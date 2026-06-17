// Locks the LIVE scoring math of the PinGlobe geo-guessing game (pinglobe/src/).
//
// game.js (the mapbox-gl game, reached from main.js) imports three functions
// from geo-utils.js and uses them on EVERY guess:
//   • haversine(lat,lon,lat,lon) — great-circle distance home→target (km)
//   • kmToMiles(km)              — the "N mi away" the scorecard shows
//   • pointInFeature(lat,lon,f)  — for country-type clues (Taiwan/India/Mexico/
//                                  Japan/NZ, etc.), did the pin land INSIDE the
//                                  country polygon? This decides correct/wrong.
// These had ZERO coverage. This suite imports the REAL shipped functions
// (no byte-copy mirror, so it can't drift) and pins their behavior.
//
// NOTE for whoever reads this: pinglobe/src/globe.js and pins.js are a SECOND,
// abandoned THREE.js globe implementation. Nothing imports them (main.js uses
// mapbox-gl), and they `import { latLonToVector3, GLOBE_RADIUS, featureCentroid }
// from './geo-utils.js'` — symbols geo-utils never exports. So those two files
// are dead AND would crash if ever wired up. Not fixed here: reviving them needs
// THREE pulled into this pure util (which would bloat the live game bundle) and
// a decision on mapbox-vs-THREE that's Johnny's call. Left as a logged landmine.
//
// run: node pinglobe/src/geo-utils.test.mjs   (or: bun run test)

import { haversine, kmToMiles, computeBearing, pointInFeature } from './geo-utils.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const R = 6371; // same Earth radius the module uses

// ---------------- haversine ----------------
ok('same point → 0 km',                 haversine(0, 0, 0, 0) === 0);
ok('same point (non-origin) → 0',       haversine(40.7, -74, 40.7, -74) === 0);
ok('1° of latitude ≈ 111.19 km',        near(haversine(0, 0, 1, 0), R * Math.PI / 180, 1e-6));
ok('quarter equator (0,0)→(0,90)',      near(haversine(0, 0, 0, 90), R * Math.PI / 2, 1e-6));
ok('pole to pole = half circumference', near(haversine(90, 0, -90, 0), R * Math.PI, 1e-6));
ok('antipodal = half circumference',    near(haversine(0, 0, 0, 180), R * Math.PI, 1e-6));
ok('NYC→London ≈ 5570 km (±40)',        near(haversine(40.7128, -74.0060, 51.5074, -0.1278), 5570, 40));
ok('symmetric A→B == B→A',              haversine(34.05, -118.24, 35.68, 139.69) === haversine(35.68, 139.69, 34.05, -118.24));
ok('distance is non-negative',          haversine(-33.87, 151.21, 55.75, 37.62) > 0);
ok('longitude wrap: -179→179 is short', near(haversine(0, -179, 0, 179), R * Math.PI / 90, 1e-6)); // 2° apart, not 358°

// ---------------- kmToMiles ----------------
ok('0 km → 0 mi',                       kmToMiles(0) === 0);
ok('100 km → 62.1371 mi',               near(kmToMiles(100), 62.1371, 1e-4));
ok('1.609344 km ≈ 1 mi',                near(kmToMiles(1.609344), 1, 1e-3));
ok('monotonic: more km → more mi',      kmToMiles(50) < kmToMiles(51));

// ---------------- computeBearing (cardinal directions) ----------------
ok('due north → 0°',                    near(computeBearing(0, 0, 1, 0), 0, 1e-6));
ok('due east → 90°',                    near(computeBearing(0, 0, 0, 1), 90, 1e-6));
ok('due south → 180°',                  near(computeBearing(1, 0, 0, 0), 180, 1e-6));
ok('due west → 270°',                   near(computeBearing(0, 1, 0, 0), 270, 1e-6));
ok('bearing always in [0,360)', [
    computeBearing(10, 20, -30, -40),
    computeBearing(-15, 100, 60, -120),
    computeBearing(0, 0, -1, -1),
  ].every(b => b >= 0 && b < 360));

// ---------------- pointInFeature: Polygon ----------------
// GeoJSON rings are [lon, lat]. A 10×10 box centered on the origin.
const square = { geometry: { type: 'Polygon', coordinates: [
  [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]],
] } };
ok('Polygon: center inside → true',     pointInFeature(0, 0, square) === true);
ok('Polygon: near corner inside → true',pointInFeature(4.9, 4.9, square) === true);
ok('Polygon: east of box → false',      pointInFeature(0, 10, square) === false);
ok('Polygon: north of box → false',     pointInFeature(10, 0, square) === false);
ok('Polygon: just west of edge → false',pointInFeature(0, -5.1, square) === false);

// Polygon with a hole (donut): outer 20×20, inner 4×4 hole.
const donut = { geometry: { type: 'Polygon', coordinates: [
  [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]],  // outer ring
  [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]],            // hole
] } };
ok('donut: point in the hole → false',  pointInFeature(0, 0, donut) === false);
ok('donut: solid ring → true',          pointInFeature(5, 5, donut) === true);
ok('donut: solid (north of hole) → true', pointInFeature(0, 5, donut) === true);
ok('donut: outside outer → false',      pointInFeature(0, 20, donut) === false);

// ---------------- pointInFeature: MultiPolygon ----------------
// Two disjoint boxes (like a country with two landmasses).
const two = { geometry: { type: 'MultiPolygon', coordinates: [
  [ [[-10, -2], [-5, -2], [-5, 2], [-10, 2], [-10, -2]] ],  // west box A
  [ [[5, -2], [10, -2], [10, 2], [5, 2], [5, -2]] ],        // east box B
] } };
ok('MultiPolygon: inside box A → true', pointInFeature(0, -7, two) === true);
ok('MultiPolygon: inside box B → true', pointInFeature(0, 7, two) === true);
ok('MultiPolygon: gap between → false', pointInFeature(0, 0, two) === false);

// MultiPolygon where the point sits in polygon A's HOLE but inside a separate
// polygon B that fills that hole — must resolve true (B catches it).
const filled = { geometry: { type: 'MultiPolygon', coordinates: [
  [ [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]],   // A outer
    [[-3, -3], [3, -3], [3, 3], [-3, 3], [-3, -3]] ],            // A hole
  [ [[-3, -3], [3, -3], [3, 3], [-3, 3], [-3, -3]] ],            // B fills the hole
] } };
ok('MultiPolygon: in A-hole but in B → true', pointInFeature(0, 0, filled) === true);

// ---------------- pointInFeature: degenerate inputs ----------------
ok('no geometry key → false',           pointInFeature(0, 0, {}) === false);
ok('null geometry → false',             pointInFeature(0, 0, { geometry: null }) === false);
ok('unsupported geom type → false',     pointInFeature(0, 0, { geometry: { type: 'Point', coordinates: [0, 0] } }) === false);

console.log(`geo-utils: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
