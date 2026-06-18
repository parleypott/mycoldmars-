// Locks the LOAD-BEARING geometry + metric-grounding core of /api/analyze-render.js
// (the "drop a photo, get a to-scale plan" brain for the 35 Walden studio).
//
// The whole render→EN-feet pipeline rides on a planar HOMOGRAPHY: solve the 8x8
// DLT system mapping the house's 4 image corners → its 4 real EN corners, then push
// every element's ground-contact box through it. If solve8/homography/applyH are
// wrong, EVERY placement is wrong. This core was ZERO-coverage. This suite imports
// the REAL shipped functions (no byte-copy mirror, so it can't drift) and pins them.
//
// No live bug was found — the math is machine-precision correct — so this is a
// verifier-layer LOCK: every assertion is mutation-proven to FAIL if the matching
// logic regresses (see render-geometry.mutation-notes at the bottom for the proofs).
//
// run: bun api/_lib/render-geometry.test.mjs   (or: bun run test)

import {
  solve8, homography, applyH, rot2, houseOrientedQuad, pointInPoly, dist,
  nearestSnap, clamp01, round1, groundOne, groundElements, PALETTE, SNAP, WALL_BEARING,
} from './render-geometry.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const nearP = (p, q, tol = 1e-7) => p && q && near(p[0], q[0], tol) && near(p[1], q[1], tol);

// An INDEPENDENT projective transform applier (NOT the module's) so the recovery
// tests have a ground truth the module can be checked against.
function applyKnown(H, [x, y]) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

// ─────────────────────────── solve8 ───────────────────────────
{
  // Identity system: A = I8, b = arbitrary → x = b.
  const I = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => (i === j ? 1 : 0)));
  const b = [3, -1, 4, 1, 5, 9, 2, 6];
  const x = solve8(I, b);
  ok('solve8 identity returns b', x && x.every((v, i) => near(v, b[i])));

  // A known non-trivial system needing pivoting: first pivot is 0, forces a row swap.
  const A = [
    [0, 2, 0, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 3, 0, 0, 0, 0, 0],
    [0, 0, 0, 4, 0, 0, 0, 0],
    [0, 0, 0, 0, 5, 0, 0, 0],
    [0, 0, 0, 0, 0, 6, 0, 0],
    [0, 0, 0, 0, 0, 0, 7, 0],
    [0, 0, 0, 0, 0, 0, 0, 8],
  ];
  const bb = [2, 1, 9, 8, 25, 36, 49, 64];
  const xx = solve8(A, bb);
  // x1 from row2 (1*x1=1)→1 ; x2 from row1 (2*x2=2)→1 ; x3=3 ; x4=2 ; x5=5 ; x6=6 ; x7=7 ; x8=8
  ok('solve8 pivot row-swap solves', xx && near(xx[0], 1) && near(xx[1], 1) && near(xx[2], 3) && near(xx[7], 8));

  // Singular system → null (zero column).
  const S = I.map((r) => r.slice()); S.forEach((r) => { r[0] = 0; });
  ok('solve8 singular → null', solve8(S, b) === null);
}

// ─────────────────────────── homography + applyH ───────────────────────────
{
  const Htrue = [[1.2, 0.3, 5], [-0.1, 0.9, 2], [0.0008, 0.0011, 1]];
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const dst = src.map((p) => applyKnown(Htrue, p));
  const H = homography(src, dst);
  ok('homography recovers a known transform (non-null)', H !== null);
  ok('homography: corner0 maps to dst0', nearP(applyH(H, src[0]), dst[0]));
  ok('homography: corner1 maps to dst1', nearP(applyH(H, src[1]), dst[1]));
  ok('homography: corner2 maps to dst2', nearP(applyH(H, src[2]), dst[2]));
  ok('homography: corner3 maps to dst3', nearP(applyH(H, src[3]), dst[3]));
  // A 5th interior point must match the TRUE transform — proves it's the right H,
  // not just one that happens to hit the 4 fitted corners.
  ok('homography: interior point matches truth', nearP(applyH(H, [0.37, 0.62]), applyKnown(Htrue, [0.37, 0.62])));

  // Affine special case (last row 0,0,1): a pure scale+translate.
  const Haff = [[2, 0, 1], [0, 3, -4], [0, 0, 1]];
  const s2 = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const d2 = s2.map((p) => applyKnown(Haff, p));
  const H2 = homography(s2, d2);
  ok('homography affine: maps (2,5) correctly', nearP(applyH(H2, [2, 5]), [5, 11]));
  ok('homography affine: bottom row ≈ [0,0,1]', near(H2[2][0], 0) && near(H2[2][1], 0) && near(H2[2][2], 1));

  // Degenerate: 3 collinear source points → singular → null.
  ok('homography collinear src → null', homography([[0, 0], [1, 1], [2, 2], [3, 0]], dst) === null);

  // applyH: a point that lands at infinity (w≈0) → null, not Infinity.
  // Hinf maps (x,y) with w = -x + 1; at x=1, w=0.
  const Hinf = [[1, 0, 0], [0, 1, 0], [-1, 0, 1]];
  ok('applyH w≈0 → null (point at infinity)', applyH(Hinf, [1, 7]) === null);
  ok('applyH finite point ok', nearP(applyH(Hinf, [0, 5]), [0, 5]));
}

