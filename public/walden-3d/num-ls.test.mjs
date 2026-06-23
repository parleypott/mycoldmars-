// Verifier-layer test for the Walden-3d studio numeric-localStorage guard (numLS).
//
// THE BUG (numeric-coercion-of-localStorage class, same as laserspace readHiScore):
// studio.html read its persisted numeric settings as `+(localStorage.getItem(k)||N)`:
//   plan2dRot = +(getItem('walden-2d-rot')||0)
//   sbStruct  = +(getItem('walden-sb-struct')||25), sbPool = +(getItem('walden-sb-pool')||15)
// The `||N` guards only an ABSENT store (getItem -> null). A corrupt/legacy/tampered
// PRESENT value ("abc") is TRUTHY, so it survives the `||` and `+("abc")` -> NaN. A NaN
// setback has real teeth on Johnny's plan:
//   (1) insetPolygon(PARCEL_EN, NaN) -> all-NaN coords -> the GREEN buildable-setback
//       zone renders broken/invisible.
//   (2) `bad = ev < req - 0.05` with req=NaN is ALWAYS false -> every element silently
//       shows "✓ to line", DISABLING every setback-violation warning (wrong "all clear").
// numLS(key,fallback) guarantees a finite number: absent/corrupt -> fallback, clean
// stored number -> that number (byte-identical for the only thing the sliders ever write).
//
// The test EXTRACTS the real shipped numLS + insetPolygon/lineInt from studio.html at
// runtime (brace-match + new Function), so it can't drift from a mirror. Mutation-proven.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./studio.html', import.meta.url), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `could not find function ${name} in studio.html`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

function mockLS(store) {
  return { getItem: (k) => (k in store ? store[k] : null) };
}

// numLS references the global `localStorage`; pass a mock in as a same-named param.
function loadNumLS(source = html) {
  const src = extractFn(source, 'numLS');
  return new Function('localStorage', src + '\nreturn numLS;');
}
const buildNumLS = (store, source = html) => loadNumLS(source)(mockLS(store));

function loadInset(source = html) {
  const lineIntSrc = extractFn(source, 'lineInt');
  const insetSrc = extractFn(source, 'insetPolygon');
  return new Function(lineIntSrc + '\n' + insetSrc + '\nreturn insetPolygon;')();
}
const insetPolygon = loadInset();
const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

// ---------- inline RED proof: the OLD read produces NaN on a corrupt store ----------
check('RED-proof: old `+(getItem(k)||N)` yields NaN on a corrupt value; numLS does not', () => {
  const store = { 'walden-sb-struct': 'abc' };
  const oldRead = +((store['walden-sb-struct']) || 25);   // reconstruct the old expression
  assert.ok(Number.isNaN(oldRead), 'old read should be NaN on a corrupt store');
  const numLS = buildNumLS(store);
  const v = numLS('walden-sb-struct', 25);
  assert.equal(v, 25, 'numLS must fall back to 25, not NaN');
  assert.ok(Number.isFinite(v));
});

// ---------- downstream impact: NaN setback breaks insetPolygon + the warning ----------
check('RED-proof downstream: a NaN setback makes insetPolygon emit NaN coords; numLS prevents it', () => {
  const nanOut = insetPolygon(SQUARE, NaN);
  assert.ok(nanOut.some(p => Number.isNaN(p[0]) || Number.isNaN(p[1])),
    'insetPolygon(_, NaN) should produce NaN coords (the broken buildable zone)');
  // with numLS the setback is finite, so insetPolygon yields a clean inset polygon
  const numLS = buildNumLS({ 'walden-sb-struct': 'xyz' });
  const sb = numLS('walden-sb-struct', 25);
  const out = insetPolygon(SQUARE, sb);
  assert.ok(out.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])),
    'numLS fallback must keep insetPolygon finite');
});

check('downstream: setback-warning gate (ev < req - 0.05) is meaningful with numLS, dead with NaN', () => {
  const ev = 10;                       // an element 10ft from the line
  const reqNaN = NaN - 0.05;
  assert.equal(ev < reqNaN, false, 'NaN req -> warning gate is always false (every element "all clear")');
  const numLS = buildNumLS({ 'walden-sb-struct': 'corrupt' });
  const req = numLS('walden-sb-struct', 25) - 0.05;   // 24.95
  assert.equal(ev < req, true, 'with a finite 25ft setback, a 10ft element is correctly flagged in setback');
});

