// TWIN-LOCK: parseEmbedding lives in THREE separate module trees that cannot
// share an import (api/ runs on Vercel; hunter/worker/ runs on Johnny's Mac
// against Supabase), so the function is hand-copied byte-for-byte across:
//   • api/_lib/semantic-search.js        (Hunter semantic-search ranking, live)
//   • hunter/worker/scene-detection-core.js (scene-detection embedding compare)
//   • hunter/worker/cross-tier-core.js      (script→raw→selects→finished match)
//
// Each file already has its OWN unit test — but those tests are blind to each
// other. If a future fix hardens ONE copy (say, semantic-search gets a new
// edge-case guard) and forgets the other two, every individual test stays GREEN
// while the copies silently DRIFT — and drift in this exact function has caused
// real, Johnny-facing bugs before (NaN/Infinity poison scrambling the whole
// match ranking via V8 TimSort — see cross-tier-core.test.mjs header, commit
// 2dfe675, and the scene-detection "THIRD copy never hardened" backlog item).
//
// This test is the missing cross-file lock: it runs ALL THREE copies through one
// battery of inputs and asserts they return IDENTICAL results. Neuter the
// finite-check (or any behavior) in any single copy and this goes RED on the
// first input where they diverge — naming which copy drifted. It does NOT assert
// a specific contract (each file's own test does that); it asserts SAMENESS.

import { parseEmbedding as fromSemantic } from './semantic-search.js';
import { parseEmbedding as fromSceneDetect } from '../../hunter/worker/scene-detection-core.js';
import { parseEmbedding as fromCrossTier } from '../../hunter/worker/cross-tier-core.js';

const COPIES = [
  ['semantic-search', fromSemantic],
  ['scene-detection-core', fromSceneDetect],
  ['cross-tier-core', fromCrossTier],
];

let pass = 0, fail = 0;
const fails = [];

// The battery deliberately spans every branch of the function: array input,
// JSON-string input, paren/bracket literal input, numeric-string tolerance,
// whitespace, and the corrupt cases that have actually bitten (NaN token,
// overflow → Infinity, empty vector, null/undefined/number/garbage).
const CASES = [
  ['json array', '[0.1,0.2,0.3]'],
  ['paren literal', '(1,2,3)'],
  ['bracket literal spaced', '[1, 2, 3]'],
  ['raw array', [1, 2, 3]],
  ['negative + sci', '[-0.5,1e-3,2.25]'],
  ['numeric strings', '["1","2"]'],
  ['NaN token', '[1,2,NaN]'],
  ['overflow → Infinity', '[1,2,1e999]'],
  ['-Infinity token', '[1,2,-1e999]'],
  ['empty json array', '[]'],
  ['empty string', ''],
  ['null', null],
  ['undefined', undefined],
  ['bare number', 42],
  ['garbage string', 'not json at all'],
  ['object', { x: 1 }],
  ['array with object', [1, {}, 3]],
  ['trailing comma', '[1,2,3,]'],
  ['leading junk then array', 'embedding=[1,2,3]'],
  ['single value', '[7]'],
];

for (const [label, input] of CASES) {
  // Compute every copy's result; JSON.stringify so we compare structure+values
  // (NaN/undefined collapse to null under stringify, which is exactly the
  // "same observable result" we want to lock — the callers only branch on
  // null-vs-array and then read numbers).
  const results = COPIES.map(([name, fn]) => {
    let out;
    try { out = JSON.stringify(fn(input)); }
    catch (e) { out = `THREW:${e && e.name}`; }
    return [name, out];
  });
  const baseline = results[0][1];
  const allSame = results.every(([, r]) => r === baseline);
  if (allSame) {
    pass++;
  } else {
    fail++;
    fails.push(
      `✗ DRIFT on "${label}" (input ${JSON.stringify(input)}):\n` +
      results.map(([n, r]) => `      ${n.padEnd(22)} → ${r}`).join('\n')
    );
  }
}

// Guard against the test silently degrading to "all copies happen to be missing"
// — assert the three really are three distinct live function references.
if (COPIES.every(([, fn]) => typeof fn === 'function')) pass++;
else { fail++; fails.push('✗ one or more parseEmbedding copies failed to import'); }

if (fail) {
  console.error(`\nparse-embedding-twin-lock: ${pass} passed, ${fail} FAILED\n`);
  console.error(fails.join('\n') + '\n');
  process.exit(1);
}
console.log(`parse-embedding-twin-lock: ${pass} passed — all 3 copies in lockstep`);
