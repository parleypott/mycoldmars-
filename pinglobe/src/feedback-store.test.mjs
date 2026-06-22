// Locks parseFeedbackList — the guard behind PinGlobe's feedback-submit handler
// (pinglobe/src/main.js). The handler does `const stored = parseFeedbackList(...);
// stored.push(entry)`. The OLD inline form was
// `JSON.parse(localStorage.getItem('pg-feedback') || '[]')` with NO try/catch,
// so a corrupt/legacy store crashed the submit two ways: malformed JSON threw
// (unhandled), and a valid-but-non-array made `stored.push` not a function.
// Same JSON.parse(localStorage) type-confusion class hardened across glossary
// loadBench, research sessions-store, snapshot readIndex, sot-hunter loadFeedback,
// westchester parseArrayLS, and burma-essays offlineIds/loadEssaysCache.
//
// Run: node pinglobe/src/feedback-store.test.mjs  (or `bun run test`)

import { parseFeedbackList } from './feedback-store.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${g}\n  want: ${w}`); };
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── Inline RED proof: the OLD inline form (no try/catch) crashes the real
// consumer (.push) on a non-array AND throws on malformed JSON. parseFeedbackList
// defuses both.
function oldInlineRead(raw) {
  // exact pre-fix logic: JSON.parse(getItem('pg-feedback') || '[]')
  const stored = JSON.parse(raw || '[]');
  stored.push({ probe: true }); // the bare .push the handler does
  return stored;
}
{
  let threwObj = false, threwMalformed = false;
  try { oldInlineRead('{}'); } catch { threwObj = true; }
  try { oldInlineRead('{bad'); } catch { threwMalformed = true; }
  ok(threwObj, 'RED proof: OLD read crashes (.push) on a non-array object store');
  ok(threwMalformed, 'RED proof: OLD read throws on malformed JSON (no try/catch)');
  // the fixed path never crashes the consumer
  for (const raw of ['{}', '{bad', '5', '"x"', 'null']) {
    const v = parseFeedbackList(raw); let crashed = false;
    try { v.push({ probe: true }); } catch { crashed = true; }
    ok(!crashed && Array.isArray(v), `fixed path push-safe for ${JSON.stringify(raw)}`);
  }
}

// ── Every non-array shape degrades to [] ──
eq(parseFeedbackList('{}'), [], 'empty object -> []');
eq(parseFeedbackList('{"a":1}'), [], 'populated object -> []');
eq(parseFeedbackList('5'), [], 'number -> []');
eq(parseFeedbackList('0'), [], 'zero -> []');
eq(parseFeedbackList('true'), [], 'boolean -> []');
eq(parseFeedbackList('"x"'), [], 'string -> []');
eq(parseFeedbackList('null'), [], 'JSON-literal null -> []');

// ── Malformed / missing -> [] (no try/catch in the old code; here it's caught) ──
eq(parseFeedbackList('{bad'), [], 'malformed JSON -> []');
eq(parseFeedbackList('[1,2,'), [], 'truncated array -> []');
eq(parseFeedbackList(null), [], 'null (getItem miss) -> []');
eq(parseFeedbackList(undefined), [], 'undefined -> []');
eq(parseFeedbackList(''), [], 'empty string -> []');

// ── No regression: a real feedback array passes through verbatim ──
const real = [
  { text: 'great game', ts: '2026-06-22T10:00:00.000Z', ua: 'Mozilla/5.0' },
  { text: 'too hard', ts: '2026-06-22T11:00:00.000Z', ua: 'Mozilla/5.0' },
];
eq(parseFeedbackList(JSON.stringify(real)), real, 'real array preserved (order + fields)');
eq(parseFeedbackList('[]'), [], 'empty array preserved');
eq(parseFeedbackList('["a","b","c"]'), ['a', 'b', 'c'], 'string array preserved + order');

// ── Invariant sweep: parseFeedbackList() is ALWAYS .push-safe across hostile inputs ──
for (const raw of ['{}', '[1]', '5', '"x"', 'null', 'true', '{bad', '', null, undefined, '{"len":99}']) {
  const v = parseFeedbackList(raw);
  let safe = Array.isArray(v);
  try { v.push({ x: 1 }); } catch { safe = false; }
  ok(safe, `invariant: push-safe array for ${JSON.stringify(raw)}`);
}

console.log(`\npinglobe feedback-store: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
