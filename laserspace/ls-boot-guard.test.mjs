// Locks the crash-safe boot-time localStorage READ guard on laserspace.
//
// The high score is read at MODULE BOOT inside the `const state = {...}` init:
//   hi: readHiScore(readStoredHi(localStorage, "laserspaceHi"))
// readHiScore only guards the PARSE (NaN-safe). readStoredHi guards the ACCESS:
// merely calling localStorage.getItem throws a SecurityError in a storage-blocked
// browser (Safari "Block All Cookies", in-app webviews). Because that access runs
// at load, an uncaught throw kills the whole game module before it renders — a
// blank page. saveHiScore already guards the WRITE; readStoredHi is its READ twin.
//
// We extract the SHIPPED helpers straight from laserspace/index.html so the test
// tracks the live code, and mutation-prove the guard is load-bearing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

// Pull the shipped functions verbatim (brace-balanced from `function NAME`).
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `could not find shipped ${name}() in index.html`);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}
const readHiSrc = extract('readHiScore');
const readStoredSrc = extract('readStoredHi');

// Sanity: the ACCESS guard actually shipped (not just the parse guard).
assert.match(readStoredSrc, /try\s*\{[\s\S]*catch/, 'readStoredHi() must be try/catch-guarded');

// Call-site lock: the boot `hi:` assignment must go THROUGH readStoredHi, never
// touch localStorage.getItem raw. This is the load-bearing assertion — reverting
// line 402 to the raw form must turn it RED.
const hiLine = html.match(/hi:\s*[^\n,]*,/);
assert.ok(hiLine, 'could not find the boot `hi:` state assignment');
assert.match(hiLine[0], /readStoredHi\(\s*localStorage\s*,/,
  'the boot hi: read must route through the guarded readStoredHi()');
assert.doesNotMatch(hiLine[0], /localStorage\.getItem/,
  'the boot hi: read must NOT call localStorage.getItem raw (bricks storage-blocked browsers)');

function build() {
  // eslint-disable-next-line no-new-func
  return new Function(`${readHiSrc}\n${readStoredSrc}\nreturn { readHiScore, readStoredHi };`)();
}
const { readHiScore, readStoredHi } = build();

// The exact boot expression: hi = readHiScore(readStoredHi(store, key))
const bootHi = (store) => readHiScore(readStoredHi(store, 'laserspaceHi'));

// --- Working store: happy path is byte-identical to the old raw form ---
{
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null) };
  assert.equal(bootHi(ls), 0, 'absent key → hi 0 (parseInt("0"))');

  store.set('laserspaceHi', '12345');
  assert.equal(bootHi(ls), 12345, 'reads the stored high score');

  store.set('laserspaceHi', 'not-a-number');
  assert.equal(bootHi(ls), 0, 'garbage → 0 (NaN-safe, unchanged)');

  store.set('laserspaceHi', '');
  assert.equal(bootHi(ls), 0, 'empty → 0');
}

// --- Blocked store: accessing localStorage THROWS (the brick condition) ---
{
  const thrower = {
    getItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  };
  assert.doesNotThrow(() => bootHi(thrower),
    'boot read must not throw on a blocked store (else the game module bricks at load)');
  assert.equal(bootHi(thrower), 0, 'degrades to hi=0 on a throwing store');
}

// --- Mutation proof: the OLD unguarded boot form DID throw on a blocked store ---
{
  const thrower = {
    getItem() { throw new DOMException('insecure', 'SecurityError'); },
  };
  const oldBoot = () => readHiScore(thrower.getItem('laserspaceHi')); // pre-guard line 402
  assert.throws(() => oldBoot(),
    'proves the raw localStorage.getItem() at boot (pre-guard) bricks the page — the bug this locks');
}

console.log('laserspace ls-boot-guard: all assertions passed');
