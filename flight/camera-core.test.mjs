// Locks the flight-animation camera math in flight/index.html — a served Johnny globe piece
// (DC -> Palau great-circle reveal). The arc itself is drawn correctly (each great-circle point is
// computed independently), but the CAMERA pan interpolated longitude with a naive linear lerp:
//
//   center[0] = a.center[0] + (b.center[0] - a.center[0]) * ease
//
// The great circle DC(-77) -> Palau(+134) goes up over the Arctic, so its midpoint keyframe lands
// near the antimeridian (~-174°). Panning from -174° to +134° reads as b-a = +308°, so the camera
// swept ~309° the LONG way EAST — across lng 0 (Atlantic -> Africa -> Asia) — during the climactic
// "approaching Palau" phase, spinning the globe almost all the way around backwards instead of the
// 51° hop WEST across the Pacific seam where the flight actually goes.
//
// Fix: lerpLng() wraps the delta to (-180,180] so the camera follows the flight, not the long way
// round. center[0] now routes through it. This test EXTRACTS the real shipped lerpLng + lerpCamera
// from index.html at runtime (brace-matching + new Function), so it can't drift from a mirror, and
// is mutation-proven to go RED if the wrap regresses. Same standard as the mapkeys lerpLng /
// nile-flights / westchester-geo inline-HTML locks.
//
// run: node flight/camera-core.test.mjs   (or via `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

// ---- extract a `function NAME(...) { ... }` body by brace-matching ----
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in index.html`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// Bind the REAL shipped functions out of the HTML.
const lerpLng = new Function(extractFn(HTML, 'lerpLng') + '\nreturn lerpLng;')();
const makeLerpCamera = new Function(
  'CAMERA_KEYFRAMES', 'lerpLng',
  extractFn(HTML, 'lerpCamera') + '\nreturn lerpCamera;'
);

// Real page coordinates (DC, the great-circle midpoint over the Bering Sea, Palau).
const DC = [-77.037, 38.907];
const MID = [-174.281, 55.376];
const PALAU = [134.479, 7.515];
const KEYFRAMES = [
  { t: 0.0,  center: DC,    zoom: 2.8 },
  { t: 0.15, center: DC,    zoom: 2.2 },
  { t: 0.5,  center: MID,   zoom: 1.2 },
  { t: 0.85, center: PALAU, zoom: 2.2 },
  { t: 1.0,  center: PALAU, zoom: 2.8 },
];
const lerpCamera = makeLerpCamera(KEYFRAMES, lerpLng);

// normalize any longitude to (-180, 180]
const norm = (x) => { let v = ((x + 180) % 360 + 360) % 360 - 180; return v === -180 ? 180 : v; };
// the OLD naive linear longitude lerp (the bug), for the inline RED proof
const naiveLng = (a, b, t) => a + (b - a) * t;

let pass = 0, fail = 0;
const eq = (msg, a, b, tol = 1e-9) => {
  if (Math.abs(a - b) <= tol) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   expected ${b}, got ${a}`); }
};
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── inline RED proof: the OLD naive lerp pans the wrong way ──
{
  // Across the MID -> Palau segment, the naive lerp passes through the lng~0 hemisphere (Africa).
  let naivePassesThroughZero = false;
  for (let s = 0; s <= 1.0001; s += 0.05) {
    if (Math.abs(norm(naiveLng(MID[0], PALAU[0], s))) < 90) naivePassesThroughZero = true;
  }
  ok('RED-proof: OLD naive lng lerp sweeps across the lng~0 hemisphere (the bug)', naivePassesThroughZero);
  // The shipped lerpLng must NOT — it stays on the Pacific/Asia side the whole segment.
  let fixStaysOnFarSide = true;
  for (let s = 0; s <= 1.0001; s += 0.05) {
    if (Math.abs(norm(lerpLng(MID[0], PALAU[0], s))) < 90) fixStaysOnFarSide = false;
  }
  ok('FIX: shipped lerpLng follows the short path (never crosses into the lng~0 hemisphere)', fixStaysOnFarSide);
}

