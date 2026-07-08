// Locks daysUntil() — the premiere-countdown day-count in Johnny's flagship
// Human Element season plan (mycoldmars.vercel.app/humanelement-cal/). It drives the
// "Oct 26 · T-N days" header the whole team reads first.
//
// The load-bearing property: it must be DST-PROOF. Two local-midnight dates that
// straddle the Nov 1 fall-back are (N*24 + 1)h apart, so raw/dayMs = N + 0.042. The
// shipped code used Math.ceil, which over-counted by a full day across that boundary
// (a Dec premiere counted from before Nov 1 read "T-43" when it was 42). Math.round
// lands on the true midnight-count and is identical to ceil for any span that does NOT
// cross DST — so this is byte-identical for the current Oct-26 data, and a correctness
// fix only for future reuse of the template with a Nov/Dec premiere.
//
// Pattern mirrors phase-status.test.mjs / pct-timeline.test.mjs: slice the REAL shipped
// source verbatim out of index.html (no build step on this page) so the test guards the
// deployed code, not a reconstruction. TZ is forced to Johnny's America/New_York so the
// DST fall-back actually exists in the test process (a UTC runner has no DST and could
// not reproduce the bug).

process.env.TZ = 'America/New_York';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

// ── slice the real source verbatim ──
function slice(re, label) {
  const m = html.match(re);
  assert.ok(m, `could not slice ${label} from index.html — did the source shape change?`);
  return m[0];
}
const dayMsSrc     = slice(/const dayMs = \d+;/, 'dayMs');
const daysUntilSrc = slice(/const daysUntil = \([^)]*\) => Math\.\w+\(\(target - from\)\/dayMs\);/, 'daysUntil');

// The shipped page defines D(s) = new Date(s+'T00:00:00') (local midnight). Rebuild the
// exact same helper so operands match the real page's inputs.
function build(daysUntilSource) {
  const D = s => new Date(s + 'T00:00:00');
  const factory = new Function('D', `${dayMsSrc}\n${daysUntilSource}\nreturn daysUntil;`);
  return { fn: factory(D), D };
}

const { fn: daysUntil, D } = build(daysUntilSrc);

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.equal(a, b, `${msg} (got ${a}, want ${b})`); passed++; };

// ── 1. no-DST-cross spans: exact, and identical to the old ceil ──
eq(daysUntil(D('2026-10-26'), D('2026-10-20')), 6, 'Oct 20 -> Oct 26 = 6 days');
eq(daysUntil(D('2026-10-26'), D('2026-10-25')), 1, 'one day before premiere = 1');
eq(daysUntil(D('2026-10-26'), D('2026-10-26')), 0, 'premiere day = 0');
eq(daysUntil(D('2026-10-26'), D('2026-06-15')), 133, 'season start -> premiere = 133 days');

// ── 2. negative (post-premiere) still exact ──
eq(daysUntil(D('2026-10-26'), D('2026-10-27')), -1, 'day after premiere = -1');
eq(daysUntil(D('2026-10-26'), D('2026-11-01')), -6, 'the PREMIERE-WEEK / Premiered boundary = -6');

// ── 3. THE load-bearing DST case: a span that crosses the Nov 1 fall-back ──
// Oct 26 -> Dec 7 is exactly 42 calendar days; the local midnights are 42*24+1 hours
// apart, so raw/dayMs = 42.0417. round -> 42 (correct). This is the assertion the bug
// would have failed.
eq(daysUntil(D('2026-12-07'), D('2026-10-26')), 42, 'DST-crossing span counts true 42 days');
// verify the raw quotient really is the fractional value (proves DST is in play, not a
// timezone-free environment silently making the test trivial)
const rawCrossing = (D('2026-12-07') - D('2026-10-26')) / 86400000;
ok(rawCrossing > 42 && rawCrossing < 42.1, `raw quotient carries the DST hour (${rawCrossing})`);

// ── 4. mutation proof: rebuild with the OLD ceil and confirm it over-counts ──
// This proves (a) the DST assertion above is load-bearing and (b) round vs ceil is the
// exact thing that matters. If someone reverts round->ceil, assertion 3 goes red.
const ceilSrc = daysUntilSrc.replace('Math.round', 'Math.ceil');
assert.notEqual(ceilSrc, daysUntilSrc, 'mutation must actually change the source');
const { fn: daysUntilCeil } = build(ceilSrc);
eq(daysUntilCeil(D('2026-12-07'), D('2026-10-26')), 43, 'OLD ceil over-counts the DST span (proves the bug + the guard)');
// ...and identical to round for the non-crossing spans (so the fix is truly zero-regression today)
eq(daysUntilCeil(D('2026-10-26'), D('2026-10-20')), 6, 'ceil == round on non-DST span (byte-identical today)');
eq(daysUntilCeil(D('2026-10-26'), D('2026-06-15')), 133, 'ceil == round across the live countdown window');

// ── 5. the shipped source is the round form (not silently still ceil) ──
ok(/Math\.round/.test(daysUntilSrc), 'shipped daysUntil uses Math.round');

console.log(`days-until.test.mjs: ${passed}/${passed} assertions passed`);
