/**
 * SOT Hunter feedback-store hardening — parseFeedbackList.
 *
 * loadFeedback() reads the thumbs feedback list out of localStorage. logFeedback
 * then does `const all = loadFeedback(); all.push(...)` on the feedback-SUBMIT
 * path (thumbs up/down on a hunt result), and getSotHunterFeedback() exports the
 * raw list for auditing. Both assume an ARRAY.
 *
 * JSON.parse of a valid-but-NON-array stored value ('{}', '5', '"x"' — a
 * corrupt/legacy/tampered FEEDBACK_KEY) SUCCEEDS, so the old
 * `JSON.parse(getItem(KEY) || '[]')` returned that non-array verbatim — and
 * `all.push(...)` then threw "all.push is not a function" on submit, with no
 * recovery. Same JSON.parse(localStorage) type-confusion class hardened this
 * week in research/sessions-store.js, glossary loadBench, westchester
 * parseArrayLS, command-palette parseRecent.
 *
 * parseFeedbackList GUARANTEES an array: a non-array, malformed JSON, or absent
 * (null) value all degrade to []. A real array passes through verbatim.
 *
 * Run: node src/sot-hunter-feedback.test.mjs   (or: bun run test)
 */
import { parseFeedbackList } from './sot-hunter.js';

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label}`); }
};
const isArr = (v) => Array.isArray(v);

// --- RED PROOF: reconstruct the OLD loadFeedback body and show it returns a
//     non-array that then CRASHES the real logFeedback `.push` consumer. ---
function oldLoadFeedback(stored) {
  // old: JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]')
  try { return JSON.parse((stored == null ? null : stored) || '[]'); }
  catch { return []; }
}
{
  // a corrupt store holding a valid-but-non-array JSON object
  const oldVal = oldLoadFeedback('{}');
  ok(!isArr(oldVal), 'RED: old loadFeedback returns a NON-array on a "{}" store');
  let oldCrashed = false;
  try { oldVal.push({ verdict: 'hit' }); } catch { oldCrashed = true; }
  ok(oldCrashed, 'RED: old logFeedback .push CRASHES on the non-array (the live bug)');

  // the fix: parseFeedbackList degrades to [] and .push works
  const newVal = parseFeedbackList('{}');
  ok(isArr(newVal) && newVal.length === 0, 'FIX: parseFeedbackList("{}") -> []');
  let newCrashed = false;
  try { newVal.push({ verdict: 'hit' }); } catch { newCrashed = true; }
  ok(!newCrashed && newVal.length === 1, 'FIX: .push works after parseFeedbackList');
}

// --- every non-array stored shape -> [] (never crashes a .push consumer) ---
const nonArrayStores = ['{}', '{"a":1}', '5', '0', '"x"', 'true', 'false', 'null'];
for (const s of nonArrayStores) {
  const v = parseFeedbackList(s);
  ok(isArr(v) && v.length === 0, `non-array store ${JSON.stringify(s)} -> []`);
}

// --- malformed / absent / empty -> [] ---
ok(isArr(parseFeedbackList('not json')) && parseFeedbackList('not json').length === 0, 'malformed JSON -> []');
ok(isArr(parseFeedbackList('[1,2,')) && parseFeedbackList('[1,2,').length === 0, 'truncated JSON -> []');
ok(isArr(parseFeedbackList(null)) && parseFeedbackList(null).length === 0, 'null (absent key) -> []');
ok(isArr(parseFeedbackList(undefined)) && parseFeedbackList(undefined).length === 0, 'undefined -> []');
ok(isArr(parseFeedbackList('')) && parseFeedbackList('').length === 0, 'empty string -> []');

// --- NO REGRESSION: a real array passes through verbatim (contents + order) ---
{
  const arr = [
    { mode: 'theme', verdict: 'hit', at: '2026-06-22T00:00:00.000Z' },
    { pasted: 'x', verdict: 'miss', at: '2026-06-22T00:01:00.000Z' },
    { mode: 'theme', verdict: 'hit', at: '2026-06-22T00:02:00.000Z' },
  ];
  const out = parseFeedbackList(JSON.stringify(arr));
  ok(isArr(out) && out.length === 3, 'real array -> array of same length');
  ok(out[0].verdict === 'hit' && out[1].verdict === 'miss' && out[2].verdict === 'hit', 'array contents + order preserved');
  ok(out[1].pasted === 'x', 'array element fields preserved');
}
ok(isArr(parseFeedbackList('[]')) && parseFeedbackList('[]').length === 0, 'empty array store -> []');
{
  const out = parseFeedbackList('[{"verdict":"hit"}]');
  ok(isArr(out) && out.length === 1 && out[0].verdict === 'hit', 'single-entry array preserved');
}

// --- INVARIANT: parseFeedbackList is ALWAYS a .push-safe array across hostile inputs ---
const hostile = ['{}', '5', '"s"', 'true', 'null', 'garbage', '', null, undefined, '{"length":3}', '[1]'];
for (const s of hostile) {
  const v = parseFeedbackList(s);
  let crashed = false;
  try { v.push(1); v.pop(); v.slice(0); v.map(x => x); } catch { crashed = true; }
  ok(isArr(v) && !crashed, `invariant: ${JSON.stringify(s)} -> array, .push/.slice/.map never throw`);
}

console.log(`\nsot-hunter-feedback: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
