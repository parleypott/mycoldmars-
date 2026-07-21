/*
 * clamp01.test.mjs — the CROP-FRACTION NORMALIZER (blocks.js clamp01).
 *
 * clamp01 is the [0,1] guard the ImageBlock crop path runs every normalized crop
 * coordinate through (blocks.js ~1690):
 *
 *     const nx = clamp01((rectPx.l - ox) / mb.width);
 *     const ny = clamp01((rectPx.t - oy) / mb.height);
 *     const nw = clamp01(rectPx.w / mb.width);
 *     const nh = clamp01(rectPx.h / mb.height);
 *
 * Those divisions turn a crop drag into a normalized {x,y,w,h} fraction that gets
 * PERSISTED (isValidCrop → the saved crop) and re-applied as the render overlay. Two
 * ways they go bad, both TAMED by clamp01, neither by a naive min/max:
 *   • a drag that overshoots the image → a fraction > 1 or < 0 (off-canvas crop);
 *   • a ZERO-dimension image bounds (mb.width/height === 0, an un-laid-out or
 *     mid-load nodeview) → rectPx.w / 0 = ±Infinity, and 0 / 0 = NaN. A bare
 *     Math.max(0, Math.min(1, v)) leaks NaN straight through (min(1,NaN)=NaN,
 *     max(0,NaN)=NaN) → a NaN crop fraction poisons the persisted crop. clamp01's
 *     `Number(v) || 0` folds NaN → 0 and its min/max fold ±Infinity → 1/0.
 *
 * This is the loop's divide-by-length + out-of-range class (cf. Art FillFrame square
 * clamp, mapkeys featherFrac). Locked here because clamp01 was the one fresh exported
 * pure fn in the +188-line blocks.js image pass with zero coverage.
 *
 * Run: bun burma-script/src/extensions/clamp01.test.mjs  (auto-discovered)
 */
import assert from 'node:assert/strict';
import { clamp01 } from './blocks.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

// The naive normalizer clamp01 REPLACES — used only as a mutation oracle below.
const naive = (v) => Math.max(0, Math.min(1, v));

// ── In-range passthrough ──────────────────────────────────────────────────────
ok('valid crop fractions pass through unchanged', () => {
  assert.equal(clamp01(0), 0);
  assert.equal(clamp01(1), 1);
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(0.001), 0.001);
  assert.equal(clamp01(0.999), 0.999);
  assert.equal(clamp01('0.4'), 0.4); // string coerced (attrs can round-trip as strings)
});

// ── Out-of-range (overshot drag) ──────────────────────────────────────────────
ok('an overshot drag clamps into [0,1]', () => {
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(42), 1);
  assert.equal(clamp01(-0.3), 0);
  assert.equal(clamp01(-99), 0);
});

// ── Load-bearing: the zero-dimension-bounds failures clamp01 exists to tame ────
ok('NaN (0/0 bounds) folds to 0 — never leaks into the persisted crop', () => {
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(0 / 0), 0);        // the literal mb.width===0 numerator-zero case
  assert.equal(clamp01(undefined), 0);
  assert.equal(clamp01(null), 0);
  assert.equal(clamp01('nope'), 0);
});

ok('±Infinity (w / 0 bounds) folds to the near edge, not Infinity', () => {
  assert.equal(clamp01(Infinity), 1);     // rectPx.w / 0  → +Infinity → 1
  assert.equal(clamp01(-Infinity), 0);    // (rectPx.l-ox) / 0 with negative num → -Infinity → 0
  assert.equal(clamp01(10 / 0), 1);
});

// Every clamp01 result is a real number in [0,1] — the invariant isValidCrop and the
// render overlay rely on. Sweep the exact inputs the crop divisions can produce.
ok('output is ALWAYS a finite fraction in [0,1] for every crop-math input', () => {
  for (const v of [0, 0.5, 1, 1.2, -0.1, NaN, Infinity, -Infinity, 5 / 0, 0 / 0, '0.7', null]) {
    const r = clamp01(v);
    assert.ok(Number.isFinite(r) && r >= 0 && r <= 1, `clamp01(${String(v)}) = ${r} out of [0,1]`);
  }
});

// ── Mutation proof: the naive min/max clamp LEAKS on exactly the bounds this guards ──
ok('a naive Math.max(0,Math.min(1,v)) LEAKS NaN — proving clamp01 is the load-bearing guard', () => {
  // The divide-by-zero-bounds inputs where clamp01 and the naive form DIVERGE:
  assert.ok(Number.isNaN(naive(NaN)), 'oracle: naive leaks NaN (this is the bug clamp01 prevents)');
  assert.ok(Number.isNaN(naive(0 / 0)), 'oracle: naive leaks NaN on 0/0 bounds');
  // clamp01 tames the identical inputs — so swapping clamp01 for the naive form goes RED here:
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(0 / 0), 0);
});

console.log(`\nclamp01.test.mjs — ${pass} checks passed`);
