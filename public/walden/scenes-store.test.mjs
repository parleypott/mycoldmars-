// Verifier-layer lock for walden's scenes() saved-scenario store reader.
//
// BUG (latent, established JSON.parse(localStorage) type-confusion class, object-shaped variant):
// scenes() read SCENES verbatim. A corrupt/legacy/tampered store holding the literal 'null'
// → JSON.parse('null') === null → restoreScenes()'s `Object.keys(scenes())` THROWS at PAGE LOAD
// (restoreScenes runs at init, line 441), crashing the whole Walden landscape studio with no
// recovery; sc-save/sc-load/sc-del (`o[n]` / `Object.keys(o).length`) crash too. A corrupt
// ARRAY store ('[1,2]') doesn't crash but mis-renders index strings as scenario names.
// FIX: scenes() now guarantees a plain object (non-object/array/null → {}). Byte-identical for a
// real object → zero regression; only a corrupt store changes (crash/garbage → {}).
//
// This test EXTRACTS the real shipped scenes() from index.html at runtime (can't drift from a mirror).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'index.html');
const html = readFileSync(HTML_PATH, 'utf8');

// --- extract the shipped scenes() body by name (brace-match) ---
function extractFn(src, decl) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(`could not find ${decl}`);
  // find the opening brace of the function body
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces for ${decl}`);
}

// Build a fresh scenes() bound to a mock localStorage + the SCENES const, from the REAL source.
function makeScenes(storeValue) {
  const fnSrc = extractFn(html, 'function scenes(');
  const ls = {
    _v: storeValue,
    getItem(k) { return k === 'SCENES_KEY' ? this._v : null; },
  };
  // SCENES const value is irrelevant to the logic; bind it so getItem matches.
  const factory = new Function('localStorage', 'SCENES', `${fnSrc}; return scenes;`);
  return factory(ls, 'SCENES_KEY');
}

// Reconstruct the OLD buggy scenes() (verbatim return) for RED proofs.
function makeOldScenes(storeValue) {
  const ls = { getItem() { return storeValue; } };
  return function scenes() { try { return JSON.parse(ls.getItem('SCENES') || '{}'); } catch (_) { return {}; } };
}

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A === B) { pass++; } else { fail++; console.error(`FAIL: ${msg}\n  expected ${B}\n  got      ${A}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };
const noThrow = (fn, msg) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL: ${msg} — threw ${e.message}`); } };
const doesThrow = (fn, msg) => { try { fn(); fail++; console.error(`FAIL: ${msg} — did NOT throw`); } catch { pass++; } };

// ---------- inline RED proof: the OLD reader crashes Object.keys at page load ----------
{
  const oldNull = makeOldScenes('null');
  ok(oldNull() === null, 'RED proof: old scenes() returns null on a literal-null store');
  doesThrow(() => Object.keys(oldNull()), 'RED proof: old scenes() → Object.keys(null) THROWS (the restoreScenes page-load crash)');

  // the FIXED reader defuses it
  const fixedNull = makeScenes('null');
  eq(fixedNull(), {}, 'fixed: literal-null store → {}');
  noThrow(() => Object.keys(fixedNull()), 'fixed: Object.keys(scenes()) never throws on a null store');
}

// ---------- the fix: every corrupt shape → {} (object-guaranteed) ----------
for (const [store, label] of [
  ['null', 'literal null'],
  ['5', 'number'],
  ['0', 'zero'],
  ['true', 'boolean'],
  ['"x"', 'string'],
  ['[1,2,3]', 'array'],
  ['[]', 'empty array'],
  ['{bad', 'malformed json'],
]) {
  const s = makeScenes(store);
  eq(s(), {}, `corrupt store (${label}) → {}`);
  // the consumer ops the studio actually runs must never throw on a corrupt store
  noThrow(() => Object.keys(s()), `Object.keys(scenes()) safe on ${label}`);
  noThrow(() => Object.keys(s()).length, `Object.keys(scenes()).length safe on ${label}`);
  noThrow(() => { const o = s(); o['x'] = 1; }, `scenes()[key]=v safe on ${label}`);
  noThrow(() => Object.assign(s(), {}), `Object.assign(scenes(),...) safe on ${label}`);
}

// absent / empty store → {} (the common first-run path)
eq(makeScenes(null)(), {}, 'absent store → {}');
eq(makeScenes('')(), {}, 'empty store → {}');
eq(makeScenes('{}')(), {}, 'empty-object store → {}');

// ---------- no-regression: a real saved-scenarios object passes through verbatim ----------
{
  const real = { 'scheme 1': { elements: [{ k: 'tree', x: 1 }] }, 'scheme 2': { elements: [] } };
  const s = makeScenes(JSON.stringify(real));
  eq(s(), real, 'real scenarios object preserved verbatim');
  ok(Object.keys(s()).length === 2, 'real scenarios: key count preserved');
  ok(s()['scheme 1'].elements[0].k === 'tree', 'real scenarios: nested contents preserved');
  // restoreScenes() option-render shape works on real data
  noThrow(() => Object.keys(s()).map(x => `<option>${x}</option>`).join(''), 'restoreScenes render works on real data');
}

// ---------- invariant: scenes() is ALWAYS a plain object across hostile inputs ----------
{
  const hostile = ['null', '5', '0', 'true', 'false', '"x"', '[1,2]', '[]', '{bad', '', '{"a":1}'];
  let allObj = true;
  for (const h of hostile) {
    const v = makeScenes(h)();
    if (!(v && typeof v === 'object' && !Array.isArray(v))) { allObj = false; break; }
  }
  ok(allObj, 'invariant: scenes() always returns a plain (non-array) object');
}

console.log(`\nscenes-store.test.mjs: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