// ── lerpLng units ──
eq('lerpLng t=0 returns a', lerpLng(MID[0], PALAU[0], 0), MID[0]);
ok('lerpLng t=1 lands on Palau (mod 360)', Math.abs(norm(lerpLng(MID[0], PALAU[0], 1) - PALAU[0])) < 1e-9);
{
  // signed delta MID->PALAU is the SHORT -51.2°, not +308.8°
  const d = lerpLng(MID[0], PALAU[0], 1) - MID[0];
  ok('lerpLng MID->PALAU delta is the short ~-51° (not +308°)', d < 0 && Math.abs(d) < 180);
}
// no-regression: when |b-a| <= 180 (DC -> MID, delta -97°) lerpLng === naive linear
for (const s of [0, 0.25, 0.5, 0.75, 1]) {
  eq(`lerpLng == naive for sub-180 delta (DC->MID, t=${s})`,
     lerpLng(DC[0], MID[0], s), naiveLng(DC[0], MID[0], s), 1e-9);
}
eq('lerpLng a==b -> a (zero delta)', lerpLng(50, 50, 0.5), 50);
// crossing the seam directly: -179 -> 179 is a 2° hop west, not 358° east
{
  const d = lerpLng(-179, 179, 1) - (-179);
  ok('lerpLng -179 -> 179 is a short 2° hop (not 358°)', Math.abs(d) <= 2 + 1e-9);
}
// exactly 180° apart: well-defined, magnitude 180 either way
ok('lerpLng 0 -> 180 stays within 180° of magnitude', Math.abs(lerpLng(0, 180, 1) - 0) <= 180 + 1e-9);

// ── lerpCamera end-to-end (uses the real shipped function + real lerpLng) ──
eq('lerpCamera(0) center lng = DC', lerpCamera(0).center[0], DC[0]);
eq('lerpCamera(0) center lat = DC', lerpCamera(0).center[1], DC[1]);
eq('lerpCamera(0) zoom = 2.8', lerpCamera(0).zoom, 2.8);
ok('lerpCamera(1) center lng = Palau (mod 360)', Math.abs(norm(lerpCamera(1).center[0] - PALAU[0])) < 1e-9);
eq('lerpCamera(1) center lat = Palau', lerpCamera(1).center[1], PALAU[1]);
eq('lerpCamera(1) zoom = 2.8', lerpCamera(1).zoom, 2.8);
{
  // The whole MID(0.5) -> PALAU(0.85) segment must stay on the far (Pacific/Asia) side: the camera
  // follows the flight across the seam, never spinning back across the lng~0 hemisphere.
  let stays = true, sawSeamCrossing = false, prev = norm(lerpCamera(0.5).center[0]);
  for (let t = 0.5; t <= 0.8500001; t += 0.01) {
    const lng = norm(lerpCamera(t).center[0]);
    if (Math.abs(lng) < 90) stays = false;
    if (Math.abs(lng - prev) > 180) sawSeamCrossing = true; // a +/-180 wrap step is the seam, expected
    prev = lng;
  }
  ok('lerpCamera MID->PALAU segment stays on the far side (follows the flight, no backward spin)', stays);
  // latitude is still a plain linear lerp (unaffected by the fix)
  const camMid = lerpCamera(0.675); // ease=0.5 of the 0.5..0.85 segment
  eq('lerpCamera latitude still linear (MID->PALAU midpoint)',
     camMid.center[1], MID[1] + (PALAU[1] - MID[1]) * 0.5, 1e-9);
}
// monotone-ish zoom and finite output across the whole timeline
{
  let allFinite = true;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = lerpCamera(Math.min(t, 1));
    if (!Number.isFinite(c.center[0]) || !Number.isFinite(c.center[1]) || !Number.isFinite(c.zoom)) allFinite = false;
  }
  ok('lerpCamera is finite across the whole timeline', allFinite);
}

console.log(`flight camera-core: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
