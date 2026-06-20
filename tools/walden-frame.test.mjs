// Locks the Walden landscape studio's LOCAL SITE FRAME — the coordinate transform
// that grounds every placed element to the real lot. local2ll / ll2local are the
// single most load-bearing geometry in the tool: every element Johnny drops, every
// AI design-op coordinate, and every setback/lot check flows through them. A sign
// flip or basis-vector swap silently mis-places EVERYTHING on the plan, with no
// signal. This file had ZERO coverage (the sibling walden-setback-sampling.test.mjs
// only locks densifyLocalRing).
//
// This is a verifier-layer LOCK (no live bug found — the transform is correct), in
// the same standard as the geo-utils / render-geometry / westchester-geo locks: it
// EXTRACTS the real shipped functions + frame constants from public/walden/index.html
// at runtime (via brace-matching, so it can't drift from a hand-copied mirror) and is
// mutation-proven to go RED if the algebra regresses.
//
// Faithfulness: the test evals the REAL shipped FT, mPerDeg, GRID_BEARING, bn and the
// REAL dE/dN basis vectors out of the file, so a regression in the frame basis is also
// caught. The ONLY injected dependency is HOUSE_C (the anchor), because the page derives
// it via turf.centroid and pulling turf in headless would add a flaky dep. That's
// honest: the round-trip identity, the rotation sense, and the per-foot scale are all
// anchor-independent — they hold for ANY valid HOUSE_C — so a fixed anchor exercises the
// exact same algebra the live page runs.
//
// run: node tools/walden-frame.test.mjs   (or via `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, '..', 'public', 'walden', 'index.html'), 'utf8');

// ---- extract a `function NAME(...) { ... }` body by brace-matching (handles single- and multi-line) ----
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

// ---- extract a single `const ... ;` line verbatim ----
function extractConstLine(src, marker) {
  const re = new RegExp(`^const ${marker}[^\\n]*$`, 'm');
  const m = src.match(re);
  if (!m) throw new Error(`const ${marker} not found in index.html`);
  return m[0];
}

// Build a sandbox carrying the REAL shipped frame constants + transform fns, with an
// injected HOUSE_C anchor. Everything else (FT, mPerDeg, GRID_BEARING, bn, dE, dN, and
// the function bodies) is pulled verbatim from index.html.
function buildFrame(htmlSrc, houseC) {
  const ftLine        = extractConstLine(htmlSrc, 'FT=');           // const FT=3.28084, M2SF=...
  const frameBearing  = extractConstLine(htmlSrc, 'FRAME_BEARING=');
  const gridBearing   = extractConstLine(htmlSrc, 'GRID_BEARING=');
  const mPerDegLine   = extractConstLine(htmlSrc, 'mPerDeg=');
  const bnLine        = extractConstLine(htmlSrc, 'bn=');
  const basisLine     = extractConstLine(htmlSrc, 'dN=');           // const dN=[...], dE=[...]
  const local2ll      = extractFn(htmlSrc, 'local2ll');
  const ll2local      = extractFn(htmlSrc, 'll2local');
  const rot2          = extractFn(htmlSrc, 'rot2');
  const elemCentroid  = extractFn(htmlSrc, 'elemCentroidLocal');
  const bboxW         = extractFn(htmlSrc, 'bboxW');
  const bboxL         = extractFn(htmlSrc, 'bboxL');

  const body = `
    const HOUSE_C = __HOUSE_C__;
    ${ftLine}
    ${frameBearing}
    ${gridBearing}
    ${mPerDegLine}
    ${bnLine}
    ${basisLine}
    ${local2ll}
    ${ll2local}
    ${rot2}
    ${elemCentroid}
    ${bboxW}
    ${bboxL}
    return { local2ll, ll2local, rot2, elemCentroidLocal, bboxW, bboxL, FT, mPerDeg, dE, dN, GRID_BEARING };
  `;
  // eslint-disable-next-line no-new-func
  return new Function('__HOUSE_C__', body)(houseC);
}

const HOUSE_C = [-73.8549, 41.08125]; // representative anchor (Tarrytown); frame props are anchor-independent
const F = buildFrame(HTML, HOUSE_C);

let pass = 0, fail = 0;
const approx = (a, b, e = 1e-7) => Math.abs(a - b) <= e;
function ok(name, cond) { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } }

// ===================== inline RED proof: a sign-broken inverse fails the round-trip =====================
// Reconstruct ll2local with a flipped basis term (the classic regression) and show the
// round-trip no longer recovers the input — proving the round-trip is a real verifier.
{
  const m = F.mPerDeg(HOUSE_C[1]);
  const badLl2local = (lng, lat) => {
    const te = (lng - HOUSE_C[0]) * m.lng * F.FT, tn = (lat - HOUSE_C[1]) * m.lat * F.FT;
    return [te * F.dE[0] - tn * F.dE[1], te * F.dN[0] + tn * F.dN[1]]; // BUG: -tn instead of +tn
  };
  const [lng, lat] = F.local2ll(40, 25);
  const [bx, by] = badLl2local(lng, lat);
  ok('RED proof: sign-broken ll2local does NOT round-trip', !(approx(bx, 40) && approx(by, 25)));
}

