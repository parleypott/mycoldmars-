// Verifier-layer LOCK for the Walden-3d studio buildable-setback-zone geometry.
//
// insetPolygon(ring, d) + its dependency lineInt(a, b) (public/walden-3d/studio.html)
// compute the inward polygon offset that renders the GREEN buildable-setback zone
// Johnny sees on the plan: insetPolygon(PARCEL_EN, sbStruct) at studio.html:326. A
// silent regression (winding sign, inward-normal direction, the offset distance, or
// the parallel-edge fallback) would render the buildable zone WRONG with no signal.
//
// NO live bug — the winding-aware miter offset is correct (hand-verified: a CCW unit
// square inset by 2 -> [[2,2],[8,2],[8,8],[2,8]]). So this is a LOCK, not a fix.
// ZERO source change: the test EXTRACTS the real shipped functions from studio.html at
// runtime (brace-match + new Function), so it can't drift from a mirror.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./studio.html', import.meta.url), 'utf8');

// Brace-match a one-or-many-line `function NAME(...) { ... }` out of the HTML.
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `could not find function ${name} in studio.html`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

function loadShipped(source = html) {
  const lineIntSrc = extractFn(source, 'lineInt');
  const insetSrc = extractFn(source, 'insetPolygon');
  const factory = new Function(lineIntSrc + '\n' + insetSrc + '\nreturn { lineInt, insetPolygon };');
  return factory();
}

const { lineInt, insetPolygon } = loadShipped();

// ---- independent reference helpers (NOT the shipped code) ----
function ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distToBoundary(p, ring) {
  let m = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const d = ptSegDist(p[0], p[1], ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
    if (d < m) m = d;
  }
  return m;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ptNear = (p, q, eps = 1e-4) => near(p[0], q[0], eps) && near(p[1], q[1], eps);

const SQUARE_CCW = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const SQUARE_CW  = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

// ---------- inline RED proof: a winding-blind offset (ccw forced to +1) ----------
check('RED-proof: a ccw-blind insetPolygon grows a CW polygon instead of shrinking it', () => {
  const blind = loadShipped(html.replace('const ccw=area>0?1:-1', 'const ccw=1'));
  const out = blind.insetPolygon(SQUARE_CW, 2);
  // CW square with ccw forced +1 offsets OUTWARD -> a vertex at (-2,-2)-ish, outside the lot.
  assert.ok(out.some(p => p[0] < -0.5 || p[1] < -0.5), 'expected the ccw-blind version to grow outward');
  // the real shipped fn keeps it inside (insets), so this proves the winding term matters.
  const real = insetPolygon(SQUARE_CW, 2);
  assert.ok(real.every(p => p[0] >= -1e-6 && p[1] >= -1e-6), 'real fn must inset inward for CW input');
});

// ---------- lineInt units ----------
check('lineInt: two crossing lines return the intersection', () => {
  // x=4 (vertical) and y=7 (horizontal)
  const p = lineInt([4, 0, 4, 10], [0, 7, 10, 7]);
  assert.ok(ptNear(p, [4, 7]), `got ${JSON.stringify(p)}`);
});
check('lineInt: parallel lines return null', () => {
  assert.equal(lineInt([0, 0, 10, 0], [0, 5, 10, 5]), null);
});
check('lineInt: identical-direction (collinear) lines return null', () => {
  assert.equal(lineInt([0, 0, 10, 0], [2, 0, 8, 0]), null);
});
check('lineInt: near-parallel below the 1e-6 determinant floor returns null', () => {
  // A=[0,0,1,0.0000003] B=[0,1,1,1.0000004]: distinct, non-intersecting near-parallel
  // lines whose determinant (b-1-a) = 1e-7 < 1e-6 -> guarded to null.
  assert.equal(lineInt([0, 0, 1, 0.0000003], [0, 1, 1, 1.0000004]), null);
});
check('lineInt: diagonal crossing', () => {
  const p = lineInt([0, 0, 10, 10], [0, 10, 10, 0]);
  assert.ok(ptNear(p, [5, 5]), `got ${JSON.stringify(p)}`);
});

// ---------- insetPolygon: the canonical CCW square ----------
check('CCW square inset by 2 -> concentric [[2,2],[8,2],[8,8],[2,8]]', () => {
  const out = insetPolygon(SQUARE_CCW, 2);
  const want = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];
  assert.equal(out.length, want.length);
  out.forEach((p, i) => assert.ok(ptNear(p, want[i]), `vertex ${i}: got ${JSON.stringify(p)} want ${JSON.stringify(want[i])}`));
});

check('CW square (reversed winding) insets to the SAME concentric square', () => {
  const out = insetPolygon(SQUARE_CW, 2);
  // CW order: [[0,0],[0,10],[10,10],[10,0]] -> inset vertices in that same order
  const want = [[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]];
  out.forEach((p, i) => assert.ok(ptNear(p, want[i]), `vertex ${i}: got ${JSON.stringify(p)} want ${JSON.stringify(want[i])}`));
});

check('inset square vertices sit exactly d from the original boundary', () => {
  const out = insetPolygon(SQUARE_CCW, 3);
  for (let i = 0; i < out.length - 1; i++) {
    assert.ok(near(distToBoundary(out[i], SQUARE_CCW), 3, 1e-4),
      `vertex ${i} dist ${distToBoundary(out[i], SQUARE_CCW)} != 3`);
  }
});

