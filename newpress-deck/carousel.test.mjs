// carousel.test.mjs
//
// First coverage for the founder-photo sub-carousel index wrap on Johnny's LIVE
// investor deck (newpress-deck/, served at /newpress-deck/). wrapIndex() replaced
// the inline `(n + imgs.length) % imgs.length` in initCarousel().show(), which had
// two latent throw sites on a static deck a bad data/markup edit could reach:
//   - an empty carousel (len 0): `n % 0` === NaN -> imgs[NaN] undefined -> throw
//   - a dot with a missing/garbage data-idx: +undefined === NaN -> same throw
// This locks: byte-identical folding for every finite index at len > 0 (incl. the
// backward-from-0 wrap that makes prev() land on the last slide), AND the safe
// degradation to 0 for empty/non-finite inputs.
//
// Imports the REAL shipped wrapIndex() from src/carousel.js — the SAME function
// main.js's show() calls — so the test can never drift from the live code.
// Bare assert-and-count style (no node:test) so it runs uniformly under bun via
// `bun run test`, matching nav.test.mjs / render-slide.test.mjs.

import assert from 'node:assert/strict';
import { wrapIndex } from './src/carousel.js';

let checks = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// In-range indices fold to themselves.
for (let n = 0; n < 4; n++) eq(wrapIndex(n, 4), n, `in-range ${n}`);

// Backward from 0 wraps to the last slide (prev() at the start). The load-bearing
// reason the inline form was `(n + len) % len`, not `n % len`: JS `-1 % 4` is -1,
// which would index off the front of the carousel.
eq(wrapIndex(-1, 4), 3, 'prev from 0 -> last');
eq(wrapIndex(-1, 1), 0, 'prev from 0, single slide');
eq(wrapIndex(-5, 4), 3, 'far-negative folds non-negative');

// Forward past the end wraps to 0 (next() at the last slide).
eq(wrapIndex(4, 4), 0, 'next from last -> 0');
eq(wrapIndex(6, 4), 2, 'far-positive folds in range');

// Byte-identical to the old inline `(n + len) % len` for every finite n at len > 0.
for (let len = 1; len <= 8; len++) {
  for (let n = -20; n <= 20; n++) {
    eq(wrapIndex(n, len), ((n % len) + len) % len, `identity n=${n} len=${len}`);
  }
}

// Degrades to 0 on an empty carousel instead of returning NaN (the throw site).
eq(wrapIndex(0, 0), 0, 'empty len, n=0');
eq(wrapIndex(3, 0), 0, 'empty len, n=3');
eq(wrapIndex(-1, 0), 0, 'empty len, n=-1');
ok(!Number.isNaN(wrapIndex(1, 0)), 'empty len never NaN');

// Degrades to 0 on a non-finite target (garbage data-idx -> +undefined -> NaN).
eq(wrapIndex(NaN, 4), 0, 'NaN target');
eq(wrapIndex(Infinity, 4), 0, 'Infinity target');
eq(wrapIndex(-Infinity, 4), 0, '-Infinity target');

// Rejects a non-integer / negative length.
eq(wrapIndex(1, -3), 0, 'negative length');
eq(wrapIndex(1, 2.5), 0, 'fractional length');

console.log(`carousel.test.mjs: ${checks} checks passed`);
