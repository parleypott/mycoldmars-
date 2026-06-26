// Mutation-proven lock for the transcript library's NaN-safe recency sort.
// Imports the REAL shipped functions. Run: bun translation/src/library-time.test.mjs
import { recencyKey, byUpdatedDesc, compareForLibrary } from './library-time.js';

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

// ── compareForLibrary: the DEFAULT column-sort comparator (Name / Status / Edited) ──
// This is the second, previously-un-migrated sort path on updated_at. Same
// NaN/0-poison class as byUpdatedDesc, reached by the library's default ordering.
{
  // RED PROOF: reconstruct main.js's pre-fix inline `<`/`>` compare on updated_at.
  // A missing updated_at returns 0 against EVERY row (undefined < "x" is false,
  // undefined > "x" is false), so the comparator is non-transitive and V8
  // scrambles the order. Demonstrate the broken "equal-to-everything" verdict.
  const oldCmp = (a, b, key, asc) => {
    let va = a[key], vb = b[key];
    if (key === 'name') { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); }
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
  };
  const undated = { id: 'U', updated_at: undefined };
  const newRow = { id: 'N', updated_at: '2026-06-25T00:00:00Z' };
  const oldRow = { id: 'O', updated_at: '2020-01-01T00:00:00Z' };
  // The bug: pre-fix, the undated row claims "equal" to BOTH a new and an old row,
  // yet new and old are NOT equal — a textbook transitivity break.
  eq(oldCmp(undated, newRow, 'updated_at', false), 0, 'RED PROOF: old compare says undated == newest');
  eq(oldCmp(undated, oldRow, 'updated_at', false), 0, 'RED PROOF: old compare says undated == oldest');
  ok(oldCmp(newRow, oldRow, 'updated_at', false) !== 0, 'RED PROOF: but newest != oldest → non-transitive');
  // FIX: the undated row is strictly oldest (key 0), and the relation is consistent.
  ok(compareForLibrary(undated, newRow, 'updated_at', false) > 0, 'FIX: undated sorts after newest (desc)');
  ok(compareForLibrary(undated, oldRow, 'updated_at', false) > 0, 'FIX: undated sorts after a real old date too');
  ok(compareForLibrary(newRow, oldRow, 'updated_at', false) < 0, 'FIX: newest before oldest (desc) — consistent');
}

// compareForLibrary updated_at: end-to-end no-scramble with the DEFAULT (desc) order
{
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push({ id: `d${i}`, name: `n${i}`, updated_at: new Date(Date.UTC(2026, 5, 20 - i, 12)).toISOString() });
  }
  rows.splice(2, 0, { id: 'u1', name: 'zz', updated_at: undefined });
  rows.splice(7, 0, { id: 'u2', name: 'zz', updated_at: 'garbage' });
  const sorted = [...rows].sort((a, b) => compareForLibrary(a, b, 'updated_at', false));
  const dated = sorted.filter(r => r.id.startsWith('d')).map(r => r.id);
  eq(dated.join(','), Array.from({ length: 12 }, (_, i) => `d${i}`).join(','),
     'default desc: dated rows keep strict newest→oldest order despite undated ones');
  eq(sorted.slice(-2).map(r => r.id).sort().join(','), 'u1,u2', 'undated rows sink to the bottom (desc)');
}

// compareForLibrary updated_at: equivalence to byUpdatedDesc for the default (desc) view
{
  const rows = [
    { updated_at: '2026-06-20T10:00:00Z' },
    { updated_at: '2026-01-01T00:00:00Z' },
    { updated_at: undefined },
    { updated_at: '2025-12-31T23:59:59Z' },
  ];
  for (const x of rows) for (const y of rows) {
    eq(Math.sign(compareForLibrary(x, y, 'updated_at', false)), Math.sign(byUpdatedDesc(x, y)),
       'updated_at desc compareForLibrary matches byUpdatedDesc sign');
  }
}

// compareForLibrary string columns (name / step): null-safe, asc/desc honored
{
  // name lowercases (case-insensitive), missing → '' (sorts first asc)
  ok(compareForLibrary({ name: 'Apple' }, { name: 'banana' }, 'name', true) < 0, 'name asc: Apple before banana (case-insensitive)');
  ok(compareForLibrary({ name: undefined }, { name: 'a' }, 'name', true) < 0, 'name asc: missing name sorts first');
  eq(compareForLibrary({ name: undefined }, { name: undefined }, 'name', true), 0, 'two missing names compare equal');
  ok(compareForLibrary({ name: 'a' }, { name: 'b' }, 'name', false) > 0, 'name desc flips the order');
  // step (status) is a non-name string column: coerced null→'' but NOT lowercased
  ok(compareForLibrary({ step: 'draft' }, { step: 'translated' }, 'step', true) < 0, 'step asc: draft before translated');
  ok(compareForLibrary({ step: undefined }, { step: 'draft' }, 'step', true) < 0, 'step asc: missing status sorts first');
  eq(compareForLibrary({ step: undefined }, { step: null }, 'step', true), 0, 'missing vs null status compare equal');
  // null row objects must not throw
  ok(Number.isFinite(compareForLibrary(null, { name: 'a' }, 'name', true)), 'null row → finite (name)');
  ok(Number.isFinite(compareForLibrary({ updated_at: 'x' }, null, 'updated_at', false)), 'null row → finite (updated_at)');
}

console.log(`\nlibrary-time: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
