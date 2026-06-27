// Locks the name-quiz + trivia choice builders against the "shuffle called for
// a side effect that no longer exists" regression. shuffle() is copy-first
// (non-mutating); buildNameChoices/buildTriviaAnswers MUST use its return value.
// The buggy form (`shuffleFn(x); use x`) leaves the correct answer pinned to the
// first button and freezes the decoys to the first dishes in data order.
//
// Mutation proof: a REVERSING shuffleFn makes the used-return path put the
// correct answer LAST and draw decoys from the END of the pool. The ignore-the-
// return bug would instead leave the correct answer FIRST and decoys at the
// START — every assertion below flips RED.

import { buildNameChoices, buildTriviaAnswers } from './ui.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('FAIL:', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Deterministic stubs (both return a NEW array, matching the real contract).
const reverse = (arr) => [...arr].reverse();
const identity = (arr) => [...arr];

const FOODS = [
  { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' },
];
const correct = FOODS[0]; // 'a'

// ── buildNameChoices ──────────────────────────────────────────────────────
{
  // identity shuffle: others = [b,c,d,e], slice(0,3) = [b,c,d], all = [a,b,c,d]
  const r = buildNameChoices(FOODS, correct, identity);
  eq(r.length, 4, 'name choices length');
  eq(r[0].id, 'a', 'identity: correct is first');
  ok(r.some((f) => f.id === 'a'), 'identity: correct present');
}

{
  // reversing shuffle exercises the used-return path:
  //   others input  = [b,c,d,e]  -> reversed [e,d,c,b]
  //   slice(0,3)     = [e,d,c]
  //   all input      = [a,e,d,c] -> reversed [c,d,e,a]
  const r = buildNameChoices(FOODS, correct, reverse);
  const ids = r.map((f) => f.id);
  eq(ids.length, 4, 'reverse: length');
  // The single sharpest mutation guard: if the return value were ignored, the
  // correct answer would be FIRST. Used properly, it lands LAST here.
  ok(ids[0] !== 'a', 'reverse: correct NOT first (return value used)');
  eq(ids[ids.length - 1], 'a', 'reverse: correct is last');
  // Decoys must come from the SHUFFLED pool. Reversed -> {c,d,e}; the buggy
  // side-effect form would give the first-three-in-data-order {b,c,d}.
  const decoys = new Set(ids.filter((id) => id !== 'a'));
  ok(decoys.has('e'), 'reverse: decoys drawn from shuffled pool (includes e)');
  ok(!decoys.has('b'), 'reverse: decoys NOT frozen to data head (excludes b)');
}

{
  // Real shuffle must not mutate the caller's foods array.
  const snapshot = FOODS.map((f) => f.id).join(',');
  const r = buildNameChoices(FOODS, correct);
  eq(FOODS.map((f) => f.id).join(','), snapshot, 'real shuffle: input not mutated');
  eq(r.length, 4, 'real shuffle: 4 choices');
  ok(r.some((f) => f.id === 'a'), 'real shuffle: correct present');
  eq(new Set(r.map((f) => f.id)).size, 4, 'real shuffle: no duplicate choices');
}

// ── buildTriviaAnswers ────────────────────────────────────────────────────
{
  const trivia = { answer: 'X', decoys: ['p', 'q', 'r'] };
  // identity: [X,p,q,r] -> answer first
  const idr = buildTriviaAnswers(trivia, identity);
  eq(idr[0], 'X', 'identity trivia: answer first');
  eq(idr.length, 4, 'identity trivia: length');

  // reverse: [X,p,q,r] -> [r,q,p,X] -> answer LAST, not first.
  const rr = buildTriviaAnswers(trivia, reverse);
  ok(rr[0] !== 'X', 'reverse trivia: answer NOT first (return value used)');
  eq(rr[rr.length - 1], 'X', 'reverse trivia: answer last');
  ok(rr.includes('X'), 'reverse trivia: answer present');
  eq(rr.length, 4, 'reverse trivia: length');

  // Real shuffle: answer always present, set preserved, input untouched.
  const before = [trivia.answer, ...trivia.decoys].join(',');
  const real = buildTriviaAnswers(trivia);
  ok(real.includes('X'), 'real trivia: answer present');
  eq(new Set(real).size, 4, 'real trivia: all 4 distinct');
  eq([trivia.answer, ...trivia.decoys].join(','), before, 'real trivia: source untouched');
}

console.log(`ui-choices: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
