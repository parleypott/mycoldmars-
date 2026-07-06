// Locks the crash-safe boot-time localStorage READ guard on the Westchester
// House Hunter (public/westchester/index.html).
//
// The basemap style is resolved at MODULE BOOT inside a top-level self-invoking
// IIFE:
//   const savedStyleKey = (() => {
//     let s = null;
//     try { s = localStorage.getItem(STYLE_KEY); } catch (e) {}
//     return MAP_STYLES[s] ? s : 'detailed';
//   })();
// This `const` executes during the inline <script>'s evaluation, BEFORE the map
// init + UI wiring below it. Every OTHER localStorage touch in the file is either
// function-scoped or already try/catch-guarded (readCached, hydrateMoneyState,
// the cloud-sync helpers, the layers-panel restore) — this style read was the one
// raw top-level access. Merely CALLING localStorage.getItem throws a SecurityError
// in a storage-blocked browser (Safari "Block All Cookies", Gmail/Slack in-app
// webview); the throw propagates out of the IIFE and stops the whole <script>, so
// the House Hunter renders a blank page instead of a working map.
//
// We assert against the SHIPPED index.html so the test tracks live code, and
// mutation-prove the guard is load-bearing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

// --- Call-site lock: the boot IIFE must guard the read, not touch getItem raw ---
const iife = html.match(/const savedStyleKey = \(\(\) => \{[\s\S]*?\}\)\(\);/);
assert.ok(iife, 'could not find the savedStyleKey boot IIFE');
const src = iife[0];

// The load-bearing assertion: reverting to `const s = localStorage.getItem(...)`
// (no try/catch) must turn this RED.
assert.match(src, /try\s*\{\s*s\s*=\s*localStorage\.getItem\(STYLE_KEY\)\s*;?\s*\}\s*catch/,
  'the boot STYLE_KEY read must be wrapped in try/catch');
assert.doesNotMatch(src, /const\s+s\s*=\s*localStorage\.getItem\(STYLE_KEY\)/,
  'the boot read must NOT call localStorage.getItem raw (bricks storage-blocked browsers)');

// --- Functional mutation proof: model both the raw and guarded boot reads ---
const MAP_STYLES = { detailed: {}, minimal: {}, satellite: {} };

const rawResolve = (store) => {
  const s = store.getItem('whh:basemap:v1'); // OLD, bricking form
  return MAP_STYLES[s] ? s : 'detailed';
};
const guardedResolve = (store) => {
  let s = null;
  try { s = store.getItem('whh:basemap:v1'); } catch (e) { /* degrade */ }
  return MAP_STYLES[s] ? s : 'detailed';
};

// Working store: happy path is byte-identical to the old raw form.
{
  const map = new Map();
  const ls = { getItem: (k) => (map.has(k) ? map.get(k) : null) };

  assert.equal(rawResolve(ls), 'detailed', 'raw: absent key → detailed default');
  assert.equal(guardedResolve(ls), 'detailed', 'guarded: absent key → detailed (identical)');

  map.set('whh:basemap:v1', 'satellite');
  assert.equal(rawResolve(ls), 'satellite', 'raw: reads stored style');
  assert.equal(guardedResolve(ls), 'satellite', 'guarded: reads stored style (identical)');

  map.set('whh:basemap:v1', 'bogus');
  assert.equal(rawResolve(ls), 'detailed', 'raw: unknown style → detailed');
  assert.equal(guardedResolve(ls), 'detailed', 'guarded: unknown style → detailed (identical)');
}

// Blocked store: accessing getItem THROWS (the brick condition).
{
  const thrower = {
    getItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  };
  assert.throws(() => rawResolve(thrower), /insecure/,
    'RED proof: the old raw read throws on a storage-blocked store (bricks the House Hunter)');
  assert.doesNotThrow(() => guardedResolve(thrower),
    'the guarded read must NOT throw on a storage-blocked store');
  assert.equal(guardedResolve(thrower), 'detailed',
    'blocked store → s stays null → detailed default → boot continues to map init');
}

// Guard is load-bearing: a try/catch-less "guarded" form must re-throw (proves
// the catch is what saves the boot, not the `let s = null` default alone).
{
  const noGuard = (store) => { let s = null; s = store.getItem('whh:basemap:v1'); return MAP_STYLES[s] ? s : 'detailed'; };
  const thrower = { getItem() { throw new DOMException('insecure', 'SecurityError'); } };
  assert.throws(() => noGuard(thrower), /insecure/,
    'mutation proof: removing the try/catch re-bricks the boot read');
}

console.log('ok — Westchester House Hunter boot localStorage read is crash-safe (guarded, mutation-locked)');
