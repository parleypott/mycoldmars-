// Tests for the feathered-crop tile math (feather-mask.js) — the pure core
// behind MapKeys' Photoshop-style edge feathering on old-map overlays.
// Run: bun mapkeys/src/feather-mask.test.mjs

import {
  lngToMercX, latToMercY, tileMercBounds, rectToMerc, insetRect,
  featherPlan, featherTilesUrl, parseFeatherUrl,
} from './feather-mask.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);
const near = (got, want, eps, label) => ok(Math.abs(got - want) <= eps, `${label} (got ${got} want ~${want})`);

// ── mercator projection anchors ──
near(lngToMercX(-180), 0, 1e-9, 'mercX: -180 → 0');
near(lngToMercX(0), 0.5, 1e-9, 'mercX: 0 → 0.5');
near(lngToMercX(180), 1, 1e-9, 'mercX: 180 → 1');
near(latToMercY(0), 0.5, 1e-9, 'mercY: equator → 0.5');
ok(latToMercY(60) < 0.5, 'mercY: north → smaller y (y is down)');
ok(latToMercY(-60) > 0.5, 'mercY: south → larger y');
near(latToMercY(89.9), latToMercY(85.051129), 1e-9, 'mercY: clamps beyond web-mercator limit');

// ── tile bounds ──
{
  const t = tileMercBounds(0, 0, 0);
  ok(t.x0 === 0 && t.y0 === 0 && t.x1 === 1 && t.y1 === 1, 'tile 0/0/0 spans the whole world');
  const t2 = tileMercBounds(2, 3, 1);
  near(t2.x0, 0.75, 1e-9, 'tile z2 x3 starts at 0.75');
  near(t2.y1 - t2.y0, 0.25, 1e-9, 'tile z2 spans a quarter');
}

// ── insetRect ──
{
  const r = insetRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0.1);
  near(r.x0, 0.1, 1e-9, 'inset shrinks west edge');
  near(r.x1, 0.9, 1e-9, 'inset shrinks east edge');
  const rneg = insetRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, -5);
  near(rneg.x0, 0, 1e-9, 'negative crop clamps to 0');
  const rover = insetRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0.9);
  ok(rover.x1 > rover.x0, 'crop clamps below rect collapse');
}

// ── featherPlan coverage classification ──
const WORLD = [[-180, -85], [180, 85]];
const EU = [[0, 40], [40, 60]]; // a Europe-ish rect
{
  // Tile far away from the rect (western hemisphere) → outside.
  const p = featherPlan({ z: 2, x: 0, y: 1 }, EU, 0, 0.1, 256);
  eq(p.coverage, 'outside', 'far-away tile classified outside');
}
{
  // Deep-inside tile with a world-sized rect → inside (original bytes).
  const p = featherPlan({ z: 4, x: 8, y: 8 }, WORLD, 0, 0.05, 256);
  eq(p.coverage, 'inside', 'deep-inside tile classified inside');
}
{
  // A tile straddling the rect's west edge → partial with 4 ramps.
  const rect = rectToMerc(EU);
  const z = 4, s = 1 / 16;
  const x = Math.floor(rect.x0 / s); // tile containing the west edge
  const y = Math.floor(((rect.y0 + rect.y1) / 2) / s);
  const p = featherPlan({ z, x, y }, EU, 0, 0.1, 256);
  eq(p.coverage, 'partial', 'edge-straddling tile classified partial');
  eq(p.ramps.length, 4, 'partial plan carries 4 edge ramps');
  const west = p.ramps[0];
  ok(west.toPx > west.fromPx, 'west ramp runs left→right (alpha 0→1 inward)');
  ok(west.fromPx >= -256 && west.fromPx <= 512, 'west ramp lands near this tile');
  const east = p.ramps[1];
  ok(east.toPx < east.fromPx, 'east ramp runs right→left (alpha 0→1 inward)');
}
{
  // Zero feather → hard crop: ramps still valid (from ≠ to).
  const p = featherPlan({ z: 2, x: 2, y: 1 }, EU, 0, 0, 256);
  if (p.coverage === 'partial') {
    ok(p.ramps.every((r) => r.fromPx !== r.toPx), 'zero feather keeps gradients non-degenerate');
  } else {
    ok(true, 'zero feather: tile not partial at this zoom (fine)');
  }
}
{
  // Crop inset moves the visible window inward: a tile inside the original
  // rect but outside the 40%-cropped rect must become 'outside'.
  const rect = rectToMerc(EU);
  const z = 6, s = 1 / 64;
  const x = Math.floor((rect.x0 + 0.02 * (rect.x1 - rect.x0)) / s);
  const y = Math.floor(((rect.y0 + rect.y1) / 2) / s);
  const before = featherPlan({ z, x, y }, EU, 0, 0, 256);
  const after = featherPlan({ z, x, y }, EU, 0.4, 0, 256);
  ok(before.coverage !== 'outside', 'near-west-edge tile visible with no crop');
  eq(after.coverage, 'outside', '40% crop pushes the near-edge tile out of view');
}

// ── URL round-trip ──
{
  const tmpl = 'https://wmts.oldmapsonline.org/maps/abc/2026-04-16T16:20:07.228370Z/{z}/{x}/{y}.png?key=K123';
  const url = featherTilesUrl(tmpl, EU, 0.05, 0.15);
  ok(url.startsWith('mkfeather://tile/{z}/{x}/{y}?'), 'template keeps literal z/x/y for Mapbox');
  const concrete = url.replace('{z}', '5').replace('{x}', '17').replace('{y}', '11');
  const parsed = parseFeatherUrl(concrete);
  ok(!!parsed, 'concrete tile URL parses');
  eq(parsed.z, 5, 'z parsed');
  eq(parsed.tileUrl, tmpl.replace('{z}', '5').replace('{x}', '17').replace('{y}', '11'), 'inner tile URL substituted');
  near(parsed.rectLngLat[0][0], 0, 1e-5, 'rect west survives round-trip');
  near(parsed.rectLngLat[1][1], 60, 1e-5, 'rect north survives round-trip');
  near(parsed.cropFrac, 0.05, 1e-9, 'crop survives round-trip');
  near(parsed.featherFrac, 0.15, 1e-9, 'feather survives round-trip');
}
eq(parseFeatherUrl('https://normal.example/5/1/1.png'), null, 'non-mkfeather URL → null');
eq(parseFeatherUrl('mkfeather://tile/5/1/1?src=&rect=1,2,3'), null, 'malformed params → null');

console.log(`feather-mask: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
