// Verifier-layer test for the reef frame-baker's GEO CORE (tools/reef-geo.ts):
// the Web-Mercator projection + tile-layout math that reef-render.ts uses to decide
// which Google satellite tiles to fetch and where to cut each 2560×1440 frame out of
// the stitched canvas. It bakes the reef flicker-loop's source JPEGs — if the
// projection or the crop offset drifts, EVERY baked frame is silently mis-centered
// (or sharp's .extract() throws / bars a frame black by reading past the tiles), and
// the headless bake has nothing to catch it. reef churned heavily this week with zero
// coverage on this math, so this locks it before a refactor can move it.
//
// Imports the REAL shipped module directly (runs under bun, which handles .ts) so it
// can't drift from a hand-mirrored copy — this is the SAME module reef-render.ts
// imports, so there's no divergent twin to keep in sync.
//
// Mutation proofs at the bottom prove the lock has teeth.

import { strict as assert } from 'node:assert';
import { TILE, lonToGlobalPx, latToGlobalPx, wrapTileX, tileYInBounds, frameLayout }
  from './reef-geo.ts';

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-9, `${m} (got ${a}, want ${b})`); passed++; };

// ── 1. PROJECTION ANCHORS (textbook Web-Mercator) ──────────────────────────────
// whole world at zoom z is TILE*2^z px wide/tall; equator & prime meridian at center.
near(lonToGlobalPx(-180, 0), 0,          'z0: lon −180 → left edge (0)');
near(lonToGlobalPx(0, 0),    TILE / 2,   'z0: lon 0 → horizontal center (128)');
near(lonToGlobalPx(180, 0),  TILE,       'z0: lon 180 → right edge (256)');
near(latToGlobalPx(0, 0),    TILE / 2,   'z0: lat 0 (equator) → vertical center (128)');
near(lonToGlobalPx(0, 1),    TILE,       'z1: lon 0 → 256 (world is 512 wide)');
near(latToGlobalPx(0, 1),    TILE,       'z1: equator → 256');
near(lonToGlobalPx(-90, 2),  TILE,       'z2: lon −90 → one quarter across (256)');

// ── 2. MONOTONICITY + Y-GROWS-SOUTH orientation ───────────────────────────────
ok(lonToGlobalPx(10, 12) > lonToGlobalPx(-10, 12), 'east (larger lon) → larger global X');
// north is a SMALLER Y than south — this orientation is what pairs px-up with lat-up.
ok(latToGlobalPx(40, 12) < latToGlobalPx(0, 12),  'north (+lat) → SMALLER Y than equator');
ok(latToGlobalPx(0, 12)  < latToGlobalPx(-40, 12), 'equator → smaller Y than south');
// symmetric about the equator
near(latToGlobalPx(30, 5) + latToGlobalPx(-30, 5), TILE * 2 ** 5, 'lat ±30 straddle the vertical center symmetrically');

// ── 3. TILE X-WRAP (antimeridian) + Y-BOUNDS (no vertical wrap) ────────────────
{
  const z = 4, n = 2 ** z;                 // 16 tiles
  assert.equal(wrapTileX(0, z), 0);        passed++;
  assert.equal(wrapTileX(n - 1, z), n - 1); passed++;
  assert.equal(wrapTileX(-1, z), n - 1);   passed++;   // one west of 0 wraps to the east edge
  assert.equal(wrapTileX(n, z), 0);        passed++;   // one east of the edge wraps to 0
  assert.equal(wrapTileX(n + 2, z), 2);    passed++;
  assert.equal(wrapTileX(-n - 3, z), n - 3); passed++;
  ok(tileYInBounds(0, z) === true,     'y=0 in bounds');
  ok(tileYInBounds(n - 1, z) === true, 'y=n−1 in bounds');
  ok(tileYInBounds(-1, z) === false,   'y=−1 out of bounds (no north wrap)');
  ok(tileYInBounds(n, z) === false,    'y=n out of bounds (no south wrap)');
}

