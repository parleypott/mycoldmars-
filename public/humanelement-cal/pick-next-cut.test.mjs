// Human Element production-plan calendar (public/humanelement-cal/) — SEVENTH coverage.
//
// `pickNextCut(episodes, today, mkDate)` chooses the soonest upcoming publish-cut across
// all episodes for the header's "next cut" chip. Its load-bearing guard is that it SKIPS
// an episode that has no pubCut date instead of throwing on `e.pubCut.d`.
//
// Why that matters: the whole page ships as ONE inline <script> (index.html 302–698). The
// header dynamics (this selector) run BEFORE buildGantt/buildCal/buildMonths/buildCards.
// The old form mapped EVERY episode and read `e.pubCut.lbl`/`e.pubCut.d` unguarded, so a
// single episode added without a pubCut date — a realistic placeholder / Season-2 stub in
// a plan Johnny actively edits — threw a TypeError here and, because nothing below in the
// block then executed, blanked the ENTIRE calendar (gantt, months, cards all gone).
//
// Matching the sibling month-bar-cols / pct-timeline / phase-status tests, we SLICE the
// real pickNextCut source straight out of index.html (no hand-copy that drifts) and prove:
//   1. it picks the soonest FUTURE cut on complete data,
//   2. it skips a pubCut-less episode without throwing,
//   3. mutation self-check: the old unguarded map-first form THROWS on that same partial
//      episode → the guard is load-bearing, not cosmetic.

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

const FN_SRC = html.match(/function pickNextCut\([\s\S]*?\n}/);
assert.ok(FN_SRC, 'sliced pickNextCut from index.html');

function build(fnSource) {
  const factory = new Function(`${fnSource}\nreturn pickNextCut;`);
  return factory();
}
const pickNextCut = build(FN_SRC[0]);

// Match the page's D(): a local-midnight Date from an ISO 'YYYY-MM-DD' string.
const D = s => new Date(s + 'T00:00:00');
const TODAY = D('2026-08-01');

// Complete data — three episodes, cuts before/after today, out of order.
const complete = [
  { place: 'Alpha', pubCut: { d: '2026-07-17', lbl: 'Jul 17' } }, // past → excluded
  { place: 'Bravo', pubCut: { d: '2026-09-04', lbl: 'Sep 4' } },  // future, later
  { place: 'Cticket', pubCut: { d: '2026-08-20', lbl: 'Aug 20' } }, // future, SOONEST
];

{
  const cut = pickNextCut(complete, TODAY, D);
  eq(cut && cut.lbl, 'Cticket · Aug 20', 'picks the soonest FUTURE cut across episodes');
}

// All cuts in the past → no next cut (undefined), no crash.
{
  const cut = pickNextCut(complete, D('2026-12-31'), D);
  ok(cut === undefined, 'no future cut → undefined (empty result, not a throw)');
}

// THE GUARD: a partial episode with no pubCut is skipped, not fatal.
const withPartial = [
  { place: 'Alpha', pubCut: { d: '2026-07-17', lbl: 'Jul 17' } },
  { place: 'Season2Stub' }, // ← no pubCut at all (placeholder Johnny might add mid-plan)
  { place: 'Cticket', pubCut: { d: '2026-08-20', lbl: 'Aug 20' } },
  { place: 'Bravo', pubCut: { d: '2026-09-04', lbl: 'Sep 4' } },
];
{
  let threw = false, cut;
  try { cut = pickNextCut(withPartial, TODAY, D); } catch { threw = true; }
  ok(!threw, 'pickNextCut does NOT throw when an episode lacks pubCut');
  eq(cut && cut.lbl, 'Cticket · Aug 20', 'partial episode is skipped; correct next cut still returned');
}

// A pubCut object present but missing its `.d` is also skipped (half-filled stub).
{
  const halfFilled = [{ place: 'Half', pubCut: { lbl: 'TBD' } }, ...complete];
  let threw = false, cut;
  try { cut = pickNextCut(halfFilled, TODAY, D); } catch { threw = true; }
  ok(!threw, 'pubCut present but no .d → skipped, no throw');
  eq(cut && cut.lbl, 'Cticket · Aug 20', 'half-filled pubCut skipped; correct next cut still returned');
}

// ── Mutation self-check — prove the pubCut guard is load-bearing ──────────────────────
// Reconstruct the OLD unguarded form (map EVERY episode, read e.pubCut.d raw). It must
// THROW on the same partial episode the guarded form handles — that throw is exactly what
// blanked the whole calendar in production.
function pickNextCutOLD(episodes, today, mkDate) {
  return episodes
    .map(e => ({ lbl: `${e.place} · ${e.pubCut.lbl}`, d: mkDate(e.pubCut.d) }))
    .filter(x => x.d >= today)
    .sort((a, b) => a.d - b.d)[0];
}
{
  let threw = false;
  try { pickNextCutOLD(withPartial, TODAY, D); } catch { threw = true; }
  ok(threw, 'mutation: the old unguarded map-first form THROWS on a pubCut-less episode → guard is load-bearing');
}
// Sanity: old form still works on complete data (so the mutation isolates the guard, not a typo).
{
  const cut = pickNextCutOLD(complete, TODAY, D);
  eq(cut && cut.lbl, 'Cticket · Aug 20', 'mutation control: old form matches new form on COMPLETE data');
}

console.log(`pick-next-cut.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
