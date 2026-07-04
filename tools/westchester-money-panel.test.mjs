// Locks the Westchester House Hunter MONEY-PANEL AGGREGATION — the arithmetic in
// moneyRecalc() that decides whether Johnny can actually afford the Pleasantville
// house. The primitives are locked elsewhere (mansionTax → ny-mansion-tax.test.mjs;
// computeNYClosing + mortgagePayment → westchester-closing.test.mjs; computePinMonthly
// → its own lock). What was NEVER covered is the SUM: how down payment + mansion tax +
// NY closing + moving roll up into "cash needed", how that nets against the bridge cash
// (invPulled + bizPulled) into the covered/short gap, and how VA-sale proceeds
// (two properties, net of payoff + realtor + repairs) net against cash needed into the
// final cash. That aggregation is the real-money decision output Johnny reads.
//
// Rather than copy moneyRecalc's formulas (which would drift), this test EXTRACTS and
// RUNS THE ACTUAL shipped moneyRecalc from public/westchester/index.html, with the DOM
// stubbed and setVal() instrumented to capture the raw numeric values it emits. So it
// exercises the real code path: change any formula in moneyRecalc and the captured
// numbers move, turning these assertions RED. Zero source change — test-only.
//
// run: node tools/westchester-money-panel.test.mjs   (or: bun run test)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// Extract a top-level function by name. Tries the single-line form first (moneyRecalc's
// one-liner deps like mortgagePayment close with ` }` on the same line), then the
// multi-line form that closes on a column-0 `}` (moneyRecalc, computeNYClosing, mansionTax).
function extractFn(name) {
  let m = HTML.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[^\\n]*?\\}\\n'));
  if (m) return m[0];
  m = HTML.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n'));
  if (m) return m[0];
  throw new Error('could not locate ' + name + ' in index.html');
}

// Build a harness that runs the REAL moneyRecalc against a supplied moneyState, with the
// DOM + formatters stubbed and setVal instrumented to record every (id, raw value, kind).
const runMoneyRecalc = new Function('state', `
  const captured = {};
  function setVal(id, val, kind){ captured[id] = { val, kind }; }
  const fmtUSD = () => '';
  const fmtUSDshort = () => '';
  const document = { getElementById: () => ({}) };
  const moneyState = state;
  ${extractFn('mansionTax')}
  ${extractFn('computeNYClosing')}
  ${extractFn('mortgagePayment')}
  ${extractFn('moneyRecalc')}
  moneyRecalc();
  return { captured, nyClosing: moneyState.nyClosing };
`);

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } };

// ---- Scenario A: SHORT — bridge cash does not cover the Day-1 close ----
// $2.0M buy, 20% down → $400K down, $1.6M loan.
//   mansion tax  = 1% of $2M                         = $20,000
//   NY closing   = title 9,000 + MRT 16,800 + fixed 6,500 + escrow 8,000 = $40,300
//   moving       = $15,000
//   cash needed  = 400,000 + 20,000 + 40,300 + 15,000 = $475,300
//   bridge cash  = invPulled 300,000 + bizPulled 100,000 = $400,000  → SHORT by $75,300
// VA side (6% combined sell rate):
//   main:   1,800,000 − 600,000 payoff − 108,000 sell − 20,000 repairs = 1,072,000
//   studio:   500,000 − 150,000 payoff −  30,000 sell − 10,000 repairs =   310,000
//   VA net = 1,382,000  → final cash = 1,382,000 − 475,300 = 906,700
{
  const s = {
    vaSellPct: 6, vaSale: 1_800_000, vaPayoff: 600_000, vaRepairs: 20_000,
    studioSale: 500_000, studioPayoff: 150_000, studioRepairs: 10_000,
    buyPrice: 2_000_000, downPct: 20, moving: 15_000,
    invPulled: 300_000, bizPulled: 100_000,
    rate: 6.5, term: 30, propTax: 40_000, nyClosing: 0,
  };
  const { captured, nyClosing } = runMoneyRecalc(s);
  ok('A down payment = $400,000',            captured['o-down'].val === 400_000);
  ok('A mansion tax = $20,000',              captured['o-mansion'].val === 20_000);
  ok('A NY closing total = $40,300',         nyClosing === 40_300 && captured['o-nyclose'].val === 40_300);
  ok('A cash needed = $475,300',             captured['o-needed'].val === 475_300);
  ok('A bridge cash available = $400,000',   captured['o-have'].val === 400_000);
  ok('A gap magnitude = $75,300',            captured['o-gap'].val === 75_300);
  ok('A gap flagged SHORT (not covered)',    captured['o-gap'].kind === 'short');
  ok('A VA net (both properties) = $1,382,000', captured['o-vanet'].val === 1_382_000);
  ok('A bridge repay = bridge cash = $400,000', captured['o-repay'].val === 400_000);
  ok('A final cash = $906,700',              captured['o-final'].val === 906_700);
  ok('A final cash styled positive',         captured['o-final'].kind === 'in-total');
}

