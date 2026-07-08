// Human Element production-plan calendar (public/humanelement-cal/) — SECOND coverage.
//
// `pct(t)` is the timeline position-mapper: it maps a date into a 0–100% x-position across
// the season DOMAIN. EVERY visual element on the page is placed with it — the Gantt month
// headers, weekly gridlines, per-episode span bars + phase segments, the pre-pub / pub-cut /
// live diamonds, the milestone + Adam-video dots, and the "Today" line. A silent regression
// here would misalign Johnny's whole-season flagship timeline: bars sliding off the domain,
// the today-line landing on the wrong week. Exactly the load-bearing pure core this loop locks.
//
// The subtle, genuinely-fragile part of its contract is that the shipped code calls `pct`
// with BOTH kinds of argument:
//   • Date objects  — pct(D(m[1])), pct(TODAY), pct(D(ep.live.d)) ...
//   • epoch-ms numbers — pct(spanS), pct(m.t) where spanS/m.t come from .getTime()
// Both must yield the same position, because `(t - DOMAIN[0])` coerces a Date via valueOf.
// A naive refactor (e.g. `t.getTime() - ...`) would silently break every number-fed caller.
// This test pins that dual-input contract plus the [0,100] clamp and the domain endpoints.
//
// The page ships all logic inline in index.html with no build step, so (matching the sibling
// phase-status.test.mjs + the nile-flights tests) we SLICE the real source of `D`, `DOMAIN`,
// and `pct` straight out of index.html and exercise the shipped code — no hand-copy that drifts.
// Data-independent: assertions derive their expected values from the sliced DOMAIN itself, so
// the test stays green if Johnny shifts the season window. Two mutation self-checks at the end
// prove the clamp is load-bearing.

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
const near = (a, b, msg, eps = 1e-9) =>
  ok(Math.abs(a - b) < eps, `${msg} (got ${a}, want ${b})`);

const D_SRC      = html.match(/const D = s => \{[\s\S]*?\};/);
const DOMAIN_SRC = html.match(/const DOMAIN = \[[^\n]*;/);
const PCT_SRC    = html.match(/const pct = t => [^\n]*;/);
assert.ok(D_SRC,      'sliced D from index.html');
assert.ok(DOMAIN_SRC, 'sliced DOMAIN from index.html');
assert.ok(PCT_SRC,    'sliced pct from index.html');

// Build a live {D, DOMAIN, pct} from the SHIPPED source — pct closes over D + DOMAIN only.
function build(pctSource) {
  const factory = new Function(
    `${D_SRC[0]}\n${DOMAIN_SRC[0]}\n${pctSource}\nreturn { D, DOMAIN, pct };`
  );
  return factory();
}

const { D, DOMAIN, pct } = build(PCT_SRC[0]);
const t0 = DOMAIN[0].getTime();          // domain start (epoch ms)
const t1 = DOMAIN[1].getTime();          // domain end
const mid = (t0 + t1) / 2;               // exact temporal midpoint

// ── 1. Domain endpoints + midpoint (fed as epoch-ms numbers) ──────────────────
near(pct(t0),  0,   'pct(domain start) = 0%');
near(pct(t1),  100, 'pct(domain end) = 100%');
near(pct(mid), 50,  'pct(midpoint) = 50%');

// A quarter of the way through the season maps to 25%.
near(pct(t0 + (t1 - t0) * 0.25), 25, 'pct(quarter point) = 25%');

// ── 2. Dual-input contract: Date object === epoch-ms number ───────────────────
// The Gantt feeds pct BOTH forms; both must land on the identical position.
near(pct(DOMAIN[0]),           pct(t0), 'pct(Date start) === pct(ms start)');
near(pct(DOMAIN[1]),           pct(t1), 'pct(Date end) === pct(ms end)');
near(pct(D('2026-09-15')),     pct(D('2026-09-15').getTime()),
     'pct(Date) === pct(Date.getTime()) for an in-domain day');
ok(pct(D('2026-09-15')) > 0 && pct(D('2026-09-15')) < 100,
   'an in-domain Date maps strictly inside 0–100%');

// ── 3. Clamp: out-of-domain dates pin to the edges (bars never escape the track) ─
near(pct(D('2026-01-01')), 0,   'a date BEFORE the domain clamps to 0% (not negative)');
near(pct(D('2027-06-01')), 100, 'a date AFTER the domain clamps to 100% (not >100)');
near(pct(t0 - 999 * 86400000), 0,   'far-past epoch-ms clamps to 0%');
near(pct(t1 + 999 * 86400000), 100, 'far-future epoch-ms clamps to 100%');

// Monotonic across the domain: later date -> larger-or-equal percent.
ok(pct(D('2026-07-01')) < pct(D('2026-10-01')),
   'pct is monotonic increasing in time across the domain');

// ── 4. Mutation self-checks — prove the clamp is load-bearing ─────────────────
// Strip the Math.max(0, Math.min(100, …)) clamp from the shipped source. Out-of-domain
// inputs must now escape [0,100], proving assertion set 3 genuinely bites.
const unclamped = PCT_SRC[0]
  .replace('Math.max(0, Math.min(100, ', '')
  .replace(' * 100));', ' * 100;');
ok(unclamped !== PCT_SRC[0], 'mutation: clamp wrapper was located + removed');
const { pct: pctRaw } = build(unclamped);
ok(pctRaw(D('2026-01-01')) < 0,
   'mutation: without the clamp a pre-domain date goes NEGATIVE → proves lower clamp is load-bearing');
ok(pctRaw(D('2027-06-01')) > 100,
   'mutation: without the clamp a post-domain date exceeds 100 → proves upper clamp is load-bearing');

console.log(`pct-timeline.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
