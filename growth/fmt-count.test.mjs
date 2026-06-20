// growth — fmtCount() subscriber-count formatter coverage.
//
// THE BUG (fixed): three inline value formatters each did
//   `v>=1e6 ? (v/1e6).toFixed(1)+'M' : Math.round(v/1000)+'K'`
// so any count in 999,500–999,999 rounded to 1000 and rendered "1000K" instead of
// rolling over to "1.0M". The reachable one is the running-value label (lineLabels
// plugin) shown at the clip-reveal edge: it formats `lerp(v1,v2,frac)` — an
// INTERPOLATED value — while the reveal sweeps. The Johnny Harris series climbs
// 910K (month 50) → 1.21M (month 52), so the interpolated running value passes
// continuously through the 999.5K–999.99K band on the way up → a "1000K" flash
// mid-animation on a served growth chart. (The prior iteration wrongly dismissed
// this page as "tops out at 60K" — that's the y-axis `max`, not the data, which
// reaches 7.64M.) Same boundary-rollover class fixed in views-growth (82da91b).
// The fix consolidates the three formatters into one fmtCount() that rolls the band
// over to "1.0M"; every value outside the band is byte-identical to the old formatter.
//
// This test EXTRACTS the REAL shipped fmtCount from growth/index.html at runtime
// (new Function), so it can never drift from a hand-copied mirror.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

// Pull the exact shipped fmtCount() body out of the inline script.
const m = html.match(/function fmtCount\(v\)\s*\{[\s\S]*?\n    \}/);
assert.ok(m, 'could not locate fmtCount() in growth/index.html');
const fmtCount = new Function('v', m[0].replace(/^function fmtCount\(v\)\s*\{/, '').replace(/\}\s*$/, ''));

// The OLD, buggy per-callsite formatter — for the inline RED proof.
const oldFmt = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1000) + 'K');

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  try { assert.equal(got, want, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};

// ---- RED proof: the old formatter flashes "1000K" instead of rolling to "1.0M" ----
eq(oldFmt(999500), '1000K', 'RED proof: old fmt renders 999,500 as "1000K"');
eq(oldFmt(999999), '1000K', 'RED proof: old fmt renders 999,999 as "1000K"');
assert.notEqual(oldFmt(999999), '1.0M', 'RED proof: old fmt does NOT roll over to 1.0M');

// ---- THE FIX: 999.5K–999.99K rolls over to "1.0M" ----
eq(fmtCount(999500), '1.0M', 'lower edge of the rollover band → 1.0M');
eq(fmtCount(999999), '1.0M', 'upper edge of the rollover band → 1.0M');
eq(fmtCount(999949), '1.0M', 'rounds to 1000K (999.949K) → 1.0M');
eq(fmtCount(999499), '999K', 'one below the band rounds to 999K (stays K)');
eq(fmtCount(1000000), '1.0M', 'exact 1M → 1.0M (M branch)');

// ---- The reachable interpolated sweep: 910K → 1.21M never shows "1000K" ----
// Mirrors the running-value lerp across the JH month-50→52 climb; assert the
// formatter never emits the bug string anywhere in the band.
for (let v = 995000; v <= 1005000; v += 137) {
  const out = fmtCount(v);
  if (out === '1000K') { fail++; console.error('  ✗ interpolated sweep flashed "1000K" @', v); }
}
pass++; // sweep clean

// ---- NO REGRESSION: every value outside the rollover band is byte-identical to old fmt ----
const sample = [
  0, 1, 999, 1000, 1499, 1500, 2500, 55000, 95000, 487000, 572000, 925000, 999000, 999499,
  // M tier (real data peaks for this page): byte-identical, no rollover band hit at integers
  1000000, 1060000, 1210000, 1490000, 2000000, 3900000, 6800000, 7640000,
];
for (const v of sample) {
  eq(fmtCount(v), oldFmt(v), `outside the band byte-identical to old fmt @ ${v}`);
}

// ---- tier-shape sanity (labels a creator actually sees) ----
eq(fmtCount(55000), '55K', 'mid-K → rounded K');
eq(fmtCount(925000), '925K', '2nd-channel peak (Search Party) → 925K, no spurious rollover');
eq(fmtCount(7640000), '7.6M', 'JH final value → 7.6M');
eq(fmtCount(1060000), '1.1M', 'JH month-51 interpolated point → 1.1M');

console.log(`fmt-count: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
