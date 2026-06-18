// Tests for MapKeys regularPolygonCoords — the ring builder behind every drawn
// polygon shape. Imports the REAL shipped function (no mirror, can't drift).
//
// The bug this locks: the original code started vertex 0 at -PI/2 (south), so an
// odd-sided polygon (triangle/pentagon) pointed DOWN at rotation 0 — contradicting
// the function's own "vertex up" comment. The user can set sides 3..24, so a
// dropped triangle rendered upside-down (▽) instead of point-up (△). Even-sided
// shapes (the default octagon) are symmetric under a 180° flip, so the fix is a
// no-op for them and only corrects odd-sided shapes.

import { regularPolygonCoords, KM_PER_DEG_LAT } from './polygon-geom.js';

let pass = 0, fail = 0;
const EPS = 1e-9;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }
function near(a, b, eps = EPS) { return Math.abs(a - b) <= eps; }
// The vertex SET (rendered shape) ignoring ring start point + closing dup.
function vertexSet(ring) {
  return JSON.stringify(ring.slice(0, -1).map(p => [+p[0].toFixed(8), +p[1].toFixed(8)]).sort());
}

// ── Inline RED proof: reconstruct the OLD (-PI/2) builder and show it pointed
// the triangle DOWN, while the shipped builder points it UP. ──
function oldPoly(center, sides, radiusKm, rotationDeg) {
  const [lng0, lat0] = center;
  const latRad = lat0 * Math.PI / 180;
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLng = radiusKm / (KM_PER_DEG_LAT * Math.max(0.05, Math.cos(latRad)));
  const rot = rotationDeg * Math.PI / 180;
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i / sides) * Math.PI * 2 + rot; // the bug
    ring.push([lng0 + Math.cos(a) * dLng, lat0 + Math.sin(a) * dLat]);
  }
  ring.push(ring[0]);
  return ring;
}
{
  const oldTri = oldPoly([0, 0], 3, 100, 0);
  const newTri = regularPolygonCoords([0, 0], 3, 100, 0);
  // RED proof: old apex (vertex 0) is SOUTH of center (lat < 0).
  ok(oldTri[0][1] < 0, 'RED proof: OLD triangle vertex 0 points DOWN (lat<0)');
  // GREEN: shipped apex is NORTH of center (lat > 0), directly above center (lng≈0).
  ok(newTri[0][1] > 0, 'shipped triangle vertex 0 points UP (lat>0)');
  ok(near(newTri[0][0], 0), 'shipped triangle apex sits directly above center (lng≈0)');
  // They genuinely differ for odd sides.
  ok(vertexSet(oldTri) !== vertexSet(newTri), 'odd-sided fix changes the rendered shape');
}

// ── Vertex-up at rotation 0 for a range of odd AND even sides ──
for (const sides of [3, 4, 5, 6, 7, 8, 9, 12]) {
  const ring = regularPolygonCoords([0, 0], sides, 100, 0);
  const apex = ring[0];
  ok(near(apex[0], 0), `sides=${sides}: vertex 0 lng≈center (straight up)`);
  ok(apex[1] > 0, `sides=${sides}: vertex 0 is north of center (vertex up)`);
  const dLat = 100 / KM_PER_DEG_LAT;
  ok(near(apex[1], dLat), `sides=${sides}: vertex 0 at exactly +radius in lat`);
}

// ── Even-sided shapes are a NO-OP vs the old code (rendered set identical) ──
for (const sides of [4, 6, 8, 10, 12, 24]) {
  ok(vertexSet(oldPoly([2, 40], sides, 80, 17)) === vertexSet(regularPolygonCoords([2, 40], sides, 80, 17)),
    `even sides=${sides}: rendered vertex set unchanged from old (no-op, incl. default octagon)`);
}
// ── Odd-sided shapes genuinely differ (the fix bites only here) ──
for (const sides of [3, 5, 7, 9, 11]) {
  ok(vertexSet(oldPoly([2, 40], sides, 80, 17)) !== vertexSet(regularPolygonCoords([2, 40], sides, 80, 17)),
    `odd sides=${sides}: rendered vertex set flips (fix corrects orientation)`);
}

// ── Structural invariants ──
{
  const ring = regularPolygonCoords([10, 20], 5, 50, 0);
  ok(ring.length === 6, 'ring has sides+1 points (closed)');
  ok(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1], 'ring is closed (first === last)');
  const oct = regularPolygonCoords([0, 0], 8, 100, 0);
  ok(oct.length === 9, 'octagon has 9 points');
}

// ── Radius / pole scaling ──
{
  // At the equator, lng and lat half-extents are equal (cos(0)=1).
  const eq = regularPolygonCoords([0, 0], 4, 111.32, 0);
  // vertex 0 up (lat = +1deg); vertex at index 2 down (lat = -1deg)
  const lats = eq.slice(0, -1).map(p => p[1]);
  ok(near(Math.max(...lats), 1, 1e-6), 'equator: max lat extent ≈ radius/111.32 deg');
  ok(near(Math.min(...lats), -1, 1e-6), 'equator: min lat extent ≈ -radius/111.32 deg');

  // Near the pole, lng extent is stretched by 1/cos(lat) > lat extent.
  const hi = regularPolygonCoords([0, 60], 4, 100, 0);
  const lngs = hi.slice(0, -1).map(p => p[0]);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const latsHi = hi.slice(0, -1).map(p => p[1]);
  const latSpan = Math.max(...latsHi) - Math.min(...latsHi);
  ok(lngSpan > latSpan, 'lat=60: lng span stretched wider than lat span (anti-squash)');
  // cos(60°)=0.5 → ~2x stretch.
  ok(near(lngSpan / latSpan, 2, 0.05), 'lat=60: lng/lat span ratio ≈ 1/cos(60°) ≈ 2');

  // Extreme pole clamps cos to 0.05 (no divide-by-zero / runaway).
  const pole = regularPolygonCoords([0, 89.9], 4, 100, 0);
  ok(pole.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])), 'near-pole ring is all finite (cos clamp holds)');
}

// ── Rotation offset ──
{
  // Rotating a triangle by 180° puts the old (down) apex back — i.e. equals old code.
  ok(vertexSet(regularPolygonCoords([0, 0], 3, 100, 180)) === vertexSet(oldPoly([0, 0], 3, 100, 0)),
    'rotating fixed triangle 180° == old upside-down triangle (rotation wired correctly)');
  // Rotation shifts the apex off straight-up.
  const rot = regularPolygonCoords([0, 0], 5, 100, 30);
  ok(!near(rot[0][0], 0), 'rotation 30° moves vertex 0 off the vertical');
}

// ── Center offset (shape follows its center) ──
{
  const a = regularPolygonCoords([0, 0], 6, 50, 0);
  const b = regularPolygonCoords([5, 0], 6, 50, 0);
  ok(near(b[0][0] - a[0][0], 5) && near(b[0][1], a[0][1]), 'center offset translates every vertex by the same delta');
}

console.log(`polygon-geom: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
