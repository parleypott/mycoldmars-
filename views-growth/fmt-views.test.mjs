// views-growth — fmtViews() view-count formatter coverage.
//
// THE BUG (fixed): the K branch did `Math.round(v/1000) + 'K'`, so any view count in
// 999,500–999,999 rounded to 1000 and rendered "1000K" instead of rolling over to "1.0M".
// fmtViews drives the animated running-value label, the y-axis ticks, AND the tooltips, and
// the chart animates each channel climbing from 0 to its peak (up to ~61M in this page's data),
// so the running label PASSES THROUGH that band on the way up — flashing "1000K" mid-climb on a
// growth chart a filmmaker may screen-record. Same boundary-rollover class the loop has fixed
// repeatedly (the hour-drop formatters). The fix rolls 999.5K–999.99K over to "1.0M"; the M and
// B branches are byte-identical, so every other value is unchanged.
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

console.log(`fmt-views: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
