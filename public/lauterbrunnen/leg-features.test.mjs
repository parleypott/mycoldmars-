// Verifier-layer test for the Lauterbrunnen map's RENDER path (sibling to journey-bounds.test.mjs,
// which locks the BOUNDS path). Same bug class: "empty/corrupt data bricks the tool."
//
// CONTRACT: legFeatures(j) turns a journey's legs into a GeoJSON FeatureCollection of LineStrings
// fed to mapboxgl addSource inside the style.load handler. It must be EMPTY-SAFE:
//   - a journey missing .legs entirely must NOT throw (j.legs.map would) — it returns 0 features,
//   - a leg whose .line is missing / not a >=2-point array must contribute NO feature, never a
//     LineString with coordinates:undefined (invalid geometry Mapbox rejects).
// If either slips through, addJourney throws inside style.load and the whole map view bricks
// (no layers, no markers, the loading overlay never clears). The render path is reachable with
// mid-edit geodata via the documented window.__loadJourneys refine hook.
//
// Also asserts addJourney still guards (j.legs||[]) for its mode set and (j.stops||[]) for markers.
//
// EXTRACTS the real shipped legFeatures from index.html at runtime (regex + new Function) so it
// can't drift from a hand-mirrored copy. Mutation-proven: drop the (j.legs||[]) guard and the
// no-legs case throws; drop the Array.isArray/length filter and the no-line case emits an
// undefined-coords feature; either turns this RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// Pull the whole legFeatures function body out of the inline script.
const m = html.match(/function legFeatures\(j\)\{[\s\S]*?\n\}/);
assert.ok(m, 'could not find legFeatures() in index.html');
const legFeatures = new Function(`${m[0]}\nreturn legFeatures;`)();

// --- normal: each leg with a >=2-point line becomes one LineString feature, in order ---
const fc = legFeatures({ legs: [
  { mode: 'hike', line: [[1, 1], [2, 2]] },
  { mode: 'train', line: [[3, 3], [4, 4], [5, 5]] },
] });
assert.equal(fc.type, 'FeatureCollection', 'returns a FeatureCollection');
assert.equal(fc.features.length, 2, 'one feature per valid leg');
assert.deepEqual(fc.features.map(f => f.properties.mode), ['hike', 'train'], 'mode carried per feature');
assert.deepEqual(fc.features[0].geometry, { type: 'LineString', coordinates: [[1, 1], [2, 2]] },
  'first leg geometry preserved');

// --- empty-safe: a journey missing .legs must NOT throw (the j.legs.map trap) ---
assert.deepEqual(legFeatures({}).features, [], 'journey missing .legs -> 0 features, no throw');
assert.deepEqual(legFeatures({ legs: [] }).features, [], 'journey with empty legs -> 0 features');

// --- empty-safe: a leg with no usable line contributes NO feature (no coordinates:undefined) ---
assert.deepEqual(legFeatures({ legs: [{ mode: 'hike' }] }).features, [],
  'leg missing .line -> dropped (never an undefined-coords LineString)');
assert.deepEqual(legFeatures({ legs: [{ mode: 'hike', line: [] }] }).features, [],
  'leg with empty line -> dropped');
assert.deepEqual(legFeatures({ legs: [{ mode: 'hike', line: [[1, 1]] }] }).features, [],
  'leg with a single point (degenerate LineString) -> dropped');

// every emitted feature must carry a valid >=2-point coordinate array
const mixed = legFeatures({ legs: [
  { mode: 'hike', line: [[1, 1], [2, 2]] },
  { mode: 'bike' },                         // dropped
  { mode: 'train', line: [[9, 9], [8, 8]] },
] });
assert.equal(mixed.features.length, 2, 'valid legs survive, the no-line leg is skipped');
for (const f of mixed.features) {
  assert.ok(Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2,
    'no emitted feature carries an undefined/short coordinate set');
}

// --- addJourney must guard the mode set and the stop loop too ---
assert.match(html, /const modes=\[\.\.\.new Set\(\(j\.legs\|\|\[\]\)\.map\(l=>l\.mode\)\)\];/,
  'addJourney must build modes from (j.legs||[]) so a legless journey does not throw');
assert.match(html, /\(j\.stops\|\|\[\]\)\.forEach\(s=>\{/,
  'addJourney must iterate (j.stops||[]) so a journey missing .stops does not throw');

// --- regression: every leg of the live curated data still yields a feature (no over-drop) ---
const live = html.match(/let JOURNEYS = (\[[\s\S]*?\]);\n/);
assert.ok(live, 'could not find the live JOURNEYS array');
const JOURNEYS = JSON.parse(live[1]);
assert.ok(JOURNEYS.length >= 5, 'expected the 5 curated journeys');
for (const j of JOURNEYS) {
  const feats = legFeatures(j).features;
  assert.equal(feats.length, j.legs.length,
    `entry ${j.entryId}: every real leg must still render (filter must not over-trigger)`);
}

console.log('leg-features.test.mjs: 12 passed, 0 failed');
