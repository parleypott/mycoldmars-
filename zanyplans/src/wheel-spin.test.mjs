// Mutation-proven lock on the glitch-wheel spin contract (zanyplans/src/wheel-spin.js).
//
// Hand-rolled assert style to match the repo runner (bun <file>, no node:test).
//
// THE BUG THIS GUARDS: the old inline handler folded `+ segAngle/2` into
// currentRotation on every spin, so the half-segment centering offset compounded.
// After the first spin, alternate spins stopped the pointer dead on a segment
// BOUNDARY (looks broken) and the announced effect drifted off the wedge actually
// under the pointer (defeats the whole point of a spin wheel).
//
// The load-bearing guarantees:
//   1. Every spin — even after 300 chained spins — lands the chosen segment's
//      CENTER under the top pointer (no boundary drift).
//   2. The announced effect == the wedge actually under the pointer, every spin.
//   3. Each spin advances forward by >= 3 full turns.

import { planSpin, selectedFromAngle } from './wheel-spin.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// Independent reference (NOT the source under test): which segment's midpoint is
// nearest the top pointer (clock-angle 0) at a given rotation.
function segmentUnderPointer(rotation, n) {
  const step = 360 / n;
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const mid = (((i * step + step / 2 + rotation) % 360) + 360) % 360;
    const d = Math.min(mid, 360 - mid);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// Deterministic LCG so the test is reproducible (no Math.random).
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

const N = 9; // the live wheel has 9 segments
const segAngle = 360 / N;

// 1. Every chained landing is a clean center (no boundary drift).
{
  const rng = lcg(12345);
  let cur = 0, worstOff = 0;
  for (let i = 0; i < 300; i++) {
    const t = planSpin(cur, N, rng);
    cur = t;
    const r = ((t % 360) + 360) % 360;
    const offCenter = Math.abs((r % segAngle) - segAngle / 2);
    if (offCenter > worstOff) worstOff = offCenter;
  }
  ok(worstOff < 1e-9, `300 chained spins all land on centers (worst off-center ${worstOff.toFixed(4)}deg)`);
}

// 2. Announced effect == wedge actually under the pointer, every spin.
{
  const rng = lcg(999);
  let cur = 0, mismatches = 0;
  for (let i = 0; i < 300; i++) {
    const t = planSpin(cur, N, rng);
    cur = t;
    if (selectedFromAngle(t, N) !== segmentUnderPointer(t, N)) mismatches++;
  }
  ok(mismatches === 0, `300 chained spins: announced always matches pointer (${mismatches} mismatches)`);
}

// 3. Always spins forward by at least 2 full turns (extraRotations 3..6 minus the
//    stripped partial turn => advance is always > 2 turns; never backwards/static).
{
  const rng = lcg(7);
  let cur = 0, minAdvance = Infinity;
  for (let i = 0; i < 50; i++) {
    const t = planSpin(cur, N, rng);
    minAdvance = Math.min(minAdvance, t - cur);
    cur = t;
  }
  ok(minAdvance > 2 * 360, `every spin advances forward > 2 full turns (min ${minAdvance.toFixed(1)}deg)`);
}

// 4. Direct landing<->selection correspondence at each centered angle.
{
  let bad = 0;
  for (let seg = 0; seg < N; seg++) {
    const angle = seg * segAngle + segAngle / 2; // segment `seg` centered at top
    if (selectedFromAngle(angle, N) !== segmentUnderPointer(angle, N)) bad++;
  }
  ok(bad === 0, `selectedFromAngle matches the pointer at all ${N} centered angles (${bad} wrong)`);
}

// 5. Selection is rotation-periodic over whole turns.
{
  const angle = 3 * segAngle + segAngle / 2;
  ok(selectedFromAngle(angle, N) === selectedFromAngle(angle + 360 * 5, N),
    'selection unchanged after adding whole turns');
}

console.log(`\nwheel-spin: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
