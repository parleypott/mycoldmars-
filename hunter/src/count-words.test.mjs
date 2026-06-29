// Twin-lock + contract test for countWords.
//
// Locks TWO things:
//  1. The hunter-bundle copy (hunter/src/count-words.js) and the Vercel
//     serverless copy (api/_lib/count-words.js) return IDENTICAL output for
//     every input — they are hand-maintained twins that must never drift.
//  2. The hardened contract itself: 0 for empty/whitespace/non-string, exact
//     whitespace-separated token count otherwise.
//
// History: the worker's Google-Docs parser carried a divergent inline copy
// (`text.split(/\s+/).filter(w => w.length > 0).length`) that THREW on a
// non-string field — no guard. Consolidated onto hunter/src/count-words.js.
// Mutation proof: drop the `typeof text !== 'string'` guard from
// hunter/src/count-words.js and the non-string rows below go RED (throw).
//
// Run: bun hunter/src/count-words.test.mjs   (also picked up by `bun run test`)

import { countWords as hunterCW } from './count-words.js';
import { countWords as apiCW } from '../../api/_lib/count-words.js';

let pass = 0, fail = 0;
function check(label, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`  ✗ ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

// [input, expected]
const CONTRACT = [
  ['hello world', 2],
  ['one', 1],
  ['  leading and trailing  ', 3],
  ['tabs\tand\nnewlines  collapse', 4],
  ['', 0],                 // empty → 0, not the phantom 1
  ['   ', 0],              // whitespace-only → 0
  ['\t\n ', 0],            // mixed whitespace → 0
  [null, 0],               // non-string guard (the bug the worker copy lacked)
  [undefined, 0],
  [42, 0],
  [{}, 0],
  [['a', 'b'], 0],
];

for (const [input, want] of CONTRACT) {
  const label = `count(${JSON.stringify(input)})`;
  // Both copies must agree with the contract...
  check(`hunter ${label}`, hunterCW(input), want);
  check(`api    ${label}`, apiCW(input), want);
  // ...and with each other (twin-lock).
  check(`twin   ${label}`, hunterCW(input), apiCW(input));
}

console.log(`\ncount-words twin-lock: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
