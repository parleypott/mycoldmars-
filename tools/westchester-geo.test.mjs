// Tests for the geo core in public/westchester/index.html — the load-bearing,
// zero-coverage geometry behind Johnny's REAL house hunt:
//   ringContains   — PNPOLY ray-cast point-in-ring
//   pointInPolygon — Polygon/MultiPolygon containment WITH holes (drives
//                    detectSchoolDistrict → which school district a home sits in,
//                    a huge factor in the actual buy decision)
//   distMiles      — haversine miles (drives every "closest station/trail/Manhattan"
//                    ranking and the walk/drive fallbacks)
//   closest        — nearest item in a list by distMiles
//
// Extracts the ACTUAL shipped functions from index.html at runtime (strongest
// signal — can't drift from a hand-copied mirror). No live bug found; this is a
// verifier-layer LOCK (same standard as the geo-utils / render-geometry locks) —
// every assertion is mutation-proven (see the runner notes) to fail if the
// corresponding logic regresses. Test-only, zero source change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

function extractFn(name, signature) {
  // Grab a top-level `function NAME(...) { ... }\n}` block. The ray-cast/geo
  // functions in index.html each close on a column-0 `}` so a non-greedy match
  // to the first `\n}\n` lifts exactly one function.
  const re = new RegExp('function ' + name + '\\(' + signature + '\\) \\{[\\s\\S]*?\\n\\}\\n');
  const m = HTML.match(re);
  if (!m) throw new Error('could not locate ' + name + ' in index.html');
  return m[0];
}

// ringContains and pointInPolygon are interdependent (pointInPolygon calls
// ringContains); load them in one scope. distMiles + closest likewise.
const polyBundle = new Function(
  extractFn('ringContains', 'ring, lng, lat') +
  extractFn('pointInPolygon', 'lng, lat, geom') +
  '\nreturn { ringContains, pointInPolygon };'
)();
const distBundle = new Function(
  extractFn('distMiles', 'a, b') +
  extractFn('closest', 'point, list') +
  '\nreturn { distMiles, closest };'
)();
const { ringContains, pointInPolygon } = polyBundle;
const { distMiles, closest } = distBundle;

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error('✗ ' + name + '\n    ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

// ── helpers ──────────────────────────────────────────────────────────────
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const polygon = (rings) => ({ type: 'Polygon', coordinates: rings });
const multi = (polys) => ({ type: 'MultiPolygon', coordinates: polys });

// ── ringContains (PNPOLY) ──────────────────────────────────────────────────
check('ringContains: point inside a unit square', () => {
  assert.equal(ringContains(sq(0, 0, 4, 4), 2, 2), true);
});
check('ringContains: point outside (right of) the square', () => {
  assert.equal(ringContains(sq(0, 0, 4, 4), 5, 2), false);
});
check('ringContains: point outside (left of) the square', () => {
  assert.equal(ringContains(sq(0, 0, 4, 4), -1, 2), false);
});
check('ringContains: point outside (above) the square', () => {
  assert.equal(ringContains(sq(0, 0, 4, 4), 2, 9), false);
});
check('ringContains: works on an OPEN ring (first point not repeated)', () => {
  // j=i++ wrap handles a ring whose last vertex != first
  const open = [[0, 0], [4, 0], [4, 4], [0, 4]];
  assert.equal(ringContains(open, 2, 2), true);
  assert.equal(ringContains(open, 9, 9), false);
});
check('ringContains: concave (L-shape) — point in the notch is OUTSIDE', () => {
  // L-shape occupying the bottom and left; the top-right quadrant is the notch.
  const L = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6], [0, 0]];
  assert.equal(ringContains(L, 1, 1), true);   // in the foot
  assert.equal(ringContains(L, 4, 4), false);  // in the notch (outside the L)
  assert.equal(ringContains(L, 5, 1), true);   // in the foot's right arm
});

