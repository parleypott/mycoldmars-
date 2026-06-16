// Pins the NY closing-cost + mortgage math used by the Westchester House Hunter
// money panel — the OTHER half of "cash needed to buy" beyond the mansion tax
// (locked separately in ny-mansion-tax.test.mjs).
//
// THE FACTS (verified against authoritative 2026 sources, June 2026):
//   * Westchester buyer-paid mortgage recording tax is a FLAT 1.05% of the loan,
//     with NO $500K step. The full county MRT is 1.30% (basic 0.50% + NY State
//     additional 0.25% + MCTD additional 0.30%); the lender pays the 0.25%
//     "special additional" tax on residential, so the borrower pays 1.05%.
//     The 0.30% MCTD additional applies to ALL loan sizes here — the per-$500K
//     escalation is a NYC-only feature and must NOT be modeled in Westchester.
//     Sources: hauseit.com (Westchester MRT calculator), defalcorealty.com,
//     Westchester County Clerk land-records fee schedule.
//   * Owner+lender title insurance ≈ 0.45% of price (NY TIRSA approximation).
//   * Escrow reserve ≈ 0.40% of price (~2 mo tax + ~2 mo homeowners insurance).
//
// computeNYClosing + mortgagePayment below are BYTE-IDENTICAL to the functions
// shipped in public/westchester/index.html, so this exercises the real money
// logic and goes RED if anyone re-introduces a NYC-style >$500K MRT bracket,
// drops the cash-purchase discount, or breaks the amortization formula.
//
// run: node tools/westchester-closing.test.mjs   (or: bun run test)

// ---- shipped functions (keep identical to public/westchester/index.html) ----
function mortgagePayment(p, ratePct, years) { if (p <= 0) return 0; const r = ratePct/100/12, n = years*12; if (r === 0) return p/n; return p * (r * Math.pow(1+r,n)) / (Math.pow(1+r,n) - 1); }

function computeNYClosing(purchasePrice, loanAmount) {
  if (purchasePrice <= 0) return { titleIns: 0, mortRecTax: 0, fixed: 0, escrow: 0, total: 0 };
  const titleIns = purchasePrice * 0.0045;          // combined owner + simultaneous lender, NY TIRSA ≈ 0.45%
  const mortRecTax = loanAmount > 0 ? loanAmount * 0.0105 : 0;
  const fixed = loanAmount > 0 ? 6500 : 4000;        // attorney + bank + appraisal + survey + title search + recording
  const escrow = loanAmount > 0 ? purchasePrice * 0.004 : 0;  // ~2 months tax + ~2 months homeowners insurance
  return {
    titleIns: Math.round(titleIns),
    mortRecTax: Math.round(mortRecTax),
    fixed: Math.round(fixed),
    escrow: Math.round(escrow),
    total: Math.round(titleIns + mortRecTax + fixed + escrow)
  };
}

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } };
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

// ---------- computeNYClosing: financed purchase, Westchester real range ----------
// $2.0M home, 20% down -> $1.6M loan
{
  const c = computeNYClosing(2_000_000, 1_600_000);
  ok('$2M/$1.6M titleIns = 0.45% = $9,000',       c.titleIns === 9_000);
  ok('$2M/$1.6M MRT = flat 1.05% = $16,800',      c.mortRecTax === 16_800);
  ok('$2M/$1.6M fixed (financed) = $6,500',       c.fixed === 6_500);
  ok('$2M/$1.6M escrow = 0.40% = $8,000',         c.escrow === 8_000);
  ok('$2M/$1.6M total = $40,300',                 c.total === 40_300);
}
// $3.0M home, 20% down -> $2.4M loan
{
  const c = computeNYClosing(3_000_000, 2_400_000);
  ok('$3M/$2.4M titleIns = $13,500',              c.titleIns === 13_500);
  ok('$3M/$2.4M MRT = 1.05% = $25,200',           c.mortRecTax === 25_200);
  ok('$3M/$2.4M total = $57,200',                 c.total === 57_200);
}

// ---------- the bug-class guard: NO per-$500K MRT escalation (NYC-only) ----------
// Doubling the loan exactly doubles the MRT — the rate is constant 1.05%, never stepped.
{
  const small = computeNYClosing(1_200_000, 600_000).mortRecTax;   // 600k * 1.05% = 6,300
  const big   = computeNYClosing(2_400_000, 1_200_000).mortRecTax; // 1.2M * 1.05% = 12,600
  ok('MRT on $600k loan = $6,300',                small === 6_300);
  ok('MRT on $1.2M loan = $12,600',               big === 12_600);
  ok('MRT scales linearly (no $500K bracket)',    big === small * 2);
  ok('MRT effective rate is constant 1.05%',
     [400_000, 600_000, 900_000, 1_500_000, 2_500_000]
       .every(l => Math.abs(computeNYClosing(l * 2, l).mortRecTax / l - 0.0105) < 1e-9));
}

// ---------- cash purchase: no loan -> no MRT/escrow, lower fixed ----------
{
  const c = computeNYClosing(2_000_000, 0);
  ok('cash buy: no mortgage recording tax',       c.mortRecTax === 0);
  ok('cash buy: no escrow reserve',               c.escrow === 0);
  ok('cash buy: fixed drops to $4,000',           c.fixed === 4_000);
  ok('cash buy: titleIns still 0.45% = $9,000',   c.titleIns === 9_000);
  ok('cash buy: total = $13,000',                 c.total === 13_000);
}

// ---------- edge: zero / negative price -> all zeros, no NaN ----------
{
  const z = computeNYClosing(0, 0);
  ok('price 0 -> all-zero result',                z.total === 0 && z.titleIns === 0 && z.mortRecTax === 0);
  const n = computeNYClosing(-500_000, 0);
  ok('negative price -> all-zero result',         n.total === 0);
}

// ---------- mortgagePayment: standard amortization ----------
// $1,600,000 at 6.5% / 30yr -> known monthly P&I ≈ $10,112.35
ok('$1.6M @ 6.5%/30yr P&I ≈ $10,112.35',          near(mortgagePayment(1_600_000, 6.5, 30), 10_112.35, 1));
// $1,000,000 at 6.0% / 30yr -> ≈ $5,995.51
ok('$1.0M @ 6.0%/30yr P&I ≈ $5,995.51',           near(mortgagePayment(1_000_000, 6.0, 30), 5_995.51, 1));
// 15-yr term is a higher payment than 30-yr at the same rate
ok('15yr payment > 30yr payment (same rate)',     mortgagePayment(1_000_000, 6.0, 15) > mortgagePayment(1_000_000, 6.0, 30));
// 0% rate -> straight principal / months
ok('0% rate -> principal/months',                 near(mortgagePayment(1_200_000, 0, 30), 1_200_000 / 360, 1e-6));
// no loan -> no payment
ok('loan <= 0 -> $0 payment',                     mortgagePayment(0, 6.5, 30) === 0 && mortgagePayment(-100, 6.5, 30) === 0);

console.log(`westchester-closing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
