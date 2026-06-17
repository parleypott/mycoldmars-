/**
 * Locks the Nile flights state-sync size cap onto the shared, byte-accurate
 * validator. The endpoint USED to gate on `serialized.length > MAX_BYTES`, but
 * JS string .length is UTF-16 code units, not bytes — so the 256KB "byte" cap
 * silently undercounted every non-ASCII char (a CJK glyph is 1 unit but 3 UTF-8
 * bytes) and let an over-cap blob through, while the "N bytes" error reported a
 * char count. This pins:
 *   1. the shared validateStatePayload byte-counts at the Nile 256KB cap (the fix),
 *   2. an inline RED proof that the OLD serialized.length check let an over-byte
 *      CJK blob slip past at that cap,
 *   3. source-binding: the divergent serialized.length>MAX_BYTES check is GONE and
 *      the shared validator is imported + used.
 *
 * Run: bun api/nile-flights-state.test.mjs  (or: bun run test)
 */
import { validateStatePayload, utf8ByteLength } from './_lib/winchester-validate.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NILE_MAX_BYTES = 256 * 1024; // mirrors api/nile-flights-state.js

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { eq(!!cond, true, msg); }

// ---------------------------------------------------------------------------
// 1. The fix: the shared validator byte-counts at the Nile cap.
// ---------------------------------------------------------------------------
{
  const small = { bookings: { 'leg-1': { booked: true, by: 'Marisa' } } };
  const r = validateStatePayload({ state: small }, NILE_MAX_BYTES);
  ok(r.ok, 'a tiny booking map passes the 256KB cap');
  eq(r.state, small, 'the validated state round-trips unchanged');
}
{
  // A blob whose UTF-16 char count is UNDER the cap but whose UTF-8 byte count
  // is OVER it. CJK glyphs are 1 char / 3 bytes, so ~120K of them = ~120K chars
  // (< 262144 char cap) but ~360K bytes (> 262144 byte cap).
  const cjk = '世'.repeat(120 * 1024);
  const state = { note: cjk };
  const serialized = JSON.stringify(state);
  ok(serialized.length <= NILE_MAX_BYTES, 'precondition: char length is UNDER the 256KB cap');
  ok(utf8ByteLength(serialized) > NILE_MAX_BYTES, 'precondition: UTF-8 byte length is OVER the 256KB cap');

  const r = validateStatePayload({ state }, NILE_MAX_BYTES);
  ok(!r.ok, 'over-byte CJK blob is REJECTED by the byte-accurate validator');
  eq(r.status, 413, 'rejection status is 413');
  eq(r.code, 'STATE_TOO_BIG', 'rejection code is STATE_TOO_BIG');
  ok(/\d+ bytes/.test(r.message), 'error message reports a real byte count');
}

// ---------------------------------------------------------------------------
// 2. Inline RED proof — the OLD serialized.length check would have PASSED that
//    same over-byte blob (the bug), while the new byte check rejects it.
// ---------------------------------------------------------------------------
{
  const cjk = '世'.repeat(120 * 1024);
  const serialized = JSON.stringify({ note: cjk });
  const oldChecksReject = serialized.length > NILE_MAX_BYTES; // the pre-fix gate
  const newChecksReject = utf8ByteLength(serialized) > NILE_MAX_BYTES; // the fix
  ok(!oldChecksReject, 'RED proof: old serialized.length check did NOT reject the over-byte blob');
  ok(newChecksReject, 'GREEN: byte-accurate check DOES reject it');
}

// ---------------------------------------------------------------------------
// 3. Boundary + shape parity (the validator's job, re-asserted at the Nile cap).
// ---------------------------------------------------------------------------
{
  // exactly at the byte cap is allowed; one byte over is rejected.
  const atCap = 'a'.repeat(NILE_MAX_BYTES - JSON.stringify({ s: '' }).length);
  const r1 = validateStatePayload({ state: { s: atCap } }, NILE_MAX_BYTES);
  eq(utf8ByteLength(JSON.stringify({ s: atCap })), NILE_MAX_BYTES, 'precondition: blob is exactly at the cap');
  ok(r1.ok, 'a blob exactly at the cap is allowed');
  const r2 = validateStatePayload({ state: { s: atCap + 'b' } }, NILE_MAX_BYTES);
  ok(!r2.ok, 'one byte over the cap is rejected');

  ok(!validateStatePayload(null, NILE_MAX_BYTES).ok, 'null body rejected');
  ok(!validateStatePayload({ state: [1, 2] }, NILE_MAX_BYTES).ok, 'array state rejected');
  ok(!validateStatePayload({ state: 'x' }, NILE_MAX_BYTES).ok, 'primitive state rejected');
  ok(!validateStatePayload({ nostate: {} }, NILE_MAX_BYTES).ok, 'missing state rejected');
}

// ---------------------------------------------------------------------------
// 4. Source-binding: the divergent char-based check is GONE and the shared
//    validator is wired in. (Mutation-proof: restoring the old check fails this.)
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(__dirname, 'nile-flights-state.js'), 'utf8');
  // strip line comments so prose mentioning the old pattern doesn't false-pass
  const code = src.replace(/\/\/.*$/gm, '');
  ok(!/serialized\.length\s*>\s*MAX_BYTES/.test(code), 'the old serialized.length>MAX_BYTES gate is removed from source');
  ok(/import\s*\{[^}]*validateStatePayload[^}]*\}\s*from\s*['"]\.\/_lib\/winchester-validate\.js['"]/.test(code),
     'validateStatePayload is imported from the shared validator');
  ok(/validateStatePayload\(\s*body\s*,\s*MAX_BYTES\s*\)/.test(code), 'handler calls validateStatePayload(body, MAX_BYTES)');
}

// ---------------------------------------------------------------------------
console.log(`\nnile-flights-state: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + fails.join('\n')); process.exit(1); }
