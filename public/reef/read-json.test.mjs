// Verifier-layer test for the reef EXPORTER's corrupt-store guard (export.js `readJSON`).
//
// readJSON is the type-matching localStorage reader that feeds the exporter its
// two saved stores: the kill-list (deleted frames) and the per-frame framing map.
// It is load-bearing precisely because its two consumers CRASH on the wrong type:
//   • `new Set(readJSON(KILL_STORE, []))`     — throws (TypeError) on a non-array.
//   • `readJSON(FRAMING_STORE, {})` then obj[key] — silently misreads a non-object.
// So a corrupt / legacy / tampered localStorage value (a bare string, a number,
// an object where an array is expected, or vice-versa) must degrade to the
// fallback, never propagate. This is the loop's #1 vein (corrupt-store guards),
// and export.js had ZERO coverage on it.
//
// The real function is extracted VERBATIM from export.js (same technique as
// export-crop.test.mjs) and driven with a localStorage stub — no DOM, no import
// of the canvas-coupled ESM module. Mutants below prove every branch is load-bearing.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const here = new URL('.', import.meta.url);
const exportSrc = readFileSync(new URL('./export.js', here), 'utf8');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };

// --- extract the REAL readJSON from export.js -------------------------------------
const readJSONSrc = exportSrc.match(/function readJSON\([\s\S]*?\n\}/);
assert.ok(readJSONSrc, 'could not find readJSON in export.js');

// Build the real function with an injected localStorage stub.
function makeStore(map) {
  return { getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null) };
}
function buildReal(map) {
  return new Function('localStorage', `${readJSONSrc[0]}\nreturn readJSON;`)(makeStore(map));
}

// ===================================================================================
// CONTRACT
// ===================================================================================

// --- array fallback: only a real array survives; everything else → [] --------------
{
  const rj = buildReal({
    good: '["a.png","b.png"]',
    obj:  '{"x":1}',
    str:  '"nope"',
    num:  '42',
    lit:  'null',
    bad:  '{oops',          // unparseable JSON
  });
  eq(rj('good', []), ['a.png', 'b.png'], 'valid array passes through');
  eq(rj('obj',  []), [], 'object coerces to array fallback');
  eq(rj('str',  []), [], 'string coerces to array fallback');
  eq(rj('num',  []), [], 'number coerces to array fallback');
  eq(rj('lit',  []), [], 'JSON null coerces to array fallback');
  eq(rj('bad',  []), [], 'unparseable value coerces to array fallback');
  eq(rj('missing', []), [], 'missing key → array fallback (getItem null → JSON.parse("") throws)');
  // The load-bearing reason: this result is fed to new Set(...).
  assert.doesNotThrow(() => new Set(rj('obj', [])), 'array-guarded result is Set-safe');
  passed++;
}

// --- object fallback: only a real (non-array) object survives → {} otherwise --------
{
  const rj = buildReal({
    good: '{"a.png":{"s":1.5}}',
    arr:  '[1,2,3]',
    str:  '"nope"',
    num:  '7',
    lit:  'null',
    bad:  'not json',
  });
  eq(rj('good', {}), { 'a.png': { s: 1.5 } }, 'valid object passes through');
  eq(rj('arr',  {}), {}, 'array coerces to object fallback (array is NOT a valid framing map)');
  eq(rj('str',  {}), {}, 'string coerces to object fallback');
  eq(rj('num',  {}), {}, 'number coerces to object fallback');
  eq(rj('lit',  {}), {}, 'JSON null coerces to object fallback');
  eq(rj('bad',  {}), {}, 'unparseable value coerces to object fallback');
  eq(rj('missing', {}), {}, 'missing key → object fallback');
}

// --- primitive fallback: parsed value wins, null/absent → fallback -----------------
{
  const rj = buildReal({ n: '5', s: '"hi"', z: '0', f: 'false', lit: 'null' });
  eq(rj('n', 1), 5, 'primitive number passes through');
  eq(rj('s', 'x'), 'hi', 'primitive string passes through');
  eq(rj('z', 1), 0, 'falsy 0 passes through (?? not ||)');
  eq(rj('f', true), false, 'falsy false passes through (?? not ||)');
  eq(rj('lit', 'fb'), 'fb', 'JSON null → fallback via ??');
  eq(rj('missing', 'fb'), 'fb', 'missing key → fallback');
}

// ===================================================================================
// MUTATION PROOF — each mutant must break at least one contract above.
// ===================================================================================
function buildMutant(body, map) {
  return new Function('localStorage', `${body}\nreturn readJSON;`)(makeStore(map));
}

// Mutant A: drop the array type-check → an object leaks through as the kill store,
// and `new Set(object)` throws — the exact crash this guard prevents.
{
  const mutant = readJSONSrc[0].replace(
    'if (Array.isArray(fallback)) return Array.isArray(v) ? v : fallback;',
    'if (Array.isArray(fallback)) return v;',
  );
  assert.notEqual(mutant, readJSONSrc[0], 'mutant A must differ');
  const rj = buildMutant(mutant, { obj: '{"x":1}' });
  const leaked = rj('obj', []);
  assert.throws(() => new Set(leaked), 'mutant A leaks a non-array → Set throws (contract catches it)');
  passed++;
}

// Mutant B: drop the object type-check → an array leaks in as the framing map.
{
  const mutant = readJSONSrc[0].replace(
    '(v && typeof v === \'object\' && !Array.isArray(v)) ? v : fallback',
    'v',
  );
  assert.notEqual(mutant, readJSONSrc[0], 'mutant B must differ');
  const rj = buildMutant(mutant, { arr: '[1,2,3]' });
  assert.ok(Array.isArray(rj('arr', {})), 'mutant B leaks an array where an object is required');
  passed++;
}

// Mutant C: swap ?? for || → falsy 0 / false get clobbered to the fallback.
{
  const mutant = readJSONSrc[0].replace('return v ?? fallback;', 'return v || fallback;');
  assert.notEqual(mutant, readJSONSrc[0], 'mutant C must differ');
  const rj = buildMutant(mutant, { z: '0' });
  assert.equal(rj('z', 99), 99, 'mutant C clobbers falsy 0 to fallback (contract keeps the 0)');
  passed++;
}

console.log(`reef read-json: ${passed} assertions passed`);
