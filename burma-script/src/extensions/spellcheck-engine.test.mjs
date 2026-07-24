import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import nspell from 'nspell';
import { loadPersonalDict, addToPersonalDictStore } from './spellcheck-core.js';

// spellcheck-engine.js itself imports the dictionary via `?raw` (a vite-only query), so it can't be
// imported under bun directly. This suite exercises the SAME engine contract against the REAL
// Hunspell dictionary loaded from disk: build nspell, seed the personal dict, and verify the three
// behaviors the menu depends on — misspelled detection, ranked suggestions, and "add to dictionary"
// making a name stop flagging live. If nspell's or dictionary-en's suggestion shape ever regresses,
// this catches it. Mirrors the getSpeller / isMisspelled / suggestions / addToPersonalDict logic.

let pass = 0;
function ok(label, fn) { fn(); pass++; }

// Resolve dictionary-en's aff/dic from node_modules (the same package spellcheck-engine.js ?raw's).
const require = createRequire(import.meta.url);
const dictDir = dirname(require.resolve('dictionary-en/package.json'));
const affRaw = readFileSync(join(dictDir, 'index.aff'), 'utf8');
const dicRaw = readFileSync(join(dictDir, 'index.dic'), 'utf8');

function installStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
  return map;
}

// Reconstruct the engine singleton exactly as spellcheck-engine.js does.
function buildEngine() {
  const speller = nspell(affRaw, dicRaw);
  for (const w of loadPersonalDict()) { try { speller.add(w); } catch {} }
  return {
    isMisspelled: (w) => !speller.correct(w),
    suggestions: (w) => speller.suggest(w).slice(0, 5),
    addToPersonalDict: (w) => { addToPersonalDictStore(w); speller.add(w); },
  };
}

ok('isMisspelled: flags a misspelling, clears a correct word', () => {
  installStorage();
  const e = buildEngine();
  assert.equal(e.isMisspelled('mediterreanean'), true);
  assert.equal(e.isMisspelled('Mediterranean'), false);
  assert.equal(e.isMisspelled('sea'), false);
});

ok('suggestions: ranks the right fix first and caps at 5', () => {
  installStorage();
  const e = buildEngine();
  const s = e.suggestions('mediterreanean');
  assert.ok(s.length >= 1 && s.length <= 5, `got ${s.length}`);
  assert.equal(s[0], 'Mediterranean');
  // Cap holds even for a word with many near-neighbors.
  const s2 = e.suggestions('wron');
  assert.ok(s2.length <= 5, `expected <=5, got ${s2.length}`);
});

ok('personal dict: an unknown NAME flags, then "add to dictionary" clears it live + persists', () => {
  const map = installStorage();
  const e = buildEngine();
  assert.equal(e.isMisspelled('Moharem'), true); // Johnny's name flags before adding
  e.addToPersonalDict('Moharem');
  assert.equal(e.isMisspelled('Moharem'), false); // stops flagging without a reload
  // Persisted under the namespaced key so a fresh engine also treats it as correct.
  assert.deepEqual(JSON.parse(map.get('wp01_spell_dict_v1')), ['Moharem']);
  const e2 = buildEngine(); // new session seeds from the persisted personal dict
  assert.equal(e2.isMisspelled('Moharem'), false);
});

console.log(`spellcheck-engine.test.mjs: ${pass} assertions passed`);