// ===================== round-trip identity (the core invariant) =====================
{
  const pts = [[0, 0], [10, 0], [0, 10], [-37.5, 62.25], [120, -45], [-200, -200], [1, 1], [999, 0.5]];
  let allRoundTrip = true;
  for (const [x, y] of pts) {
    const [lng, lat] = F.local2ll(x, y);
    const [rx, ry] = F.ll2local(lng, lat);
    if (!(approx(rx, x) && approx(ry, y))) { allRoundTrip = false; console.log(`    round-trip miss (${x},${y}) -> (${rx},${ry})`); }
  }
  ok('local2ll -> ll2local round-trips every point exactly', allRoundTrip);

  // and the reverse direction (ll -> local -> ll)
  const [lng0, lat0] = F.local2ll(33, -77);
  const [bx, by] = F.ll2local(lng0, lat0);
  const [lng1, lat1] = F.local2ll(bx, by);
  ok('ll2local -> local2ll round-trips (lng/lat)', approx(lng1, lng0, 1e-12) && approx(lat1, lat0, 1e-12));
}

// ===================== origin anchors to HOUSE_C =====================
{
  const [lng, lat] = F.local2ll(0, 0);
  ok('local2ll(0,0) === HOUSE_C', approx(lng, HOUSE_C[0], 1e-12) && approx(lat, HOUSE_C[1], 1e-12));
  const [x, y] = F.ll2local(HOUSE_C[0], HOUSE_C[1]);
  ok('ll2local(HOUSE_C) === origin', approx(x, 0, 1e-9) && approx(y, 0, 1e-9));
}

// ===================== orthonormal basis (rotation, not skew/scale) =====================
{
  // dE and dN must be unit length and perpendicular — otherwise the frame skews or scales.
  const len = v => Math.hypot(v[0], v[1]);
  ok('dE is unit length', approx(len(F.dE), 1, 1e-12));
  ok('dN is unit length', approx(len(F.dN), 1, 1e-12));
  ok('dE perpendicular to dN', approx(F.dE[0] * F.dN[0] + F.dE[1] * F.dN[1], 0, 1e-12));
}

// ===================== isometry: 1 grid-foot of separation == 1 real foot =====================
// local2ll maps grid feet to lng/lat; converting that lng/lat displacement back to feet
// (via the same mPerDeg used on the page) must reproduce the original foot distance — i.e.
// the transform preserves distance (it's a pure rotation + unit scale, no stretch).
{
  const m = F.mPerDeg(HOUSE_C[1]);
  const ftBetween = (a, b) => {
    const de = (b[0] - a[0]) * m.lng * F.FT;   // east feet
    const dn = (b[1] - a[1]) * m.lat * F.FT;   // north feet
    return Math.hypot(de, dn);
  };
  const A = F.local2ll(0, 0), B = F.local2ll(100, 0), C = F.local2ll(0, 100), D = F.local2ll(30, 40);
  ok('100 grid-east ft -> 100 real ft', approx(ftBetween(A, B), 100, 1e-4));
  ok('100 grid-north ft -> 100 real ft', approx(ftBetween(A, C), 100, 1e-4));
  ok('(30,40) grid -> 50 real ft (3-4-5)', approx(ftBetween(A, D), 50, 1e-4));
  // perpendicular grid axes stay perpendicular on the ground
  const eVec = [(B[0] - A[0]) * m.lng, (B[1] - A[1]) * m.lat];
  const nVec = [(C[0] - A[0]) * m.lng, (C[1] - A[1]) * m.lat];
  ok('grid-east stays perpendicular to grid-north on the ground',
     approx(eVec[0] * nVec[0] + eVec[1] * nVec[1], 0, 1e-6));
}

// ===================== rot2 (the rotation matrix behind every box ring + handle) =====================
{
  const r90 = F.rot2(1, 0, 90);
  ok('rot2(1,0,90) -> (0,1)', approx(r90[0], 0) && approx(r90[1], 1));
  const r180 = F.rot2(1, 0, 180);
  ok('rot2(1,0,180) -> (-1,0)', approx(r180[0], -1) && approx(r180[1], 0));
  const r0 = F.rot2(3, -7, 0);
  ok('rot2 with 0deg is identity', approx(r0[0], 3) && approx(r0[1], -7));
  // rotation preserves length
  const r37 = F.rot2(3, 4, 37);
  ok('rot2 preserves length', approx(Math.hypot(r37[0], r37[1]), 5));
  // CCW sense: +90 takes +x to +y (matches the math convention the ring builders rely on)
  const r45 = F.rot2(1, 0, 45);
  ok('rot2(+90 sense) +x rotates toward +y', r45[1] > 0 && approx(r45[0], r45[1]));
}

// ===================== elemCentroidLocal / bboxW / bboxL (fed into planSummary -> the AI) =====================
{
  const boxEl = { family: 'box', cx: 12, cy: -3 };
  const c = F.elemCentroidLocal(boxEl);
  ok('elemCentroidLocal(box) returns [cx,cy]', c[0] === 12 && c[1] === -3);

  const polyEl = { family: 'poly', pts: [[0, 0], [10, 0], [10, 20], [0, 20]] };
  const pc = F.elemCentroidLocal(polyEl);
  ok('elemCentroidLocal(poly) averages vertices', approx(pc[0], 5) && approx(pc[1], 10));
  ok('bboxW(poly) is x-extent', approx(F.bboxW(polyEl), 10));
  ok('bboxL(poly) is y-extent', approx(F.bboxL(polyEl), 20));

  // negative / unordered vertices
  const skew = { pts: [[-5, 3], [7, -2], [2, 9]] };
  ok('bboxW handles unordered/negative x', approx(F.bboxW(skew), 12));   // 7 - (-5)
  ok('bboxL handles unordered/negative y', approx(F.bboxL(skew), 11));   // 9 - (-2)
}

console.log(`\nwalden-frame: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