// ── pointInPolygon — Polygon ───────────────────────────────────────────────
check('pointInPolygon: simple Polygon inside/outside', () => {
  const g = polygon([sq(0, 0, 10, 10)]);
  assert.equal(pointInPolygon(5, 5, g), true);
  assert.equal(pointInPolygon(15, 5, g), false);
});
check('pointInPolygon: HOLE — point in the hole is OUTSIDE', () => {
  // outer 0..10, hole 3..7
  const g = polygon([sq(0, 0, 10, 10), sq(3, 3, 7, 7)]);
  assert.equal(pointInPolygon(5, 5, g), false); // dead center = in the hole
  assert.equal(pointInPolygon(1, 1, g), true);  // in outer, outside hole
  assert.equal(pointInPolygon(8, 8, g), true);  // in outer, outside hole
});
check('pointInPolygon: MultiPolygon — matches the second landmass', () => {
  const g = multi([[sq(0, 0, 4, 4)], [sq(10, 10, 14, 14)]]);
  assert.equal(pointInPolygon(12, 12, g), true);  // inside 2nd
  assert.equal(pointInPolygon(2, 2, g), true);    // inside 1st
  assert.equal(pointInPolygon(7, 7, g), false);   // between the two
});
check('pointInPolygon: point in poly A hole but inside poly B → inside', () => {
  // A: outer 0..10 with hole 3..7. B: outer 4..6 (sits inside A's hole).
  const g = multi([
    [sq(0, 0, 10, 10), sq(3, 3, 7, 7)],
    [sq(4, 4, 6, 6)],
  ]);
  assert.equal(pointInPolygon(5, 5, g), true); // in A's hole, but in B
});
check('pointInPolygon: null / unsupported geometry → false', () => {
  assert.equal(pointInPolygon(5, 5, null), false);
  assert.equal(pointInPolygon(5, 5, { type: 'Point', coordinates: [5, 5] }), false);
  assert.equal(pointInPolygon(5, 5, { type: 'LineString', coordinates: [[0, 0], [9, 9]] }), false);
});

// ── distMiles (haversine) ───────────────────────────────────────────────────
check('distMiles: same point → 0', () => {
  assert.equal(distMiles({ lat: 41, lng: -73.7 }, { lat: 41, lng: -73.7 }), 0);
});
check('distMiles: 1° of latitude ≈ 69 miles', () => {
  const d = distMiles({ lat: 41, lng: -73.7 }, { lat: 42, lng: -73.7 });
  assert.ok(Math.abs(d - 69) < 0.6, `expected ~69 mi, got ${d}`);
});
check('distMiles: Grand Central → Boston ≈ 190 mi (sanity)', () => {
  const gct = { lat: 40.7527, lng: -73.9772 };
  const bos = { lat: 42.3601, lng: -71.0589 };
  const d = distMiles(gct, bos);
  assert.ok(d > 180 && d < 200, `expected ~190 mi, got ${d}`);
});
check('distMiles: symmetric', () => {
  const a = { lat: 41.1, lng: -73.8 }, b = { lat: 41.3, lng: -73.5 };
  assert.ok(Math.abs(distMiles(a, b) - distMiles(b, a)) < 1e-9);
});

// ── closest ─────────────────────────────────────────────────────────────────
check('closest: picks the nearest item and reports its miles', () => {
  const here = { lat: 41.10, lng: -73.80 };
  const list = [
    { name: 'far', lat: 41.50, lng: -73.20 },
    { name: 'near', lat: 41.11, lng: -73.81 },
    { name: 'mid', lat: 41.25, lng: -73.70 },
  ];
  const r = closest(here, list);
  assert.equal(r.name, 'near');
  assert.ok(r.miles > 0 && r.miles < 2, `near should be <2mi, got ${r.miles}`);
});
check('closest: a tie keeps the first scanned', () => {
  const here = { lat: 41, lng: -73 };
  const list = [
    { name: 'A', lat: 41.1, lng: -73 },
    { name: 'B', lat: 40.9, lng: -73 }, // same distance, scanned 2nd → not chosen
  ];
  assert.equal(closest(here, list).name, 'A');
});

// ── inline RED proofs (demonstrate the lock catches a regression) ───────────
// A ring-cast with the parity toggle removed always reports "outside".
function ringContainsNoParity(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) { /* parity toggle dropped */ }
  }
  return inside;
}
check('RED proof: parity-less ray-cast wrongly reports inside-point as outside', () => {
  assert.equal(ringContainsNoParity(sq(0, 0, 4, 4), 2, 2), false); // broken
  assert.equal(ringContains(sq(0, 0, 4, 4), 2, 2), true);          // shipped is right
});
// A pointInPolygon that ignores holes wrongly reports a hole-point as inside.
function pointInPolygonNoHoles(lng, lat, geom) {
  if (!geom) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) {
    if (ringContains(poly[0], lng, lat)) return true; // holes ignored
  }
  return false;
}
check('RED proof: hole-ignoring containment wrongly reports a hole-point as inside', () => {
  const g = polygon([sq(0, 0, 10, 10), sq(3, 3, 7, 7)]);
  assert.equal(pointInPolygonNoHoles(5, 5, g), true);  // broken
  assert.equal(pointInPolygon(5, 5, g), false);        // shipped is right
});

console.log(`westchester-geo: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
