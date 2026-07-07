/*
 * gif-transcode.test.mjs — the gif→mp4 optimizer's DECISION GATE + pure geometry
 * (extensions/gif-transcode.js). The actual transcode (transcodeGifToMp4) is WebCodecs —
 * ImageDecoder + VideoEncoder exist only in a real browser, NOT under bun — so the full
 * encode is deliberately behind hasGifTranscodeSupport and verified with the live-browser
 * check (agent-browser against the dev server), not here. What IS locked here:
 *
 *   1. isGifTranscodeCandidate — mime must be image/gif (case-insensitive), size must be
 *      STRICTLY over 2MB. Small gifs and every non-gif ride the existing road untouched.
 *   2. hasGifTranscodeSupport — all three of ImageDecoder / VideoEncoder / OffscreenCanvas
 *      required; env-injectable so the matrix runs headless. Under bare bun it is FALSE —
 *      which is exactly the production fallback story on a non-WebCodecs browser.
 *   3. shouldTranscodeGif — candidate AND capability; the single predicate image-drop.js
 *      trusts after its cheap pre-gate.
 *   4. evenDims — H.264 4:2:0 requires even dimensions; the real MapKeys gif is 1304×653
 *      (ODD height) and must crop to 1304×652. Floor-to-even, never scale, never below 2.
 *   5. pickAvcLevelHex — the codec-string level byte fits the macroblock budget
 *      (1304×652@12fps lands on level 3.1).
 *
 * Run: bun burma-script/src/extensions/gif-transcode.test.mjs  (auto-discovered)
 */
import assert from 'node:assert/strict';
import {
  GIF_TRANSCODE_MIN_BYTES, isGifTranscodeCandidate, hasGifTranscodeSupport,
  shouldTranscodeGif, evenDims, pickAvcLevelHex,
} from './gif-transcode.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

const MB = 1024 * 1024;
// A Chrome-shaped env stub — capability is three constructors existing, nothing more.
const CHROME = { ImageDecoder: function () {}, VideoEncoder: function () {}, OffscreenCanvas: function () {} };

// ── 1: candidate matrix — mime × size ──────────────────────────────────────────────────
ok('isGifTranscodeCandidate: only image/gif strictly over 2MB qualifies', () => {
  assert.equal(GIF_TRANSCODE_MIN_BYTES, 2 * MB, 'threshold constant unchanged');
  // The real file the feature exists for: 78MB image/gif.
  assert.equal(isGifTranscodeCandidate('image/gif', 78 * MB), true);
  // Case-insensitive mime (a sloppy Finder drag can report uppercase).
  assert.equal(isGifTranscodeCandidate('IMAGE/GIF', 10 * MB), true);
  // BOUNDARY: exactly 2MB is NOT "over 2MB" → no transcode (matches pickUploadRoute's
  // strict-comparator convention). One byte over → candidate.
  assert.equal(isGifTranscodeCandidate('image/gif', 2 * MB), false);
  assert.equal(isGifTranscodeCandidate('image/gif', 2 * MB + 1), true);
  // Small gifs stay gifs — <img> loops them natively, not worth an encode pass.
  assert.equal(isGifTranscodeCandidate('image/gif', 200 * 1024), false);
  // Non-gifs never transcode, whatever their size.
  assert.equal(isGifTranscodeCandidate('image/png', 78 * MB), false);
  assert.equal(isGifTranscodeCandidate('image/webp', 78 * MB), false);
  assert.equal(isGifTranscodeCandidate('video/mp4', 78 * MB), false);
  assert.equal(isGifTranscodeCandidate('', 78 * MB), false);
  assert.equal(isGifTranscodeCandidate(undefined, 78 * MB), false);
  // Junk size coerces via Number(): NaN > x is false → not a candidate (safe default).
  assert.equal(isGifTranscodeCandidate('image/gif', undefined), false);
});

// ── 2: capability gate — all three WebCodecs pieces, env-injectable ─────────────────────
ok('hasGifTranscodeSupport: needs ImageDecoder + VideoEncoder + OffscreenCanvas', () => {
  assert.equal(hasGifTranscodeSupport(CHROME), true);
  assert.equal(hasGifTranscodeSupport({ ...CHROME, ImageDecoder: undefined }), false);
  assert.equal(hasGifTranscodeSupport({ ...CHROME, VideoEncoder: undefined }), false);
  assert.equal(hasGifTranscodeSupport({ ...CHROME, OffscreenCanvas: undefined }), false);
  assert.equal(hasGifTranscodeSupport({}), false);
  // Under bare bun there is no WebCodecs — the gate is FALSE here, which IS the
  // production fallback path (upload the original gif). The live encode needs the
  // real-browser check; it can never be exercised in this suite.
  assert.equal(hasGifTranscodeSupport(), false);
});

// ── 3: the single predicate image-drop.js trusts ────────────────────────────────────────
ok('shouldTranscodeGif: candidate AND capability AND a real file', () => {
  const bigGif = { type: 'image/gif', size: 78 * MB };
  assert.equal(shouldTranscodeGif(bigGif, CHROME), true);
  assert.equal(shouldTranscodeGif({ type: 'image/gif', size: 1 * MB }, CHROME), false, 'small gif');
  assert.equal(shouldTranscodeGif({ type: 'image/png', size: 78 * MB }, CHROME), false, 'not a gif');
  assert.equal(shouldTranscodeGif(bigGif, {}), false, 'no WebCodecs → fall back to the gif road');
  assert.equal(shouldTranscodeGif(null, CHROME), false, 'no file');
});

// ── 4: even-dimension crop — the 1304×653 case the feature was built against ───────────
ok('evenDims floors odd dimensions to even (crop, never scale, never below 2)', () => {
  // THE real MapKeys reference gif: odd height crops one bottom row.
  assert.deepEqual(evenDims(1304, 653), { width: 1304, height: 652 });
  // Already-even dims pass through untouched (no-crop fast path in the encoder loop).
  assert.deepEqual(evenDims(1304, 652), { width: 1304, height: 652 });
  assert.deepEqual(evenDims(1920, 1080), { width: 1920, height: 1080 });
  // Odd width crops too.
  assert.deepEqual(evenDims(653, 1304), { width: 652, height: 1304 });
  // Degenerate 1px never collapses to 0 (H.264 min is 2).
  assert.deepEqual(evenDims(1, 1), { width: 2, height: 2 });
});

// ── 5: level pick fits the macroblock budget ────────────────────────────────────────────
ok('pickAvcLevelHex: 1304×652@12 → 3.1; 1080p30 → 4.0; tiny → 3.0; huge → 5.1', () => {
  // 82×41 = 3362 MBs ≤ 3600 (level 3.1), 3362×12 = 40344 MB/s ≤ 108000 — the real file.
  assert.equal(pickAvcLevelHex(1304, 652, 12), '1f');
  // 120×68 = 8160 MBs needs level 4.0's 8192 budget.
  assert.equal(pickAvcLevelHex(1920, 1080, 30), '28');
  // 40×23 = 920 MBs fits level 3.0.
  assert.equal(pickAvcLevelHex(640, 360, 12), '1e');
  // 4K falls through to 5.1.
  assert.equal(pickAvcLevelHex(3840, 2160, 30), '33');
});

console.log(`gif-transcode.test.mjs: ${pass} assertions passed`);
