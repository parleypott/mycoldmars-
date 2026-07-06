// Locks the crash-safe boot-time localStorage READ guard on the walden 2D
// landscape studio (public/walden/index.html).
//
// The chat-panel width is restored at MODULE BOOT inside a self-invoking IIFE:
//   (function(){ let saved=0; try{ saved=+localStorage.getItem('walden-chatw'); }catch(_){} if(saved)setChatW(saved); ... })();
// This IIFE runs BEFORE initMap() (the last statement in the script, which renders
// the whole tool). setChatW already guards the WRITE with try/catch, but the boot
// READ was raw: merely CALLING localStorage.getItem throws a SecurityError in a
// storage-blocked browser (Safari "Block All Cookies", Gmail/Slack in-app webview).
// Because the throw propagates out of the IIFE, it stops the <script> before
// initMap() ever runs — the studio renders a blank page. Guarding the read is the
// READ twin of setChatW's already-guarded write.
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
const iife = html.match(/\(function\(\)\{[^\n]*walden-chatw[^\n]*setChatW[^\n]*\}\)\(\);/);
assert.ok(iife, 'could not find the boot chat-resize IIFE');
const src = iife[0];

// The load-bearing assertion: reverting to `const saved=+localStorage.getItem(...)`
// (no try/catch) must turn this RED.
assert.match(src, /try\s*\{\s*saved\s*=\s*\+localStorage\.getItem\('walden-chatw'\)\s*;?\s*\}\s*catch/,
  'the boot walden-chatw read must be wrapped in try/catch');
assert.doesNotMatch(src, /const\s+saved\s*=\s*\+localStorage\.getItem/,
  'the boot read must NOT call +localStorage.getItem raw (bricks storage-blocked browsers)');

// --- Functional mutation proof: model both the raw and guarded boot reads ---
// The exact boot expression, factored so we can prove the guard is load-bearing.
const rawRead = (store) => {
  const saved = +store.getItem('walden-chatw'); // OLD, bricking form
  return saved;
};
const guardedRead = (store) => {
  let saved = 0;
  try { saved = +store.getItem('walden-chatw'); } catch (_) { /* degrade */ }
  return saved;
};

// Working store: happy path is byte-identical to the old raw form.
{
  const map = new Map();
  const ls = { getItem: (k) => (map.has(k) ? map.get(k) : null) };

  assert.equal(rawRead(ls), 0, 'raw: absent key → +null → 0');
  assert.equal(guardedRead(ls), 0, 'guarded: absent key → 0 (identical)');

  map.set('walden-chatw', '500');
  assert.equal(rawRead(ls), 500, 'raw: reads stored width');
  assert.equal(guardedRead(ls), 500, 'guarded: reads stored width (identical)');

  map.set('walden-chatw', 'garbage');
  assert.ok(Number.isNaN(rawRead(ls)), 'raw: garbage → NaN');
  assert.ok(Number.isNaN(guardedRead(ls)), 'guarded: garbage → NaN (identical; if(saved) is falsy)');
}

// Blocked store: accessing getItem THROWS (the brick condition).
{
  const thrower = {
    getItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  };
  assert.throws(() => rawRead(thrower), /insecure/,
    'RED proof: the old raw read throws on a storage-blocked store (bricks the studio)');
  assert.doesNotThrow(() => guardedRead(thrower),
    'the guarded read must NOT throw on a storage-blocked store');
  assert.equal(guardedRead(thrower), 0,
    'blocked store → saved stays 0 → if(saved) false → skip restore, boot continues to initMap()');
}

// Guard is load-bearing: a try/catch-less "guarded" form must re-throw (proves
// the catch is what saves the boot, not the `let saved=0` default alone).
{
  const noGuard = (store) => { let saved = 0; saved = +store.getItem('walden-chatw'); return saved; };
  const thrower = { getItem() { throw new DOMException('insecure', 'SecurityError'); } };
  assert.throws(() => noGuard(thrower), /insecure/,
    'mutation proof: removing the try/catch re-bricks the boot read');
}

console.log('ok — walden 2D studio boot localStorage read is crash-safe (guarded, mutation-locked)');