check('inset polygon is strictly inside the original (each vertex inset inward)', () => {
  const out = insetPolygon(SQUARE_CCW, 2);
  // every inset vertex coordinate is within (0,10)
  for (let i = 0; i < out.length - 1; i++) {
    assert.ok(out[i][0] > 0 && out[i][0] < 10 && out[i][1] > 0 && out[i][1] < 10,
      `vertex ${i} ${JSON.stringify(out[i])} not strictly inside`);
  }
});

check('inset by half the width collapses the square to its center', () => {
  const out = insetPolygon(SQUARE_CCW, 5);
  for (let i = 0; i < out.length - 1; i++) {
    assert.ok(ptNear(out[i], [5, 5], 1e-4), `vertex ${i} ${JSON.stringify(out[i])} != center`);
  }
});

check('non-square rectangle insets each side independently', () => {
  const rect = [[0, 0], [20, 0], [20, 6], [0, 6], [0, 0]];
  const out = insetPolygon(rect, 1);
  const want = [[1, 1], [19, 1], [19, 5], [1, 5], [1, 1]];
  out.forEach((p, i) => assert.ok(ptNear(p, want[i]), `vertex ${i}: got ${JSON.stringify(p)} want ${JSON.stringify(want[i])}`));
});

check('CCW triangle insets to a smaller interior triangle', () => {
  const tri = [[0, 0], [12, 0], [6, 9], [0, 0]];
  const out = insetPolygon(tri, 1);
  // every inset vertex is strictly inside the original triangle (positive dist from each edge)
  for (let i = 0; i < out.length - 1; i++) {
    assert.ok(distToBoundary(out[i], tri) >= 0.99, `vertex ${i} too close to edge`);
  }
  assert.ok(ptNear(out[0], out[out.length - 1]), 'triangle output must be closed');
});

check('output ring is always closed (first === last)', () => {
  for (const ring of [SQUARE_CCW, SQUARE_CW, [[0, 0], [20, 0], [20, 6], [0, 6], [0, 0]]]) {
    const out = insetPolygon(ring, 1.5);
    assert.ok(ptNear(out[0], out[out.length - 1]), 'first !== last');
  }
});

check('output vertex count == input edge count + 1 (closing dup)', () => {
  const out = insetPolygon(SQUARE_CCW, 2);
  assert.equal(out.length, 5); // 4 edges -> 4 vertices + 1 closing
});

check('concave L-shape: convex corners move inward, reflex handled without throwing', () => {
  // CCW L-shape
  const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10], [0, 0]];
  const out = insetPolygon(L, 1);
  assert.equal(out.length, 7);
  // bottom-left convex corner (0,0) -> (1,1)
  assert.ok(ptNear(out[0], [1, 1]), `corner 0: got ${JSON.stringify(out[0])}`);
  // the bottom-right convex corner (10,0) -> (9,1)
  assert.ok(ptNear(out[1], [9, 1]), `corner 1: got ${JSON.stringify(out[1])}`);
  out.forEach(p => assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), 'finite'));
});

check('collinear consecutive edges fall back to the original vertex (lineInt null)', () => {
  // square with an extra collinear midpoint on the bottom edge: (5,0) lies between (0,0)&(10,0)
  const ring = [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const out = insetPolygon(ring, 2);
  // vertex index 1 corresponds to (5,0): its two adjacent offset edges are collinear
  // (both the bottom edge, offset to y=2) -> lineInt null -> fallback to original (5,0).
  assert.ok(ptNear(out[1], [5, 0]), `collinear fallback: got ${JSON.stringify(out[1])} want [5,0]`);
});

// ---------- MUTATION PROOFS (each must go RED on the real source) ----------
function mutate(find, replace) {
  assert.ok(html.includes(find), `mutation anchor not found: ${find}`);
  return loadShipped(html.replace(find, replace));
}
function expectMutantWrong(label, mutantFn) {
  let wrong = false;
  try {
    const out = mutantFn.insetPolygon(SQUARE_CCW, 2);
    const want = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];
    wrong = out.some((p, i) => !ptNear(p, want[i]));
  } catch { wrong = true; }
  assert.ok(wrong, `mutation "${label}" did NOT change CCW-square output — test is not a real verifier`);
}

check('mutation: ccw forced +1 (drop winding) breaks the offset', () => {
  // for a CCW square ccw is already +1, so check the CW square instead
  const m = mutate('const ccw=area>0?1:-1', 'const ccw=1');
  const out = m.insetPolygon(SQUARE_CW, 2);
  const want = [[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]];
  assert.ok(out.some((p, i) => !ptNear(p, want[i])), 'ccw-blind mutant should mis-inset the CW square');
});
check('mutation: inward normal sign flipped grows instead of shrinks', () => {
  const m = mutate('const nx=(-dy/len)*ccw,ny=(dx/len)*ccw;', 'const nx=(dy/len)*ccw,ny=(-dx/len)*ccw;');
  expectMutantWrong('flip normal', m);
});
check('mutation: zero offset distance leaves the polygon unchanged', () => {
  const m = mutate('lines.push([a[0]+nx*d,a[1]+ny*d,b[0]+nx*d,b[1]+ny*d]);',
                   'lines.push([a[0]+nx*0,a[1]+ny*0,b[0]+nx*0,b[1]+ny*0]);');
  expectMutantWrong('zero offset', m);
});
check('mutation: dropping the computed intersection (always fallback) leaves it unchanged', () => {
  const m = mutate('out.push(p||pts[i]);', 'out.push(pts[i]);');
  expectMutantWrong('drop intersection', m);
});

console.log(`\ninset-polygon: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
