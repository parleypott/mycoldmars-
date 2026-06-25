// views-growth — fmtViews() view-count formatter coverage.
//
// THE BUG (fixed): the K branch did `Math.round(v/1000) + 'K'`, so any view count in
// 999,500–999,999 rounded to 1000 and rendered "1000K" instead of rolling over to "1.0M".
// fmtViews drives the animated running-value label, the y-axis ticks, AND the tooltips, and
// the chart animates each channel climbing from 0 to its peak (up to ~61M in this page's data),
// so the running label PASSES THROUGH that band on the way up — flashing "1000K" mid-climb on a
// growth chart a filmmaker may screen-record. Same boundary-rollover class the loop has fixed
// repeatedly (the hour-drop formatters). The fix rolls 999.5K–999.99K over to "1.0M".
//
// THE SECOND BUG (this iteration): the SAME rollover lived one tier up. The M branch did a bare
// (v/1e6).toFixed(1)+'M', so any view count in 999,950,000–999,999,999 rounded to "1000.0M"
// instead of rolling over to "1.0B" — exactly the "1000K" class, just at the M→B boundary. The
// chart animates cumulative views (a filmmaker's channel totals run into the billions) climbing
// from 0 to peak, so the running label PASSES THROUGH that window mid-climb. The fix promotes the
// "1000.0M" rollover to "1.0B". Every value outside [999.95M, 1B) is unchanged.
//
// This test EXTRACTS the REAL shipped fmtViews from views-growth/index.html at runtime
// (new Function), so it can never drift from a hand-copied mirror.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

// Pull the exact shipped fmtViews() body out of the inline script.
const m = html.match(/function fmtViews\(v\)\s*\{[\s\S]*?\n    \}/);
assert.ok(m, 'could not locate fmtViews() in views-growth/index.html');
const fmtViews = new Function('v', m[0].replace(/^function fmtViews\(v\)\s*\{/, '').replace(/\}\s*$/, ''));

