// Tests for the Winchester (Westchester House Hunter) state-sync payload
// validator — the rules that guard what gets persisted to Johnny's house-hunt
// state row. Imports the REAL shipped function (no drift-prone mirror).
//
// Run: node api/winchester-validate.test.mjs  (or: bun run test)

import { validateStatePayload, utf8ByteLength } from './_lib/winchester-validate.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

const MAX = 1024 * 1024;

// --- happy path ---
{
  const r = validateStatePayload({ state: { a: 1, listings: [{ id: 'x' }] } }, MAX);
  eq(r.ok, true, 'valid plain-object state passes');
  eq(r.state.a, 1, 'returns the state object');
  eq(typeof r.serialized, 'string', 'returns serialized string');
  eq(r.bytes, utf8ByteLength(r.serialized), 'reports byte length');
}
{
  const r = validateStatePayload({ state: {} }, MAX);
  eq(r.ok, true, 'empty object state is valid');
  eq(r.bytes, 2, 'empty object is 2 bytes ({})');
}
{
  // extra body keys (expectedUpdatedAt) are allowed — validator only checks state
  const r = validateStatePayload({ state: { ok: true }, expectedUpdatedAt: '2026-01-01' }, MAX);
  eq(r.ok, true, 'body with expectedUpdatedAt still validates on state alone');
}

// --- BAD_BODY: body must be a non-null, non-array object ---
for (const [bad, label] of [[null, 'null'], [undefined, 'undefined'], ['str', 'string'], [42, 'number'], [[], 'array']]) {
  const r = validateStatePayload(bad, MAX);
  eq(r.ok, false, `body=${label} rejected`);
  eq(r.code, 'BAD_BODY', `body=${label} -> BAD_BODY`);
  eq(r.status, 400, `body=${label} -> 400`);
}

// --- BAD_STATE: state must be a plain object ---
for (const [st, label] of [[null, 'null'], [undefined, 'undefined'], ['nope', 'string'], [7, 'number'], [[1, 2], 'array'], [true, 'boolean']]) {
  const r = validateStatePayload({ state: st }, MAX);
  eq(r.ok, false, `state=${label} rejected`);
  eq(r.code, 'BAD_STATE', `state=${label} -> BAD_STATE`);
  eq(r.status, 400, `state=${label} -> 400`);
}
{
  // missing state key entirely
  const r = validateStatePayload({ foo: 1 }, MAX);
  eq(r.ok, false, 'missing state key rejected');
  eq(r.code, 'BAD_STATE', 'missing state -> BAD_STATE');
}

// --- BAD_STATE: not JSON-serializable (circular) ---
{
  const circ = {}; circ.self = circ;
  const r = validateStatePayload({ state: circ }, MAX);
  eq(r.ok, false, 'circular state rejected');
  eq(r.code, 'BAD_STATE', 'circular -> BAD_STATE');
  eq(r.status, 400, 'circular -> 400');
}

// --- STATE_TOO_BIG: byte cap ---
{
  // A small ASCII state under a tiny cap, to exercise the boundary precisely.
  const tiny = validateStatePayload({ state: { k: 'abcdefgh' } }, 10);
  // {"k":"abcdefgh"} = 16 bytes > 10
  eq(tiny.ok, false, 'over-cap ASCII state rejected');
  eq(tiny.code, 'STATE_TOO_BIG', 'over-cap -> STATE_TOO_BIG');
  eq(tiny.status, 413, 'over-cap -> 413');
  ok(/bytes; max 10/.test(tiny.message), 'error message reports byte count and cap');
}
{
  // exactly at the cap is allowed (> not >=)
  const s = { state: { a: 'b' } }; // {"a":"b"} = 9 bytes
  const atCap = validateStatePayload(s, 9);
  eq(atCap.ok, true, 'state exactly at byte cap is allowed (strict >)');
  const overByOne = validateStatePayload(s, 8);
  eq(overByOne.ok, false, 'state one byte over cap is rejected');
}

// --- THE FIX: non-ASCII must be counted as UTF-8 BYTES, not UTF-16 units ---
// A CJK glyph is 1 string-length unit but 3 UTF-8 bytes. The old check used
// serialized.length, which undercounts ~3x for CJK — so an over-cap blob slipped through.
{
  const cjk = '中'.repeat(100);            // string length 100, 300 UTF-8 bytes
  const serialized = JSON.stringify({ note: cjk }); // {"note":"…"} wraps it
  const charLen = serialized.length;        // ~110 (the OLD, wrong measure)
  const byteLen = utf8ByteLength(serialized); // ~310 (the real wire size)
  ok(byteLen > charLen + 150, 'sanity: CJK byte length far exceeds char length');

  // Cap chosen to sit BETWEEN the two measures: the old char-based check would
  // PASS (charLen <= cap), the correct byte-based check must REJECT (bytes > cap).
  const cap = Math.floor((charLen + byteLen) / 2);
  ok(charLen <= cap, 'sanity: old char measure would have passed this cap');
  ok(byteLen > cap, 'sanity: real byte measure exceeds this cap');

  const r = validateStatePayload({ state: { note: cjk } }, cap);
  eq(r.ok, false, 'over-byte-cap CJK state is REJECTED (the fix)');
  eq(r.code, 'STATE_TOO_BIG', 'CJK over byte cap -> STATE_TOO_BIG');

  // INLINE RED PROOF: reconstruct the OLD char-based check and show it let this through.
  const oldCharCheckWouldReject = serialized.length > cap;
  eq(oldCharCheckWouldReject, false, 'RED PROOF: old serialized.length check would NOT have rejected this over-byte-cap blob');
}
{
  // Emoji: surrogate pair = 2 UTF-16 units, 4 UTF-8 bytes.
  const r = utf8ByteLength('😀');
  eq(r, 4, 'emoji is 4 UTF-8 bytes');
}

// --- default cap (1MB) when maxBytes omitted ---
{
  const r = validateStatePayload({ state: { x: 1 } });
  eq(r.ok, true, 'small state passes with default 1MB cap');
}
{
  const big = { state: { blob: 'a'.repeat(1024 * 1024 + 100) } };
  const r = validateStatePayload(big); // default cap
  eq(r.ok, false, 'state over default 1MB cap rejected');
  eq(r.code, 'STATE_TOO_BIG', 'over default cap -> STATE_TOO_BIG');
}

// --- summary ---
if (fail) {
  console.error(`\n✗ winchester-validate: ${fail} FAILED of ${pass + fail}`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ winchester-validate: all ${pass} assertions passed`);
