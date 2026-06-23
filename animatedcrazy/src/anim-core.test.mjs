// Verifier-layer LOCK for the animatedcrazy playback-interpolation core.
//
// anim-core.js holds the pure math behind every frame the user sees on the
// canvas AND exports to GIF: the time -> segment mapping (segmentAtTime), the
// keyframe time table (keyframeTimes / totalAnimDuration), property interpolation
// (lerp), color interpolation (lerpColor / hexToRgb / rgbToHex), and the EASINGS
// table. A silent regression here breaks every animation with no signal.
//
// This imports the REAL shipped functions and is mutation-proven: each assertion
// is shown to fail if the corresponding logic regresses (see the matching
// mutations recorded in BACKLOG.md). NOTE: no live bug was found — the math is
// correct — so this is a LOCK, not a fix.

import {
  clamp, lerp, hexToRgb, rgbToHex, lerpColor, EASINGS,
  keyframeTimes, totalAnimDuration, segmentAtTime,
} from './anim-core.js';

let passed = 0, failed = 0;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function close(a, b, msg) { ok(approx(a, b), `${msg} — got ${a}, want ${b}`); }

// keyframes helper: durations are the "hold to the next kf" spans.
const KF = (id, dur, easing = 'linear', shapes = {}) => ({ id, duration: dur, easing, shapes });

// ─── clamp ───
eq(clamp(5, 0, 10), 5, 'clamp inside');
eq(clamp(-3, 0, 10), 0, 'clamp below');
eq(clamp(99, 0, 10), 10, 'clamp above');

// ─── lerp ───
eq(lerp(0, 10, 0), 0, 'lerp t=0');
eq(lerp(0, 10, 1), 10, 'lerp t=1');
eq(lerp(0, 10, 0.5), 5, 'lerp midpoint');
eq(lerp(10, 0, 0.25), 7.5, 'lerp descending');
eq(lerp(-4, 4, 0.5), 0, 'lerp across zero');

// ─── hexToRgb / rgbToHex round-trip ───
eq(JSON.stringify(hexToRgb('#ff0000')), JSON.stringify([255, 0, 0]), 'hexToRgb red');
eq(JSON.stringify(hexToRgb('#00ff00')), JSON.stringify([0, 255, 0]), 'hexToRgb green');
eq(JSON.stringify(hexToRgb('#0000ff')), JSON.stringify([0, 0, 255]), 'hexToRgb blue');
eq(JSON.stringify(hexToRgb('#f0a')), JSON.stringify([255, 0, 170]), 'hexToRgb 3-char expands');
eq(rgbToHex(255, 0, 0), '#ff0000', 'rgbToHex red');
eq(rgbToHex(26, 26, 26), '#1a1a1a', 'rgbToHex soft black zero-pad');
eq(rgbToHex(300, -5, 128), '#ff0080', 'rgbToHex clamps out-of-range channels');
eq(rgbToHex(127.6, 0, 0), '#800000', 'rgbToHex rounds');

// ─── lerpColor ───
eq(lerpColor('#000000', '#ffffff', 0), '#000000', 'lerpColor t=0 = a');
eq(lerpColor('#000000', '#ffffff', 1), '#ffffff', 'lerpColor t=1 = b');
eq(lerpColor('#000000', '#ffffff', 0.5), '#808080', 'lerpColor midpoint = mid grey');
eq(lerpColor('#ff0000', '#0000ff', 0.5), '#800080', 'lerpColor red->blue midpoint');
eq(lerpColor(null, '#abcdef', 0.5), '#abcdef', 'lerpColor a null -> b');
eq(lerpColor('#abcdef', null, 0.5), '#abcdef', 'lerpColor b null -> a');
eq(lerpColor('', '', 0.5), '', 'lerpColor both empty -> empty');

// ─── EASINGS ───
// Endpoints: every easing must map 0->0 and 1->1.
for (const name of Object.keys(EASINGS)) {
  close(EASINGS[name](0), 0, `easing ${name}(0) = 0`);
  close(EASINGS[name](1), 1, `easing ${name}(1) = 1`);
}
eq(EASINGS.linear(0.3), 0.3, 'linear identity');
close(EASINGS.easeIn(0.5), 0.25, 'easeIn 0.5 = 0.25');
close(EASINGS.easeOut(0.5), 0.75, 'easeOut 0.5 = 0.75');
close(EASINGS.easeInOut(0.5), 0.5, 'easeInOut symmetric midpoint');
ok(EASINGS.easeInOut(0.25) < 0.25, 'easeInOut decelerates early');
ok(EASINGS.bounce(0.5) > 0 && EASINGS.bounce(0.5) <= 1, 'bounce stays in (0,1] mid');
ok(EASINGS.elastic(0.5) !== 0.5, 'elastic is not identity mid');