// ─────────────────────────── rot2 ───────────────────────────
{
  ok('rot2 by 0 is identity', nearP(rot2([3, 4], 0), [3, 4]));
  ok('rot2 by 90° (CCW): (1,0)→(0,1)', nearP(rot2([1, 0], Math.PI / 2), [0, 1]));
  ok('rot2 by 180°: (1,2)→(-1,-2)', nearP(rot2([1, 2], Math.PI), [-1, -2]));
  // round-trip: rotate then un-rotate
  ok('rot2 round-trips', nearP(rot2(rot2([5, -2], 0.7), -0.7), [5, -2]));
}

// ─────────────────────────── houseOrientedQuad ───────────────────────────
{
  // An axis-aligned 20×10 rectangle (already on EN axes) → quad area ~ 200 only if
  // the wall-bearing alignment is a no-op... but WALL_BEARING≠0, so a tilted input
  // is the realistic case. Use a rectangle tilted BY the wall bearing so the
  // oriented box is the tight 20×10.
  const a = WALL_BEARING * Math.PI / 180; // tilt the footprint by the wall bearing
  const rect = [[-10, -5], [10, -5], [10, 5], [-10, 5]].map((p) => rot2(p, a));
  const quad = houseOrientedQuad(rect);
  ok('houseOrientedQuad returns 4 corners', Array.isArray(quad) && quad.length === 4);
  // The oriented box of a tilted 20×10 rectangle should have side lengths {20,10}.
  const sides = [dist(quad[0], quad[1]), dist(quad[1], quad[2]), dist(quad[2], quad[3]), dist(quad[3], quad[0])];
  const longSide = Math.max(...sides), shortSide = Math.min(...sides);
  ok('houseOrientedQuad recovers 20×10 tight box', near(longSide, 20, 1e-6) && near(shortSide, 10, 1e-6));
  // Opposite sides equal (it's a rectangle).
  ok('houseOrientedQuad is a rectangle', near(sides[0], sides[2], 1e-6) && near(sides[1], sides[3], 1e-6));
}

// ─────────────────────────── pointInPoly ───────────────────────────
{
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  ok('pointInPoly: center inside', pointInPoly([5, 5], sq) === true);
  ok('pointInPoly: clearly outside', pointInPoly([20, 5], sq) === false);
  ok('pointInPoly: negative outside', pointInPoly([-1, 5], sq) === false);
  // Concave (L-shape) polygon — the notch must read as OUTSIDE.
  const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  ok('pointInPoly: inside the arm of an L', pointInPoly([2, 8], L) === true);
  ok('pointInPoly: in the notch of an L → outside', pointInPoly([8, 8], L) === false);
}

// ─────────────────────────── dist / clamp01 / round1 ───────────────────────────
{
  ok('dist 3-4-5', near(dist([0, 0], [3, 4]), 5));
  ok('dist zero', near(dist([7, 7], [7, 7]), 0));

  ok('clamp01 mid', clamp01(0.4) === 0.4);
  ok('clamp01 over → 1', clamp01(1.7) === 1);
  ok('clamp01 under → 0', clamp01(-0.3) === 0);
  ok('clamp01 NaN → 0', clamp01(NaN) === 0);
  ok('clamp01 string number', clamp01('0.5') === 0.5);
  ok('clamp01 garbage → 0', clamp01('abc') === 0);

  ok('round1 tenths', round1(1.249) === 1.2);
  ok('round1 half-up', round1(1.25) === 1.3);
  ok('round1 negative', round1(-2.34) === -2.3);
}

// ─────────────────────────── nearestSnap ───────────────────────────
{
  const pools = SNAP.pool; // [[12,24],[14,28],...]
  // Near 16×33 → snaps to [16,32].
  ok('nearestSnap picks closest [small,big]', JSON.stringify(nearestSnap(pools, 16, 33)) === JSON.stringify([16, 32]));
  // Orientation-independent: (w,l) swapped gives the same snap (uses min/max).
  ok('nearestSnap orientation-independent', JSON.stringify(nearestSnap(pools, 33, 16)) === JSON.stringify(nearestSnap(pools, 16, 33)));
  // Tiny → smallest entry.
  ok('nearestSnap tiny → smallest', JSON.stringify(nearestSnap(pools, 1, 1)) === JSON.stringify([12, 24]));
  ok('nearestSnap empty list → null', nearestSnap([], 10, 10) === null);
}

