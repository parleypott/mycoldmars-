/**
 * frame169Rect — the 16:9 compose-frame geometry (mapkeys, commit dd93272 / merge a0f121b).
 *
 * frame169Rect() computes the centered 16:9 "camera matte" window over the map. It is
 * LOAD-BEARING beyond the visual matte: gifExport reads frame169Rect().w / .h as the source
 * crop dimensions (main.js srcW/srcH), so a regression here silently ships a wrong-aspect or
 * zero/negative export crop. Same clamp/aspect-geometry class the loop has locked before
 * (Art FillFrame square-clamp, mapkeys featherFrac, insetPolygon, clamp01).
 *
 * This test SOURCE-EXTRACTS the real function verbatim from main.js (so a drift in the shipped
 * body changes what runs here) and runs it against a stubbed map container, mutation-locking the
 * four invariants that must hold for EVERY container size — robust to Johnny tuning the SIDE/TOP
 * inset constants, but RED the moment the aspect math or a Math.max floor breaks:
 *
 *   1. exact 16:9    — w / h === 16 / 9 (the export-crop contract)
 *   2. minimum floors — w >= 320 AND h >= 180 (a usable frame even in a small window)
 *   3. fits the box   — h <= boxH (the h>boxH refit branch actually fires when needed)
 *   4. centered       — x === (W - w) / 2, and w/h/x/y are finite
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'main.js'), 'utf8');

// Extract the function body verbatim: from `function frame169Rect()` to its matching close brace.
const start = src.indexOf('function frame169Rect()');
assert.ok(start !== -1, 'frame169Rect must exist in main.js (source-extraction anchor)');
let i = src.indexOf('{', start);
let depth = 0, end = -1;
for (; i < src.length; i += 1) {
  const c = src[i];
  if (c === '{') depth += 1;
  else if (c === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
}
assert.ok(end !== -1, 'frame169Rect close brace must be found');
const fnText = src.slice(start, end);

// Confirm the load-bearing pieces are present in the extracted text (so a gutted body is caught
// here even before the numeric asserts run).
assert.ok(/Math\.max\(320,/.test(fnText), 'width floor Math.max(320, …) must be present');
assert.ok(/Math\.max\(180,/.test(fnText), 'height floor Math.max(180, …) must be present');
assert.ok(/\(w \* 9\) \/ 16/.test(fnText), '16:9 aspect derivation must be present');

// Build a callable by injecting a `map` stub the extracted body closes over.
function makeFrame169Rect(clientWidth, clientHeight) {
  const map = { getContainer: () => ({ clientWidth, clientHeight }) };
  // eslint-disable-next-line no-new-func
  const factory = new Function('map', `${fnText}\nreturn frame169Rect();`);
  return factory(map);
}

// The same box-floor math the function uses, for the h<=boxH invariant.
const boxHFor = (H) => Math.max(180, H - 56 - 16);

let passed = 0;
const ok = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };
const EPS = 1e-6;

const SIZES = [
  [1920, 1080], // 1080p landscape
  [1366, 768],  // laptop
  [800, 2000],  // tall portrait (width-limited → min-frame floor)
  [4000, 400],  // wide-short (fires the h>boxH refit branch)
  [320, 240],   // tiny window (both floors bite)
  [2560, 1440], // QHD
];

ok('1. aspect is exactly 16:9 for every container size', () => {
  for (const [W, H] of SIZES) {
    const r = makeFrame169Rect(W, H);
    assert.ok(Math.abs(r.w / r.h - 16 / 9) < EPS, `ratio ${r.w / r.h} !== 16/9 at ${W}x${H}`);
  }
});

ok('2. minimum frame floors — w >= 320, h >= 180 always', () => {
  for (const [W, H] of SIZES) {
    const r = makeFrame169Rect(W, H);
    assert.ok(r.w >= 320 - EPS, `w ${r.w} < 320 at ${W}x${H}`);
    assert.ok(r.h >= 180 - EPS, `h ${r.h} < 180 at ${W}x${H}`);
  }
});

ok('3. frame fits the available box vertically — h <= boxH (refit branch works)', () => {
  for (const [W, H] of SIZES) {
    const r = makeFrame169Rect(W, H);
    assert.ok(r.h <= boxHFor(H) + EPS, `h ${r.h} > boxH ${boxHFor(H)} at ${W}x${H}`);
  }
});

ok('4. horizontally centered + all coords finite', () => {
  for (const [W, H] of SIZES) {
    const r = makeFrame169Rect(W, H);
    assert.ok(Math.abs(r.x - (W - r.w) / 2) < EPS, `x ${r.x} !== centered at ${W}x${H}`);
    for (const v of [r.x, r.y, r.w, r.h]) assert.ok(Number.isFinite(v), `non-finite coord at ${W}x${H}`);
  }
});

// Concrete anchor (1080p): the exact rect the shipped math produces today. Pins the numbers so a
// silent inset-constant regression is visible, while the invariants above stay tuning-robust.
ok('5. concrete 1920x1080 rect matches the shipped math', () => {
  const r = makeFrame169Rect(1920, 1080);
  assert.equal(r.w, 1376);
  assert.equal(r.h, 774);
  assert.equal(r.x, 272);
  assert.equal(r.y, 173);
});

// Mutation oracle: a builder that DROPS the h>boxH refit branch (keeps w=boxW, h=boxW*9/16) still
// yields a 16:9 rect, so invariant 1 can't catch it — but on the wide-short container it overflows
// the box, which invariant 3 (h <= boxH) does catch. Proves invariant 3 is load-bearing.
ok('6. no-refit-branch mutation overflows boxH on a wide-short container (invariant 3 is load-bearing)', () => {
  const buggy = (W, H) => {
    const boxW = Math.max(320, W - 272 * 2);
    const boxH = Math.max(180, H - 56 - 16);
    const w = boxW, h = (w * 9) / 16; // NO refit
    return { w, h, boxH };
  };
  const b = buggy(4000, 400);
  assert.ok(Math.abs(b.w / b.h - 16 / 9) < EPS, 'buggy form is still 16:9 (so invariant 1 misses it)');
  assert.ok(b.h > b.boxH, 'buggy form overflows boxH — invariant 3 fires');
});

console.log(`\nframe169-rect: ${passed} passed, 0 failed`);