// The OLD, buggy K branch — for the inline RED proof.
const oldFmt = (v) => {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return Math.round(v / 1000) + 'K';
  return Math.round(v).toString();
};

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  try { assert.equal(got, want, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};

// ---- RED proof: the old K branch flashes "1000K" instead of rolling to "1.0M" ----
eq(oldFmt(999500), '1000K', 'RED proof: old fmt renders 999,500 as "1000K"');
eq(oldFmt(999999), '1000K', 'RED proof: old fmt renders 999,999 as "1000K"');
assert.notEqual(oldFmt(999999), '1.0M', 'RED proof: old fmt does NOT roll over to 1.0M');

// ---- THE FIX: 999.5K–999.99K rolls over to "1.0M" ----
eq(fmtViews(999500), '1.0M', 'lower edge of the rollover band → 1.0M');
eq(fmtViews(999999), '1.0M', 'upper edge of the rollover band → 1.0M');
eq(fmtViews(999949), '1.0M', 'rounds to 1000K (999.949K) → 1.0M');
eq(fmtViews(999499), '999K', 'one below the band rounds to 999K (stays K)');
eq(fmtViews(1000000), '1.0M', 'exact 1M → 1.0M (M branch)');

// ---- THE M→B FIX: 999.95M–999.99M rolls over to "1.0B", never "1000.0M" ----
// oldFmt (above) reproduces the pre-fix M branch verbatim, so it doubles as the RED proof.
eq(oldFmt(999950000), '1000.0M', 'RED proof: old M branch renders 999,950,000 as "1000.0M"');
eq(oldFmt(999999999), '1000.0M', 'RED proof: old M branch renders 999,999,999 as "1000.0M"');
assert.notEqual(oldFmt(999999999), '1.0B', 'RED proof: old M branch does NOT roll over to 1.0B');
eq(fmtViews(999950000), '1.0B', 'lower edge of the M→B rollover window → 1.0B');
eq(fmtViews(999999999), '1.0B', 'upper edge of the M→B rollover window → 1.0B');
eq(fmtViews(999949999), '999.9M', 'one below the window stays "999.9M" (no rollover)');
eq(fmtViews(999000000), '999.0M', 'mid-999M stays "999.0M"');
eq(fmtViews(1000000000), '1.0B', 'exact 1B → 1.0B (B branch, unchanged)');
eq(fmtViews(1500000000), '1.5B', '1.5B → 1.5B (B branch, unchanged)');

// ---- NO REGRESSION: every value outside the rollover band is byte-identical to the old fmt ----
const sample = [
  0, 1, 12, 500, 999, 1000, 1499, 1500, 2500, 47000, 47200, 999000, 999499,
  // M tier (real data peaks): byte-identical, no rollover band reached at this page's scale
  1000000, 1049999, 1050000, 1500000, 24521382, 47708507, 61106789,
  // B tier
  1e9, 2.4e9,
];
for (const v of sample) {
  eq(fmtViews(v), oldFmt(v), `outside the band byte-identical to old fmt @ ${v}`);
}

// ---- tier-shape sanity (the labels a creator actually sees on the chart) ----
eq(fmtViews(0), '0', 'zero → "0"');
eq(fmtViews(999), '999', 'sub-1K → integer');
eq(fmtViews(47200), '47K', 'mid-K → rounded K');
eq(fmtViews(24521382), '24.5M', 'real peak data point → M with one decimal');
eq(fmtViews(61106789), '61.1M', 'top channel peak → 61.1M');
eq(fmtViews(2.4e9), '2.4B', 'B tier');

// ---- AXIS-TICK LOCK ----------------------------------------------------------
// The comment above ("fmtViews drives ... the y-axis ticks") was ASPIRATIONAL when
// first written: the y-axis tick callback was actually a DIVERGENT inline copy that
// used Math.round(v/1e6)+'M' — collapsing a 1.0M tick and a 1.25M tick to the SAME
// "1M" label, rounding 1.5M UP to a phantom "2M" past the real max, and STILL
// flashing "1000K" (the very rollover this file locks for the running label). The
// y.max is animated (lerp'd) up to the real peak, so non-round intermediate ticks
// in those bands are reachable mid-animation. The fix routes the axis through
// fmtViews. These assertions lock that.

// The OLD, buggy axis formatter — inline RED proof of what was shipping.
const oldAxis = (v) => {
  if (v === 0) return '0';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return Math.round(v / 1e6) + 'M';
  if (v >= 1e3) return Math.round(v / 1000) + 'K';
  return String(v);
};
eq(oldAxis(1e6), '1M', 'RED proof: old axis labels 1.0M tick "1M"');
eq(oldAxis(1.25e6), '1M', 'RED proof: old axis ALSO labels 1.25M tick "1M" (duplicate)');
eq(oldAxis(1.5e6), '2M', 'RED proof: old axis rounds 1.5M tick up to phantom "2M"');
eq(oldAxis(999600), '1000K', 'RED proof: old axis still flashes "1000K"');
eq(oldAxis(1e6) === oldAxis(1.25e6), true, 'RED proof: old axis collapses 1.0M and 1.25M to one label');

// GREEN: fmtViews (the formatter the axis now uses) keeps those ticks distinct + clean.
eq(fmtViews(1.25e6), '1.3M', '1.25M tick is a DISTINCT "1.3M", not a duplicate "1M"');
eq(fmtViews(1.5e6), '1.5M', '1.5M tick is "1.5M", no phantom "2M"');
assert.notEqual(fmtViews(1e6), fmtViews(1.25e6), '1.0M and 1.25M ticks differ');
eq(fmtViews(999600), '1.0M', '999.6K tick rolls to "1.0M", never "1000K"');

// LOCK the fix in the HTML: axis callback routes through fmtViews; no divergent copy survives.
eq(/callback:\s*function\(v\)\s*\{\s*return fmtViews\(v\);\s*\}/.test(html), true,
  'y-axis tick callback routes through fmtViews(v)');
eq(/return\s+Math\.round\(v\s*\/\s*1e6\)/.test(html), false,
  'no surviving "return Math.round(v/1e6)" divergent axis copy in the HTML');

console.log(`fmt-views: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
