// Human Element production-plan calendar (public/humanelement-cal/) — SIXTH coverage.
//
// `monthBarCols(rowStartDay, dim, rowSMs, rowEMs, wsMs, weMs)` decides which columns a
// week-bar paints in a MONTH-grid row. The subtle, load-bearing part of its contract is
// that it CLAMPS the bar to the row's IN-MONTH cells: a week that straddles a month
// boundary (the shipped plan has several — "Jun 29 – Jul 3", "Aug 31 – Sep 4",
// "Sep 28 – Oct 2", "Nov 30 – Dec 4") must NOT bleed onto the greyed adjacent-month
// (.out) cells shown at the ends of a month grid. The old code clamped only to the 7-cell
// ROW, so those cross-month bars painted right over the out-of-month days — visually
// implying work was scheduled in a month it wasn't. This test pins the in-month clamp on
// both the month a cross-month week STARTS in and the one it ENDS in, and proves an
// in-month week is left untouched.
//
// The page ships all logic inline in index.html with no build step, so (matching the
// sibling pct-timeline.test.mjs + phase-status.test.mjs) we SLICE the real source of
// `dayMs` and `monthBarCols` straight out of index.html and exercise the shipped code —
// no hand-copy that drifts. A mutation self-check at the end strips the in-month clamp and
// proves the cross-month bar then escapes onto the .out cells.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  try { assert.ok(cond, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const DAYMS_SRC = html.match(/const dayMs = \d+;/);
const FN_SRC    = html.match(/function monthBarCols\([\s\S]*?\n}/);
assert.ok(DAYMS_SRC, 'sliced dayMs from index.html');
assert.ok(FN_SRC,    'sliced monthBarCols from index.html');

function build(fnSource) {
  const factory = new Function(`${DAYMS_SRC[0]}\n${fnSource}\nreturn monthBarCols;`);
  return factory();
}
const monthBarCols = build(FN_SRC[0]);

// Helper: local-midnight epoch-ms for a 2026 date, matching the page's D()/new Date usage.
const ms = (mi, day) => new Date(2026, mi, day).getTime();

// June 2026: Jun 1 is a Monday → offset 0 → last row starts at day 29 (Jun 29,30 + Jul 1–5 out).
// The week "Jun 29 – Jul 3" (Mon–Fri) must paint ONLY Jun 29 & 30 in June's grid — never Jul 1–3.
{
  const rowStart = 29, dim = 30; // June
  const rowS = ms(5, 29), rowE = ms(5, 29 + 6); // new Date(2026,5,35) = Jul 5
  const cols = monthBarCols(rowStart, dim, rowS, rowE, ms(5, 29), ms(6, 3)); // Jun29 → Jul3
  eq(cols, { c0: 0, c1: 1 }, 'June grid: "Jun 29 – Jul 3" clamps to Jun 29–30 (cols 0–1), no Jul bleed');
}

// July 2026: Jul 1 is a Wednesday → offset 2 → leading row starts at day -1 (Jun 29,30 out + Jul 1–5).
// The same week in JULY's grid must paint ONLY Jul 1–3 — never the leading Jun 29/30 out-cells.
{
  const rowStart = -1, dim = 31; // July, leading row
  const rowS = ms(6, -1), rowE = ms(6, -1 + 6); // Jun 29 → Jul 5
  const cols = monthBarCols(rowStart, dim, rowS, rowE, ms(5, 29), ms(6, 3)); // Jun29 → Jul3
  eq(cols, { c0: 2, c1: 4 }, 'July grid: "Jun 29 – Jul 3" clamps to Jul 1–3 (cols 2–4), no Jun bleed');
}

// An entirely in-month week is untouched: "Jul 6 – Jul 9" in July's Jul-6 row (rowStart 6).
{
  const rowStart = 6, dim = 31;
  const rowS = ms(6, 6), rowE = ms(6, 6 + 6); // Jul 6 → Jul 12
  const cols = monthBarCols(rowStart, dim, rowS, rowE, ms(6, 6), ms(6, 9)); // Jul6 → Jul9
  eq(cols, { c0: 0, c1: 3 }, 'in-month week "Jul 6 – Jul 9" fills cols 0–3 unchanged');
}

// A week that does not intersect this row at all → null (nothing painted).
{
  const rowStart = 6, dim = 31;
  const rowS = ms(6, 6), rowE = ms(6, 6 + 6); // Jul 6 → Jul 12
  const cols = monthBarCols(rowStart, dim, rowS, rowE, ms(6, 20), ms(6, 24)); // Jul20 → Jul24
  eq(cols, null, 'non-overlapping week returns null');
}

// A cross-month week whose in-month portion is only the trailing out-cells of the OTHER
// month still yields null in the wrong grid (defensive): a week fully in Aug shows null in
// July's trailing row.
{
  const rowStart = 27, dim = 31; // July trailing row: Jul 27–31 + Aug 1,2 out (Jul 27 is a Monday)
  const rowS = ms(6, 27), rowE = ms(6, 27 + 6); // Jul 27 → Aug 2
  const cols = monthBarCols(rowStart, dim, rowS, rowE, ms(7, 3), ms(7, 7)); // Aug 3–7, no overlap
  eq(cols, null, 'week beyond the row (Aug 3–7 vs a Jul row) returns null');
}

// ── Mutation self-check — prove the in-month clamp is load-bearing ────────────────────
// Strip the clamp line. The cross-month "Jun 29 – Jul 3" week in June's grid must now
// escape onto the out cells (c1 = 4 → paints Jul 1–3), proving the clamp genuinely bites.
const unclamped = FN_SRC[0].replace(/\n {2}c0 = Math\.max\(c0[^\n]*\n/, '\n');
ok(unclamped !== FN_SRC[0], 'mutation: in-month clamp line located + removed');
const monthBarColsRaw = build(unclamped);
{
  const rowS = ms(5, 29), rowE = ms(5, 29 + 6);
  const cols = monthBarColsRaw(29, 30, rowS, rowE, ms(5, 29), ms(6, 3));
  ok(cols && cols.c1 === 4,
     'mutation: without the clamp the June bar reaches col 4 (Jul 3) → bleeds onto .out cells → clamp is load-bearing');
}

console.log(`month-bar-cols.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
