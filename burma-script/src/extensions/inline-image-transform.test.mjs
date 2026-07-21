/*
 * inline-image-transform.test.mjs — the BOUNDED inline-render path (blocks.js).
 *
 * The rack renders reference STILLS inline at a bounded width via Supabase's /render/image
 * transform endpoint (WebP-auto-negotiated), so a 300-still Nile script downloads ~12MB inline
 * instead of ~300MB of full-res PNG originals. Full res is one click away — the lightbox and the
 * DOWNLOAD button read the RAW src, never these helpers. Locked here:
 *
 *   1. supabaseInlineSrc — rewrites ONLY our public storage URLs to the transform endpoint;
 *      leaves bundled /palau2/img/*, foreign hosts, videos, and already-query'd/signed URLs alone.
 *   2. pickInlineWidth — snaps a target width (× DPR, capped ×2) UP to a small fixed ladder so the
 *      CDN caches a handful of variants, not one per pixel.
 *   3. isRenderTransformSrc — the predicate the nodeview's error handler uses to tell a failed
 *      TRANSFORM (fall back to original) from a genuinely broken original (leave it).
 *
 * Run: bun burma-script/src/extensions/inline-image-transform.test.mjs  (auto-discovered)
 */
import assert from 'node:assert/strict';
import {
  supabaseInlineSrc, pickInlineWidth, isRenderTransformSrc, INLINE_WIDTH_LADDER, isVideoSrc,
} from './blocks.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

const PUB = 'https://x.supabase.co/storage/v1/object/public/script-images/scripts/_ca/abc.png';
const RENDER = 'https://x.supabase.co/storage/v1/render/image/public/script-images/scripts/_ca/abc.png';

ok('supabaseInlineSrc: rewrites our public storage URL to the render endpoint with width+quality', () => {
  assert.equal(supabaseInlineSrc(PUB, 768), RENDER + '?width=768&quality=78');
  assert.equal(supabaseInlineSrc(PUB, 480, 60), RENDER + '?width=480&quality=60');
  assert.ok(isRenderTransformSrc(supabaseInlineSrc(PUB, 768)), 'result is a transform URL');
});

ok('supabaseInlineSrc: quality clamped to 1..100 (0 falls back to the 78 default)', () => {
  assert.match(supabaseInlineSrc(PUB, 768, 0.4), /quality=1$/);   // truthy sub-1 → rounds to 0 → clamped to 1
  assert.match(supabaseInlineSrc(PUB, 768, 999), /quality=100$/); // over-100 → 100
  assert.match(supabaseInlineSrc(PUB, 768, 0), /quality=78$/);    // falsy → the default
});

ok('supabaseInlineSrc: leaves NON-eligible srcs byte-identical', () => {
  // Bundled/relative bundled path — the existing static /palau2/img/* shape.
  assert.equal(supabaseInlineSrc('/palau2/img/frame01.jpg', 768), '/palau2/img/frame01.jpg');
  // Foreign host (not our storage marker).
  assert.equal(supabaseInlineSrc('https://cdn.other.com/a.png', 768), 'https://cdn.other.com/a.png');
  // A video src is never transformed (the endpoint is image-only).
  const vid = 'https://x.supabase.co/storage/v1/object/public/script-images/scripts/_ca/clip.mp4';
  assert.ok(isVideoSrc(vid));
  assert.equal(supabaseInlineSrc(vid, 768), vid);
  // Already-query'd / signed URL — don't risk doubling params or transforming a token'd object.
  const signed = PUB + '?token=xyz';
  assert.equal(supabaseInlineSrc(signed, 768), signed);
  // Empty / zero width → unchanged.
  assert.equal(supabaseInlineSrc('', 768), '');
  assert.equal(supabaseInlineSrc(PUB, 0), PUB);
});

ok('pickInlineWidth: snaps UP to the ladder, DPR-aware (capped ×2), tops out at the max rung', () => {
  const top = INLINE_WIDTH_LADDER[INLINE_WIDTH_LADDER.length - 1]; // 1440
  assert.equal(pickInlineWidth(300, 1), 480);      // 300 → first rung ≥ 300
  assert.equal(pickInlineWidth(500, 1), 768);      // 500 → 768
  assert.equal(pickInlineWidth(400, 2), 1080);     // 400×2 = 800 → first rung ≥ 800 is 1080
  assert.equal(pickInlineWidth(720, 1), 768);      // 720 → 768
  assert.equal(pickInlineWidth(9999, 1), top);     // beyond the ladder → clamp to top (lightbox has full res)
  assert.equal(pickInlineWidth(500, 5), 1080);     // DPR capped at ×2 → 1000 → 1080 (5× never applied)
  assert.equal(pickInlineWidth(0, 1), 768);        // 0 falls back to the 720 default box width → 768
});

ok('isRenderTransformSrc: true only for the render endpoint', () => {
  assert.ok(isRenderTransformSrc(RENDER));
  assert.ok(!isRenderTransformSrc(PUB));
  assert.ok(!isRenderTransformSrc('/palau2/img/x.png'));
  assert.ok(!isRenderTransformSrc(''));
});

console.log(`inline-image-transform.test.mjs: ${pass} assertions passed`);
