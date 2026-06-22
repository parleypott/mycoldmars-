// Lock for filterAndSortCorpus — the Hunter corpus browse filter + sort.
// Imports the REAL shipped function. Mutation-proven: every assertion fails if
// the corresponding stage regresses. This is the exact band logic that was
// broken before the keepability scale fix (empty high/mid tabs on real 0–1
// data), so the end-to-end lock pins that class shut.
import { filterAndSortCorpus } from './corpus-filter.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// --- fixture helper: a unit with an id, tier, analysis + keepability_score (raw 0–1) ---
function unit(id, { tier = 'raw', keep = null, text = 'analysis text', noAnalysis = false } = {}) {
  if (noAnalysis) return { id, media_assets: { tier }, analyses: [] };
  return {
    id,
    media_assets: { tier },
    analyses: [{ output_text: text, output_json: keep == null ? {} : { keepability_score: keep } }],
  };
}
const ids = (rows) => rows.map(r => r.id);

// ============ STAGE 1: analyzed-only ============
{
  const units = [
    unit('a'),
    unit('b', { noAnalysis: true }),           // no analyses → dropped
    { id: 'c', media_assets: { tier: 'raw' }, analyses: [{ output_json: {} }] }, // analysis but no output_text → dropped
    unit('d'),
  ];
  eq(ids(filterAndSortCorpus(units, {})), ['a', 'd'], 'stage1: drops units without analysis output_text');
}

// ============ STAGE 2: tier filter ============
{
  const units = [
    unit('raw1', { tier: 'raw' }),
    unit('scr1', { tier: 'script' }),
    unit('raw2', { tier: 'raw' }),
    unit('fin1', { tier: 'finished' }),
  ];
  eq(ids(filterAndSortCorpus(units, { tier: 'raw' })), ['raw1', 'raw2'], 'stage2: tier=raw keeps only raw');
  eq(ids(filterAndSortCorpus(units, { tier: 'finished' })), ['fin1'], 'stage2: tier=finished keeps only finished');
  eq(ids(filterAndSortCorpus(units, { tier: '' })), ['raw1', 'scr1', 'raw2', 'fin1'], 'stage2: empty tier keeps all');
  eq(ids(filterAndSortCorpus(units, { tier: 'nonexistent' })), [], 'stage2: unknown tier → none');
  // a unit with no media_assets.tier reads as '' → only matched by empty tier
  const u2 = [{ id: 'x', media_assets: {}, analyses: [{ output_text: 't', output_json: {} }] }];
  eq(ids(filterAndSortCorpus(u2, { tier: 'raw' })), [], 'stage2: missing tier never matches a real tier');
}

// ============ STAGE 3: keepability band (the broken-before-the-fix logic) ============
// Scores are raw 0–1; normalizeKeepability bridges to 0–10. high>=7, mid 4–6, low<=3.
{
  const units = [
    unit('s00', { keep: 0.0 }),   // → 0   low
    unit('s03', { keep: 0.3 }),   // → 3   low (boundary)
    unit('s04', { keep: 0.4 }),   // → 4   mid (boundary)
    unit('s06', { keep: 0.6 }),   // → 6   mid (boundary)
    unit('s07', { keep: 0.7 }),   // → 7   high (boundary)
    unit('s10', { keep: 1.0 }),   // → 10  high
    unit('snull', { keep: null }),// → null excluded from every band
  ];
  // THE HEADLINE: on real 0–1 data the high tab must NOT be empty (the bug).
  eq(ids(filterAndSortCorpus(units, { keep: 'high' })), ['s07', 's10'], 'stage3: high band = scores >=7 (0.7,1.0)');
  eq(ids(filterAndSortCorpus(units, { keep: 'mid' })), ['s04', 's06'], 'stage3: mid band = 4..6 (0.4,0.6)');
  eq(ids(filterAndSortCorpus(units, { keep: 'low' })), ['s00', 's03'], 'stage3: low band = <=3 (0.0,0.3)');
  ok(!ids(filterAndSortCorpus(units, { keep: 'high' })).includes('snull'), 'stage3: null score excluded from high');
  ok(!ids(filterAndSortCorpus(units, { keep: 'low' })).includes('snull'), 'stage3: null score excluded from low');
  // boundary exclusivity: 0.3→3 is low not mid; 0.7→7 is high not mid
  ok(!ids(filterAndSortCorpus(units, { keep: 'mid' })).includes('s03'), 'stage3: 0.3 (→3) is NOT mid');
  ok(!ids(filterAndSortCorpus(units, { keep: 'mid' })).includes('s07'), 'stage3: 0.7 (→7) is NOT mid');
  // legacy 0–10 row (score > 1) passes through normalizeKeepability unchanged
  const legacy = [unit('L8', { keep: 8 }), unit('L2', { keep: 2 })];
  eq(ids(filterAndSortCorpus(legacy, { keep: 'high' })), ['L8'], 'stage3: legacy 0–10 row banded correctly (8→high)');
  eq(ids(filterAndSortCorpus(legacy, { keep: 'low' })), ['L2'], 'stage3: legacy 0–10 row banded correctly (2→low)');
}