// ---------- numLS unit contract ----------
check('absent store -> fallback', () => {
  const n = buildNumLS({});
  assert.equal(n('walden-sb-struct', 25), 25);
  assert.equal(n('walden-sb-pool', 15), 15);
  assert.equal(n('walden-2d-rot', 0), 0);
});

check('clean stored number -> that number (byte-identical to the old +() for the real case)', () => {
  const n = buildNumLS({ 'walden-sb-struct': '30', 'walden-sb-pool': '12', 'walden-2d-rot': '45' });
  assert.equal(n('walden-sb-struct', 25), 30);
  assert.equal(n('walden-sb-pool', 15), 12);
  assert.equal(n('walden-2d-rot', 0), 45);
});

check('decimal stored number preserved', () => {
  assert.equal(buildNumLS({ k: '25.5' })('k', 25), 25.5);
  assert.equal(buildNumLS({ k: '0' })('k', 25), 0);     // 0 is a valid stored value, not the fallback
  assert.equal(buildNumLS({ k: '-3' })('k', 0), -3);
});

check('every non-numeric shape -> fallback (never NaN)', () => {
  // clearly-non-numeric values (parseFloat -> NaN) must fall back to the passed default
  for (const bad of ['abc', '', ' ', 'null', 'undefined', 'NaN', '{}', '[]', 'true', '.', '+', '-', 'xyz']) {
    const v = buildNumLS({ k: bad })('k', 7);
    assert.equal(v, 7, `non-numeric "${bad}" should fall back to 7`);
  }
});

check('numLS result is ALWAYS finite across hostile inputs (the invariant)', () => {
  for (const bad of ['abc', 'null', '{}', '[1,2]', 'true', 'NaN', 'Infinity', '-Infinity', 'xyz', '']) {
    assert.ok(Number.isFinite(buildNumLS({ k: bad })('k', 25)), `result for "${bad}" must be finite`);
  }
});

// ---------- MUTATION PROOF: numLS is a real verifier, not a rubber stamp ----------
check('mutation: dropping the Number.isFinite guard reintroduces NaN (proves the test has teeth)', () => {
  // reconstruct a buggy numLS that returns the parse verbatim
  const buggySrc = extractFn(html, 'numLS')
    .replace('return Number.isFinite(v)?v:fallback;', 'return v;');
  const buggy = new Function('localStorage', buggySrc + '\nreturn numLS;')(mockLS({ k: 'abc' }));
  const v = buggy('k', 25);
  assert.ok(Number.isNaN(v), 'the buggy (guard-less) numLS should return NaN — confirming the guard is load-bearing');
});

check('mutation: changing the fallback path is caught by the absent-store cases', () => {
  const buggySrc = extractFn(html, 'numLS')
    .replace('return Number.isFinite(v)?v:fallback;', 'return Number.isFinite(v)?v:0;');
  const buggy = new Function('localStorage', buggySrc + '\nreturn numLS;')(mockLS({}));
  assert.equal(buggy('walden-sb-struct', 25), 0, 'mutant ignores the passed fallback');
  // the real shipped numLS honors the fallback:
  assert.equal(buildNumLS({})('walden-sb-struct', 25), 25);
});

// ---------- source binding: the three reads route through numLS, old form gone ----------
check('source binding: all three numeric reads use numLS, the old +(getItem(k)||N) form is gone', () => {
  assert.ok(/numLS\('walden-2d-rot',0\)/.test(html), 'plan2dRot should use numLS');
  assert.ok(/numLS\('walden-sb-struct',25\)/.test(html), 'sbStruct should use numLS');
  assert.ok(/numLS\('walden-sb-pool',15\)/.test(html), 'sbPool should use numLS');
  assert.ok(!/\+\(localStorage\.getItem\('walden-sb-struct'\)/.test(html), 'old sbStruct read form must be gone');
  assert.ok(!/\+\(localStorage\.getItem\('walden-2d-rot'\)/.test(html), 'old plan2dRot read form must be gone');
});

console.log(`\nnum-ls: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
