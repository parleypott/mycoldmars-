// Locks the MapKeys playback timing core (playback-timing.js) — the segment-
// resolution + easing math driving every animation frame and timeline scrub.
// Imports the REAL shipped functions. Mutation-proven: the RED blocks below
// reconstruct each guard removed and show the contract breaks.

import { EASINGS, totalDuration, resolveKeyframeSegment, easedSegmentAt } from './playback-timing.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A === B) { pass++; } else { fail++; console.error(`FAIL: ${msg}\n  expected ${B}\n  got      ${A}`); }
};
const approx = (a, b, msg, tol = 1e-9) => {
  if (typeof a === 'number' && Math.abs(a - b) <= tol) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  expected ~${b}\n  got      ${a}`); }
};
const kf = (duration, easing = 'linear') => ({ duration, easing });

// ── totalDuration ──
eq(totalDuration([]), 0, 'no keyframes → 0');
eq(totalDuration(null), 0, 'null → 0');
eq(totalDuration([kf(4)]), 0, 'single keyframe → 0 (no outgoing segment)');
eq(totalDuration([kf(4), kf(3)]), 4, 'two keyframes → duration[0] only (last has no segment)');
eq(totalDuration([kf(4), kf(3), kf(2)]), 7, 'three keyframes → duration[0]+duration[1] = 7');
eq(totalDuration([kf(1.5), kf(99), kf(0.5)]), 1.5 + 99, 'sums all but the last keyframe duration');

// RED proof: a totalDuration that summed the LAST keyframe too would over-count.
function totalDurationBuggy(keyframes) {
  let t = 0;
  for (let i = 0; i < keyframes.length; i++) t += keyframes[i].duration; // <i> should stop at length-1
  return t;
}
eq(totalDurationBuggy([kf(4), kf(3)]), 7, 'RED: buggy variant over-counts (4+3) — real code returns 4');
if (totalDuration([kf(4), kf(3)]) === totalDurationBuggy([kf(4), kf(3)])) {
  fail++; console.error('FAIL: real totalDuration must NOT equal the over-counting variant');
} else pass++;

// ── resolveKeyframeSegment: empty / single ──
eq(resolveKeyframeSegment([], 0), null, 'empty → null');
eq(resolveKeyframeSegment(null, 0), null, 'null → null');
eq(resolveKeyframeSegment([kf(4)], 1), null, 'single keyframe → null (nothing to interpolate)');

// ── resolveKeyframeSegment: basic two-segment list [dur 4, dur 6] ──
const two = [kf(4), kf(6)]; // one segment, window [0,4]
eq(resolveKeyframeSegment(two, 0), { index: 0, localT: 0 }, 't=0 → start of segment 0');
eq(resolveKeyframeSegment(two, 2), { index: 0, localT: 0.5 }, 't=2 → halfway through segment 0');
eq(resolveKeyframeSegment(two, 4), { index: 0, localT: 1 }, 't=4 (boundary) → end of segment 0, localT 1');
eq(resolveKeyframeSegment(two, 99), { index: 0, localT: 1 }, 't past end → last segment, clamped to 1');

// ── three keyframes: segments [0,4] then [4,10] ──
const three = [kf(4), kf(6), kf(5)];
eq(resolveKeyframeSegment(three, 1), { index: 0, localT: 0.25 }, 't=1 → segment 0 @ 0.25');
eq(resolveKeyframeSegment(three, 4), { index: 0, localT: 1 }, 't=4 → boundary stays on segment 0 (<= test)');
eq(resolveKeyframeSegment(three, 7), { index: 1, localT: 0.5 }, 't=7 → segment 1 @ (7-4)/6=0.5');
eq(resolveKeyframeSegment(three, 10), { index: 1, localT: 1 }, 't=10 → end of segment 1');
eq(resolveKeyframeSegment(three, 1000), { index: 1, localT: 1 }, 't way past end → last segment clamped');

// ── clamp guard: negative time clamps localT to 0 ──
eq(resolveKeyframeSegment(two, -5), { index: 0, localT: 0 }, 'negative time → localT clamped to 0');
// RED proof: without the Math.max(0,...) clamp, negative time yields a negative localT.
function localTNoClamp(timeSec, acc, dur) { return (timeSec - acc) / dur; }
approx(localTNoClamp(-5, 0, 4), -1.25, 'RED: unclamped localT goes negative (-1.25) — real code clamps to 0');
if (resolveKeyframeSegment(two, -5).localT < 0) { fail++; console.error('FAIL: real resolver must clamp negative localT'); }
else pass++;

// ── zero-duration guard: localT === 1, never NaN ──
const zeroDur = [kf(0), kf(0), kf(3)]; // segment 0 has zero duration
const z0 = resolveKeyframeSegment(zeroDur, 0);
eq(z0, { index: 0, localT: 1 }, 'zero-duration segment → localT 1 (jump to next), no divide-by-zero');
// RED proof: without the `dur > 0 ?` guard, zero duration divides → NaN.
const nan = localTNoClamp(0, 0, 0);
if (Number.isNaN(nan)) { pass++; } else { fail++; console.error('FAIL: 0/0 must be NaN to prove the guard matters'); }
if (Number.isNaN(resolveKeyframeSegment(zeroDur, 0).localT)) {
  fail++; console.error('FAIL: real resolver must NOT return NaN localT on zero-duration');
} else pass++;

// ── EASINGS: endpoints + continuity ──
for (const name of ['linear', 'easeIn', 'easeOut', 'easeInOut']) {
  approx(EASINGS[name](0), 0, `${name}(0) === 0`);
  approx(EASINGS[name](1), 1, `${name}(1) === 1`);
}
approx(EASINGS.linear(0.5), 0.5, 'linear(0.5)=0.5');
approx(EASINGS.easeIn(0.5), 0.25, 'easeIn(0.5)=0.25');
approx(EASINGS.easeOut(0.5), 0.75, 'easeOut(0.5)=0.75');
// easeInOut continuity at the t=0.5 branch seam: both halves meet at 0.5.
approx(EASINGS.easeInOut(0.5), 0.5, 'easeInOut(0.5)=0.5 (branch seam continuous)');
approx(EASINGS.easeInOut(0.4999999), 0.5, 'easeInOut just below seam ≈ 0.5', 1e-5);
approx(EASINGS.easeInOut(0.5000001), 0.5, 'easeInOut just above seam ≈ 0.5', 1e-5);

// ── easedSegmentAt: composes resolve + easing ──
eq(easedSegmentAt([], 0), null, 'easedSegmentAt empty → null');
const e = easedSegmentAt([kf(4, 'easeIn'), kf(1)], 2); // localT 0.5, easeIn → 0.25
eq(e.index, 0, 'easedSegmentAt index 0');
approx(e.localT, 0.5, 'easedSegmentAt localT 0.5');
approx(e.eased, 0.25, 'easedSegmentAt applies easeIn(0.5)=0.25');
// unknown easing name falls back to linear (eased === localT)
const eu = easedSegmentAt([kf(4, 'wobble'), kf(1)], 1); // localT 0.25
approx(eu.eased, 0.25, 'unknown easing name → linear fallback (eased === localT)');
// RED proof: if easedSegmentAt ignored easing and returned localT raw, easeIn would not bend.
if (Math.abs(easedSegmentAt([kf(4, 'easeIn'), kf(1)], 2).eased - 0.5) < 1e-9) {
  fail++; console.error('FAIL: easedSegmentAt must apply easing, not pass localT through');
} else pass++;

console.log(`playback-timing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
