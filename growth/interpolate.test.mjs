// growth — interpolate() + computeTargetY() coverage (the chart-data math).
//
// WHY: growth/index.html is a served, animated subscriber-growth chart (the kind
// Johnny screen-records). fmtCount() is locked (fmt-count.test.mjs) but the two
// functions that BUILD every point of the curve were zero-coverage:
//   • interpolate(ms, max) — turns each channel's sparse {m:month, s:subs}
//     milestone list into the per-month subscriber array drawn on the chart. A
//     regression in its segment selection, its `||1` divide-by-zero guard, or its
//     [0,1] clamp silently mis-draws the whole growth curve, with no signal.
//   • computeTargetY(upTo, maxIdx) — the peak*1.3 ceiling the animated y-axis grows
//     toward; a wrong peak scan flattens or overshoots the whole chart.
// Reviewed both: NO live bug (the math is correct) — so this is a verifier-layer
// LOCK, not a fix.
//
// This test EXTRACTS the REAL shipped lerp/interpolate/computeTargetY from
// growth/index.html at runtime (new Function), so it can never drift from a mirror.
// Correctness is checked against an INDEPENDENT linear-interpolation reference
// (explicit boundary returns + forward scan) — different code, same math — so a
// regression in the shipped function shows up as disagreement.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

// ── Extract the three shipped functions verbatim from the inline script ──
const lerpM = html.match(/function lerp\(a,b,t\)\{return a\+\(b-a\)\*t\}/);
const interpM = html.match(/function interpolate\(ms,max\)\{[\s\S]*?\n    \}/);
const computeM = html.match(/function computeTargetY\(upTo, maxIdx\) \{[\s\S]*?\n    \}/);
assert.ok(lerpM, 'could not locate lerp() in growth/index.html');
assert.ok(interpM, 'could not locate interpolate() in growth/index.html');
assert.ok(computeM, 'could not locate computeTargetY() in growth/index.html');

