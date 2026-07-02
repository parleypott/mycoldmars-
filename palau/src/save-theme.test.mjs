// Mutation-lock for the crash-safe theme persist (the Private-Browsing throw that
// silently broke the Palau vibes button — setItem ran before map.setStyle, so a
// QuotaExceededError aborted the whole click and the theme never applied).
//
// The load-bearing assertion: a store whose setItem THROWS must be swallowed
// (return false, never propagate). Neuter the try/catch in save-theme.js and this
// file goes RED — proving the guard is what keeps the throw from escaping.
import { saveTheme } from './save-theme.js';
import assert from 'node:assert';

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// Healthy store: persists the value and reports success.
t('healthy store persists + returns true', () => {
  const bag = {};
  const store = { setItem: (k, v) => { bag[k] = v; } };
  assert.strictEqual(saveTheme(store, 'palau-theme', 'noir'), true);
  assert.strictEqual(bag['palau-theme'], 'noir');
});

// LOAD-BEARING: a throwing store must NOT propagate — returns false, no throw.
t('throwing store is swallowed (returns false, does not throw)', () => {
  const store = { setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); } };
  let ret;
  assert.doesNotThrow(() => { ret = saveTheme(store, 'palau-theme', 'noir'); });
  assert.strictEqual(ret, false);
});

// Proof the raw form (what shipped) DOES throw — so the guard is essential, not cosmetic.
t('raw setItem on a throwing store would throw (guard is essential)', () => {
  const store = { setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); } };
  assert.throws(() => store.setItem('palau-theme', 'noir'));
});

// Value is passed through verbatim (no coercion surprises on theme names).
t('passes value through unchanged', () => {
  let seen;
  const store = { setItem: (_k, v) => { seen = v; } };
  saveTheme(store, 'palau-theme', 'sunrise');
  assert.strictEqual(seen, 'sunrise');
});

console.log(`save-theme: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
