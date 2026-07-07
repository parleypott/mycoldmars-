// Verifier-layer test for the ASCENT poster's DISPLAY-FORMAT CORE (public/ascent/src/app.js ~175-182).
// Fifth sibling to hike-data-contract (shape), landmark-data-contract (axis ladders),
// hike-scaling-contract (HEIGHT series↔stats) and distance-contract (DISTANCE series↔stats). Those
// four all guard the RIDGE GEOMETRY. This one guards the layer downstream of all of them: the pure
// unit-conversion + number-formatting functions that turn an internal metres value into every printed
// string on the poster — #big-total, #big-unit, the stat bar (#st-2 distance, the Season label), and
// every hover readout. Not one of the four touches them; they were the last unlocked core in ascent.
//
// WHY THIS BITES. app.js stores every quantity in METRES and prints via six tiny pure fns that close
// over the mutable `unit` ("ft" | "m"):
//     const elevDisp = (m) => (unit === "ft" ? m * 3.28084 : m);   // metres → feet
//     const distDisp = (m) => (unit === "ft" ? m / 1609.34 : m / 1000); // metres → miles / km
//     const fmtElev  = (m,u=true) => `${Math.round(elevDisp(m)).toLocaleString()}${u?" "+elevU():""}`;
//     const fmtDist  = (m,u=true) => { const v = distDisp(m);
//                        return `${v >= 100 ? Math.round(v) : v.toFixed(1)}${u?" "+distU():""}`; };
// These are the whole number engine of a poster Johnny built this week for his family — the numbers
// they actually read. A silent regression here mislabels the mountain with zero geometric symptom:
//   • the feet constant 3.28084 fudged (→ 1, or a typo like 3.048) → every foot reading wrong by that
//     ratio; a 1316 m summit prints as 1316 ft, not 4318 ft. No ridge check sees it.
//   • the mile/km constants (1609.34 / 1000) swapped or rounded → distances off by ~1.6x or ~1000x.
//   • the fmtDist branch (≥100 → integer, else one decimal) flipped or its threshold moved → the
//     headline mileage either loses its decimal early or grows a spurious ".0" — the exact rollover-
//     formatter class this loop has hand-fixed ~10× ("1000K", "$1000K", "1000.0M").
//   • the `u` suffix toggle inverted → units glued to bare numbers (#big-total prints "4,318 ft" into
//     a box that already has a separate FT stamp) or stripped where they're needed.
//   • toLocaleString dropped → "4318" instead of "4,318"; a small ugliness on a design-forward poster.
//
// The functions are EXTRACTED VERBATIM from the shipped app.js at runtime (regex-sliced, eval'd in a
// factory that binds `unit`) so the contract cannot drift from a hand-mirrored copy — if the block is
// renamed or moved, the slice fails and this test goes RED, correctly flagging that the contract moved.
// Grouped-number expectations are derived from the runtime's OWN (n).toLocaleString() so the lock is
// locale-robust (it pins "toLocaleString is applied", not a US-specific comma), while separate
// magnitude assertions pin the conversion constants themselves. Mutation-proven: neuter 3.28084 → 1,
// or 1609.34 → 1000, or the ≥100 branch, and the magnitude / branch assertions below go RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

// --- slice the six formatter declarations verbatim from the shipped source ---
const src = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
const block = src.match(/const elevDisp = [\s\S]*?const fmtDist = \(m, u = true\) => \{[\s\S]*?\n  \};/);
assert.ok(block, 'could not slice the elevDisp…fmtDist formatter block from src/app.js — the display-format contract MOVED; update this test to the new location.');

// Bind the block to a chosen `unit` and hand back the formatters. `unit` is a Function param, exactly
// the free variable the shipped closures reference — so this is the real code, not a paraphrase.
const makeFormatters = new Function(
  'unit',
  block[0] + '\n return { elevDisp, elevU, distDisp, distU, fmtElev, fmtDist };'
);
const FT = makeFormatters('ft');
const M = makeFormatters('m');

