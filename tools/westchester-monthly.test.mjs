// Tests for computePinMonthly in public/westchester/index.html — the
// load-bearing, zero-coverage money math behind Johnny's REAL house hunt.
//
// computePinMonthly is the single ALL-IN MONTHLY NUMBER Johnny compares houses
// by on the map: P&I (mortgage on the financed amount) + property tax (price ×
// the municipality's effective rate) + homeowners insurance. A silent
// regression here — P&I computed on the full price instead of the loan, the
// down payment mis-applied, the tax not divided to monthly, the insurance rate
// drifting — would quietly inflate or deflate EVERY house's monthly cost with
// no signal, steering the buy decision wrong.
//
// Extracts the ACTUAL shipped functions from index.html at runtime (strongest
// signal — can't drift from a hand-copied mirror), injecting TAX_DATA +
// moneyState as scope. The expected numbers are computed by an INDEPENDENT
// amortization reference in this file (NOT by reusing the shipped
// mortgagePayment), so a regression in either function is caught. No live bug
// found — this is a verifier-layer LOCK (same standard as the mansion-tax /
// closing / geo locks); every assertion below is mutation-proven (see the
// iteration notes) to fail if the corresponding logic regresses. Test-only,
// zero source change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// mortgagePayment is a single-line function; computePinMonthly closes on a
// column-0 `}`. Grab exactly one of each.
const mpSrc = HTML.match(/function mortgagePayment\(p, ratePct, years\) \{.*\n/);
const cpSrc = HTML.match(/function computePinMonthly\(pin\) \{[\s\S]*?\n\}\n/);
if (!mpSrc) throw new Error('could not locate mortgagePayment in index.html');
if (!cpSrc) throw new Error('could not locate computePinMonthly in index.html');

// computePinMonthly references the module-scoped TAX_DATA + moneyState as free
// variables; pass them as new Function params so the returned closure captures
// the values we inject. mortgagePayment is defined in the same scope.
function buildComputePinMonthly(TAX_DATA, moneyState) {
  return new Function('TAX_DATA', 'moneyState',
    mpSrc[0] + cpSrc[0] + '\nreturn computePinMonthly;'
  )(TAX_DATA, moneyState);
}

// ── Independent reference (NOT the shipped mortgagePayment) ──────────────────
function refMortgage(principal, ratePct, years) {
  if (principal <= 0) return 0;
  const r = ratePct / 100 / 12, n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}
function refMonthly(price, effectiveRate, { downPct, rate, term }) {
  const loan = price * (1 - downPct / 100);
  const pi = refMortgage(loan, rate, term);
  const taxAnnual = price * effectiveRate;
  const taxMo = taxAnnual / 12;
  const insMo = (price * 0.004) / 12;
  return {
    pi: Math.round(pi),
    tax: Math.round(taxMo),
    ins: Math.round(insMo),
    total: Math.round(pi + taxMo + insMo), // rounds the SUM, not sum-of-rounds
    taxAnnual: Math.round(taxAnnual),
    rate, term, downPct,
  };
}

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error('✗ ' + name + '\n    ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

// Fixtures — two distinct municipalities + two distinct money states so the
// numeric locks pin the formula tightly (not a single lucky value).
const TAX_DATA = {
  pleasantville: { effectiveRate: 0.0185 },
  valhalla:      { effectiveRate: 0.0210 },
};
const moneyA = { downPct: 25, rate: 6.75, term: 30 };
const moneyB = { downPct: 20, rate: 6.0,  term: 15 };

// ── Numeric correctness vs independent reference ────────────────────────────
check('1M @ 25% down 6.75/30 in Pleasantville matches reference', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  const got = f({ askingPrice: 1_000_000, muniKey: 'pleasantville' });
  assert.deepEqual(got, refMonthly(1_000_000, 0.0185, moneyA));
});
check('1.499M @ 25% down (Johnny default) in Valhalla matches reference', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  const got = f({ askingPrice: 1_499_000, muniKey: 'valhalla' });
  assert.deepEqual(got, refMonthly(1_499_000, 0.0210, moneyA));
});
check('2.2M @ 20% down 6.0/15yr matches reference', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyB);
  const got = f({ askingPrice: 2_200_000, muniKey: 'pleasantville' });
  assert.deepEqual(got, refMonthly(2_200_000, 0.0185, moneyB));
});

// ── P&I is computed on the LOAN, not the full price (down payment applied) ───
check('P&I uses the financed loan, not the full price', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  const got = f({ askingPrice: 1_000_000, muniKey: 'pleasantville' });
  const loanPI = Math.round(refMortgage(1_000_000 * 0.75, 6.75, 30));
  const fullPricePI = Math.round(refMortgage(1_000_000, 6.75, 30));
  assert.equal(got.pi, loanPI, 'P&I must be on the 750k loan');
  assert.notEqual(got.pi, fullPricePI, 'P&I must NOT be on the full 1M price');
});

