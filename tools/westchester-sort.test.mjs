// Verifier-layer LOCK for the Westchester House Hunter comparison-table SORT logic:
//   tvPinValue(p, col)      — the sort key for each of the 16 pin columns
//   tvVillageValue(v, col)  — the sort key for each of the 7 village columns
//   sortRows(rows, kind)    — the comparator (string -> localeCompare, number -> subtract; asc/desc)
//
// These drive how Johnny ranks/compares houses across the comparison table on his ACTIVE
// house hunt. A silent regression — a column's no-data sentinel flipping (-1 vs 999 vs 'zzz'),
// a type change, a lowerIsBetter inversion, or the comparator losing its string/number dispatch
// (which would feed a string into a numeric subtraction -> NaN -> V8 sort poison) — would
// mis-rank his houses with no signal.
//
// No live bug found (the sort logic is correct) -> this is a LOCK, not a fix. Test-only, ZERO
// source change. The functions are EXTRACTED from the shipped public/westchester/index.html at
// runtime (brace-match + new Function), so the lock can't drift from a hand-copied mirror.
// Same standard as tools/westchester-geo.test.mjs / westchester-monthly.test.mjs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// --- runtime extractor: pull a top-level `function NAME(...) { ... }` by brace matching.
// The three target functions contain NO braces inside string/regex literals, so a plain
// depth counter is exact for them.
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('source function not found: ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const SRC_PIN = extractFn(HTML, 'tvPinValue');
const SRC_VILLAGE = extractFn(HTML, 'tvVillageValue');
const SRC_SORT = extractFn(HTML, 'sortRows');

// Inject the two externals tvPinValue depends on (formatPinAddress for 'address',
// computePinMonthly for 'monthly') + the tvSort config sortRows reads. tvSort is passed by
// reference, so a test mutates tvSortObj.pins.col/.dir before calling sortRows.
function buildSort(tvSortObj) {
  const stubFormatPinAddress = (p) => (p && p.__addr) || '';
  const stubComputePinMonthly = (p) => (p && p.__monthly != null) ? { total: p.__monthly } : null;
  const factory = new Function(
    'formatPinAddress', 'computePinMonthly', 'tvSort',
    `${SRC_PIN}\n${SRC_VILLAGE}\n${SRC_SORT}\nreturn { tvPinValue, tvVillageValue, sortRows };`
  );
  return factory(stubFormatPinAddress, stubComputePinMonthly, tvSortObj);
}

const tvSort = { pins: { col: 'price', dir: 'asc' }, villages: { col: 'name', dir: 'asc' } };
const { tvPinValue, tvVillageValue, sortRows } = buildSort(tvSort);

// ---- tiny assert harness (repo convention) ----
let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; console.error(`FAIL: ${msg}\n  expected ${e}\n  got      ${a}`); }
}
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error(`FAIL: ${msg}`); } }

function pin(o = {}) { return { compass: {}, ...o }; }
function cmp(o) { return { compass: o }; }

// helper: sort just the ids, given a column + dir, over the pins kind
function sortIds(rows, col, dir = 'asc', kind = 'pins') {
  tvSort[kind].col = col; tvSort[kind].dir = dir;
  return sortRows(rows, kind).map(r => r.id);
}

// ============================================================
// INLINE RED PROOF — a numeric-only comparator (no string branch) poisons a string-column sort.
// This is exactly what mutation #2 reintroduces; proving the shipped code AVOIDS it.
// ============================================================
(function redProof() {
  // A naive comparator that always subtracts would turn 'Apt' - 'Zed' into NaN and scramble order.
  const naive = (rows, getVal, col, mult) =>
    [...rows].sort((a, b) => (getVal(a, col) - getVal(b, col)) * mult).map(r => r.id);
  const rows = [
    { id: 'z', __addr: 'Zed St' },
    { id: 'a', __addr: 'Apple Ave' },
    { id: 'm', __addr: 'Maple Dr' },
  ];
  const naiveOut = naive(rows, tvPinValue, 'address', 1);
  // NaN comparisons leave order effectively unsorted (not alphabetical).
  ok(JSON.stringify(naiveOut) !== JSON.stringify(['a', 'm', 'z']),
    'RED proof: a string-blind numeric comparator does NOT sort addresses alphabetically');
  // the shipped sortRows DOES:
  eq(sortIds(rows, 'address', 'asc'), ['a', 'm', 'z'],
    'RED proof: shipped sortRows sorts string addresses alphabetically (string branch present)');
})();

// ============================================================
// tvPinValue — per-column sort keys
// ============================================================

// score: total when present, -1 sentinel (sinks to bottom in asc) otherwise
eq(tvPinValue(pin({ score: { total: 87 } }), 'score'), 87, 'score: returns total');
eq(tvPinValue(pin({ score: { total: 0 } }), 'score'), 0, 'score: zero total preserved (not sentinel)');
eq(tvPinValue(pin({}), 'score'), -1, 'score: missing -> -1 sentinel');
eq(tvPinValue(pin({ score: {} }), 'score'), -1, 'score: non-numeric total -> -1');