// -------------------------------------------------------------------------------------------------
// unit labels — the strings stamped next to every number (#big-unit, #st-2 label, hover suffix)
// -------------------------------------------------------------------------------------------------
assert.equal(FT.elevU(), 'ft', 'elevation unit label in feet mode must be "ft"');
assert.equal(M.elevU(), 'm', 'elevation unit label in metre mode must be "m"');
assert.equal(FT.distU(), 'mi', 'distance unit label in feet mode must be "mi"');
assert.equal(M.distU(), 'km', 'distance unit label in metre mode must be "km"');

// -------------------------------------------------------------------------------------------------
// elevation conversion + formatting
// -------------------------------------------------------------------------------------------------
// metre passthrough: no conversion in metric mode, grouped, with unit.
assert.equal(M.fmtElev(1000), (1000).toLocaleString() + ' m');
assert.equal(M.fmtElev(12345, false), (12345).toLocaleString(), 'metre elevation is grouped via toLocaleString and honours u=false');

// feet conversion: 1000 m → 3280.84 ft → rounds to 3281. Pinning the MAGNITUDE (3281, not 1000)
// mutation-proves the 3.28084 constant; deriving the grouped form from toLocaleString keeps it locale-safe.
assert.equal(FT.fmtElev(1000, false), (3281).toLocaleString(), 'metres→feet uses 3.28084 and rounds (magnitude-locked)');
assert.equal(FT.fmtElev(1000), (3281).toLocaleString() + ' ft');
assert.notEqual(FT.fmtElev(1000, false), M.fmtElev(1000, false), 'feet and metre readings of the same value must differ');

// the real headline: the shipped Lake Mary summit is billed at 4318 ft. Its metre value round-trips
// through elevDisp back to 4318 (±1 rounding) — a sanity anchor that the feet path lands on the number
// the poster actually claims, not merely a self-consistent ratio.
const summitFt = 4318;
const summitM = summitFt / 3.28084;
assert.equal(FT.fmtElev(summitM, false), (4318).toLocaleString(), 'a 4318 ft summit must print as 4,318 ft in feet mode');

// -------------------------------------------------------------------------------------------------
// distance conversion + the ≥100 rollover branch (the loop's most-repeated live-bug class)
// -------------------------------------------------------------------------------------------------
// exactly one mile / one km, both under 100 → one decimal place, with unit.
assert.equal(FT.fmtDist(1609.34), '1.0 mi', 'metres→miles uses the 1609.34 constant');
assert.equal(M.fmtDist(1000), '1.0 km', 'metres→km uses the 1000 constant');
assert.equal(FT.fmtDist(1609.34, false), '1.0', 'distance honours u=false (bare number, no unit)');

// under-100 keeps ONE decimal …
assert.equal(M.fmtDist(5000), '5.0 km');
assert.equal(FT.fmtDist(160740), '99.9 mi', 'just under 100 stays on the one-decimal branch');
// … at/above 100 switches to a bare integer (no ".0", no rollover flash).
assert.equal(FT.fmtDist(160934), '100 mi', '≥100 renders as a rounded integer, not "100.0"');
assert.equal(M.fmtDist(200000), '200 km', '≥100 km renders as a rounded integer');

// mutation-proof the ≥100 threshold + the mile constant jointly: 100 mi ≠ its metre reading, and the
// integer branch really drops the decimal a real "100.0 mi" bug would show.
assert.equal(FT.fmtDist(160934).includes('.'), false, 'the ≥100 branch must not carry a decimal point');
assert.notEqual(FT.fmtDist(160934), M.fmtDist(160934), 'the same metres must read differently in mi vs km');

// self-mutation harness: rebuild the formatters with the feet constant neutered to 1 and prove the
// magnitude lock above would catch it (documents WHY the 3.28084 assertion is load-bearing).
const neutered = new Function(
  'unit',
  block[0].replace('m * 3.28084', 'm * 1') + '\n return { fmtElev };'
)('ft');
assert.notEqual(neutered.fmtElev(1000, false), (3281).toLocaleString(), 'sanity: neutering 3.28084 changes the output the lock pins');

console.log('ascent display-format contract: OK');
