// Locks foldBpm — the BPM octave-fold that used to be an inline browser-FREEZE
// landmine (60/median with median possibly 0 → Infinity → `while (bpm>180)
// bpm/=2` spins forever and hard-locks the tab).
//
// Run: node trippy/bpm.test.mjs
import { foldBpm } from './bpm.js';

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  expected ${b}, got ${a}`); }
}
function approx(a, b, msg, eps = 1e-9) {
  if (typeof a === 'number' && Math.abs(a - b) < eps) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  expected ~${b}, got ${a}`); }
}

// ── The freeze guard: the whole point of the extraction ──────────────────
// A median of 0 (two beats in the same instant) is what made the inline
// `60/median` produce Infinity and hang the octave-fold loop. It must now
// return null (skip the update), NOT Infinity, and — critically — RETURN
// (this test process itself would hang if the guard regressed).
eq(foldBpm(0), null, 'median 0 → null (no Infinity, no hang)');
eq(foldBpm(-0.5), null, 'negative median → null (would spin `while bpm<70` forever)');
eq(foldBpm(NaN), null, 'NaN median → null');
eq(foldBpm(Infinity), null, 'Infinity median → null');
eq(foldBpm(undefined), null, 'undefined median → null');
eq(foldBpm(null), null, 'null median → null');

// ── Correct octave-folding into [70, 180] for valid intervals ────────────
// 0.5s interval = 120 BPM (the synth test track is 120 BPM) — in range, untouched.
approx(foldBpm(0.5), 120, '0.5s interval → 120 BPM');
// 0.18s (the refractory floor) = ~333 BPM → fold once → ~166.7.
approx(foldBpm(0.18), (60 / 0.18) / 2, '0.18s (fast) folds down into range');
// Slow beats: 2s = 30 BPM → ×2 ×2 = 120.
approx(foldBpm(2), 120, '2s interval (30 BPM) folds up to 120');
// 10s = 6 BPM → 6,12,24,48,96 — terminates at 96.
approx(foldBpm(10), 96, '10s interval (6 BPM) folds up to 96');

// Every valid result must land inside the musical window.
for (const m of [0.18, 0.2, 0.33, 0.4, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 20]) {
  const b = foldBpm(m);
  if (b !== null && b >= 70 && b <= 180) pass++;
  else { fail++; console.error(`FAIL: foldBpm(${m})=${b} outside [70,180]`); }
}

console.log(`\ntrippy/bpm: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
