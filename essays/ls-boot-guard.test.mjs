// Locks the crash-safe localStorage guard on the essays player's save()/load().
//
// load() is called at BOOT inside render() for every essay (to show the resume pill),
// so a raw localStorage access that throws in a storage-blocked browser (Safari "Block
// All Cookies", or an in-app webview like the Gmail/Slack browser a listener taps the
// link from) would abort the whole render → blank page. The guard must:
//   - be byte-identical to the old behavior on a working store (load = parseFloat||0),
//   - degrade to no-op save / 0 resume on a throwing store instead of propagating.
//
// We extract the SHIPPED helpers straight from essays/index.html so the test tracks the
// live code, and mutation-prove the guard is load-bearing (reverting turns cases RED).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

// Pull the two shipped one-liners verbatim.
function extract(name) {
  const re = new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[^\\n]*\\}`);
  const m = html.match(re);
  assert.ok(m, `could not find shipped ${name}() in index.html`);
  return m[0];
}
const saveSrc = extract('save');
const loadSrc = extract('load');

// Sanity: confirm the guard actually shipped (not just relying on behavior).
assert.match(saveSrc, /try\s*\{[\s\S]*catch/, 'save() must be try/catch-guarded');
assert.match(loadSrc, /try\s*\{[\s\S]*catch/, 'load() must be try/catch-guarded');

// Build callable helpers against an injected `localStorage`.
function build(ls) {
  // eslint-disable-next-line no-new-func
  return new Function('localStorage', 'parseFloat', `${saveSrc}\n${loadSrc}\nreturn { save, load };`)(ls, parseFloat);
}

// --- Working store: happy path is byte-identical to the old raw form ---
{
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  const { save, load } = build(ls);

  assert.equal(load('a'), 0, 'absent key → 0 (parseFloat(null)||0)');
  save('a', 42.5);
  assert.equal(store.get('ep_a'), '42.5', 'save writes ep_<id>');
  assert.equal(load('a'), 42.5, 'round-trips the saved float');

  store.set('ep_b', '');
  assert.equal(load('b'), 0, 'empty string → 0, exactly like the old ||0');
  store.set('ep_c', 'not-a-number');
  assert.equal(load('c'), 0, 'garbage → 0');
  store.set('ep_d', '0');
  assert.equal(load('d'), 0, 'stored 0 → 0');
}

// --- Blocked store: accessing localStorage THROWS (the brick condition) ---
{
  const thrower = {
    getItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
    setItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  };
  const { save, load } = build(thrower);

  // These are the load-bearing assertions: neither must propagate.
  assert.doesNotThrow(() => load('x'), 'load() must not throw on a blocked store (else render() bricks)');
  assert.equal(load('x'), 0, 'load() degrades to 0 resume on a throwing store');
  assert.doesNotThrow(() => save('x', 12), 'save() must not throw on a blocked store');
}

// --- Mutation proof: the OLD unguarded forms DO throw on a blocked store ---
{
  const thrower = {
    getItem() { throw new DOMException('insecure', 'SecurityError'); },
    setItem() { throw new DOMException('insecure', 'SecurityError'); },
  };
  const oldLoad = (id) => parseFloat(thrower.getItem('ep_' + id)) || 0;
  const oldSave = (id, t) => { thrower.setItem('ep_' + id, t); };
  assert.throws(() => oldLoad('x'), 'proves the raw load() (pre-guard) bricks render — the bug this locks');
  assert.throws(() => oldSave('x', 1), 'proves the raw save() (pre-guard) throws too');
}

console.log('essays ls-boot-guard: all assertions passed');