// ── 4. frameLayout: the extract window fits INSIDE the stitched canvas ──────────
// THE load-bearing invariant. Across a grid of reef-plausible centers and zooms the
// W×H crop must sit fully within the whole-tile canvas — else sharp reads past the
// composited tiles. Also: the crop is centered on round(projected center), and the
// covering tile range is inclusive of both edges of the crop.
const W = 2560, H = 1440;
for (const z of [13, 14, 15, 16, 17, 18]) {
  for (const lat of [-41.3, -8.5, -0.2, 0, 7.1, 21.9, 40.7]) {
    for (const lon of [-179.4, -95, -0.3, 0, 66.7, 151.2, 179.6]) {
      const L = frameLayout(lat, lon, z, W, H);
      // extract fully inside the canvas — the whole point of the layout
      ok(L.extractLeft >= 0,             `extractLeft ≥ 0 (z${z} ${lat},${lon})`);
      ok(L.extractTop >= 0,              `extractTop ≥ 0 (z${z} ${lat},${lon})`);
      ok(L.extractLeft + W <= L.canvasW, `crop within canvas width (z${z} ${lat},${lon})`);
      ok(L.extractTop + H <= L.canvasH,  `crop within canvas height (z${z} ${lat},${lon})`);
      // tile range covers exactly the crop span (inclusive both ends)
      assert.equal(L.tL, Math.floor(L.left / TILE));               passed++;
      assert.equal(L.tR, Math.floor((L.left + W - 1) / TILE));     passed++;
      assert.equal(L.canvasW, (L.tR - L.tL + 1) * TILE);           passed++;
      // the crop's global-px origin is exactly tile-origin + extract offset
      assert.equal(L.tL * TILE + L.extractLeft, L.left);           passed++;
      assert.equal(L.tT * TILE + L.extractTop, L.top);             passed++;
      // extract offset is the sub-tile remainder → strictly < one tile
      ok(L.extractLeft < TILE && L.extractTop < TILE, 'extract offset is a sub-tile remainder');
    }
  }
}

// centering: the crop is centered on the rounded projected center
{
  const L = frameLayout(0, 0, 10, W, H);
  const cx = lonToGlobalPx(0, 10), cy = latToGlobalPx(0, 10);
  near(L.left, Math.round(cx - W / 2), 'crop left = round(center − W/2)');
  near(L.top,  Math.round(cy - H / 2), 'crop top = round(center − H/2)');
}

// ── MUTATION PROOFS: the lock must FAIL if the math regresses ───────────────────
function mustThrow(fn, label) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(threw, `MUTATION CAUGHT: ${label}`);
}

// (a) flip the mercator Y sign (0.5 + … instead of 0.5 − …): north/south invert.
mustThrow(() => {
  const badLatPx = (lat, z) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return (0.5 + Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z; // BUG: +
  };
  assert.ok(badLatPx(40, 12) < badLatPx(0, 12), 'sign-flipped Y still puts north above equator');
}, 'flipping the mercator Y sign breaks north-above-equator');

// (b) drop the pan-span from tR (tR = floor(left/TILE)): a crop that starts mid-tile
//     no longer has a right-hand tile, so the extract runs off the canvas.
mustThrow(() => {
  const badLayout = (lat, lon, z, w, h) => {
    const cx = lonToGlobalPx(lon, z), cy = latToGlobalPx(lat, z);
    const left = Math.round(cx - w / 2), top = Math.round(cy - h / 2);
    const tL = Math.floor(left / TILE), tR = Math.floor(left / TILE);          // BUG: no +w-1 span
    const tT = Math.floor(top / TILE), tB = Math.floor(top / TILE);
    const canvasW = (tR - tL + 1) * TILE;
    const extractLeft = left - tL * TILE;
    return { extractLeft, canvasW };
  };
  // find a center whose left is NOT tile-aligned, so the missing span actually bites
  const b = badLayout(8.5, 66.73, 16, W, H);
  assert.ok(b.extractLeft + W <= b.canvasW, 'span-dropped layout still fits the crop');
}, 'dropping the crop span from tR overflows the canvas');

// (c) naive modulo for wrapTileX (x % n): a negative tile X no longer wraps east.
mustThrow(() => {
  const badWrap = (x, z) => x % (2 ** z);                                       // BUG: not floored-mod
  assert.equal(badWrap(-1, 4), 15, 'naive % still wraps −1 to the east edge');
}, 'naive % breaks negative tile-X wrap');

console.log(`reef-geo: ${passed} assertions passed`);