// ============ STAGE 4: sort ============
{
  const units = [
    unit('mid', { keep: 0.5 }),    // 5
    unit('hi', { keep: 0.9 }),     // 9
    unit('lo', { keep: 0.1 }),     // 1
    unit('nul', { keep: null }),   // null
  ];
  eq(ids(filterAndSortCorpus(units, { sort: 'keep-desc' })), ['hi', 'mid', 'lo', 'nul'], 'stage4: keep-desc, null sinks last');
  eq(ids(filterAndSortCorpus(units, { sort: 'keep-asc' })), ['lo', 'mid', 'hi', 'nul'], 'stage4: keep-asc, null sinks last');
  eq(ids(filterAndSortCorpus(units, { sort: 'default' })), ['mid', 'hi', 'lo', 'nul'], 'stage4: default keeps input order');
}

// ============ no-mutation of the caller's array ============
{
  const units = [unit('b', { keep: 0.1 }), unit('a', { keep: 0.9 })];
  const before = ids(units);
  filterAndSortCorpus(units, { sort: 'keep-desc' });
  eq(ids(units), before, 'no-mutation: keep-desc sort does not reorder the input array');
}

// ============ combined: tier + band + sort end-to-end ============
{
  const units = [
    unit('raw_hi', { tier: 'raw', keep: 0.9 }),     // 9, raw, high
    unit('raw_lo', { tier: 'raw', keep: 0.2 }),     // 2, raw, low
    unit('scr_hi', { tier: 'script', keep: 0.9 }),  // 9, script (filtered out by tier)
    unit('raw_hi2', { tier: 'raw', keep: 0.8 }),    // 8, raw, high
  ];
  eq(ids(filterAndSortCorpus(units, { tier: 'raw', keep: 'high', sort: 'keep-desc' })),
     ['raw_hi', 'raw_hi2'], 'combined: tier=raw + high + desc');
}

// ============ robustness ============
{
  eq(filterAndSortCorpus(null, {}), [], 'robust: null units → []');
  eq(filterAndSortCorpus(undefined, {}), [], 'robust: undefined units → []');
  eq(filterAndSortCorpus([], { tier: 'raw', keep: 'high', sort: 'keep-desc' }), [], 'robust: empty units → []');
  eq(ids(filterAndSortCorpus([unit('a')], undefined)), ['a'], 'robust: missing opts arg → defaults (no throw)');
  // default opts means tier='' keep='' sort='default' → just the analyzed-only filter
  eq(ids(filterAndSortCorpus([unit('a'), unit('b', { noAnalysis: true })])), ['a'], 'robust: no opts arg → analyzed-only');
}

// ============ INLINE RED PROOF: the pre-fix raw-0–1-vs-0–10 bug ============
// Reconstruct the OLD band logic that compared the RAW 0–1 score against the
// 0–10 thresholds (no normalizeKeepability). On real 0–1 data the high band is
// EMPTY — the live bug the keepability fix closed. Assert the shipped function
// does NOT reproduce it.
{
  const units = [unit('hi', { keep: 0.9 }), unit('mid', { keep: 0.5 }), unit('lo', { keep: 0.1 })];
  const oldHigh = units.filter(u => {
    const raw = u.analyses?.[0]?.output_json?.keepability_score; // RAW 0–1, no bridge
    return raw != null && raw >= 7;
  });
  ok(oldHigh.length === 0, 'RED-proof: old raw-vs-0–10 logic yields an EMPTY high band on 0–1 data');
  ok(ids(filterAndSortCorpus(units, { keep: 'high' })).length === 1,
     'RED-proof: shipped function correctly populates the high band (0.9→9)');
}

console.log(`\ncorpus-filter: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\nFAILURES:\n' + fails.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
