// Mutation-proven lock for The Hunter "Recent analyses" feed recency key.
//
// Reproduces RED first: the OLD inline comparator
//   new Date(b.analyses[0].created_at || 0) - new Date(a.analyses[0].created_at || 0)
// NaN-poisons V8's sort when ANY unit carries a present-but-unparseable
// created_at (a garbage string / malformed timestamp), scrambling the WHOLE
// feed order. analysisRecencyMs returns a finite epoch-ms or 0, so the
// comparator can never produce NaN.
//
// Imports the REAL shipped functions — no mirror, can't drift.

import { analysisRecencyMs, byAnalysisRecencyDesc } from './feed-sort.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`✗ ${msg}\n    got:  ${g}\n    want: ${w}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`✗ ${msg}`); } };

const unit = (created_at, id) => ({ id, analyses: [{ created_at }] });

// ── INLINE RED PROOF: the OLD comparator NaN-poisons on a garbage created_at ──
// Reconstruct the exact old inline logic and show (a) it produces NaN and
// (b) it scrambles a sort that the fixed comparator keeps ordered.
const oldCmp = (a, b) =>
  new Date(b.analyses[0].created_at || 0) - new Date(a.analyses[0].created_at || 0);
{
  const bad = unit('not-a-date', 'X');
  const good = unit('2026-06-01T00:00:00Z', 'G');
  ok(Number.isNaN(oldCmp(bad, good)), 'RED: old comparator yields NaN on a garbage created_at');
  ok(Number.isFinite(byAnalysisRecencyDesc(bad, good)), 'fixed comparator is finite on the same input');
}

// End-to-end: a feed where one unit has a garbage timestamp. Build enough rows
// that a NaN comparator demonstrably scrambles V8's sort, then assert the fixed
// sort keeps every dated row in strict descending order.
{
  const rows = [
    unit('2026-06-10T00:00:00Z', 'd10'),
    unit('2026-06-05T00:00:00Z', 'd05'),
    unit('garbage', 'bad'),
    unit('2026-06-20T00:00:00Z', 'd20'),
    unit('2026-06-01T00:00:00Z', 'd01'),
    unit('2026-06-15T00:00:00Z', 'd15'),
    unit('2026-06-08T00:00:00Z', 'd08'),
    unit('2026-06-12T00:00:00Z', 'd12'),
  ];

  // Old comparator: demonstrate the poison — the dated rows do NOT come out in
  // correct descending order (V8's sort is corrupted by the NaN comparisons).
  const oldSorted = [...rows].sort(oldCmp).filter(u => u.id !== 'bad').map(u => u.id);
  const correctDesc = ['d20', 'd15', 'd12', 'd10', 'd08', 'd05', 'd01'];
  ok(JSON.stringify(oldSorted) !== JSON.stringify(correctDesc),
    'RED: old comparator scrambles the dated rows (NaN-poisoned sort)');

  // Fixed comparator: every dated row in strict descending order; bad row sinks
  // to oldest (epoch 0); all rows survive.
  const fixed = [...rows].sort(byAnalysisRecencyDesc).map(u => u.id);
  eq(fixed.filter(id => id !== 'bad'), correctDesc, 'fixed: dated rows strictly descending despite the bad row');
  eq(fixed[fixed.length - 1], 'bad', 'fixed: garbage-timestamp row sinks to oldest');
  eq(fixed.length, rows.length, 'fixed: every row survives the sort');
}

// ── analysisRecencyMs unit cases ──
eq(analysisRecencyMs(unit('1970-01-01T00:00:00Z', 'a')), 0, 'epoch ISO -> 0');
ok(analysisRecencyMs(unit('2026-06-20T00:00:00Z', 'a')) === Date.parse('2026-06-20T00:00:00Z'),
  'valid ISO -> its epoch-ms');
eq(analysisRecencyMs(unit(null, 'a')), 0, 'null created_at -> 0');
eq(analysisRecencyMs(unit(undefined, 'a')), 0, 'undefined created_at -> 0');
eq(analysisRecencyMs(unit('', 'a')), 0, 'empty-string created_at -> 0');
eq(analysisRecencyMs(unit('garbage', 'a')), 0, 'unparseable created_at -> 0 (no NaN)');
eq(analysisRecencyMs({ id: 'a', analyses: [] }), 0, 'empty analyses -> 0 (no throw)');
eq(analysisRecencyMs({ id: 'a' }), 0, 'missing analyses -> 0 (no throw)');
eq(analysisRecencyMs(null), 0, 'null unit -> 0 (no throw)');
eq(analysisRecencyMs(undefined), 0, 'undefined unit -> 0 (no throw)');
ok(Number.isFinite(analysisRecencyMs(unit('2026-06-20T00:00:00Z', 'a'))), 'recency is always finite');

// Ordering invariant: newer analysis ranks first under the desc comparator.
{
  const newer = unit('2026-06-20T00:00:00Z', 'n');
  const older = unit('2026-06-01T00:00:00Z', 'o');
  ok(byAnalysisRecencyDesc(newer, older) < 0, 'desc: newer before older');
  ok(byAnalysisRecencyDesc(older, newer) > 0, 'desc: older after newer');
  eq(byAnalysisRecencyDesc(newer, { ...newer }), 0, 'desc: equal timestamps -> 0');
}

console.log(`feed-sort: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