// rank
eq(tvPinValue(pin({ rank: 3 }), 'rank'), 3, 'rank: returns rank');
eq(tvPinValue(pin({}), 'rank'), 0, 'rank: missing -> 0');

// address (string, lowercased, via formatPinAddress stub)
eq(tvPinValue(pin({ __addr: '12 MAPLE Dr' }), 'address'), '12 maple dr', 'address: lowercased');
eq(tvPinValue(pin({}), 'address'), '', 'address: empty -> ""');

// price: compass.price, then askingPrice, then 0
eq(tvPinValue(cmp({ price: 1250000 }), 'price'), 1250000, 'price: compass.price');
eq(tvPinValue(pin({ askingPrice: 990000 }), 'price'), 990000, 'price: falls to askingPrice');
eq(tvPinValue(pin({}), 'price'), 0, 'price: missing -> 0');

// beds / baths: value or -1 sentinel; 0 must be preserved (!= null)
eq(tvPinValue(cmp({ beds: 4 }), 'beds'), 4, 'beds: value');
eq(tvPinValue(cmp({ beds: 0 }), 'beds'), 0, 'beds: zero preserved');
eq(tvPinValue(pin({}), 'beds'), -1, 'beds: missing -> -1');
eq(tvPinValue(cmp({ baths: 2.5 }), 'baths'), 2.5, 'baths: value');
eq(tvPinValue(pin({}), 'baths'), -1, 'baths: missing -> -1');

// bb combined key: beds*10 + baths
eq(tvPinValue(cmp({ beds: 4, baths: 2 }), 'bb'), 42, 'bb: 4 beds 2 baths -> 42');
eq(tvPinValue(cmp({ beds: 3 }), 'bb'), 30, 'bb: missing baths -> 0 component');
eq(tvPinValue(pin({}), 'bb'), 0, 'bb: both missing -> 0');
ok(tvPinValue(cmp({ beds: 4, baths: 0 }), 'bb') > tvPinValue(cmp({ beds: 3, baths: 9 }), 'bb'),
  'bb: beds dominate baths (4bd > 3bd regardless of baths)');

// sqft / lot
eq(tvPinValue(cmp({ sqft: 2400 }), 'sqft'), 2400, 'sqft: value');
eq(tvPinValue(pin({}), 'sqft'), -1, 'sqft: missing -> -1');
eq(tvPinValue(cmp({ lotSize: 0.75 }), 'lot'), 0.75, 'lot: lotSize');
eq(tvPinValue(pin({}), 'lot'), -1, 'lot: missing -> -1');

// built
eq(tvPinValue(cmp({ yearBuilt: 1965 }), 'built'), 1965, 'built: yearBuilt');
eq(tvPinValue(pin({}), 'built'), 0, 'built: missing -> 0');

// train (string, lowercase name, else 'zzz' sinks last)
eq(tvPinValue(pin({ train: { name: 'Bedford Hills' } }), 'train'), 'bedford hills', 'train: lowercased name');
eq(tvPinValue(pin({}), 'train'), 'zzz', 'train: missing -> zzz');

// walk / downtown — both use train.walkMin (downtown is an intentional train-station proxy), 999 sentinel
eq(tvPinValue(pin({ train: { walkMin: 8 } }), 'walk'), 8, 'walk: walkMin');
eq(tvPinValue(pin({ train: {} }), 'walk'), 999, 'walk: no walkMin -> 999');
eq(tvPinValue(pin({}), 'walk'), 999, 'walk: no train -> 999');
eq(tvPinValue(pin({ train: { walkMin: 12 } }), 'downtown'), 12, 'downtown: walkMin proxy');
eq(tvPinValue(pin({}), 'downtown'), 999, 'downtown: no train -> 999');
eq(tvPinValue(pin({ train: { walkMin: 0 } }), 'walk'), 0, 'walk: zero walkMin preserved (!= null)');

// gct (Grand Central commute minutes), 999 sentinel
eq(tvPinValue(pin({ train: { gct: 47 } }), 'gct'), 47, 'gct: value');
eq(tvPinValue(pin({ train: {} }), 'gct'), 999, 'gct: missing -> 999');
eq(tvPinValue(pin({}), 'gct'), 999, 'gct: no train -> 999');

// trail: driveDistMi, then miles, then 999
eq(tvPinValue(pin({ trail: { driveDistMi: 3.2 } }), 'trail'), 3.2, 'trail: driveDistMi');
eq(tvPinValue(pin({ trail: { miles: 1.5 } }), 'trail'), 1.5, 'trail: falls to miles');
eq(tvPinValue(pin({}), 'trail'), 999, 'trail: missing -> 999');

// monthly: computePinMonthly().total or 0
eq(tvPinValue(pin({ __monthly: 9100 }), 'monthly'), 9100, 'monthly: total');
eq(tvPinValue(pin({}), 'monthly'), 0, 'monthly: no monthly -> 0');

// school (string, lowercase, else 'zzz')
eq(tvPinValue(pin({ schoolDistrict: 'Chappaqua' }), 'school'), 'chappaqua', 'school: lowercased');
eq(tvPinValue(pin({}), 'school'), 'zzz', 'school: missing -> zzz');

