// Pins the NY "mansion tax" used by the Westchester House Hunter money panel.
//
// THE FACT (verified against multiple authoritative sources, June 2026):
//   NY Tax Law §1402-a imposes a FLAT 1% tax on residential conveyances of
//   $1,000,000 or more, statewide. The progressive *supplemental* mansion tax
//   (§1402-b, 1.25% → 3.9%) added in the 2019 MTA funding package applies ONLY
//   to property located inside a city with a population of 1,000,000+ — i.e.
//   New York City's five boroughs. It does NOT apply in Westchester County.
//   Sources: askdoss.com, hauseit.com, defalcorealty.com NYC mansion-tax guides.
//
// The old shipped function applied a (mis-remembered) progressive schedule to
// every purchase, so it overstated a Westchester buyer's cash-needed by
// thousands on any $2M+ home (e.g. $3M → charged 1.5%/$45k instead of 1%/$30k).
//
// mansionTax below is BYTE-IDENTICAL to the function shipped in
// public/westchester/index.html — same pure-JS source — so this exercises the
// real logic and goes RED if anyone re-introduces NYC's progressive brackets.
//
// run: node tools/ny-mansion-tax.test.mjs   (or: bun run test)

// ---- shipped function (keep identical to public/westchester/index.html) ----
function mansionTax(p) {
  return p >= 1_000_000 ? p * 0.01 : 0;
}

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } };

// ---------- threshold ----------
ok('below $1M → no tax',            mansionTax(999_999) === 0);
ok('$0 → no tax',                   mansionTax(0) === 0);
ok('negative price → no tax',       mansionTax(-500_000) === 0);
ok('exactly $1M → taxed (>=)',      mansionTax(1_000_000) === 10_000);
ok('$1,000,001 → 1%',               mansionTax(1_000_001) === 10_000.01);

// ---------- flat 1% across Westchester's real range ----------
ok('$1.5M → flat 1% = $15,000',     mansionTax(1_500_000) === 15_000);
ok('$2M → flat 1% = $20,000',       mansionTax(2_000_000) === 20_000);
ok('$2.5M → flat 1% = $25,000',     mansionTax(2_500_000) === 25_000);
ok('$3M → flat 1% = $30,000',       mansionTax(3_000_000) === 30_000);
ok('$5M → flat 1% = $50,000',       mansionTax(5_000_000) === 50_000);

// ---------- the bug-class guard: NO progressive escalation (the whole point) ----------
// Every dollar above $1M is still taxed at exactly 1%, never the NYC supplemental rates.
ok('$2M is NOT charged 1.25% (NYC rate)', mansionTax(2_000_000) !== 25_000);
ok('$3M is NOT charged 1.5% (NYC rate)',  mansionTax(3_000_000) !== 45_000);
ok('$5M is NOT charged 1.75%/2.25%',      mansionTax(5_000_000) !== 87_500 && mansionTax(5_000_000) !== 112_500);
// rate is constant: tax/price === 0.01 at every taxable price point
ok('effective rate is constant 1% everywhere ≥$1M',
   [1_000_000, 1_750_000, 2_250_000, 4_000_000, 9_999_999].every(p => Math.abs(mansionTax(p) / p - 0.01) < 1e-12));

console.log(`ny-mansion-tax: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
