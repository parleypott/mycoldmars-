// Mutation-proven lock for the transcript library's NaN-safe recency sort.
// Imports the REAL shipped functions. Run: bun translation/src/library-time.test.mjs
import { recencyKey, byUpdatedDesc } from './library-time.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${a}, want ${b})`);

// ── Inline RED proof: the OLD inline comparator poisons the sort on a NaN date ──
// Reconstructs main.js's pre-fix `new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()`
// and shows an undated row jumps into the recent slice, displacing a genuinely-recent one.
{
  const oldCmp = (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  const rows = [
    { id: 'A', updated_at: '2026-06-20T10:00:00Z' },
    { id: 'B', updated_at: '2026-06-19T10:00:00Z' },
    { id: 'C', updated_at: undefined },               // NaN
    { id: 'D', updated_at: '2026-06-18T10:00:00Z' },
    { id: 'E', updated_at: '2026-06-17T10:00:00Z' },
  ];
  const oldTop3 = [...rows].sort(oldCmp).slice(0, 3).map(r => r.id);
  ok(oldTop3.includes('C'), 'RED PROOF: old comparator lets the undated row C into the recent-3');
  ok(!oldTop3.includes('D'), 'RED PROOF: old comparator pushes genuinely-recent D out of the recent-3');
  const newTop3 = [...rows].sort(byUpdatedDesc).slice(0, 3).map(r => r.id);
  ok(!newTop3.includes('C'), 'FIX: undated C does NOT enter the recent-3');
  ok(newTop3.includes('D'), 'FIX: genuinely-recent D stays in the recent-3');
  eq(newTop3.join(','), 'A,B,D', 'FIX: recent-3 is the three newest valid dates, in order');
}

// ── recencyKey: NaN-safe key ──
eq(recencyKey('2026-06-20T10:00:00Z'), new Date('2026-06-20T10:00:00Z').getTime(), 'valid ISO → exact getTime');
eq(recencyKey(undefined), 0, 'undefined → 0');
eq(recencyKey(null), 0, 'null → 0 (new Date(null) is epoch, finite)');
eq(recencyKey(''), 0, 'empty string → 0');
eq(recencyKey('not a date'), 0, 'garbage string → 0');
eq(recencyKey('2026-13-99'), 0, 'invalid date components → 0');
eq(recencyKey({}), 0, 'object → 0');
eq(recencyKey(NaN), 0, 'NaN → 0');
ok(Number.isFinite(recencyKey('garbage')), 'key is always finite (no NaN can escape)');
// A numeric epoch passes through new Date(number) → same number.
eq(recencyKey(1700000000000), 1700000000000, 'numeric epoch ms → itself');

// ── byUpdatedDesc: comparator never returns NaN, sorts newest-first ──
{
  // Two undated rows must compare to 0, not NaN (the poison case).
  eq(byUpdatedDesc({ updated_at: undefined }, { updated_at: undefined }), 0, 'two undated rows compare 0 (no NaN poison)');
  eq(byUpdatedDesc({ updated_at: null }, { updated_at: 'x' }), 0, 'two effectively-epoch/undated rows compare 0');
  // Newer first → comparator(newer, older) < 0.
  ok(byUpdatedDesc({ updated_at: '2026-06-20T00:00:00Z' }, { updated_at: '2026-06-19T00:00:00Z' }) < 0, 'newer sorts before older');
  ok(byUpdatedDesc({ updated_at: '2026-06-19T00:00:00Z' }, { updated_at: '2026-06-20T00:00:00Z' }) > 0, 'older sorts after newer');
  // A valid date always beats a missing one (missing → 0 → oldest).
  ok(byUpdatedDesc({ updated_at: '2026-06-20T00:00:00Z' }, { updated_at: undefined }) < 0, 'valid date sorts before an undated row');
  // Null-safe on the row objects themselves.
  ok(Number.isFinite(byUpdatedDesc(null, { updated_at: '2026-06-20T00:00:00Z' })), 'null row → finite comparator result');
  ok(Number.isFinite(byUpdatedDesc({ updated_at: '2026-06-20T00:00:00Z' }, null)), 'null row (other side) → finite');
}

// ── No-regression: byUpdatedDesc === the old inline comparator for ALL-VALID input ──
// (the universal real case — proves the consolidation changes nothing except the NaN path)
{
  const oldCmp = (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  const valid = [
    { id: 'a', updated_at: '2026-06-20T10:00:00Z' },
    { id: 'b', updated_at: '2026-06-20T10:00:01Z' },
    { id: 'c', updated_at: '2026-01-01T00:00:00Z' },
    { id: 'd', updated_at: '2025-12-31T23:59:59Z' },
    { id: 'e', updated_at: '2026-06-20T10:00:00Z' }, // tie with a
    { id: 'f', updated_at: '2024-06-20T10:00:00Z' },
  ];
  for (const x of valid) for (const y of valid) {
    eq(Math.sign(byUpdatedDesc(x, y)), Math.sign(oldCmp(x, y)),
      `all-valid equivalence: cmp(${x.id},${y.id}) matches old sign`);
  }
}

// ── End-to-end no-scramble lock: a larger list with several undated rows ──
{
  const rows = [];
  // 20 dated rows, descending by a day each from 2026-06-20.
  for (let i = 0; i < 20; i++) {
    const d = new Date(Date.UTC(2026, 5, 20 - i, 12, 0, 0)).toISOString();
    rows.push({ id: `d${i}`, updated_at: d });
  }
  // sprinkle in undated rows
  rows.splice(3, 0, { id: 'x1', updated_at: undefined });
  rows.splice(10, 0, { id: 'x2', updated_at: null });
  rows.splice(15, 0, { id: 'x3', updated_at: 'garbage' });
  const sorted = [...rows].sort(byUpdatedDesc);
  // The dated rows must appear in strict d0,d1,...,d19 order regardless of the undated ones.
  const datedOrder = sorted.filter(r => r.id.startsWith('d')).map(r => r.id);
  const expected = Array.from({ length: 20 }, (_, i) => `d${i}`);
  eq(datedOrder.join(','), expected.join(','), 'dated rows keep correct desc order despite undated rows');
  // All undated rows sink to the end (key 0 = oldest).
  const tail = sorted.slice(-3).map(r => r.id).sort();
  eq(tail.join(','), 'x1,x2,x3', 'all undated rows sink to the end');
  // The recent-25 slice contains all 20 real dated rows (none displaced by an undated row).
  const top25 = sorted.slice(0, 25).map(r => r.id);
  ok(expected.every(id => top25.includes(id)), 'every genuinely-dated row survives the recent-25 slice');
}

console.log(`\nlibrary-time: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
