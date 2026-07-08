// Human Element production-plan calendar (public/humanelement-cal/) — FIRST coverage.
//
// phaseStatus(ep, ph) is the most load-bearing function on the page: it decides EVERY
// episode-phase's status (done / now / open), and that verdict drives the progress bars,
// the ●/◐/○ glyphs, the "manual" tag, AND the click-to-override cycle in buildCards().
// It is entirely date-derived with a manual-override layer on top, so a silent regression
// here would mislabel Johnny's whole-season status on his flagship show's live plan page —
// exactly the class this loop locks. The page ships all logic inline in index.html with no
// build step, so (matching the sibling nile-flights tests) we SLICE the real source of
// `D` and `phaseStatus` straight out of index.html and exercise the shipped code — no
// hand-copy that could drift.
//
// The contract locked here (from the source, top to bottom):
//   1. overrides[key]==='done'  -> {st:'done', manual:true}   (override wins over EVERYTHING)
//   2. overrides[key]==='open'  -> {st:'open', manual:true}    (incl. over ph.pre)
//   3. ph.pre (and no override) -> {st:'done'}
//   4. e   <  TODAY             -> {st:'done'}                 (finished)
//   5. s <= TODAY <= e          -> {st:'now'}                  (in progress; INCLUSIVE both ends)
//   6. otherwise (future)       -> {st:'open'}
//   key = ep.id + ':' + ph.k ; derived results carry NO manual flag.
//
// Data-independent: uses synthetic ep/ph objects + a FIXED TODAY, so it stays green when
// Johnny edits real episode dates. Two mutation self-checks at the end prove the override
// precedence and the inclusive `e < TODAY` boundary are genuinely load-bearing.

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
const eq = (a, b, msg) =>
  ok(Object.is(a, b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// FIXED "today" so date assertions are deterministic regardless of run date.
// Sep 15 2026, local midnight — mirrors the page's `TODAY.setHours(0,0,0,0)`.
const FIXED_TODAY = new Date(2026, 8, 15); FIXED_TODAY.setHours(0, 0, 0, 0);

const D_SRC  = html.match(/const D = s => \{[\s\S]*?\};/);
const PS_SRC = html.match(/function phaseStatus\(ep, ph\) \{[\s\S]*?\n\}/);
assert.ok(D_SRC,  'sliced D from index.html');
assert.ok(PS_SRC, 'sliced phaseStatus from index.html');

// Build a live phaseStatus from the SHIPPED source, injecting TODAY + a mutable overrides
// object (the two module-scope names the fn closes over, besides the sliced D).
function buildPhaseStatus(psSource, overrides) {
  const factory = new Function('TODAY', 'overrides', `${D_SRC[0]}\n${psSource}\nreturn phaseStatus;`);
  return factory(FIXED_TODAY, overrides);
}

const overrides = {};
const phaseStatus = buildPhaseStatus(PS_SRC[0], overrides);

const EP = { id: 'test' };
const past   = { k: 'p1', s: '2026-06-01', e: '2026-06-10' }; // e < today  -> done
const now    = { k: 'p2', s: '2026-09-10', e: '2026-09-20' }; // spans today -> now
const future = { k: 'p3', s: '2026-12-01', e: '2026-12-10' }; // s > today  -> open
const pre    = { k: 'p4', pre: true };                        // pre        -> done
const endsToday   = { k: 'p5', s: '2026-09-01', e: '2026-09-15' }; // e == today -> now (inclusive)
const startsToday = { k: 'p6', s: '2026-09-15', e: '2026-09-30' }; // s == today -> now (inclusive)

// ── 1. Pure date-derived status (no overrides) ────────────────────────────────
eq(phaseStatus(EP, past).st,        'done', 'past phase (e < today) is done');
eq(phaseStatus(EP, now).st,         'now',  'phase spanning today is now');
eq(phaseStatus(EP, future).st,      'open', 'future phase (s > today) is open');
eq(phaseStatus(EP, pre).st,         'done', 'pre phase is done');
eq(phaseStatus(EP, endsToday).st,   'now',  'phase ENDING exactly today is still now (inclusive end)');
eq(phaseStatus(EP, startsToday).st, 'now',  'phase STARTING exactly today is now (inclusive start)');

// Derived verdicts must NOT carry a manual flag (drives the "manual" tag in the UI).
eq(phaseStatus(EP, past).manual,   undefined, 'derived-done phase has no manual flag');
eq(phaseStatus(EP, now).manual,    undefined, 'derived-now phase has no manual flag');
eq(phaseStatus(EP, future).manual, undefined, 'derived-open phase has no manual flag');

// ── 2. Manual overrides win, and are flagged manual ───────────────────────────
overrides['test:p1'] = 'open';   // flip a PAST (derived-done) phase to open
eq(phaseStatus(EP, past).st,     'open', 'override "open" beats derived done');
eq(phaseStatus(EP, past).manual, true,   'overridden phase is flagged manual');

overrides['test:p3'] = 'done';   // flip a FUTURE (derived-open) phase to done
eq(phaseStatus(EP, future).st,     'done', 'override "done" beats derived open');
eq(phaseStatus(EP, future).manual, true,   'overridden future phase is flagged manual');

overrides['test:p4'] = 'open';   // override beats even ph.pre
eq(phaseStatus(EP, pre).st,     'open', 'override "open" beats ph.pre');
eq(phaseStatus(EP, pre).manual, true,   'overridden pre phase is flagged manual');

// key is ep.id + ':' + ph.k — an override under a DIFFERENT ep.id must not leak across.
const overrides2 = { 'other:p1': 'open' };
const ps2 = buildPhaseStatus(PS_SRC[0], overrides2);
eq(ps2(EP, past).st, 'done', 'override is keyed by ep.id — no cross-episode leak');

// ── 3. Mutation self-checks — prove the guards above are load-bearing ──────────
// (a) Strip the override-precedence lines: the overridden past phase must STOP honoring
//     the override (would wrongly report derived 'done'), proving assertion set 2 bites.
const noOverride = PS_SRC[0]
  .replace(/\n\s*if \(overrides\[key\] === 'done'\)[^\n]*/, '')
  .replace(/\n\s*if \(overrides\[key\] === 'open'\)[^\n]*/, '');
ok(noOverride !== PS_SRC[0], 'mutation (a): override lines were located + removed');
const mutA = buildPhaseStatus(noOverride, { 'test:p1': 'open' });
eq(mutA(EP, past).st, 'done',
   'mutation (a): without override lines a past phase ignores its "open" override → proves precedence is load-bearing');

// (b) Tighten the finished boundary to `e <= TODAY`: the ends-exactly-today phase must
//     flip now→done, proving the inclusive-end assertion is load-bearing.
const strictEnd = PS_SRC[0].replace('if (e < TODAY)', 'if (e <= TODAY)');
ok(strictEnd !== PS_SRC[0], 'mutation (b): `e < TODAY` boundary was located + tightened');
const mutB = buildPhaseStatus(strictEnd, {});
eq(mutB(EP, endsToday).st, 'done',
   'mutation (b): with `e <= TODAY` a phase ending today flips to done → proves inclusive end is load-bearing');

console.log(`phase-status.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