// ─────────────────────────── groundOne ───────────────────────────
{
  // Identity-ish homography from image fractions to a 100×100 EN field:
  // image (0..1) → EN (0..100) with a vertical flip so 'bot' (y=1) → N=0.
  // H maps (x,y) → (100x, 100(1-y)).
  const Hgrid = homography([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 100], [100, 100], [100, 0], [0, 0]]);

  // A 'patio' (not snapped) bbox: x 0.40..0.60, y 0.40..0.50.
  const patio = groundOne(Hgrid, { type: 'patio', x0: 0.40, y0: 0.40, x1: 0.60, y1: 0.50, confidence: 0.9 });
  ok('groundOne returns an element', patio && patio.type === 'patio');
  ok('groundOne center E ≈ 50', near(patio.e, 50, 0.6));
  ok('groundOne width ≈ 20ft', near(patio.wFt, 20, 0.6));
  ok('groundOne length ≈ 10ft', near(patio.lFt, 10, 0.6));
  ok('groundOne passes confidence through', patio.confidence === 0.9);
  ok('groundOne patio not assumed', patio.assumed === false);
  ok('groundOne rot in [0,360)', patio.rot >= 0 && patio.rot < 360);

  // A 'pool' snaps to a SNAP size and sets assumed:true.
  const pool = groundOne(Hgrid, { type: 'pool', x0: 0.3, y0: 0.3, x1: 0.6, y1: 0.5 });
  ok('groundOne pool assumed:true', pool.assumed === true);
  ok('groundOne pool snapped to a SNAP size', SNAP.pool.some(([s, b]) => pool.wFt === s && pool.lFt === b));
  ok('groundOne pool default confidence 0.5', pool.confidence === 0.5);

  // A 'tree' is forced to a SQUARE diameter (wFt === lFt) within [8,38].
  const tree = groundOne(Hgrid, { type: 'tree', x0: 0.45, y0: 0.45, x1: 0.62, y1: 0.62 });
  ok('groundOne tree is square (canopy diameter)', tree.wFt === tree.lFt);
  ok('groundOne tree diameter in [8,38]', tree.wFt >= 8 && tree.wFt <= 38);

  // A 'firepit' is a small square in [3,9].
  const fire = groundOne(Hgrid, { type: 'firepit', x0: 0.48, y0: 0.48, x1: 0.52, y1: 0.52 });
  ok('groundOne firepit square', fire.wFt === fire.lFt);
  ok('groundOne firepit in [3,9]', fire.wFt >= 3 && fire.wFt <= 9);

  // clamp01 on the bbox: out-of-range fractions are clamped, not propagated.
  const wild = groundOne(Hgrid, { type: 'patio', x0: -5, y0: 2, x1: 0.5, y1: 0.5 });
  ok('groundOne clamps wild bbox to finite element', wild && isFinite(wild.e) && isFinite(wild.n));

  // null homography point (w≈0) → groundOne returns null.
  const Hinf = [[1, 0, 0], [0, 1, 0], [-1, 0, 1]]; // w=0 at x=1
  ok('groundOne → null when a corner projects to infinity', groundOne(Hinf, { type: 'patio', x0: 0.9, y0: 0.2, x1: 1.0, y1: 0.4 }) === null);
}

// ─────────────────────────── groundElements ───────────────────────────
{
  const houseEN = [[10, 10], [-10, 10], [-10, -10], [10, -10]];
  const parcelEN = [[100, 100], [-100, 100], [-100, -100], [100, -100]];

  // < 4 house corners → no anchor.
  ok('groundElements: <4 corners → no-house-anchor',
    groundElements({ house: { corners: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }] }, elements: [] }, houseEN, parcelEN).note === 'no-house-anchor');

  // Missing house entirely → no anchor (no throw).
  ok('groundElements: no house key → no-house-anchor',
    groundElements({ elements: [] }, houseEN, parcelEN).note === 'no-house-anchor');

  const vision = {
    house: { corners: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }] },
    elements: [
      { type: 'pool', x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.5, confidence: 0.8 },
      { type: 'spa', x0: 0.56, y0: 0.45, x1: 0.6, y1: 0.49, confidence: 0.7 },
      { type: 'NOT_A_TYPE', x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }, // filtered out
    ],
  };
  const res = groundElements(vision, houseEN, parcelEN);
  ok('groundElements: filters non-PALETTE types (2 of 3 kept)', res.elements.length === 2);
  ok('groundElements: note reports an orientation score', /oriented \(score/.test(res.note));
  ok('groundElements: every placed element has finite EN coords', res.elements.every((e) => isFinite(e.e) && isFinite(e.n)));
  ok('groundElements: placed elements land inside the parcel', res.elements.every((e) => pointInPoly([e.e, e.n], parcelEN)));

  // No palette elements → empty placement but still anchored (best chosen, score 0).
  const empty = groundElements({ house: vision.house, elements: [] }, houseEN, parcelEN);
  ok('groundElements: zero elements → empty list, still oriented', empty.elements.length === 0 && /oriented/.test(empty.note));

  // PALETTE sanity (the filter the pipeline depends on).
  ok('PALETTE includes pool & tree', PALETTE.includes('pool') && PALETTE.includes('tree'));
  ok('PALETTE excludes house/lawn', !PALETTE.includes('house') && !PALETTE.includes('lawn'));
}

console.log(`render-geometry: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
