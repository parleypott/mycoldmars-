// ============================================================================
// api/_lib/render-geometry.js
//
// Pure geometry + metric-grounding core for /api/analyze-render.js (the "drop a
// photo, get a to-scale plan" brain for the 35 Walden studio). Extracted verbatim
// so the load-bearing planar-homography math is unit-testable headlessly — the
// whole render→EN-feet pipeline rides on solve8/homography/applyH being correct.
//
// No I/O here: every export is a pure function of its inputs.
// ============================================================================

export const PALETTE = ['pool', 'spa', 'deck', 'patio', 'bed', 'hedge', 'tree', 'firepit', 'path', 'wall'];

// House wall bearing in the EN frame (degrees). The footprint is rotated this
// much off the EN axes; used to build the house's ORIENTED bounding rectangle.
export const WALL_BEARING = -9.55;

// Standard sizes we snap pools/spas toward (feet). Marked assumed:true.
export const SNAP = {
  pool: [[12,24],[14,28],[16,32],[16,36],[18,40],[20,40]],
  spa: [[7,7],[8,8]],
};

// ────────────────────────────────────────────────────────────────────────────
// Geometry — planar homography (DLT, exactly 4 points) + helpers
// ────────────────────────────────────────────────────────────────────────────

// Solve A x = b for an 8x8 system via Gaussian elimination with partial pivot.
export function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null; // singular
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

// Homography mapping 4 source points -> 4 destination points.
// Returns 3x3 matrix (h[8]=1) or null.
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  const h = solve8(A, b);
  if (!h) return null;
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

export function applyH(H, p) {
  const [x, y] = p;
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  if (Math.abs(w) < 1e-9) return null;
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

export function rot2(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; }

// The house's oriented bounding rectangle in EN feet -> 4 corners (CW), built
// by aligning the footprint to its wall bearing.
export function houseOrientedQuad(houseEN) {
  const a = -WALL_BEARING * Math.PI / 180;
  const aligned = houseEN.map((p) => rot2(p, a));
  const xs = aligned.map((p) => p[0]), ys = aligned.map((p) => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const cornersAligned = [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy]];
  return cornersAligned.map((p) => rot2(p, -a)); // back to EN
}

export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// ────────────────────────────────────────────────────────────────────────────
// Grounding — turn the vision result into EN-feet elements
// ────────────────────────────────────────────────────────────────────────────
export function groundElements(vision, houseEN, parcelEN) {
  const imgCorners = (vision.house?.corners || []).slice(0, 4).map((c) => [clamp01(c.x), clamp01(c.y)]);
  if (imgCorners.length < 4) return { elements: [], note: 'no-house-anchor' };

  const houseQuad = houseOrientedQuad(houseEN); // 4 EN corners, CW
  const els = (vision.elements || []).filter((e) => PALETTE.includes(e.type));

  // Try 8 correspondences (4 rotations x 2 windings). Score by parcel containment.
  const rotations = [[0, 1, 2, 3], [1, 2, 3, 0], [2, 3, 0, 1], [3, 0, 1, 2]];
  let best = null;
  for (const flip of [false, true]) {
    const baseQuad = flip ? [houseQuad[0], houseQuad[3], houseQuad[2], houseQuad[1]] : houseQuad;
    for (const order of rotations) {
      const dst = order.map((i) => baseQuad[i]);
      const H = homography(imgCorners, dst);
      if (!H) continue;
      const placed = els.map((e) => groundOne(H, e)).filter(Boolean);
      // score: elements inside parcel, minus wild sizes
      let score = 0;
      for (const p of placed) {
        if (pointInPoly([p.e, p.n], parcelEN)) score += 2; else score -= 1;
        if (p.wFt > 4 && p.wFt < 90 && p.lFt > 4 && p.lFt < 120) score += 0.5; // plausible footprint
      }
      if (!best || score > best.score) best = { H, score, placed };
    }
  }
  if (!best) return { elements: [], note: 'homography-failed' };
  return { elements: best.placed, note: `oriented (score ${best.score.toFixed(1)})` };
}

// One element's image bbox -> EN center/size via the homography.
export function groundOne(H, e) {
  const x0 = clamp01(e.x0), y0 = clamp01(e.y0), x1 = clamp01(e.x1), y1 = clamp01(e.y1);
  const left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bot = Math.max(y0, y1);
  const BL = applyH(H, [left, bot]), BR = applyH(H, [right, bot]), TL = applyH(H, [left, top]), TR = applyH(H, [right, top]);
  if (!BL || !BR || !TL || !TR) return null;
  const center = [(BL[0] + BR[0] + TL[0] + TR[0]) / 4, (BL[1] + BR[1] + TL[1] + TR[1]) / 4];
  let wFt = (dist(BL, BR) + dist(TL, TR)) / 2;
  let lFt = (dist(BL, TL) + dist(BR, TR)) / 2;
  // rotation of the bottom edge relative to EN east
  let rot = Math.atan2(BR[1] - BL[1], BR[0] - BL[0]) * 180 / Math.PI;
  if (!isFinite(wFt) || !isFinite(lFt)) return null;
  wFt = Math.max(2, Math.min(120, wFt));
  lFt = Math.max(2, Math.min(140, lFt));
  let assumed = false;
  if (SNAP[e.type]) {
    const target = nearestSnap(SNAP[e.type], wFt, lFt);
    if (target) { wFt = target[0]; lFt = target[1]; assumed = true; }
  }
  if (e.type === 'tree') { let d = Math.max(8, Math.min(38, (wFt + lFt) / 2)); wFt = d; lFt = d; }
  if (e.type === 'firepit') { const d = Math.max(3, Math.min(9, (wFt + lFt) / 2)); wFt = d; lFt = d; }
  return {
    type: e.type,
    e: round1(center[0]), n: round1(center[1]),
    wFt: round1(wFt), lFt: round1(lFt),
    rot: Math.round(((rot % 360) + 360) % 360),
    confidence: typeof e.confidence === 'number' ? e.confidence : 0.5,
    assumed,
  };
}

export function nearestSnap(list, w, l) {
  const big = Math.max(w, l), small = Math.min(w, l);
  let best = null, bestd = Infinity;
  for (const [a, b] of list) {
    const d = Math.abs(b - big) + Math.abs(a - small);
    if (d < bestd) { bestd = d; best = [a, b]; }
  }
  return best;
}

export const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
export const round1 = (v) => Math.round(v * 10) / 10;
