// Lock for walden-3d/studio.html elClearance — the setback-clearance check that
// drives the ⚠ "into setback" warning. The OLD code sampled only the element's
// 4 CORNERS, so a long thin element (hedge/path) whose nearest point to the lot
// line is on an EDGE near a pointed lot vertex reported a FALSE "✓ to line".
// The fix densifies each element edge (corners stay included -> strict superset),
// matching the main /walden/ tool's densifyLocalRing approach.
//
// EXTRACTS the real shipped pSeg/elCorners/distToLotLine/elClearance from the HTML
// at runtime (new Function), so the lock can't drift from a mirror. PARCEL_EN is
// injected so we can construct a crisp lot-vertex-under-edge case.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'studio.html'), 'utf8');

// pull `function NAME(...){...}` from the HTML by brace-matching from its start
function extractFn(name) {
  const start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = HTML.indexOf('{', start), depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}

// build a scope holding the REAL shipped functions, with PARCEL_EN injected
function buildScope(PARCEL_EN) {
  const body = `
    const PARCEL_EN = ${JSON.stringify(PARCEL_EN)};
    ${extractFn('pSeg')}
    ${extractFn('elCorners')}
    ${extractFn('distToLotLine')}
    ${extractFn('elClearance')}
    return { pSeg, elCorners, distToLotLine, elClearance };`;
  return new Function(body)();
}

// the OLD corner-only elClearance, reconstructed from the SAME real elCorners +
// distToLotLine — for the inline RED proof and the additive invariant.
function oldCornerClearance(scope, el) {
  let m = Infinity;
  scope.elCorners(el).forEach(c => { const d = scope.distToLotLine(c[0], c[1]); if (d < m) m = d; });
  return m;
}

let pass = 0, fail = 0;
const approx = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } }

// ---- the lot-vertex-under-an-edge scenario (the bug) ----
// Apex V=(10,0) points UP toward the element; both lot sides drop steeply away,
// so V is the nearest lot feature for every element point and the perpendicular
// feet from the corners clamp to V.
const SPIKE = [[10, 0], [60, -100], [-40, -100], [10, 0]];
// path-like element: 24ft x 4ft, centered at (10,8), axis-aligned. Bottom edge n=6.
const PATH_OVER_SPIKE = { id: 'p', type: 'path', e: 10, n: 8, wFt: 24, lFt: 4, rot: 0 };

{
  const s = buildScope(SPIKE);
  const fixed = s.elClearance(PATH_OVER_SPIKE);
  const old = oldCornerClearance(s, PATH_OVER_SPIKE);

  // RED PROOF: the OLD corner-only logic reports ~13.4ft (both bottom corners are
  // hypot(12,6) from the apex), MISSING the bottom-edge midpoint that sits 6ft
  // from the apex. With a 10ft setback, OLD => "✓ OK" (wrong), FIXED => "⚠ violation".
  ok(approx(old, Math.hypot(12, 6)), `RED proof: old corner-only reports ~13.42, got ${old.toFixed(2)}`);
  ok(approx(fixed, 6), `fixed edge-sampled reports the true 6ft edge clearance, got ${fixed.toFixed(2)}`);
  ok(fixed < old - 1, `fixed (${fixed.toFixed(2)}) is meaningfully tighter than old (${old.toFixed(2)})`);

  // the load-bearing consequence: at a 10ft setback the OLD passes, the FIXED flags
  const req = 10;
  ok(old >= req, `OLD wrongly clears the 10ft setback (${old.toFixed(2)} >= 10)`);
  ok(fixed < req, `FIXED correctly flags the 10ft setback violation (${fixed.toFixed(2)} < 10)`);
}

// ---- no-regression: corner IS the closest -> fixed === old, byte-for-byte ----
// Axis-aligned element near an axis-aligned lot edge: distance is constant along
// the parallel edge, so the corner equals the midpoint.
{
  const SQUARE = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
  const s = buildScope(SQUARE);
  for (const el of [
    { id: 'a', type: 'deck', e: 50, n: 12, wFt: 16, lFt: 20, rot: 0 },   // near bottom edge
    { id: 'b', type: 'patio', e: 88, n: 50, wFt: 18, lFt: 18, rot: 0 },  // near right edge
    { id: 'c', type: 'bed', e: 50, n: 50, wFt: 6, lFt: 14, rot: 0 },     // dead center
    { id: 'd', type: 'tree', e: 20, n: 80, wFt: 18, lFt: 18, rot: 0 },   // bbox-sampled circle
  ]) {
    const fixed = s.elClearance(el), old = oldCornerClearance(s, el);
    ok(approx(fixed, old, 0.001), `no-regression: ${el.type} corner-closest -> fixed (${fixed.toFixed(3)}) === old (${old.toFixed(3)})`);
  }
}

// ---- additive invariant: fixed <= old ALWAYS (densify is a superset of corners) ----
{
  const PARCELS = [SPIKE, [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], [[5, 5], [95, 10], [80, 90], [10, 70], [5, 5]]];
  let checked = 0;
  for (const P of PARCELS) {
    const s = buildScope(P);
    for (let e = 10; e <= 90; e += 20)
      for (let n = 10; n <= 90; n += 20)
        for (const rot of [0, 30, 45, 90]) {
          const el = { id: 'x', type: 'path', e, n, wFt: 24, lFt: 4, rot };
          const fixed = s.elClearance(el), old = oldCornerClearance(s, el);
          if (fixed > old + 1e-6) { fail++; console.error(`  ✗ invariant: fixed ${fixed} > old ${old} (P,e,n,rot)`); }
          else checked++;
        }
  }
  ok(checked > 100, `additive invariant: fixed <= old across ${checked} element/parcel configs`);
}

// ---- rotated long element still finds its edge clearance ----
{
  // a hedge rotated so its long axis crosses near a spike apex
  const s = buildScope(SPIKE);
  const hedge = { id: 'h', type: 'hedge', e: 10, n: 9, wFt: 2.5, lFt: 26, rot: 90 }; // long axis horizontal after 90deg
  const fixed = s.elClearance(hedge), old = oldCornerClearance(s, hedge);
  ok(fixed <= old + 1e-6, `rotated hedge: fixed (${fixed.toFixed(2)}) <= old (${old.toFixed(2)})`);
  ok(fixed < old, `rotated hedge spanning the apex: fixed (${fixed.toFixed(2)}) tighter than old (${old.toFixed(2)})`);
}

console.log(`elclearance: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
