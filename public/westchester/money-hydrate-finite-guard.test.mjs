// Locks the FINITENESS guard on the Westchester House Hunter money-state hydrate
// (public/westchester/index.html → hydrateMoneyState).
//
// The money panel hydrates `moneyState` from localStorage ('whh:money:v1') at boot.
// Every moneyState value is a number (buyPrice, downPct, rate, term, …). The per-key
// merge guard used to be:
//     if (snap[k] != null && typeof snap[k] === typeof moneyState[k]) moneyState[k] = snap[k];
// That `typeof === 'number'` check ACCEPTS Infinity — and JSON.parse turns an
// out-of-range literal like `1e999` (a corrupt / legacy / hand-tampered store) into
// Infinity. A non-finite `rate` then poisons the ENTIRE panel: mortgagePayment returns
// NaN on every derived line, and the rate field renders "Infinity%". The fix additionally
// requires Number.isFinite for numeric fields; it's byte-identical for every real number.
//
// We assert against the SHIPPED index.html (tracks live code) and mutation-prove the guard
// is load-bearing by executing the sliced predicate on a poisoned snapshot.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

// --- Slice the shipped hydrate merge loop verbatim ---
const block = html.match(/Object\.keys\(moneyState\)\.forEach\(k => \{[\s\S]*?\}\);/);
assert.ok(block, 'could not find the hydrateMoneyState merge loop');
const src = block[0];

// Pull out the single `if (...) moneyState[k] = snap[k];` condition so we can EXECUTE it.
const cond = src.match(/if \(([\s\S]*?)\) moneyState\[k\] = snap\[k\];/);
assert.ok(cond, 'could not find the per-key merge guard condition');
// Build a pure predicate: does this (snap[k], default) pass the shipped guard?
// eslint-disable-next-line no-new-func
const accepts = new Function('snap', 'moneyState', 'k',
  `return (${cond[1]});`);

const acc = (val, def) => Boolean(accepts({ x: val }, { x: def }, 'x'));

// --- Source-level lock: the finiteness check must be present ---
ok('guard requires Number.isFinite for numeric fields', () => {
  assert.match(src, /Number\.isFinite\(snap\[k\]\)/,
    'the merge guard must require Number.isFinite for numeric values');
});

// --- Behavioral / mutation-proof locks (execute the sliced predicate) ---
ok('accepts a real finite number (byte-identical happy path)', () => {
  assert.equal(acc(6.75, 6.75), true, 'a normal rate must still hydrate');
  assert.equal(acc(1499000, 1499000), true, 'a normal price must still hydrate');
  assert.equal(acc(0, 25), true, 'an explicit 0 must still hydrate (finite)');
  assert.equal(acc(-5000, 10000), true, 'a negative finite value still hydrates (type/finite ok)');
});

ok('REJECTS a non-finite number (the poison the old typeof check waved through)', () => {
  // This is the load-bearing case: dropping `&& (typeof … !== 'number' || Number.isFinite(…))`
  // makes acc(Infinity, …) return true again — turning this RED.
  assert.equal(acc(Infinity, 6.75), false, 'Infinity (from JSON.parse 1e999) must be rejected');
  assert.equal(acc(-Infinity, 6.75), false, '-Infinity must be rejected');
  assert.equal(acc(NaN, 6.75), false, 'NaN must be rejected');
});

ok('still rejects a type mismatch (unchanged behavior)', () => {
  assert.equal(acc('6.75', 6.75), false, 'a string in a numeric field is rejected');
  assert.equal(acc(null, 6.75), false, 'null is rejected (snap[k] != null)');
});

// Independent proof the poison is real end-to-end: Infinity slips typeof, kills the payment.
ok('poison is real: Infinity is typeof number and NaNs mortgagePayment', () => {
  const fromJson = JSON.parse('{"rate":1e999}').rate;
  assert.equal(typeof fromJson, 'number');
  assert.equal(Number.isFinite(fromJson), false);
  const mortgagePayment = (p, ratePct, years) => {
    if (p <= 0) return 0; const r = ratePct / 100 / 12, n = years * 12;
    if (n <= 0) return 0; if (r === 0) return p / n;
    return p * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  };
  assert.ok(Number.isNaN(mortgagePayment(1124250, fromJson, 30)),
    'a non-finite rate NaNs the monthly payment — exactly what the guard now prevents');
});

console.log(`\nmoney-hydrate-finite-guard: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
