// Mutation-lock for scene-confidence.js — the SCENE BUILDER status + confidence
// derivation. The load-bearing property: a KNOWN-keepability scene must never read
// LESS confident than the unknown-keepability floor (the bug fixed here — a raw
// 0–10 score displayed as a 0–100 percentage without the ×10 scale, so an ACCEPTED
// scene rendered ~8% while an unknown-keep scene fell back to 50–80%).

import { sceneStatus, sceneConfidence } from './scene-confidence.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${got}\n  want: ${want}`); }
};
const ok = (cond, msg) => {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
};

// --- sceneStatus: unchanged thresholds (0–10 scale) -------------------------
eq(sceneStatus(10), 'accepted', 'k=10 → accepted');
eq(sceneStatus(7), 'accepted', 'k=7 (boundary) → accepted');
eq(sceneStatus(6.9), 'refined', 'k=6.9 → refined');
eq(sceneStatus(5), 'refined', 'k=5 (boundary) → refined');
eq(sceneStatus(4.9), 'proposed', 'k=4.9 → proposed');
eq(sceneStatus(0), 'proposed', 'k=0 → proposed');
eq(sceneStatus(null), 'proposed', 'k=null → proposed');
eq(sceneStatus(undefined), 'proposed', 'k=undefined → proposed');

// --- sceneConfidence: the ×10 SCALE fix (load-bearing) ----------------------
// With rand=0 the jitter vanishes, so the value is deterministic = round(k*10).
eq(sceneConfidence(8, 0), 80, 'k=8, no jitter → 80% (was ~8% before the ×10 fix)');
eq(sceneConfidence(7, 0), 70, 'k=7, no jitter → 70%');
eq(sceneConfidence(5, 0), 50, 'k=5, no jitter → 50% (meets the unknown floor)');
eq(sceneConfidence(0, 0), 0, 'k=0, no jitter → 0%');

// Cap at 95 even for a perfect score (round(100 + jitter) clamps to 95).
eq(sceneConfidence(10, 1), 95, 'k=10 with full jitter clamps to 95%');
eq(sceneConfidence(10, 0), 95, 'k=10 → 100 clamps to 95%');

// Unknown keepability → 50–80% fallback band.
eq(sceneConfidence(null, 0), 50, 'k=null, rand=0 → 50%');
eq(sceneConfidence(null, 1), 80, 'k=null, rand=1 → 80%');

// THE INVARIANT the bug violated: a known-keep scene (k>=5, i.e. refined/accepted)
// must read at LEAST the 50% unknown floor, across the full jitter range.
for (let k = 5; k <= 10; k += 0.5) {
  for (const rand of [0, 0.5, 1]) {
    ok(sceneConfidence(k, rand) >= 50,
       `known-keep k=${k} rand=${rand} confidence must be >= 50 (unknown floor); got ${sceneConfidence(k, rand)}`);
  }
}

// And higher keepability is never LESS confident than lower (monotonic, jitter fixed).
for (const rand of [0, 0.5, 1]) {
  let prev = -1;
  for (let k = 0; k <= 10; k += 1) {
    const c = sceneConfidence(k, rand);
    ok(c >= prev, `confidence monotonic in k (rand=${rand}): k=${k} gave ${c}, prev ${prev}`);
    prev = c;
  }
}

console.log(`scene-confidence: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
