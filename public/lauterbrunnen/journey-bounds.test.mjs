// Verifier-layer test for the Lauterbrunnen map's bounds builders.
//
// CONTRACT: journeyCoords(journeys, id) returns the flat [lng,lat] coord list across the
// legs of the matching journey(s) — id==null means ALL journeys, an entryId scopes to one.
// It must be EMPTY-SAFE: a missing id, a journey with no legs, or a leg with no line must
// yield [] (not throw, not undefined). entryBounds()/fitAll() then guard on `.length` so the
// map never feeds an empty coord set into `new mapboxgl.LngLatBounds(undefined,undefined)` +
// fitBounds (which NaN-centers / throws and bricks the whole map view).
//
// THE BUG CLASS this guards: the loop's signature "empty/corrupt data bricks the tool". The
// live page exposes window.__loadJourneys to swap in researched geodata mid-edit; a legless
// or empty journey passing through fitAll (which runs unconditionally inside style.load) would
// kill the map. journeyCoords + the length guards make that path inert.
//
// It EXTRACTS the real shipped journeyCoords from index.html at runtime (regex + new Function)
// so it can't drift from a hand-mirrored copy, and asserts the two callers still length-guard.
// Mutation-proven: drop the `(l.line||[])` guard and the no-line case throws; drop the
// `(j.legs||[])` guard and the no-legs case throws; remove a caller's length guard and the
// source assertion goes RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// Pull the whole journeyCoords function body out of the inline script.
const m = html.match(/function journeyCoords\(journeys, id\)\{[\s\S]*?\n\}/);
assert.ok(m, 'could not find journeyCoords() in index.html');
const journeyCoords = new Function(`${m[0]}\nreturn journeyCoords;`)();

const sample = [
  { entryId: 1, legs: [{ line: [[1, 1], [2, 2]] }, { line: [[3, 3]] }] },
  { entryId: 2, legs: [{ line: [[4, 4]] }] },
];

// --- scoped to one entry: flattens that journey's legs->lines in order ---
const one = journeyCoords(sample, 1);
assert.deepEqual(one, [[1, 1], [2, 2], [3, 3]], 'id=1 flattens both legs in order');

// --- id==null: all coords across all journeys ---
const all = journeyCoords(sample, null);
assert.equal(all.length, 4, 'id=null returns coords from every journey');
assert.deepEqual(all, [[1, 1], [2, 2], [3, 3], [4, 4]], 'id=null preserves journey+leg order');

// --- missing id -> [] (not undefined, not throw) ---
assert.deepEqual(journeyCoords(sample, 99), [], 'missing entryId yields an empty list');

// --- empty-safe: legless journey, no-line leg, empty whole set ---
assert.deepEqual(journeyCoords([{ entryId: 7, legs: [] }], 7), [], 'a journey with no legs -> []');
assert.deepEqual(journeyCoords([{ entryId: 7 }], 7), [], 'a journey missing .legs entirely -> []');
assert.deepEqual(journeyCoords([{ entryId: 7, legs: [{ mode: 'hike' }] }], 7), [],
  'a leg missing .line -> [] (the (l.line||[]) guard)');
assert.deepEqual(journeyCoords([], null), [], 'no journeys at all -> []');

// --- callers must length-guard before building LngLatBounds (the actual crash guard) ---
assert.match(html, /function entryBounds\(id\)\{[\s\S]*?if\(!all\.length\) return null;/,
  'entryBounds must bail to null on empty coords');
assert.match(html, /function fitAll\(\)\{[\s\S]*?if\(!all\.length\) return;/,
  'fitAll must bail before fitBounds on empty coords');

// --- regression: current live data still yields a non-empty set for every entry (no over-guard) ---
const live = html.match(/let JOURNEYS = (\[[\s\S]*?\]);\n/);
assert.ok(live, 'could not find the live JOURNEYS array');
const JOURNEYS = JSON.parse(live[1]);
assert.ok(JOURNEYS.length >= 5, 'expected the 5 curated journeys');
for (const j of JOURNEYS) {
  assert.ok(journeyCoords(JOURNEYS, j.entryId).length > 0,
    `entry ${j.entryId} must still produce coords (guard must not over-trigger on real data)`);
}
assert.ok(journeyCoords(JOURNEYS, null).length > 0, 'fitAll coord set is non-empty for live data');

console.log('journey-bounds.test.mjs: 13 passed, 0 failed');