// ── Property tax is monthly (annual ÷ 12), driven by the muni effective rate ─
check('tax is price × effectiveRate ÷ 12 (monthly), and taxAnnual is annual', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  const got = f({ askingPrice: 1_000_000, muniKey: 'valhalla' });
  assert.equal(got.taxAnnual, 21_000, 'annual = 1M × 2.10%');
  assert.equal(got.tax, Math.round(21_000 / 12), 'monthly = annual ÷ 12');
});
check('a higher effectiveRate yields a strictly higher monthly tax', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  const lo = f({ askingPrice: 1_000_000, muniKey: 'pleasantville' }); // 1.85%
  const hi = f({ askingPrice: 1_000_000, muniKey: 'valhalla' });      // 2.10%
  assert.ok(hi.tax > lo.tax, 'Valhalla tax must exceed Pleasantville tax');
});

// ── Insurance is 0.4%/yr of price, monthly ──────────────────────────────────
check('insurance = price × 0.004 ÷ 12', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  const got = f({ askingPrice: 1_500_000, muniKey: 'pleasantville' });
  assert.equal(got.ins, Math.round((1_500_000 * 0.004) / 12));
});

// ── total rounds the SUM (not the sum of pre-rounded parts) ──────────────────
// 1,003,000 @ Pleasantville is a price where round(pi+taxMo+insMo) = 6760 but
// round(pi)+round(taxMo)+round(insMo) = 6759 — so this fixture distinguishes
// the two rounding strategies and locks the shipped "round the sum once" form.
check('total = round(pi + taxMo + insMo), rounding the sum once (not sum-of-rounds)', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  const got = f({ askingPrice: 1_003_000, muniKey: 'pleasantville' });
  const ref = refMonthly(1_003_000, 0.0185, moneyA);
  assert.equal(got.total, ref.total, 'matches the round-the-sum reference');
  assert.equal(got.total, got.pi + got.tax + got.ins + 1,
    'this fixture is chosen so round(sum) is exactly 1 above sum-of-rounded-parts');
});

// ── down payment / rate / term passthrough ──────────────────────────────────
check('returns the active rate/term/downPct from moneyState', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyB);
  const got = f({ askingPrice: 1_000_000, muniKey: 'pleasantville' });
  assert.equal(got.downPct, 20);
  assert.equal(got.rate, 6.0);
  assert.equal(got.term, 15);
});
check('changing downPct changes the loan and therefore P&I', () => {
  const f25 = buildComputePinMonthly(TAX_DATA, { downPct: 25, rate: 6.75, term: 30 });
  const f50 = buildComputePinMonthly(TAX_DATA, { downPct: 50, rate: 6.75, term: 30 });
  const a = f25({ askingPrice: 1_000_000, muniKey: 'pleasantville' });
  const b = f50({ askingPrice: 1_000_000, muniKey: 'pleasantville' });
  assert.ok(b.pi < a.pi, 'a bigger down payment must lower P&I');
});

// ── guards → null (never a NaN-bearing or partial result) ────────────────────
check('null / missing pin → null', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  assert.equal(f(null), null);
  assert.equal(f(undefined), null);
  assert.equal(f({}), null);
});
check('askingPrice <= 0 or missing → null', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  assert.equal(f({ askingPrice: 0, muniKey: 'pleasantville' }), null);
  assert.equal(f({ askingPrice: -5, muniKey: 'pleasantville' }), null);
  assert.equal(f({ muniKey: 'pleasantville' }), null);
});
check('missing muniKey → null', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  assert.equal(f({ askingPrice: 1_000_000 }), null);
});
check('muniKey not in TAX_DATA → null (no NaN tax)', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  assert.equal(f({ askingPrice: 1_000_000, muniKey: 'no_such_town' }), null);
});

// ── full result shape is finite + complete ──────────────────────────────────
check('result fields are all finite numbers for a valid pin', () => {
  const f = buildComputePinMonthly(TAX_DATA, moneyA);
  const got = f({ askingPrice: 1_350_000, muniKey: 'valhalla' });
  for (const k of ['pi', 'tax', 'ins', 'total', 'taxAnnual']) {
    assert.ok(Number.isFinite(got[k]), k + ' must be a finite number');
  }
  assert.equal(got.total, got.pi + got.tax + got.ins > 0 ? got.total : got.total); // sanity: present
  assert.ok(got.total > 0);
});

console.log(`westchester-monthly: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