// ---- Scenario B: COVERED — bridge cash exceeds the Day-1 close (sign flip) ----
// Same buy, but pull more bridge cash so cash-available > cash-needed. Locks the
// covered/short flip AND that o-gap always reports a MAGNITUDE (Math.abs), never a
// negative "cushion" number.
{
  const s = {
    vaSellPct: 6, vaSale: 1_800_000, vaPayoff: 600_000, vaRepairs: 20_000,
    studioSale: 500_000, studioPayoff: 150_000, studioRepairs: 10_000,
    buyPrice: 2_000_000, downPct: 20, moving: 15_000,
    invPulled: 400_000, bizPulled: 100_000, // 500,000 available vs 475,300 needed → covered by 24,700
    rate: 6.5, term: 30, propTax: 40_000, nyClosing: 0,
  };
  const { captured } = runMoneyRecalc(s);
  ok('B cash needed unchanged = $475,300',   captured['o-needed'].val === 475_300);
  ok('B bridge cash available = $500,000',   captured['o-have'].val === 500_000);
  ok('B gap magnitude = $24,700 (cushion)',  captured['o-gap'].val === 24_700);
  ok('B gap flagged COVERED',                captured['o-gap'].kind === 'covered');
  ok('B final cash = $906,700 (unchanged)',  captured['o-final'].val === 906_700);
}

// ---- Scenario C: sub-$1M buy → NO mansion tax (threshold guard in the aggregate) ----
// $900K buy, 20% down → $180K down, $720K loan, mansion tax = $0 (below $1M).
//   NY closing = title 4,050 + MRT 7,560 + fixed 6,500 + escrow 3,600 = $21,710
//   cash needed = 180,000 + 0 + 21,710 + 15,000 = $216,710
{
  const s = {
    vaSellPct: 6, vaSale: 0, vaPayoff: 0, vaRepairs: 0,
    studioSale: 0, studioPayoff: 0, studioRepairs: 0,
    buyPrice: 900_000, downPct: 20, moving: 15_000,
    invPulled: 0, bizPulled: 0,
    rate: 6.5, term: 30, propTax: 18_000, nyClosing: 0,
  };
  const { captured, nyClosing } = runMoneyRecalc(s);
  ok('C mansion tax = $0 below $1M',         captured['o-mansion'].val === 0);
  ok('C NY closing total = $21,710',         nyClosing === 21_710);
  ok('C cash needed = $216,710',             captured['o-needed'].val === 216_710);
  ok('C no VA sales → VA net = $0',          captured['o-vanet'].val === 0);
  ok('C final cash = −$216,710',             captured['o-final'].val === -216_710);
  ok('C final cash styled negative',         captured['o-final'].kind === 'out-total');
}

console.log(`westchester-money-panel: ${pass} passed, ${fail} failed`);
assert.equal(fail, 0, 'money-panel aggregation assertions must all pass');
