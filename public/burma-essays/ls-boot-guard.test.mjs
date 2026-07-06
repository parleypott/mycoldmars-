// Locks the crash-safe boot-time localStorage READ guards on the Burma Essays
// PWA (public/burma-essays/index.html).
//
// The rate label is rendered at MODULE BOOT:
//   $('rate').textContent = currentRate() + '×';   // top-level, ~line 644
// and currentRate() read localStorage RAW:
//   function currentRate(){ const r = parseFloat(localStorage.getItem('burma:rate')); ... }
// That top-level call runs BEFORE load() (the main essay-list render, ~line 1030),
// so in a storage-blocked browser (iOS Safari "Block All Cookies", Gmail/Slack
// in-app webview) merely CALLING localStorage.getItem throws a SecurityError, the
// throw propagates, and the whole <script> stops before load() — the PWA renders
// a blank page. This PWA is a mobile-first listening app; iOS Safari is its
// PRIMARY surface, exactly where blocked-storage bites.
//
// Two more raw reads in the same class: localPos() (resume position, hit on
// play/select) and maybeShowIosInstall()'s `dismissed` read (also boot, after 644).
// All three now guard the read. We assert against the SHIPPED index.html and
// mutation-prove each guard is load-bearing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

// --- Call-site locks: each read must be try/catch-guarded, never raw ---

// currentRate — the boot-critical brick (called at top level before load()).
{
  const fn = html.match(/function currentRate\(\)\{[\s\S]*?\}/);
  assert.ok(fn, 'could not find currentRate()');
  assert.match(fn[0], /try\s*\{\s*r\s*=\s*parseFloat\(localStorage\.getItem\('burma:rate'\)\)/,
    'currentRate must guard the localStorage read in try/catch');
  assert.doesNotMatch(fn[0], /const\s+r\s*=\s*parseFloat\(localStorage\.getItem/,
    'currentRate must NOT read localStorage raw (boot brick before load())');
}

// localPos — resume position, reached on play/select.
{
  const m = html.match(/const localPos = \(id\) => \{[\s\S]*?\};/);
  assert.ok(m, 'could not find localPos');
  assert.match(m[0], /try\s*\{\s*v\s*=\s*parseFloat\(localStorage\.getItem\(lsKey\(id\)\)\)/,
    'localPos must guard the localStorage read in try/catch');
}

// maybeShowIosInstall's dismissed read — boot, after currentRate.
{
  assert.match(html, /let dismissed = false; try \{ dismissed = localStorage\.getItem\('burma:iosHintDismissed'\) === '1'; \} catch/,
    'the iOS-hint dismissed read must be try/catch-guarded');
  assert.doesNotMatch(html, /const dismissed = localStorage\.getItem\('burma:iosHintDismissed'\)/,
    'the iOS-hint read must NOT touch localStorage raw');
}

// --- Functional mutation proof: the boot rate resolve ---
const RATES = [1, 1.25, 1.5, 1.75, 2];

const rawRate = (store) => {                    // OLD bricking form
  const r = parseFloat(store.getItem('burma:rate'));
  return RATES.includes(r) ? r : 1;
};
const guardedRate = (store) => {                // shipped form
  let r = NaN;
  try { r = parseFloat(store.getItem('burma:rate')); } catch (e) { /* degrade */ }
  return RATES.includes(r) ? r : 1;
};

// Working store: happy path byte-identical.
{
  const map = new Map();
  const ls = { getItem: (k) => (map.has(k) ? map.get(k) : null) };
  assert.equal(rawRate(ls), 1, 'raw: absent → 1');
  assert.equal(guardedRate(ls), 1, 'guarded: absent → 1 (identical)');
  map.set('burma:rate', '1.5');
  assert.equal(rawRate(ls), 1.5, 'raw: reads stored rate');
  assert.equal(guardedRate(ls), 1.5, 'guarded: reads stored rate (identical)');
  map.set('burma:rate', '9');   // not in RATES
  assert.equal(rawRate(ls), 1, 'raw: unknown rate → 1');
  assert.equal(guardedRate(ls), 1, 'guarded: unknown rate → 1 (identical)');
}

// Blocked store: getItem throws (the brick).
{
  const thrower = { getItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); } };
  assert.throws(() => rawRate(thrower), /insecure/,
    'RED proof: old raw rate read throws on a storage-blocked store (bricks the PWA before load())');
  assert.doesNotThrow(() => guardedRate(thrower),
    'guarded rate read must NOT throw on a storage-blocked store');
  assert.equal(guardedRate(thrower), 1,
    'blocked store → r stays NaN → default 1× → boot continues to load()');
}

// Guard is load-bearing: a catch-less "guarded" form must re-throw.
{
  const noGuard = (store) => { let r = NaN; r = parseFloat(store.getItem('burma:rate')); return RATES.includes(r) ? r : 1; };
  const thrower = { getItem() { throw new DOMException('insecure', 'SecurityError'); } };
  assert.throws(() => noGuard(thrower), /insecure/,
    'mutation proof: removing the try/catch re-bricks the boot rate read');
}

console.log('ok — Burma Essays PWA boot localStorage reads are crash-safe (guarded, mutation-locked)');
