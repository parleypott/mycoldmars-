// Verifier lock for burma-essays loadEssaysCache() — guards the offline
// cold-start library read ('burma:list') against a non-array localStorage value
// (JSON.parse type-confusion class, sibling of offlineIds a4f3d4e).
// EXTRACTS the real shipped loadEssaysCache from index.html at runtime (can't drift).
//
// The cache feeds the module-level `essays` array on an offline cold-start (the
// fetch-failure catch in load()). A non-array there crashes the real consumers:
// openSwitcher() does essays.map(...), removeEssay() essays.filter(...),
// re-voice/duration essays.find(...)/essays.findIndex(...). All throw on a non-array.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Pull the exact shipped one-liner: `const loadEssaysCache = () => { ... };`
const m = html.match(/const loadEssaysCache = \(\) => \{[\s\S]*?\};/);
assert(m, 'could not locate loadEssaysCache in index.html');
const src = m[0];

// Materialize the real function over an injected localStorage holding a chosen
// raw value for the 'burma:list' key.
function makeLoad(raw) {
  const store = raw === undefined ? {} : { 'burma:list': raw };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  // eslint-disable-next-line no-new-func
  return new Function('localStorage', `${src} return loadEssaysCache;`)(localStorage);
}

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('✗', name, '\n   ', e.message); } };

// --- RED proof: reconstruct the OLD verbatim read and show it crashes the real consumers ---
function oldRead(raw) {
  const store = raw === undefined ? {} : { 'burma:list': raw };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  // the pre-fix body: essays = JSON.parse(... || '[]') verbatim (catch -> [])
  return new Function('localStorage',
    `let essays = []; try { essays = JSON.parse(localStorage.getItem('burma:list') || '[]'); } catch { essays = []; } return essays;`
  )(localStorage);
}
t('RED proof: old read returns a non-array (object) and openSwitcher essays.map() crashes', () => {
  const old = oldRead('{}');
  assert(!Array.isArray(old), 'old should return the non-array verbatim');
  assert.throws(() => old.map((e) => e), TypeError, 'essays.map must crash under old code');
});
t('RED proof: old read on literal "null" crashes essays.find() (re-voice path)', () => {
  const old = oldRead('null');
  assert.throws(() => old.find((e) => e.id === 'x'), 'null.find must crash under old code');
});
t('RED proof: old read on number crashes essays.filter() (removeEssay path)', () => {
  const old = oldRead('5');
  assert.throws(() => old.filter((e) => e), TypeError, 'number.filter must crash under old code');
});

// --- FIX: every degenerate store degrades to [] (array-safe) ---
for (const [raw, label] of [
  ['{}', 'object'], ['{"a":1}', 'populated object'],
  ['5', 'number'], ['0', 'zero'], ['true', 'boolean'],
  ['"abc"', 'string'], ['null', 'literal null'],
]) {
  t(`fix: non-array store (${label}) -> []`, () => {
    const v = makeLoad(raw)();
    assert(Array.isArray(v), 'must be an array');
    assert.strictEqual(v.length, 0, 'must be empty');
  });
}
t('fix: malformed JSON -> []', () => {
  const v = makeLoad('{not json')();
  assert(Array.isArray(v) && v.length === 0);
});
t('fix: absent key -> []', () => {
  const v = makeLoad(undefined)();
  assert(Array.isArray(v) && v.length === 0);
});

// --- NO REGRESSION: a real essays array passes through verbatim ---
t('no-regression: real essay array preserved verbatim + order + fields', () => {
  const v = makeLoad('[{"id":"a","title":"One"},{"id":"b","title":"Two"}]')();
  assert.deepStrictEqual(v, [{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }]);
});
t('no-regression: empty array preserved', () => {
  assert.deepStrictEqual(makeLoad('[]')(), []);
});
t('no-regression: single essay preserved', () => {
  assert.deepStrictEqual(makeLoad('[{"id":"x42"}]')(), [{ id: 'x42' }]);
});

// --- INVARIANT: loadEssaysCache() is ALWAYS map/filter/find/findIndex-safe ---
t('invariant: result is always array-consumer-safe across hostile inputs', () => {
  for (const raw of ['{}', '5', '0', 'true', 'null', '"x"', '{not json', '[{"id":1}]', '[]', undefined]) {
    const v = makeLoad(raw)();
    assert.doesNotThrow(() => v.map((e) => e), `map() must not throw for raw=${raw}`);
    assert.doesNotThrow(() => v.filter((e) => e), `filter() must not throw for raw=${raw}`);
    assert.doesNotThrow(() => v.find((e) => e && e.id === 'z'), `find() must not throw for raw=${raw}`);
    assert.doesNotThrow(() => v.findIndex((e) => e && e.id === 'z'), `findIndex() must not throw for raw=${raw}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