// Build a sandbox: lerp + interpolate + computeTargetY, with `fullData` injected as
// a free variable (computeTargetY closes over the page-global fullData; the test
// supplies it). interpolate/lerp ignore fullData.
function build(fullData, mutate = (s) => s) {
  const src = mutate(`${lerpM[0]}\n${interpM[0]}\n${computeM[0]}\nreturn { lerp, interpolate, computeTargetY };`);
  return new Function('fullData', src)(fullData);
}
const { lerp, interpolate, computeTargetY } = build([]);

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  try { assert.deepEqual(got, want, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};
const ok = (cond, msg) => {
  try { assert.ok(cond, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};

// ── Independent reference (explicit-boundary forward scan; distinct from shipped) ──
function refValueAt(ms, m) {
  const first = ms[0], last = ms[ms.length - 1];
  if (m <= first.m) return first.s;
  if (m >= last.m) return last.s;
  for (let i = 1; i < ms.length; i++) {
    if (m <= ms[i].m) {
      const lo = ms[i - 1], hi = ms[i];
      return lo.s + (hi.s - lo.s) * ((m - lo.m) / (hi.m - lo.m));
    }
  }
  return last.s;
}
function refArray(ms, max) {
  const out = [];
  const cap = Math.min(max, ms[ms.length - 1].m);
  for (let m = 0; m <= cap; m++) out.push(Math.round(refValueAt(ms, m)));
  return out;
}

// Realistic-shaped fixture (sparse, strictly increasing months).
const MS = [
  { m: 0, s: 2000 }, { m: 6, s: 4000 }, { m: 12, s: 8000 },
  { m: 24, s: 55000 }, { m: 36, s: 200000 }, { m: 48, s: 700000 },
];

// ── interpolate: agrees with the independent reference across the full span ──
eq(interpolate(MS, 48), refArray(MS, 48), 'interpolate matches the independent linear reference over the whole span');
eq(interpolate(MS, 100), refArray(MS, 100), 'max beyond the last milestone is clamped to the last month (no overrun)');

// length: one entry per month 0..min(max,lastM)
ok(interpolate(MS, 48).length === 49, 'one value per month 0..48 inclusive');
ok(interpolate(MS, 12).length === 13, 'max below the last milestone truncates the array at max');

// exact milestone months land exactly on their subscriber value
const full = interpolate(MS, 48);
eq(full[0], 2000, 'month 0 = first milestone value');
eq(full[6], 4000, 'month 6 (a milestone) lands exactly');
eq(full[24], 55000, 'month 24 (a milestone) lands exactly');
eq(full[48], 700000, 'month 48 (last milestone) lands exactly');

// a midpoint between two milestones is the rounded linear blend
eq(full[3], Math.round(2000 + (4000 - 2000) * 0.5), 'month 3 = halfway between month-0 and month-6 milestones');
eq(full[42], Math.round(200000 + (700000 - 200000) * 0.5), 'month 42 = halfway between month-36 and month-48');

// monotonic non-decreasing for a monotonic-increasing milestone set
const mono = interpolate(MS, 48).every((v, i, a) => i === 0 || v >= a[i - 1]);
ok(mono, 'interpolated curve is non-decreasing for an increasing milestone set');

// single milestone → no crash, value held
eq(interpolate([{ m: 5, s: 1234 }], 10), [1234, 1234, 1234, 1234, 1234, 1234], 'single milestone holds its value to its month, no crash');

// duplicate-month milestone exercises the `||1` divide-by-zero guard (no NaN/Infinity).
// The leading duplicate ({m:4}×2) is the FIRST segment month 4 selects, so the
// zero-width segment is actually hit — without `||1` this is a 0/0 = NaN.
const dup = interpolate([{ m: 4, s: 100 }, { m: 4, s: 999 }, { m: 8, s: 800 }], 8);
ok(dup.every(Number.isFinite), 'duplicate-month milestone produces finite values (||1 guard holds)');

// months below the first milestone month clamp to the first value (no extrapolation below)
const late = interpolate([{ m: 3, s: 500 }, { m: 9, s: 1100 }], 9);
eq(late[0], 500, 'month before the first milestone clamps to the first value (clamp floor)');
eq(late[1], 500, 'month 1 (still before first milestone) clamps to the first value');
eq(late[3], 500, 'month 3 (first milestone) = its value');
eq(late[9], 1100, 'month 9 (last milestone) = its value');

// ── computeTargetY: peak across revealed channels × 1.3 ──
const FD = [
  [10, 20, 30, 40],   // channel 0 peak (within window) = 30 at idx<=2
  [5, 15, 90, 200],   // channel 1 peak = 90 at idx<=2
];
{
  const c = build(FD);
  eq(c.computeTargetY(0, 2), 30 * 1.3, 'single channel: peak within window × 1.3');
  eq(c.computeTargetY(1, 2), 90 * 1.3, 'two channels: max peak across both × 1.3');
  eq(c.computeTargetY(1, 3), 200 * 1.3, 'wider window includes the later peak');
  eq(c.computeTargetY(1, 0), 10 * 1.3, 'window of one month: only month-0 values count');
}
// peak scan tolerates a channel shorter than maxIdx+1 (Math.min clamp) — no undefined
{
  const c = build([[5, 9], [1, 2, 3]]);
  ok(Number.isFinite(c.computeTargetY(1, 10)), 'maxIdx beyond channel length stays finite (length clamp)');
  eq(c.computeTargetY(1, 10), 9 * 1.3, 'peak is the true max despite the over-long window');
}

// ── RED-proof: a plausible regression disagrees with the locked behavior ──
// (1) drop the [0,1] clamp → a month below the first milestone extrapolates below it.
{
  const broken = build([], (s) => s.replace('Math.max(0,Math.min(1,(m-b.m)/s))', '((m-b.m)/s)'));
  const lateB = broken.interpolate([{ m: 3, s: 500 }, { m: 9, s: 1100 }], 9);
  ok(lateB[0] !== 500, 'RED proof: dropping the clamp extrapolates month-0 below the first value');
}
// (2) drop the `||1` guard → duplicate-month milestone yields a non-finite value.
{
  const broken = build([], (s) => s.replace('a.m-b.m||1', 'a.m-b.m'));
  const dupB = broken.interpolate([{ m: 4, s: 100 }, { m: 4, s: 999 }, { m: 8, s: 800 }], 8);
  ok(dupB.some((v) => !Number.isFinite(v)), 'RED proof: dropping the ||1 guard yields a non-finite value on a duplicate month');
}
// (3) computeTargetY without the 1.3 headroom → ceiling equals the bare peak.
{
  const broken = build(FD, (s) => s.replace('peak * 1.3', 'peak'));
  eq(broken.computeTargetY(1, 2), 90, 'RED proof: removing ×1.3 drops the y-axis headroom to the bare peak');
}

console.log(`interpolate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
