// shuffle.test.mjs
//
// Locks the Fisher-Yates shuffle() shared by the hakka and night-market street-food
// study tools (both import the byte-identical src/ui.js — see quiz-reveal.test.mjs).
//
// THE DIVERGENCE (fixed): five projects carried a copy of shuffle. Three (fascism,
// flyingmoney, modern-middle-east) were COPY-FIRST — `const a = [...arr]` — so they
// never touched the caller's array. Two (hakka, night-market) were IN-PLACE: they
// swapped elements of the passed-in `arr` directly and returned it. Every call site
// in ui.js happens to pass a throwaway array (a .filter() result or an array literal),
// so the in-place form was harmless TODAY — but a future `shuffle(somePool)` on a
// shared/imported array (e.g. the foods pool) would have silently and permanently
// reordered that pool. This test locks the safe, side-effect-free contract so the
// in-place form can never creep back in.
//
// We import the SHIPPED function straight from the live source — it only depends on
// foods data at module load, no DOM at import time. Mutation-proven: revert shuffle to
// the in-place form (drop the `const a = [...arr]` and operate on `arr`) and the
// "does not mutate its input" assertion goes RED.

import assert from 'node:assert';
import { shuffle } from './src/ui.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

const multiset = (a) => [...a].sort((x, y) => (x > y ? 1 : x < y ? -1 : 0));

// ── 1. Does NOT mutate its input (the load-bearing fix) ──
const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const before = [...input];
const result = shuffle(input);
ok(
  JSON.stringify(input) === JSON.stringify(before),
  'shuffle does NOT reorder/mutate the array it was given (the in-place form fails here)',
);
ok(result !== input, 'shuffle returns a NEW array, not the same reference');

// ── 2. Returns a true permutation: same length, same elements ──
ok(result.length === input.length, 'output length equals input length');
ok(
  JSON.stringify(multiset(result)) === JSON.stringify(multiset(input)),
  'output is a permutation of the input — no elements lost, added, or duplicated',
);

// ── 3. Edge cases: empty and singleton (the loop body never runs) ──
const empty = [];
const emptyOut = shuffle(empty);
ok(emptyOut.length === 0 && emptyOut !== empty, 'shuffle([]) -> a new empty array');

const one = [42];
const oneOut = shuffle(one);
ok(
  oneOut.length === 1 && oneOut[0] === 42 && oneOut !== one,
  'shuffle([x]) -> a new [x]',
);

// ── 4. It actually permutes (not a no-op): over many trials on a 10-element
//      array, at least one run must differ from sorted order. Probability of
//      every one of 50 shuffles landing back in original order is ~ (1/10!)^50,
//      i.e. effectively zero — a false failure here would mean shuffle is inert. ──
const seq = Array.from({ length: 10 }, (_, i) => i);
let everMoved = false;
for (let t = 0; t < 50; t++) {
  const out = shuffle(seq);
  if (JSON.stringify(out) !== JSON.stringify(seq)) { everMoved = true; break; }
  // also re-confirm non-mutation holds every trial
  assert.ok(JSON.stringify(seq) === JSON.stringify(Array.from({ length: 10 }, (_, i) => i)),
    'input stays pristine across repeated shuffles');
}
ok(everMoved, 'shuffle genuinely reorders elements (not an accidental no-op)');

console.log(`shuffle: ${passed} passed, 0 failed`);
