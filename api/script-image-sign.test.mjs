/*
 * script-image-sign.test.mjs — the sign endpoint's mp4 allowance (gif→mp4 optimization)
 * and, MORE IMPORTANT, the negative space around it: the shared QSS image map must NOT
 * have changed. mediaStorageMeta is a LOCAL wrapper on this endpoint only — video/mp4
 * resolves here and nowhere else; every QSS upload endpoint keeps coercing video/* to
 * the safe png default exactly as before.
 *
 * Run: bun api/script-image-sign.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { mediaStorageMeta, MAX_SIGNED_BYTES } from './script-image-sign.js';
import { imageStorageMeta } from './_lib/image-storage.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

ok('mediaStorageMeta: video/mp4 → mp4/mp4 (the transcoded-gif road)', () => {
  assert.deepEqual(mediaStorageMeta('video/mp4'), { mime: 'video/mp4', ext: 'mp4' });
  // Sloppy clients: trim + lowercase before the match, same posture as imageStorageMeta.
  assert.deepEqual(mediaStorageMeta('  VIDEO/MP4  '), { mime: 'video/mp4', ext: 'mp4' });
});

ok('mediaStorageMeta defers everything non-mp4 to imageStorageMeta unchanged', () => {
  for (const m of ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'text/html', 'image/svg+xml', 'video/webm', '', null]) {
    assert.deepEqual(mediaStorageMeta(m), imageStorageMeta(m), `defers for ${JSON.stringify(m)}`);
  }
  // The coercions that matter, spelled out: gif stays gif; documents coerce to safe png.
  assert.deepEqual(mediaStorageMeta('image/gif'), { mime: 'image/gif', ext: 'gif' });
  assert.deepEqual(mediaStorageMeta('text/html'), { mime: 'image/png', ext: 'png' });
  // video/webm is NOT allow-listed — only the mp4 the transcoder actually emits.
  assert.deepEqual(mediaStorageMeta('video/webm'), { mime: 'image/png', ext: 'png' });
});

ok('THE SHARED QSS MAP IS UNCHANGED: imageStorageMeta still coerces video/mp4 → png', () => {
  // LOAD-BEARING NEGATIVE TEST. imageStorageMeta is shared by qss-image-upload, qss-cast,
  // qss-scene-illustrate, and qss-explorer. If video/mp4 ever resolves THERE, every QSS
  // public bucket silently opens to video uploads. The mp4 allowance must live only in
  // this endpoint's local mediaStorageMeta wrapper — this assertion going red means the
  // shared ALLOWED map was widened, which is the exact change this design forbids.
  assert.deepEqual(imageStorageMeta('video/mp4'), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(imageStorageMeta('VIDEO/MP4'), { mime: 'image/png', ext: 'png' });
});

ok('MAX_SIGNED_BYTES still admits the real 78MB reference gif (and its mp4)', () => {
  assert.equal(MAX_SIGNED_BYTES, 100 * 1024 * 1024);
  assert.ok(78 * 1024 * 1024 < MAX_SIGNED_BYTES);
});

console.log(`script-image-sign.test.mjs: ${pass} assertions passed`);
