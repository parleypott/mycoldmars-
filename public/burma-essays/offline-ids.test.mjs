// Verifier lock for burma-essays offlineIds() — guards the offline-store read
// against a non-array localStorage value (JSON.parse type-confusion class).
// EXTRACTS the real shipped offlineIds from index.html at runtime (can't drift).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Pull the exact shipped one-liner: `const offlineIds = () => { ... };`
const m = html.match(/const offlineIds = \(\) => \{[\s\S]*?\};/);
assert(m, 'could not locate offlineIds in index.html');
const src = m[0];

// Build a factory that materializes the real function over an injected
// localStorage holding a chosen raw value for the 'burma:offline' key.
function makeOfflineIds(raw) {
  const store = raw === undefined ? {} : { 'burma:offline': raw };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  // eslint-disable-next-line no-new-func
  return new Function('localStorage', `${src} return offlineIds;`)(localStorage);
}

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('✗', name, '\n   ', e.message); } };

// --- RED proof: reconstruct the OLD verbatim-return and show it crashes consumers ---
function oldOfflineIds(raw) {
  const store = raw === undefined ? {} : { 'burma:offline': raw };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  // the pre-fix body: returns JSON.parse(... || '[]') verbatim
  return new Function('localStorage',
    `const f = () => { try { return JSON.parse(localStorage.getItem('burma:offline') || '[]'); } catch { return []; } }; return f;`
  )(localStorage)();
}
t('RED proof: old offlineIds returns a non-array (object) and .includes() crashes', () => {
  const old = oldOfflineIds('{}');
  assert(!Array.isArray(old), 'old should return the non-array verbatim');
  assert.throws(() => old.includes('x'), TypeError, 'isOffline().includes must crash under old code');
});
t('RED proof: old offlineIds on literal "null" crashes isOffline().includes', () => {
  const old = oldOfflineIds('null');
  assert.throws(() => old.includes('x'), 'null.includes must crash under old code');
});
t('RED proof: old offlineIds on number breaks new Set(...) (setOfflineId path)', () => {
  const old = oldOfflineIds('5');
  assert.throws(() => new Set(old), TypeError, 'new Set(number) must crash under old code');
});

// --- FIX: every degenerate store degrades to [] (array-safe) ---
for (const [raw, label] of [
  ['{}', 'object'], ['{"a":1}', 'populated object'],
  ['5', 'number'], ['0', 'zero'], ['true', 'boolean'],
  ['"abc"', 'string'], ['null', 'literal null'],
]) {
  t(`fix: non-array store (${label}) -> []`, () => {
    const v = makeOfflineIds(raw)();
    assert(Array.isArray(v), 'must be an array');
    assert.strictEqual(v.length, 0, 'must be empty');
  });
}
t('fix: malformed JSON -> []', () => {
  const v = makeOfflineIds('{not json')();
  assert(Array.isArray(v) && v.length === 0);
});
t('fix: absent key -> []', () => {
  const v = makeOfflineIds(undefined)();
  assert(Array.isArray(v) && v.length === 0);
});

// --- NO REGRESSION: a real array passes through verbatim ---
t('no-regression: real id array preserved verbatim + order', () => {
  const v = makeOfflineIds('["a","b","c"]')();
  assert.deepStrictEqual(v, ['a', 'b', 'c']);
});
t('no-regression: empty array preserved', () => {
  assert.deepStrictEqual(makeOfflineIds('[]')(), []);
});
t('no-regression: single id preserved', () => {
  assert.deepStrictEqual(makeOfflineIds('["x42"]')(), ['x42']);
});

// --- INVARIANT: offlineIds() is ALWAYS .includes/.Set-safe across hostile inputs ---
t('invariant: result is always array-consumer-safe (isOffline + setOfflineId never throw)', () => {
  for (const raw of ['{}', '5', '0', 'true', 'null', '"x"', '{not json', '[1,2]', '[]', undefined]) {
    const v = makeOfflineIds(raw)();
    assert.doesNotThrow(() => v.includes('id'), `includes() must not throw for raw=${raw}`);
    assert.doesNotThrow(() => new Set(v), `new Set() must not throw for raw=${raw}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
