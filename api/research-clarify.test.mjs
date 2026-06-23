// Lock for api/research-clarify.js parseClarifyJson — the public clarifier's
// response parser. Closes the null-parse class follow-up: a literal-null /
// number / string / array model reply must be treated as a failed clarify
// (ok:false → handler 502s → frontend cleanly skips) instead of being passed
// straight through as a bare "null"/"5"/"[…]" 200 body.
//
// Run: bun api/research-clarify.test.mjs   (auto-discovered by `bun run test`)

import { parseClarifyJson } from './research-clarify.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

// ---------------------------------------------------------------------------
// Inline RED proof: reconstruct the OLD inline extraction and assert it
// PASSED a non-object reply straight through (the bug), while parseClarifyJson
// rejects it.
function oldExtract(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(m ? m[1] : text); // throws on invalid JSON; SUCCEEDS on "null"/"5"/"[…]"
}
{
  // The old code returned these verbatim (no throw) → backend sent a bare body.
  eq(oldExtract('null'), null, 'RED: old extract returns bare null on a literal-null reply');
  eq(oldExtract('5'), 5, 'RED: old extract returns a bare number');
  eq(oldExtract('[1,2,3]'), [1, 2, 3], 'RED: old extract returns a bare array');
  // The fix treats all three as a failed clarify.
  eq(parseClarifyJson('null'), { ok: false, value: null }, 'fix: literal-null → ok:false');
  eq(parseClarifyJson('5'), { ok: false, value: null }, 'fix: number → ok:false');
  eq(parseClarifyJson('[1,2,3]'), { ok: false, value: null }, 'fix: array → ok:false');
}

// ---------------------------------------------------------------------------
// Valid object replies → ok:true, value preserved (no regression).
{
  const r = parseClarifyJson('{"questions":[{"id":"q1","question":"x"}],"summary":"s"}');
  ok(r.ok === true, 'raw valid object → ok:true');
  eq(r.value, { questions: [{ id: 'q1', question: 'x' }], summary: 's' }, 'raw valid object preserved verbatim');
}
{
  // Fenced (the common case the model actually emits).
  const r = parseClarifyJson('```json\n{"questions":[],"summary":"hi"}\n```');
  ok(r.ok === true, 'fenced valid object → ok:true');
  eq(r.value, { questions: [], summary: 'hi' }, 'fenced valid object unwrapped + preserved');
}
{
  // Bare ``` fence (no json tag).
  const r = parseClarifyJson('```\n{"summary":"a"}\n```');
  ok(r.ok === true && r.value.summary === 'a', 'bare ``` fence → ok:true, parsed');
}
{
  // PROSE BEFORE the fence — the reason the extractor uses a mid-text match,
  // NOT a leading/trailing strip. This must still work (no regression).
  const r = parseClarifyJson('Here are the questions:\n```json\n{"questions":[{"id":"q1"}],"summary":"z"}\n```\nHope that helps!');
  ok(r.ok === true, 'prose-wrapped fenced object → ok:true');
  eq(r.value.summary, 'z', 'prose-wrapped: correct object extracted');
}

// ---------------------------------------------------------------------------
// Genuinely-invalid JSON → ok:false (unchanged 502 behavior).
{
  eq(parseClarifyJson('this is not json at all'), { ok: false, value: null }, 'plain prose → ok:false');
  eq(parseClarifyJson('{ broken: '), { ok: false, value: null }, 'truncated JSON → ok:false');
  eq(parseClarifyJson('```json\n{ nope\n```'), { ok: false, value: null }, 'fenced-but-broken JSON → ok:false');
}

// ---------------------------------------------------------------------------
// Degenerate inputs never throw.
{
  eq(parseClarifyJson(''), { ok: false, value: null }, 'empty string → ok:false no-throw');
  eq(parseClarifyJson(null), { ok: false, value: null }, 'null arg → ok:false no-throw');
  eq(parseClarifyJson(undefined), { ok: false, value: null }, 'undefined arg → ok:false no-throw');
  // Empty-object reply is a VALID object (the frontend ?? defaults handle empties).
  const r = parseClarifyJson('{}');
  ok(r.ok === true, 'empty object {} → ok:true (a real, if empty, object)');
  eq(r.value, {}, 'empty object preserved');
}

// ---------------------------------------------------------------------------
// String reply (e.g. the model answers in prose-as-a-JSON-string) → ok:false.
{
  eq(parseClarifyJson('"just a string"'), { ok: false, value: null }, 'JSON-string reply → ok:false');
  eq(parseClarifyJson('true'), { ok: false, value: null }, 'JSON boolean → ok:false');
}

// ---------------------------------------------------------------------------
console.log(`research-clarify parseClarifyJson: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗', f); process.exit(1); }
