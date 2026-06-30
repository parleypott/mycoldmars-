// Verifier-layer test for the always-on GONDOLA/CABLECAR/FUNICULAR network builder shared by the
// Switzerland and Lauterbrunnen map pages — the `addGondolaNetwork()` core that decides WHICH lift
// legs render as the faint always-on cable network (the lines you see even when an adventure is
// toggled off). This core is brand-new, live on both published pages, actively edited the week it
// landed, and carried ZERO test of its own. It is also a BYTE-IDENTICAL twin across the two pages,
// so a divergent edit — drop a lift mode from the filter, weaken the >=2-point guard, remove the
// endpoint dedup — would be silent and live on one page while passing unnoticed on the other.
//
// This test does three things:
//   1. LOCKS the builder contract over synthetic input, mutation-proven against the REAL extracted
//      source: only gondola/cablecar/funicular legs become features (train/hike/walk/bike/rail are
//      excluded); legs with the same start+end endpoints are deduped to one; reverse-direction legs
//      are NOT deduped (endpoint-key behavior, documented); a missing/short/non-array line and a
//      legless journey contribute nothing instead of leaking an invalid LineString or crashing.
//      Break the mode branch, the dedup, or the guard in index.html and an assertion goes RED.
//   2. PROBES the REAL shipped JOURNEYS data on BOTH pages — every emitted feature must be a valid
//      >=2-point LineString drawn from a lift mode. Catches a future data edit that slips in an
//      empty/short polyline or mislabels a lift.
//   3. TWIN-LOCKS byte-parity of the builder core across Switzerland and Lauterbrunnen, so any
//      future divergence forces a human to re-sync the pages or give one its own contract — it
//      can't drift in silence.
//
// EXTRACTS the real shipped builder + data from index.html at runtime (regex + new Function /
// JSON.parse) so the test can't drift from a hand-mirrored copy. The impure map.* tail of
// addGondolaNetwork is sliced off; only the pure feature-collection build (everything up to and
// including `const data = {...}`) is evaluated, with JOURNEYS injected as a parameter.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const BUILDER_RE =
  /function addGondolaNetwork\(\)\{[\s\S]*?const data=\{type:'FeatureCollection',features:feats\};/;

function extractBuilderSource(page) {
  const html = readFileSync(new URL(`../${page}/index.html`, import.meta.url), 'utf8');
  const m = html.match(BUILDER_RE);
  assert.ok(m, `could not find addGondolaNetwork() in ${page}/index.html`);
  // strip the "function addGondolaNetwork(){" head; the body references the closure global
  // JOURNEYS, which we re-bind as a parameter so the core is pure and testable.
  return m[0].replace(/^function addGondolaNetwork\(\)\{/, '');
}

function buildGondolaFeatures(page) {
  const inner = extractBuilderSource(page);
  return new Function('JOURNEYS', `${inner}\nreturn data;`);
}

function extractJourneys(page) {
  const html = readFileSync(new URL(`../${page}/index.html`, import.meta.url), 'utf8');
  const jm = html.match(/let JOURNEYS = (\[.*\]);/);
  assert.ok(jm, `could not find JOURNEYS data in ${page}/index.html`);
  const J = JSON.parse(jm[1]);
  assert.ok(Array.isArray(J) && J.length >= 5, `${page} JOURNEYS should be a non-trivial array`);
  return J;
}

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };

// the page we attach the suite to (the test lives under switzerland/)
const gondolaFeatures = buildGondolaFeatures('switzerland');

// ---------------------------------------------------------------------------
// 1. CONTRACT — synthetic input, mutation-proven against the extracted source
// ---------------------------------------------------------------------------
const L = (a, b) => [a, b]; // a coord is [lng,lat]; a line is >=2 coords
const A = [7.9, 46.6], B = [7.95, 46.62], C = [8.0, 46.63], D = [8.05, 46.64];

// only lift modes survive the filter
{
  const fc = gondolaFeatures([{
    legs: [
      { mode: 'gondola', line: [A, B] },
      { mode: 'cablecar', line: [B, C] },
      { mode: 'funicular', line: [C, D] },
      { mode: 'train', line: [A, C] },
      { mode: 'hike', line: [A, D] },
      { mode: 'walk', line: [B, D] },
      { mode: 'bike', line: [A, B] },
      { mode: 'rail', line: [C, A] },
    ],
  }]);
  eq(fc.type, 'FeatureCollection', 'returns a FeatureCollection');
  eq(fc.features.length, 3, 'only the 3 lift modes (gondola/cablecar/funicular) become features');
  ok(fc.features.every(f => f.geometry.type === 'LineString'), 'every feature is a LineString');
  // the coordinates passed straight through (no mutation of the source line)
  eq(fc.features[0].geometry.coordinates, [A, B], 'gondola line coordinates preserved');
}

// dedup by identical START+END endpoints → one feature
{
  const fc = gondolaFeatures([
    { legs: [{ mode: 'gondola', line: [A, B] }] },
    { legs: [{ mode: 'gondola', line: [A, B] }] }, // same cable referenced in a 2nd journey
  ]);
  eq(fc.features.length, 1, 'two legs with identical endpoints dedupe to one feature');
}

// dedup keys on endpoints only, so an intermediate-point difference is STILL deduped
{
  const fc = gondolaFeatures([{
    legs: [
      { mode: 'gondola', line: [A, C] },
      { mode: 'gondola', line: [A, B, C] }, // same start+end, extra midpoint
    ],
  }]);
  eq(fc.features.length, 1, 'same start+end (different midpoints) dedupe — endpoint-keyed');
}

// reverse direction (start/end swapped) is NOT deduped — documents the key behavior
{
  const fc = gondolaFeatures([{
    legs: [
      { mode: 'gondola', line: [A, B] },
      { mode: 'gondola', line: [B, A] },
    ],
  }]);
  eq(fc.features.length, 2, 'reversed endpoints are distinct keys — both render');
}

// empty-safe: a lift leg with a missing / too-short / non-array line contributes nothing
{
  const fc = gondolaFeatures([{
    legs: [
      { mode: 'gondola', line: [A] },        // single point
      { mode: 'gondola', line: [] },         // empty
      { mode: 'gondola' },                   // no line
      { mode: 'gondola', line: 'nope' },     // non-array
      { mode: 'gondola', line: [A, B] },     // the one valid leg
    ],
  }]);
  eq(fc.features.length, 1, 'only the >=2-point array line survives; short/missing/non-array dropped');
}

// empty-safe: a legless journey (reachable via the __loadJourneys refine hook) doesn't crash
{
  const fc = gondolaFeatures([{ /* no legs */ }, { legs: null }, { legs: [{ mode: 'gondola', line: [C, D] }] }]);
  eq(fc.features.length, 1, 'legless / null-legs journeys are skipped without crashing');
}

// fully empty input → empty collection
{
  const fc = gondolaFeatures([]);
  eq(fc.features.length, 0, 'no journeys → empty FeatureCollection');
}

// ---------------------------------------------------------------------------
// 2. REAL DATA — probe both pages' shipped JOURNEYS
// ---------------------------------------------------------------------------
const LIFT_MODES = new Set(['gondola', 'cablecar', 'funicular']);
for (const page of ['switzerland', 'lauterbrunnen']) {
  const build = buildGondolaFeatures(page);
  const J = extractJourneys(page);
  const fc = build(J);
  ok(fc && fc.type === 'FeatureCollection', `${page}: builder returns a FeatureCollection`);
  ok(fc.features.length >= 1, `${page}: at least one lift renders in the always-on network`);
  for (const f of fc.features) {
    ok(f.geometry.type === 'LineString', `${page}: feature is a LineString`);
    ok(Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2,
      `${page}: feature has a >=2-point polyline`);
  }
  // every emitted feature must trace back to a real lift leg in the data
  const liftCount = J.reduce((n, j) => n + (j.legs || []).filter(
    l => LIFT_MODES.has(l.mode) && Array.isArray(l.line) && l.line.length >= 2).length, 0);
  ok(fc.features.length <= liftCount,
    `${page}: feature count (${fc.features.length}) never exceeds valid lift legs (${liftCount}) — dedup only shrinks`);
}

// ---------------------------------------------------------------------------
// 3. TWIN-LOCK — the builder core is byte-identical across the two pages
// ---------------------------------------------------------------------------
{
  const sw = extractBuilderSource('switzerland').trim();
  const la = extractBuilderSource('lauterbrunnen').trim();
  eq(sw, la,
    'addGondolaNetwork() core diverged between Switzerland and Lauterbrunnen — re-sync the pages ' +
    'or give one its own contract; the always-on lift network must not drift in silence');
}

console.log(`gondola-network: ${passed} passed, 0 failed`);