// unknown column -> 0
eq(tvPinValue(pin({}), 'nonsense'), 0, 'unknown column -> 0');

// ============================================================
// tvVillageValue — per-column sort keys
// ============================================================
eq(tvVillageValue({ name: 'Katonah' }, 'name'), 'katonah', 'village name: lowercased');
eq(tvVillageValue({}, 'name'), '', 'village name: missing -> ""');
eq(tvVillageValue({ schoolDistrict: 'Byram' }, 'school'), 'byram', 'village school: lowercased');
eq(tvVillageValue({}, 'school'), 'zzz', 'village school: missing -> zzz');
eq(tvVillageValue({ trails: [{ miles: 0.4 }] }, 'trail'), 0.4, 'village trail: first trail miles');
eq(tvVillageValue({}, 'trail'), 999, 'village trail: missing -> 999');
eq(tvVillageValue({ trailsWithin1Mi: 3 }, 'trailCount'), 3, 'village trailCount: value');
eq(tvVillageValue({ trailsWithin1Mi: 0 }, 'trailCount'), 0, 'village trailCount: zero preserved');
eq(tvVillageValue({}, 'trailCount'), -1, 'village trailCount: missing -> -1');
eq(tvVillageValue({ train: { name: 'Mount Kisco' } }, 'train'), 'mount kisco', 'village train: lowercased');
eq(tvVillageValue({}, 'train'), 'zzz', 'village train: missing -> zzz');
eq(tvVillageValue({ train: { gct: 52 } }, 'gct'), 52, 'village gct: value');
eq(tvVillageValue({}, 'gct'), 999, 'village gct: missing -> 999');
eq(tvVillageValue({ bookstores: [1, 2] }, 'books'), 2, 'village books: count');
eq(tvVillageValue({}, 'books'), -1, 'village books: missing -> -1');
eq(tvVillageValue({}, 'nonsense'), 0, 'village unknown column -> 0');

// ============================================================
// sortRows — comparator dispatch, asc/desc, sentinel placement
// ============================================================

// numeric ascending: cheapest first; a no-price pin (0) leads asc
{
  const rows = [cmpId('a', { price: 2000000 }), cmpId('b', { price: 1200000 }), cmpId('c', { price: 1800000 })];
  eq(sortIds(rows, 'price', 'asc'), ['b', 'c', 'a'], 'sort price asc');
  eq(sortIds(rows, 'price', 'desc'), ['a', 'c', 'b'], 'sort price desc');
}

// no-data numeric sentinel placement: a no-beds pin (-1) sinks to bottom in asc
{
  const rows = [cmpId('hi', { beds: 5 }), cmpId('none', {}), cmpId('lo', { beds: 2 })];
  eq(sortIds(rows, 'beds', 'asc'), ['none', 'lo', 'hi'], 'beds asc: missing(-1) leads, then 2, 5');
  eq(sortIds(rows, 'beds', 'desc'), ['hi', 'lo', 'none'], 'beds desc: 5, 2, missing last');
}

// gct sentinel 999 sinks no-train pins to the bottom in asc (worst commute last)
{
  const rows = [
    { id: 'far', train: { gct: 60 } },
    { id: 'near', train: { gct: 38 } },
    { id: 'none', },
  ];
  eq(sortIds(rows, 'gct', 'asc'), ['near', 'far', 'none'], 'gct asc: best commute first, no-train(999) last');
}

// string column: localeCompare, no NaN poison; mixed-case handled (values are pre-lowercased)
{
  const rows = [{ id: 'z', __addr: 'Zed St' }, { id: 'a', __addr: 'apple Ave' }, { id: 'm', __addr: 'Maple Dr' }];
  eq(sortIds(rows, 'address', 'asc'), ['a', 'm', 'z'], 'address asc alphabetical');
  eq(sortIds(rows, 'address', 'desc'), ['z', 'm', 'a'], 'address desc reverse alphabetical');
}

// train 'zzz' sentinel sorts a no-train row last alphabetically (asc)
{
  const rows = [{ id: 'none' }, { id: 'b', train: { name: 'Bedford' } }, { id: 'a', train: { name: 'Armonk' } }];
  eq(sortIds(rows, 'train', 'asc'), ['a', 'b', 'none'], 'train asc: named first, no-train(zzz) last');
}

// villages kind routes through tvVillageValue
{
  const rows = [{ id: 'v2', name: 'Pound Ridge' }, { id: 'v1', name: 'Armonk' }];
  eq(sortIds(rows, 'name', 'asc', 'villages'), ['v1', 'v2'], 'villages kind sorts via tvVillageValue');
}

// sortRows does not mutate the input array (returns a copy)
{
  const rows = [cmpId('a', { price: 3 }), cmpId('b', { price: 1 })];
  const before = rows.map(r => r.id);
  sortIds(rows, 'price', 'asc');
  eq(rows.map(r => r.id), before, 'sortRows does not mutate input order');
}

function cmpId(id, compass) { return { id, compass }; }

// ============================================================
console.log(`\nwestchester-sort: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
