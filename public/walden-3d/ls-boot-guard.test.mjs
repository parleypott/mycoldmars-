// Verifier-layer test for the Walden-3d studio boot-time localStorage ACCESS guard (readLS).
//
// THE BUG (storage-blocked-access brick class — same as nile-flights/essays/laserspace):
// In a storage-blocked browser (Safari "Block All Cookies", or an in-app webview like the
// Gmail/Slack browser), merely CALLING localStorage.getItem throws a SecurityError — you
// don't have to write, just reading the store throws. studio.html read three settings RAW
// at module boot, each before any try/catch:
//   numLS(...)         -> localStorage.getItem('walden-2d-rot')      (2D rotation)
//   plan2dLocked       =  localStorage.getItem('walden-2d-locked')   (lock flag)
//   saved (maps key)   =  localStorage.getItem('walden-maps-key')    (Google key reuse)
// Any one throw at boot kills the whole <script>, so the studio renders a BLANK page in
// those browsers. The pre-existing numLS/els-store guards protect the PARSE (corrupt value),
// not the ACCESS — the throw fires while evaluating the argument, before those guards run.
//
// readLS(key) wraps the access in try/catch and returns null on any throw, so every caller
// falls back exactly as it does for an absent key and the page boots. Byte-identical when
// storage works. This test EXTRACTS the real shipped readLS from studio.html (brace-match +
// new Function) so it can't drift, proves degradation + byte-identity, and locks the three
// call sites. Mutation-proven.

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

// Build readLS with a caller-supplied `localStorage` shim (same-named Function param).
function loadReadLS(source = html) {
  const src = extractFn(source, 'readLS');
  return new Function('localStorage', src + '\nreturn readLS;');
}
const buildReadLS = (store) => loadReadLS()(store);

const workingStore = (obj) => ({ getItem: (k) => (k in obj ? obj[k] : null) });
const throwingStore = { getItem: () => { throw new DOMException('denied', 'SecurityError'); } };

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

// ---------- RED proof: a raw getItem throws; readLS swallows it ----------
check('RED-proof: a raw getItem on a storage-blocked store throws (the boot brick)', () => {
  assert.throws(() => throwingStore.getItem('walden-2d-locked'), /SecurityError|denied/);
});

check('readLS returns null (never throws) on a storage-blocked store', () => {
  const readLS = buildReadLS(throwingStore);
  let out, threw = false;
  try { out = readLS('walden-maps-key'); } catch (_) { threw = true; }
  assert.equal(threw, false, 'readLS must not propagate the SecurityError');
  assert.equal(out, null, 'readLS must degrade to null so callers take the absent-key path');
});

// ---------- byte-identity: a working store behaves exactly like a raw getItem ----------
check('readLS is byte-identical to getItem when storage works', () => {
  const readLS = buildReadLS(workingStore({ 'walden-maps-key': 'AIzaTESTKEY', 'walden-2d-locked': '1' }));
  assert.equal(readLS('walden-maps-key'), 'AIzaTESTKEY');
  assert.equal(readLS('walden-2d-locked'), '1');
  assert.equal(readLS('absent-key'), null, 'absent key -> null, same as a raw getItem');
});

// ---------- downstream: the two boot expressions behave correctly under a throw ----------
check('downstream: plan2dLocked and saved take the safe default when storage is blocked', () => {
  const readLS = buildReadLS(throwingStore);
  const plan2dLocked = readLS('walden-2d-locked') === '1';   // null === '1' -> false
  const saved = readLS('walden-maps-key');                   // null -> gate shows, no boot(key)
  assert.equal(plan2dLocked, false, 'blocked storage -> unlocked (safe default), not a crash');
  assert.equal(saved, null, 'blocked storage -> no stored key, studio still boots in 2D');
});

// ---------- MUTATION PROOF: readLS is a real guard, not a rubber stamp ----------
check('mutation: a guard-less readLS re-throws on a blocked store (proves the try/catch has teeth)', () => {
  const buggySrc = extractFn(html, 'readLS')
    .replace('try{return localStorage.getItem(key);}catch(_){return null;}', 'return localStorage.getItem(key);');
  assert.notEqual(buggySrc, extractFn(html, 'readLS'), 'mutation must actually change the source');
  const buggy = new Function('localStorage', buggySrc + '\nreturn readLS;')(throwingStore);
  assert.throws(() => buggy('walden-maps-key'), /SecurityError|denied/,
    'the guard-less readLS should re-throw — confirming the try/catch is load-bearing');
});

// ---------- source binding: the three boot reads route through the guard, raw forms gone ----------
check('source binding: numLS reads via readLS, not a raw getItem', () => {
  const numLS = extractFn(html, 'numLS');
  assert.ok(/parseFloat\(readLS\(key\)\)/.test(numLS), 'numLS must read through readLS');
  assert.ok(!/localStorage\.getItem/.test(numLS), 'numLS must not touch localStorage directly');
});

check('source binding: the two boot expressions route through readLS, old raw forms gone', () => {
  assert.ok(/let plan2dLocked=readLS\('walden-2d-locked'\)==='1';/.test(html), 'plan2dLocked must use readLS');
  assert.ok(/const saved=readLS\('walden-maps-key'\);/.test(html), 'saved (maps key) must use readLS');
  assert.ok(!/localStorage\.getItem\('walden-2d-locked'\)/.test(html), 'old raw walden-2d-locked read must be gone');
  assert.ok(!/const saved=localStorage\.getItem\('walden-maps-key'\)/.test(html), 'old raw walden-maps-key read must be gone');
});

check('source binding: readLS is a try/catch access guard', () => {
  const readLS = extractFn(html, 'readLS');
  assert.ok(/try\{return localStorage\.getItem\(key\);\}catch/.test(readLS), 'readLS must try/catch the getItem access');
});

console.log(`\nls-boot-guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
