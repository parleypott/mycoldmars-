// Tests for parseMoney() — the MANUAL-ENTRY money parser in
// public/westchester/index.html. It feeds pin.askingPrice (every asking-price
// input field on Johnny's ACTIVE house hunt) plus the tax override, and its
// output drives the entire money panel (mortgage, closing, all-in monthly).
//
// BUG (this fix): parseMoney only tested str.endsWith('m'/'k'). After spaces
// are stripped, "2.5 million" becomes "2.5million" — which ends in 'n', not
// 'm' — so it fell through to plain parseFloat and returned 2.5: a $2.50 price
// for a $2,500,000 house, a silent 1,000,000x error. The paste-IMPORTER's
// parseListingPrice already accepts "million"/"mil"/"thousand" (see
// westchester-price.test.mjs); manual entry was the divergent-weaker twin.
//
// Extracts the ACTUAL shipped arrow function from index.html at runtime
// (regex grab + new Function) so the test can't drift from a hand-copied mirror.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

const m = HTML.match(/const parseMoney = s => \{[\s\S]*?\n\};/);
if (!m) throw new Error('could not locate parseMoney in index.html');
const { parseMoney } = new Function(m[0] + '\nreturn { parseMoney };')();

// The OLD (buggy) parser, for the RED proof.
const oldParseMoney = s => {
  if (s == null) return 0;
  const str = String(s).toLowerCase().trim().replace(/[\$,\s]/g, '');
  if (!str) return 0;
  let mult = 1, core = str;
  if (str.endsWith('m')) { mult = 1000000; core = str.slice(0, -1); }
  else if (str.endsWith('k')) { mult = 1000; core = str.slice(0, -1); }
  const n = parseFloat(core);
  return isNaN(n) ? 0 : n * mult;
};

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`  ✗ ${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); }
}
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

// ── RED proof: the old parser genuinely mis-prices spelled-out shorthand ──────
eq('RED: old prices "2.5 million" at 2.5', oldParseMoney('2.5 million'), 2.5);
eq('RED: old prices "$2.5 million" at 2.5', oldParseMoney('$2.5 million'), 2.5);
eq('RED: old prices "950 thousand" at 950', oldParseMoney('950 thousand'), 950);
ok('RED proof would have failed pre-fix (old !== new for "2.5 million")',
   oldParseMoney('2.5 million') !== parseMoney('2.5 million'));

// ── The fix: spelled-out suffixes ────────────────────────────────────────────
eq('"2.5 million" → 2,500,000', parseMoney('2.5 million'), 2500000);
eq('"$2.5 million" → 2,500,000', parseMoney('$2.5 million'), 2500000);
eq('"2.5 mil" → 2,500,000', parseMoney('2.5 mil'), 2500000);
eq('"3 million" → 3,000,000', parseMoney('3 million'), 3000000);
eq('"950 thousand" → 950,000', parseMoney('950 thousand'), 950000);
eq('"1.5MILLION" (caps) → 1,500,000', parseMoney('1.5MILLION'), 1500000);

// ── Documented/plain forms stay byte-identical to the old parser ─────────────
for (const v of ['$255,000', '255000', '250k', '1.5m', '1.5M', '$1,500,000',
                 '0', '', '   ', 'abc', '$0', '950K', '2.5M', '$2.5M', '12000']) {
  eq(`byte-identical: ${JSON.stringify(v)}`, parseMoney(v), oldParseMoney(v));
}

// ── Spot-check the documented forms resolve to the right money ───────────────
eq('"$255,000" → 255000', parseMoney('$255,000'), 255000);
eq('"250k" → 250000', parseMoney('250k'), 250000);
eq('"1.5m" → 1,500,000', parseMoney('1.5m'), 1500000);
eq('garbage "abc" → 0', parseMoney('abc'), 0);
eq('empty → 0', parseMoney(''), 0);
eq('null → 0', parseMoney(null), 0);

console.log(`\nwestchester-parsemoney: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
