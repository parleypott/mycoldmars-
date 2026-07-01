// Verifier-layer test for the Lauterbrunnen page's SHIPPED TRIP DATA (sibling to the three
// tests that lock the map's render/bounds FUNCTIONS — leg-features, journey-bounds, leg-info).
// Those guard the code against corrupt runtime data via window.__loadJourneys; this guards the
// hand-authored `JOURNEYS` array itself, which none of them touch.
//
// WHY: JOURNEYS is 6 journeys / ~930 coordinate points Johnny typed/pasted by hand for a real
// family trip, and the page was edited 31× in 3 days. A single fat-fingered future edit — a
// dropped digit, a swapped lng/lat pair, a leg pasted with one point, or a journey pointing at
// an entryId that doesn't exist in ENTRIES — is INVISIBLE in review but ships a garbage line
// drawn across Europe, a Mapbox "invalid LineString" throw, or a panel row whose name silently
// falls back. The render functions can't catch a coordinate that's *valid-shaped but wrong-place*.
//
// This is a data-contract regression gate (same category as the quiz-bank / bounce data locks):
// a pure validateJourneys() checks the invariants, run against BOTH the LIVE shipped data (must
// be clean) AND crafted bad fixtures (must each be caught). Mutation-proven: the bad-fixture
// assertions go RED the instant any invariant check is neutered.
//
// It parses JOURNEYS + the ENTRIES `n` set straight out of index.html so the contract tracks the
// real page and can't drift from a hand-mirrored copy.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// --- pull the shipped JOURNEYS array (it's a JSON literal: `let JOURNEYS = [ ... ];`) ---
const jm = html.match(/let JOURNEYS = (\[[\s\S]*?\]);/);
assert.ok(jm, 'could not find JOURNEYS in index.html');
const JOURNEYS = JSON.parse(jm[1]);

// --- pull the ENTRIES numbers (`n: 1, name: "..."`) — the set of valid menu entries ---
const entryNums = new Set([...html.matchAll(/\bn:\s*(\d+),\s*name:/g)].map(m => Number(m[1])));
assert.ok(entryNums.size >= 5, `expected several ENTRIES, found ${entryNums.size}`);

// Lauterbrunnen valley bounding box, generous but tight enough that a swapped lng/lat
// (~46,7) or a dropped/added digit lands outside it. The whole Jungfrau region sits inside.
const LNG = [7.80, 8.10];
const LAT = [46.50, 46.70];

const inBox = ([lng, lat]) =>
  typeof lng === 'number' && typeof lat === 'number' &&
  lng >= LNG[0] && lng <= LNG[1] && lat >= LAT[0] && lat <= LAT[1];

// The invariant checker. Returns a list of human-readable problems ([] === valid).
function validateJourneys(journeys, validEntryNums) {
  const problems = [];
  const seen = new Set();
  for (const j of journeys) {
    const id = j.entryId;
    if (typeof id !== 'number') { problems.push(`journey entryId not numeric: ${JSON.stringify(id)}`); continue; }
    if (seen.has(id)) problems.push(`duplicate journey for entryId ${id}`);
    seen.add(id);
    if (!validEntryNums.has(id)) problems.push(`journey ${id} has no matching ENTRIES entry`);
    for (const lg of (j.legs || [])) {
      if (!Array.isArray(lg.line) || lg.line.length < 2) {
        problems.push(`journey ${id} leg "${lg.label}" line is not a >=2-point array`);
        continue;
      }
      for (const pt of lg.line) {
        if (!Array.isArray(pt) || pt.length < 2 || !inBox(pt)) {
          problems.push(`journey ${id} leg "${lg.label}" coord out of valley: ${JSON.stringify(pt)}`);
        }
      }
    }
    for (const s of (j.stops || [])) {
      if (!Array.isArray(s.coord) || !inBox(s.coord)) {
        problems.push(`journey ${id} stop "${s.name}" coord out of valley: ${JSON.stringify(s.coord)}`);
      }
    }
  }
  return problems;
}

// ============ THE LIVE CONTRACT: shipped data must be clean ============
const live = validateJourneys(JOURNEYS, entryNums);
assert.deepEqual(live, [], `shipped JOURNEYS violate the trip-data contract:\n  ${live.join('\n  ')}`);

// sanity: we actually loaded real data, not an empty array that passes vacuously
assert.ok(JOURNEYS.length >= 5, `expected several journeys, got ${JOURNEYS.length}`);
const totalPts = JOURNEYS.reduce((a, j) => a + (j.legs || []).reduce((b, l) => b + (l.line || []).length, 0), 0);
assert.ok(totalPts > 500, `expected the full hand-built geodata, got only ${totalPts} points`);

// ============ MUTATION PROOF: each invariant must actually bite ============
const okLeg = { mode: 'hike', label: 'ok', line: [[7.92, 46.60], [7.94, 46.61]] };
const okStop = { name: 'Wengen', coord: [7.922, 46.6055], kind: 'station' };
const good = [{ entryId: 1, legs: [okLeg], stops: [okStop] }];
assert.deepEqual(validateJourneys(good, new Set([1])), [], 'a well-formed journey is accepted');

// swapped lng/lat (46.60, 7.92) -> lands at lng 46 which is outside the valley
const swapped = [{ entryId: 1, legs: [{ mode: 'hike', label: 'swap', line: [[46.60, 7.92], [7.94, 46.61]] }], stops: [] }];
assert.ok(validateJourneys(swapped, new Set([1])).some(p => /out of valley/.test(p)),
  'a swapped lng/lat coordinate is caught');

// dropped digit: 7.92 -> 7.2 (still a plausible-looking number, but outside the box)
const dropped = [{ entryId: 1, legs: [{ mode: 'hike', label: 'drop', line: [[7.2, 46.61], [7.94, 46.61]] }], stops: [] }];
assert.ok(validateJourneys(dropped, new Set([1])).some(p => /out of valley/.test(p)),
  'a dropped-digit (out-of-region) coordinate is caught');

// a leg pasted with a single point -> degenerate LineString
const oneP = [{ entryId: 1, legs: [{ mode: 'hike', label: '1pt', line: [[7.92, 46.60]] }], stops: [] }];
assert.ok(validateJourneys(oneP, new Set([1])).some(p => />=2-point/.test(p)),
  'a single-point leg line is caught');

// journey pointing at an entry that does not exist in ENTRIES
const orphan = [{ entryId: 99, legs: [okLeg], stops: [] }];
assert.ok(validateJourneys(orphan, new Set([1])).some(p => /no matching ENTRIES/.test(p)),
  'a journey with an orphan entryId is caught');

// two journeys claiming the same entry
const dup = [{ entryId: 1, legs: [okLeg], stops: [] }, { entryId: 1, legs: [okLeg], stops: [] }];
assert.ok(validateJourneys(dup, new Set([1])).some(p => /duplicate journey/.test(p)),
  'a duplicate entryId is caught');

// an out-of-valley STOP coordinate (marker, not a line) is also caught
const badStop = [{ entryId: 1, legs: [okLeg], stops: [{ name: 'Nowhere', coord: [9.9, 46.6] }] }];
assert.ok(validateJourneys(badStop, new Set([1])).some(p => /stop "Nowhere".*out of valley/.test(p)),
  'an out-of-valley stop coordinate is caught');

console.log(`ok — Lauterbrunnen trip-data contract: ${JOURNEYS.length} journeys, ${totalPts} coords, all in-valley, all entryIds resolve`);
