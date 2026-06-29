// Tests for MapKeys route geometry — the distance + partial-reveal slicing +
// antimeridian-safe interpolation behind the animated route reveal and the
// route-distance display. Imports the REAL shipped functions (no mirror, can't
// drift). No live bug — this is a verifier-layer LOCK; every assertion is
// mutation-proven to go RED if the corresponding logic regresses.
//
// Why it matters: haversine/buildRoute/lineLength drive how-long-is-this-route;
// sliceRoute/sliceLineCoords drive the animated reveal (the leading vertices +
// an interpolated point on the partial segment); lerpLng/lerpBearing interpolate
// the camera/shape the SHORT way around the globe — the exact antimeridian-wrap
// class that bit flight/index.html (commit 08a3b19).

import {
  haversine, buildRoute, sliceRoute, lineCentroid, transformLineCoords,
  lineLength, sliceLineCoords, lerpLng, lerpBearing, coordsBounds,
} from './route-geo.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ── Inline RED proof: a haversine with R=1 (broken) and a linear (no-wrap) lerp
// both fail cases the shipped functions pass — proving the asserts have teeth. ──
{
  const brokenHav = (la1, lo1, la2, lo2) => {
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(la2 - la1), dLon = toRad(lo2 - lo1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
    return 2 * 1 * Math.asin(Math.sqrt(a)); // R=1 not 6371
  };
  ok(brokenHav(0, 0, 0, 1) < 1 && haversine(0, 0, 0, 1) > 100,
    'RED-proof: a unit-radius haversine reports ~0.017 where the shipped km haversine reports ~111');
  const linearLng = (a, b, t) => a + (b - a) * t; // no antimeridian wrap
  ok(near(linearLng(179, -179, 0.5), 0) && near(lerpLng(179, -179, 0.5), 180),
    'RED-proof: a linear lng-lerp crosses lng 0 (the long way); shipped lerpLng takes the short hop across the seam');
}

// ── haversine ──
ok(near(haversine(40, -74, 40, -74), 0), 'haversine: same point = 0');
ok(near(haversine(0, 0, 1, 0), 111.19, 0.1), 'haversine: 1° of latitude ≈ 111.19 km');
ok(near(haversine(0, 0, 0, 1), 111.19, 0.1), 'haversine: 1° lng at equator ≈ 111.19 km');
ok(near(haversine(40.7128, -74.006, 51.5074, -0.1278), 5570, 5), 'haversine: NYC→London ≈ 5570 km');
ok(near(haversine(10, 20, 50, 60), haversine(50, 60, 10, 20)), 'haversine: symmetric in argument order');
ok(haversine(0, 179, 0, -179) < 250, 'haversine: across the antimeridian is a ~222 km short hop, not half the globe');

// ── buildRoute ──
{
  const r = buildRoute([[0, 0], [0, 1], [0, 2]]); // 3 colinear points, 1° apart
  ok(r.cumDist.length === 3 && r.cumDist[0] === 0, 'buildRoute: cumDist starts at 0, one entry per coord');
  ok(r.cumDist[1] < r.cumDist[2], 'buildRoute: cumDist is monotonically increasing');
  ok(near(r.totalDist, r.cumDist[2]), 'buildRoute: totalDist === last cumDist');
  ok(near(r.totalDist, haversine(0, 0, 1, 0) + haversine(1, 0, 2, 0)), 'buildRoute: totalDist = sum of segment haversines');
  ok(r.coords.length === 3, 'buildRoute: coords passed through');
}
ok(buildRoute([[5, 5]]).totalDist === 0, 'buildRoute: single point → totalDist 0');
ok(buildRoute([]).totalDist === 0, 'buildRoute: empty → totalDist 0 (|| guard)');

// ── sliceRoute ──
{
  const r = buildRoute([[0, 0], [0, 2]]); // one segment, ~222 km
  ok(sliceRoute(r, 0).length === 0, 'sliceRoute: progress 0 → []');
  ok(sliceRoute(r, -0.5).length === 0, 'sliceRoute: progress <0 → []');
  ok(sliceRoute(buildRoute([[0, 0]]), 0.5).length === 0, 'sliceRoute: <2 coords → []');
  const full = sliceRoute(r, 1);
  ok(full.length === 2 && full[1][1] === 2, 'sliceRoute: progress 1 → full copy');
  ok(full !== r.coords, 'sliceRoute: progress 1 returns a copy, not the original array');
  const half = sliceRoute(r, 0.5);
  ok(half.length === 2, 'sliceRoute: mid → leading vertex + interpolated point');
  ok(half[1] && near(half[1][1], 1, 0.01), 'sliceRoute: 0.5 along a 0→2 segment interpolates lat ≈ 1');
  ok(half[1] && near(half[1][0], 0), 'sliceRoute: interpolated lng stays 0 on a meridian segment');
}
{
  // 3-vertex L; slice past the first vertex keeps it + interpolates into segment 2.
  const r = buildRoute([[0, 0], [0, 1], [1, 1]]);
  const s = sliceRoute(r, 0.75); // 3/4 of total length → into the 2nd segment
  ok(s.length === 3 && s[0][1] === 0 && s[1][1] === 1, 'sliceRoute: keeps all leading vertices before the partial segment');
  ok(s[2] && s[2][0] > 0 && s[2][0] < 1, 'sliceRoute: final point interpolated within the partial segment');
}
{
  // Degenerate: all coords identical → totalDist 0 → segLen 0 → t=0, no NaN.
  const r = buildRoute([[3, 3], [3, 3]]);
  const s = sliceRoute(r, 0.5);
  ok(s.length === 2 && s[1] && Number.isFinite(s[1][0]) && Number.isFinite(s[1][1]), 'sliceRoute: zero-length route → finite point, no NaN');
}

// ── lineLength ──
ok(near(lineLength([[0, 0], [0, 1], [0, 2]]), haversine(0, 0, 1, 0) + haversine(1, 0, 2, 0)), 'lineLength: sum of segment haversines');
ok(lineLength([[5, 5]]) === 0, 'lineLength: single point → 0');
ok(lineLength([]) === 0, 'lineLength: empty → 0');

// ── lineCentroid ──
{
  const c = lineCentroid([[0, 0], [10, 0], [10, 10], [0, 10]]);
  ok(near(c[0], 5) && near(c[1], 5), 'lineCentroid: average of a square = its center');
  // Empty/missing input -> [0,0] sentinel, NEVER [NaN,NaN] (sum/0 trap).
  // Mutation-proof: strip the empty guard and these go RED (NaN !== 0, isNaN true).
  const e = lineCentroid([]);
  ok(e[0] === 0 && e[1] === 0, 'lineCentroid: [] -> [0,0], not [NaN,NaN]');
  const u = lineCentroid(undefined);
  ok(u[0] === 0 && u[1] === 0, 'lineCentroid: undefined -> [0,0], no throw');
  ok(!Number.isNaN(e[0]) && !Number.isNaN(e[1]), 'lineCentroid: empty centroid is NaN-free');
}

// ── transformLineCoords ──
{
  const base = [[0, 0], [10, 0], [10, 10]];
  const id = transformLineCoords(base, 0, 0, 1);
  ok(id.every((p, i) => near(p[0], base[i][0]) && near(p[1], base[i][1])), 'transformLineCoords: scale 1, offset 0 → identity');
  const off = transformLineCoords(base, 5, -3, 1);
  ok(off.every((p, i) => near(p[0], base[i][0] + 5) && near(p[1], base[i][1] - 3)), 'transformLineCoords: offset translates every point');
  const [cx, cy] = lineCentroid(base);
  const sc = transformLineCoords(base, 0, 0, 0);
  ok(sc.every(p => near(p[0], cx) && near(p[1], cy)), 'transformLineCoords: scale 0 collapses every point to the centroid');
  const big = transformLineCoords(base, 0, 0, 2);
  ok(near(big[0][0], cx + (0 - cx) * 2) && near(big[0][1], cy + (0 - cy) * 2), 'transformLineCoords: scale 2 doubles distance from centroid');
}

// ── sliceLineCoords (same semantics as sliceRoute, on raw coords) ──
{
  const coords = [[0, 0], [0, 2]];
  ok(sliceLineCoords(coords, 0).length === 0, 'sliceLineCoords: 0 → []');
  ok(sliceLineCoords([[1, 1]], 0.5).length === 0, 'sliceLineCoords: <2 coords → []');
  const full = sliceLineCoords(coords, 1);
  ok(full.length === 2 && full !== coords, 'sliceLineCoords: 1 → full copy (not the input array)');
  const half = sliceLineCoords(coords, 0.5);
  ok(half.length === 2 && half[1] && near(half[1][1], 1, 0.01), 'sliceLineCoords: 0.5 interpolates lat ≈ 1');
}

// ── lerpLng (antimeridian-safe) ──
ok(near(lerpLng(0, 10, 0), 0), 'lerpLng: t=0 → a');
ok(near(lerpLng(0, 10, 1), 10), 'lerpLng: t=1 → b (in range)');
ok(near(lerpLng(0, 10, 0.5), 5), 'lerpLng: ordinary midpoint');
ok(near(lerpLng(179, -179, 0.5), 180), 'lerpLng: 179→-179 takes the +2° short hop (to 180), not the -358° long way');
ok(near(lerpLng(-179, 179, 0.5), -180), 'lerpLng: -179→179 takes the -2° short hop');
ok(near(lerpLng(170, -170, 0.25), 175), 'lerpLng: 170→-170 (20° east across the seam) quarter-way → 175');
ok(near(lerpLng(50, 50, 0.5), 50), 'lerpLng: a==b → a');
ok(near(lerpLng(10, -10, 0.5), 0), 'lerpLng: 10→-10 (no wrap, |diff|<180) interpolates linearly to 0');

// ── lerpBearing ──
ok(near(lerpBearing(0, 90, 0.5), 45), 'lerpBearing: 0→90 → 45');
ok(near(lerpBearing(350, 10, 0.5), 360), 'lerpBearing: 350→10 takes the +20° short way (to 360), not -340');
ok(near(lerpBearing(10, 350, 0.5), 0), 'lerpBearing: 10→350 takes the -20° short way (to 0)');
ok(near(lerpBearing(90, 90, 0.7), 90), 'lerpBearing: a==b → a');

// ── coordsBounds (fitBounds box, single-pass, spread-overflow-safe) ──
{
  const c = coordsBounds([[1, 2], [-3, 4], [5, -6]]);
  ok(c[0][0] === -3 && c[0][1] === -6, 'coordsBounds: min corner = [minLng, minLat]');
  ok(c[1][0] === 5 && c[1][1] === 4, 'coordsBounds: max corner = [maxLng, maxLat]');
  const one = coordsBounds([[7, 8]]);
  ok(one[0][0] === 7 && one[1][0] === 7 && one[0][1] === 8 && one[1][1] === 8, 'coordsBounds: single point → degenerate box at that point');
  const empty = coordsBounds([]);
  ok(empty[0][0] === Infinity && empty[1][0] === -Infinity, 'coordsBounds: empty → Infinity box (byte-identical to old spread form)');
}
// Behavior-identity: on every array small enough that the old Math.min/max spread
// was even legal, coordsBounds returns the exact same box.
{
  const coords = Array.from({ length: 5000 }, (_, i) => [Math.sin(i) * 10, Math.cos(i) * 20]);
  const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
  const spreadBox = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
  const box = coordsBounds(coords);
  ok(box[0][0] === spreadBox[0][0] && box[0][1] === spreadBox[0][1] &&
     box[1][0] === spreadBox[1][0] && box[1][1] === spreadBox[1][1],
    'coordsBounds: identical to the old Math.min/max spread on a normal-size track');
}
// ── RED proof: the old spread form THROWS on a long recorded gx:Track; coordsBounds doesn't. ──
{
  // V8/Chrome (where this code actually runs) caps spread args at ~125k; JSC/bun
  // (this test runtime) caps near ~1M. Size above BOTH so the RED-proof is real
  // in whatever runtime runs it. A multi-hour recorded GPS log (gx:Track, the
  // just-enabled import path — the longest tracks) routinely exceeds the browser cap.
  const N = 1_100_000;
  const big = Array.from({ length: N }, (_, i) => [i * 0.0001, -(i * 0.0002)]);
  let spreadThrew = false;
  try { Math.max(...big.map(c => c[0])); } catch { spreadThrew = true; }
  ok(spreadThrew, `RED-proof: Math.max(...lngs) throws RangeError on a ${N}-point track (the bug)`);
  let boundsThrew = false, box = null;
  try { box = coordsBounds(big); } catch { boundsThrew = true; }
  ok(!boundsThrew, 'coordsBounds: handles the oversized track without throwing (the fix)');
  ok(box && near(box[0][0], 0) && near(box[1][0], (N - 1) * 0.0001),
    'coordsBounds: correct lng bounds even on the oversized track');
  ok(box && near(box[0][1], -((N - 1) * 0.0002)) && near(box[1][1], 0),
    'coordsBounds: correct lat bounds even on the oversized track');
}

console.log(`route-geo: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
