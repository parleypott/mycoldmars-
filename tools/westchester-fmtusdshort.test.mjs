// Tests for fmtUSDshort in public/westchester/index.html — the abbreviated
// money formatter ("$1.2M" / "$840K") behind Johnny's REAL house hunt.
//
// fmtUSDshort renders the financed LOAN amount in the money panel's status line
// (`'Loan ' + fmtUSDshort(loan) + ' · LTV ...'`), which sweeps continuously as
// Johnny drags the down-payment slider on a listing. The function decided the
// M-vs-K tier on the RAW value (`a >= 1e6`) but rendered the K tier with
// `Math.round(a/1000)` — so any amount in [999,500, 999,999] failed the 1e6
// test, fell to the K branch, and rounded to 1000 → "$1000K" instead of "$1.0M".
// That band is squarely reachable: a ~$1.25M Westchester house (his range) at
// ~20% down puts the loan there, and the value sweeps through it live as the
// down-payment slider moves. Same "1000K" rollover class fixed this week in the
// views-growth + growth chart formatters.
//
// The fix rolls the K tier over to the M branch when Math.round(a/1000) hits
// 1000, so 999,500–999,999 renders "$1M" (correct to 2 sig figs). Byte-identical
// for every value OUTSIDE the band, so zero regression.
//
// Extracts the ACTUAL shipped fmtUSD + fmtUSDshort from index.html at runtime
// (strongest signal — can't drift from a hand-copied mirror). Test-only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// fmtUSD is single-line; fmtUSDshort is the multi-line arrow ending on `};`.
const fmtUSDsrc = HTML.match(/const fmtUSD = n => \{.*?\};/);
const fmtUSDshortSrc = HTML.match(/const fmtUSDshort = n => \{[\s\S]*?\n\};/);
if (!fmtUSDsrc) throw new Error('could not locate fmtUSD in index.html');
if (!fmtUSDshortSrc) throw new Error('could not locate fmtUSDshort in index.html');

// Build the REAL shipped fmtUSDshort (it closes over fmtUSD in the same scope).
function buildFmtUSDshort() {
  return new Function(`${fmtUSDsrc[0]}\n${fmtUSDshortSrc[0]}\nreturn fmtUSDshort;`)();
}
const fmtUSDshort = buildFmtUSDshort();

// Independent reference (NOT the shipped code) that anyone agrees is correct:
// the M-vs-K choice must be made on the ROUNDED thousands, so 999.5K rolls to
// "$1M", not "$1000K".
function refShort(n) {
  const a = Math.abs(n);
  const sign = n < 0 ? '-$' : '$';
  if (a >= 1000) {
    const k = Math.round(a / 1000);
    if (k >= 1000) return sign + (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e6) return sign + (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    return sign + k + 'K';
  }
  const v = Math.round(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
}

let pass = 0, fail = 0;
const check = (label, got, want) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

// ── INLINE RED PROOF: the OLD logic flashed "$1000K" in the rollover band ──
const oldShort = (() => {
  const fmtUSD = n => { const v = Math.round(n); return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US'); };
  return n => {
    const a = Math.abs(n);
    if (a >= 1e6) return (n < 0 ? '-$' : '$') + (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1000) return (n < 0 ? '-$' : '$') + Math.round(a / 1000) + 'K';
    return fmtUSD(n);
  };
})();
check('RED proof: old code rolls to $1000K at 999900', oldShort(999900), '$1000K');
check('RED proof: shipped code does NOT', fmtUSDshort(999900) !== '$1000K', true);

// ── THE FIX: the rollover band renders as M, never "$1000K" ──
check('999500 → $1M', fmtUSDshort(999500), '$1M');
check('999600 (≈$1.25M house @ 20% down loan) → $1M', fmtUSDshort(999600), '$1M');
check('999900 → $1M', fmtUSDshort(999900), '$1M');
check('999999 → $1M', fmtUSDshort(999999), '$1M');
// No "1000K" anywhere across the whole band, and never a 4-digit-K render.
for (let a = 999000; a <= 1000000; a += 17) {
  const out = fmtUSDshort(a);
  check(`no $1000K flash at ${a}`, /1000K|[0-9]{4,}K/.test(out), false);
}

// ── NO REGRESSION: byte-identical to the independent reference across the range ──
for (const a of [0, 1, 50, 500, 999, 1000, 1001, 1499, 1500, 12500, 45000, 250000,
                 840000, 999000, 999499, 1000001, 1250000, 2400000, 3950000, 12000000]) {
  check(`ref-match @ ${a}`, fmtUSDshort(a), refShort(a));
  check(`ref-match @ -${a}`, fmtUSDshort(-a), refShort(-a));
}

// ── boundary detail locks ──
check('999499 stays $999K (below band)', fmtUSDshort(999499), '$999K');
check('1000000 → $1M', fmtUSDshort(1000000), '$1M');
check('1000001 → $1M (toFixed strips trailing zeros)', fmtUSDshort(1000001), '$1M');
check('1500000 → $1.5M', fmtUSDshort(1500000), '$1.5M');
check('840000 → $840K', fmtUSDshort(840000), '$840K');
check('999 → $999 (under 1000, full form)', fmtUSDshort(999), '$999');
check('negative loan -999900 → -$1M', fmtUSDshort(-999900), '-$1M');
check('negative 840000 → -$840K', fmtUSDshort(-840000), '-$840K');

console.log(`\nfmtUSDshort: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
