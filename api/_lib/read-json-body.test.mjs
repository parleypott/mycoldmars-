// Tests for the shared safe JSON-body reader that closes the two unhandled-500
// crash modes across the research-* endpoints.
//
// RED proof: the OLD shape was `const { prompt } = await req.json();` with no
// try/catch and no object guard. Reconstructed here to prove it throws on both
// a rejecting .json() AND a JSON `null` body — exactly what readJsonBody fixes.
//
// Run: node api/_lib/read-json-body.test.mjs   (also picked up by `bun run test`)
import { readJsonBody, coerceObjectBody } from './read-json-body.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
async function throws(fn) { try { await fn(); return false; } catch { return true; } }

// A fake Request whose .json() resolves to `value`.
const reqResolving = (value) => ({ json: async () => value });
// A fake Request whose .json() rejects (malformed body).
const reqRejecting = () => ({ json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });

// The OLD handler body, reconstructed verbatim, for the RED proof.
async function oldHandlerParse(req) {
  const { prompt } = await req.json();   // <- no try/catch, no null guard
  return prompt;
}

// ── RED PROOF: the old logic crashes on both modes ──────────────────────────
ok(await throws(() => oldHandlerParse(reqRejecting())),
  'RED: old destructure throws (unhandled) when req.json() rejects');
ok(await throws(() => oldHandlerParse(reqResolving(null))),
  'RED: old destructure throws TypeError on a JSON `null` body');
// ...and the shipped reader survives both:
{
  const a = await readJsonBody(reqRejecting());
  ok(a.ok === false && a.status === 400, 'reader: rejecting .json() -> ok:false 400 (no throw)');
  const b = await readJsonBody(reqResolving(null));
  ok(b.ok === false && b.status === 400, 'reader: JSON null body -> ok:false 400 (no throw)');
}

// ── malformed body (parse rejects) -> clean 400 ─────────────────────────────
{
  const r = await readJsonBody(reqRejecting());
  ok(r.ok === false, 'malformed: ok false');
  ok(r.status === 400, 'malformed: status 400');
  ok(r.error === 'invalid json', 'malformed: error message');
  ok(!('body' in r), 'malformed: no body field');
}

// ── non-object valid JSON -> clean 400, never crashes ───────────────────────
for (const [label, value] of [
  ['null', null],
  ['number', 42],
  ['string', 'hello'],
  ['boolean', true],
  ['array', [1, 2, 3]],
]) {
  const r = await readJsonBody(reqResolving(value));
  ok(r.ok === false, `non-object ${label}: ok false`);
  ok(r.status === 400, `non-object ${label}: status 400`);
  ok(r.error === 'body must be a json object', `non-object ${label}: error message`);
}

// ── valid object bodies -> ok:true, body passthrough ────────────────────────
{
  const obj = { prompt: 'what is the capital of france?' };
  const r = await readJsonBody(reqResolving(obj));
  ok(r.ok === true, 'object: ok true');
  ok(r.body === obj, 'object: same body reference passed through');
  ok(r.error === undefined, 'object: no error field');
  ok(r.status === undefined, 'object: no status field on success');
  // destructuring the returned body is now safe
  const { prompt } = r.body;
  ok(prompt === 'what is the capital of france?', 'object: destructure works on body');
}
{
  // empty object is a valid object (missing fields are the endpoint's own concern)
  const r = await readJsonBody(reqResolving({}));
  ok(r.ok === true, 'empty object: ok true');
  const { prompt } = r.body;
  ok(prompt === undefined, 'empty object: missing field -> undefined, not a crash');
}
{
  // multi-field body (research-synthesize / research-tts shapes)
  const r = await readJsonBody(reqResolving({ prompt: 'x', claude: 'a', chatgpt: 'b', gemini: 'c' }));
  ok(r.ok === true, 'multi-field: ok true');
  ok(r.body.claude === 'a' && r.body.gemini === 'c', 'multi-field: fields intact');
}

// ── coerceObjectBody: the inline-reader guard ───────────────────────────────
// Used by qss-stories (POST) and qss-world-style (PUT), which read the body
// with the weaker `await req.json().catch(() => ({}))` idiom and then access
// `body.x` RAW. coerceObjectBody turns every non-object into `{}` so those
// raw accesses can't throw a TypeError that surfaces as a 500.
//
// RED proof: the shipped handler shape, reconstructed. With a JSON `null` body
// the `.catch(() => ({}))` does NOT fire (null is valid JSON, not a parse
// error), so body stays null and `body.name` throws — exactly the 500 path
// these two handlers had. Wrapping in coerceObjectBody fixes it.
async function oldInlineHandler(req) {
  const body = await req.json().catch(() => ({}));
  return (body.name || '').toString().trim();        // <- throws on null body
}
async function fixedInlineHandler(req) {
  const body = coerceObjectBody(await req.json().catch(() => ({})));
  return (body.name || '').toString().trim();        // <- safe: body is always an object
}
ok(await throws(() => oldInlineHandler(reqResolving(null))),
  'RED: old inline `.catch(()=>({}))` + raw body.name throws on a JSON null body');
ok(!(await throws(() => oldInlineHandler(reqResolving([1, 2])))),
  'baseline: array body does NOT throw on body.name (only null/undefined do) — coerce still normalizes it to {}');
// the fix never throws and yields the empty-name → handler returns its own ''/400 path
ok((await fixedInlineHandler(reqResolving(null))) === '',
  'FIX: coerced null body → {} → empty name (handler returns its own 400), no throw');
ok((await fixedInlineHandler(reqResolving(42))) === '',
  'FIX: coerced number body → {} → empty name, no throw');
ok((await fixedInlineHandler(reqResolving('hi'))) === '',
  'FIX: coerced string body → {} → empty name, no throw');
ok((await fixedInlineHandler(reqResolving([1, 2]))) === '',
  'FIX: coerced array body → {} → empty name, no throw');

// coerceObjectBody unit contract
ok(coerceObjectBody(null) && typeof coerceObjectBody(null) === 'object' && !Array.isArray(coerceObjectBody(null)),
  'coerce: null → plain object {}');
ok(Object.keys(coerceObjectBody(null)).length === 0, 'coerce: null → EMPTY object');
ok(Object.keys(coerceObjectBody(42)).length === 0, 'coerce: number → {}');
ok(Object.keys(coerceObjectBody('hi')).length === 0, 'coerce: string → {}');
ok(Object.keys(coerceObjectBody(true)).length === 0, 'coerce: boolean → {}');
ok(Array.isArray(coerceObjectBody([1, 2])) === false && Object.keys(coerceObjectBody([1, 2])).length === 0,
  'coerce: array → {} (NOT passed through as an array)');
ok(coerceObjectBody(undefined) && Object.keys(coerceObjectBody(undefined)).length === 0,
  'coerce: undefined → {}');
{
  const obj = { name: 'Scarlet', id: 'abc' };
  ok(coerceObjectBody(obj) === obj, 'coerce: plain object passes through BY REFERENCE (zero copy / zero change)');
}

// ── report ──────────────────────────────────────────────────────────────────
if (fail) {
  console.error(`read-json-body: ${pass} passed, ${fail} FAILED`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`read-json-body: ${pass} passed, 0 failed`);