// ─── keyframeTimes ───
{
  const kfs = [KF('a', 2), KF('b', 3), KF('c', 0)];
  // times[i] = sum of kfs[0..i-1].duration
  eq(JSON.stringify(keyframeTimes(kfs)), JSON.stringify([0, 2, 5]), 'keyframeTimes cumulative');
  // last entry = total span = sum of all but last kf's duration
  eq(keyframeTimes(kfs)[2], totalAnimDuration(kfs), 'keyframeTimes last == totalAnimDuration');
}
eq(JSON.stringify(keyframeTimes([KF('a', 2)])), JSON.stringify([0]), 'keyframeTimes single');

// ─── totalAnimDuration ───
eq(totalAnimDuration([]), 0, 'totalAnimDuration empty = 0');
eq(totalAnimDuration([KF('a', 5)]), 0, 'totalAnimDuration single = 0 (no span)');
eq(totalAnimDuration([KF('a', 2), KF('b', 3)]), 2, 'totalAnimDuration excludes last kf duration');
eq(totalAnimDuration([KF('a', 2), KF('b', 3), KF('c', 7)]), 5, 'totalAnimDuration three kfs');
eq(totalAnimDuration([KF('a', undefined), KF('b', 4)]), 0, 'totalAnimDuration missing duration -> 0');

// ─── segmentAtTime: the load-bearing time -> segment + eased progress mapping ───
{
  // Two linear keyframes, dur 2.
  const kfs = [KF('a', 2, 'linear'), KF('b', 2, 'linear')];
  eq(segmentAtTime(kfs, 0).i, 0, 'segment at t=0 -> i=0');
  close(segmentAtTime(kfs, 0).eased, 0, 'eased at t=0 = 0');
  close(segmentAtTime(kfs, 1).eased, 0.5, 'eased at mid of segment 0 = 0.5 (linear)');
  close(segmentAtTime(kfs, 2).eased, 1, 'eased at end of span = 1');
  // Clamp beyond the span.
  eq(segmentAtTime(kfs, 999).i, 0, 'segment beyond span clamps to last segment');
  close(segmentAtTime(kfs, 999).eased, 1, 'eased beyond span clamps to 1');
  // Clamp before zero.
  close(segmentAtTime(kfs, -5).eased, 0, 'eased before zero clamps to 0');
}
{
  // Three keyframes a(2) b(2) c(hold) -> span = times [0,2,4]; segment 0 = [0,2], segment 1 = [2,4].
  const kfs = [KF('a', 2, 'linear'), KF('b', 2, 'linear'), KF('c', 0, 'linear')];
  eq(segmentAtTime(kfs, 1).i, 0, 'three-kf t=1 in segment 0');
  eq(segmentAtTime(kfs, 3).i, 1, 'three-kf t=3 in segment 1');
  close(segmentAtTime(kfs, 3).eased, 0.5, 'three-kf t=3 -> mid of segment 1 (linear)');
  eq(segmentAtTime(kfs, 4).i, 1, 'three-kf t=4 in last segment');
}
{
  // Easing is taken from the SEGMENT-START keyframe (kfs[i].easing), not kfs[i+1].
  const kfs = [KF('a', 2, 'easeIn'), KF('b', 2, 'linear')];
  close(segmentAtTime(kfs, 1).eased, EASINGS.easeIn(0.5), 'segment uses start-keyframe easing (easeIn 0.5 = 0.25)');
}
{
  // Zero-duration segment -> localT defaults to 1 (snap to b), no divide-by-zero.
  const kfs = [KF('a', 0, 'linear'), KF('b', 2, 'linear')];
  close(segmentAtTime(kfs, 0).eased, 1, 'zero-duration segment snaps eased to 1');
  ok(Number.isFinite(segmentAtTime(kfs, 0).eased), 'zero-duration segment eased is finite (no NaN)');
}
{
  // Unknown easing name falls back to linear.
  const kfs = [KF('a', 2, 'nonsense'), KF('b', 2, 'linear')];
  close(segmentAtTime(kfs, 1).eased, 0.5, 'unknown easing falls back to linear');
}

console.log(`anim-core: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
