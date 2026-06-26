// Mutation-locked coverage for pickMediaIndex — the pure media-index picker
// that defends the gallery (the DEFAULT zanyplans scene) against the empty-pool
// crash class tile.js was written to kill. The gallery can't pre-tile its pool
// (it indexes + swaps randomly), so this picker is the only guard between an
// empty/short space and a hard `undefined.type` white-screen crash.
//
// Run: node zanyplans/src/grid-gallery.test.mjs
import assert from 'node:assert/strict';
import { pickMediaIndex } from './grid-gallery.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };

// Deterministic rand stub so the random branch is provable.
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

// ── empty / invalid pool → -1 sentinel (NOT 0, NOT NaN — 0 is the crash) ──
t('empty pool returns -1, never 0', () => {
  assert.equal(pickMediaIndex(0), -1);
  assert.equal(pickMediaIndex(0, 3), -1);
});
t('invalid pool lengths degrade to -1', () => {
  for (const bad of [undefined, null, NaN, -1, -5, 'x', {}, [], 0.4]) {
    assert.equal(pickMediaIndex(bad), -1, `len=${String(bad)}`);
  }
});

// ── single item → always 0 (and may repeat the current index, by design) ──
t('single-item pool always returns 0', () => {
  assert.equal(pickMediaIndex(1), 0);
  assert.equal(pickMediaIndex(1, 0), 0); // staying on 0 is correct for n===1
  assert.equal(pickMediaIndex(1, -1), 0);
});

// ── first pick (currentIdx = -1) is uniform over 0..n-1, repeats allowed ──
t('first pick can land on index 0 (currentIdx=-1 never blocks)', () => {
  // rand→0 must yield 0, not loop forever against the -1 sentinel.
  assert.equal(pickMediaIndex(5, -1, seq(0)), 0);
});
t('first pick maps rand uniformly to floor(rand*n)', () => {
  assert.equal(pickMediaIndex(9, -1, seq(0)), 0);
  assert.equal(pickMediaIndex(9, -1, seq(0.5)), 4);
  assert.equal(pickMediaIndex(9, -1, seq(0.999)), 8);
});

// ── swap (currentIdx >= 0, n > 1) → never repeats currentIdx ──
t('swap never returns the current index', () => {
  // rand first yields the current index (blocked), then a different one.
  assert.equal(pickMediaIndex(4, 2, seq(0.5, 0.0)), 0); // 0.5*4=2 blocked → 0.0*4=0
  assert.equal(pickMediaIndex(4, 0, seq(0.0, 0.75)), 3); // 0 blocked → 3
});
t('swap result is always in range and != currentIdx across many draws', () => {
  for (let cur = 0; cur < 6; cur++) {
    for (let k = 0; k < 200; k++) {
      const r = pickMediaIndex(6, cur);
      assert.ok(r >= 0 && r < 6, `in range: ${r}`);
      assert.notEqual(r, cur, `no-repeat cur=${cur}`);
    }
  }
});

// ── the exact reachable scenario: empty space pool, layer construction ──
t('empty pool through a swap stays at the -1 no-op sentinel', () => {
  // nextMedia() early-returns when this is < 0 — no crash, no infinite loop.
  assert.equal(pickMediaIndex(0, 0), -1);
});

console.log(`grid-gallery pickMediaIndex: ${n} test groups passed`);
