/*
 * script-image-sign.test.mjs — the sign endpoint's VIDEO allowance (gif→mp4 optimization +
 * direct mp4/webm/mov paste) and, MORE IMPORTANT, the negative space around it: the shared
 * QSS image map must NOT have changed. mediaStorageMeta is a LOCAL wrapper on this endpoint
 * only — the video set resolves here and nowhere else; every QSS upload endpoint keeps
 * coercing video/* to the safe png default exactly as before.
 *
 * Run: bun api/script-image-sign.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { imageStorageMeta } from './_lib/image-storage.js';

// Env BEFORE the dynamic import — the module reads SUPABASE_URL/KEY at load; access code off = dev.
// (Must be a dynamic import, not a static one: a static import hoists ABOVE this env setup and the
// module would capture empty env, 500-ing every handler test below.)
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
delete process.env.ACCESS_CODE;
const { mediaStorageMeta, MAX_SIGNED_BYTES, default: signHandler } = await import('./script-image-sign.js');

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

ok('mediaStorageMeta: the video set resolves locally (mp4 transcode + direct webm/mov paste)', () => {
  assert.deepEqual(mediaStorageMeta('video/mp4'), { mime: 'video/mp4', ext: 'mp4' });
  // Sloppy clients: trim + lowercase before the match, same posture as imageStorageMeta.
  assert.deepEqual(mediaStorageMeta('  VIDEO/MP4  '), { mime: 'video/mp4', ext: 'mp4' });
  // Direct video pastes (image-drop.js): webm/mov keep their container so isVideoSrc forks on them.
  assert.deepEqual(mediaStorageMeta('video/webm'), { mime: 'video/webm', ext: 'webm' });
  assert.deepEqual(mediaStorageMeta('VIDEO/QUICKTIME'), { mime: 'video/quicktime', ext: 'mov' });
});

ok('mediaStorageMeta defers every non-video type to imageStorageMeta unchanged', () => {
  for (const m of ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'text/html', 'image/svg+xml', '', null]) {
    assert.deepEqual(mediaStorageMeta(m), imageStorageMeta(m), `defers for ${JSON.stringify(m)}`);
  }
  // The coercions that matter, spelled out: gif stays gif; documents coerce to safe png.
  assert.deepEqual(mediaStorageMeta('image/gif'), { mime: 'image/gif', ext: 'gif' });
  assert.deepEqual(mediaStorageMeta('text/html'), { mime: 'image/png', ext: 'png' });
  // An UNSUPPORTED video container is still not allow-listed → defers to the safe png default.
  assert.deepEqual(mediaStorageMeta('video/x-matroska'), { mime: 'image/png', ext: 'png' });
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

// ── CONTENT-HASH DEDUPE on the signed road ────────────────────────────────────
// The signed road never carries bytes through the edge fn — a dedupe HIT returns the public URL
// with NO uploadUrl so the browser skips the PUT entirely (zero bytes moved for a re-used 60MB gif).
const SHASH = 'b'.repeat(64);
const realFetch = globalThis.fetch;
let infoStatus = 400, signCalls = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/object/info/')) return new Response(infoStatus === 200 ? '{}' : 'x', { status: infoStatus });
  if (u.includes('/object/upload/sign/')) { signCalls++; return new Response(JSON.stringify({ url: '/object/upload/sign/script-images/p?token=tok' }), { status: 200 }); }
  return new Response('{}', { status: 200 });
};
const signReq = (body) => new Request('http://localhost/api/script-image-sign', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const asyncOk = async (label, fn) => { await fn(); pass++; console.log('  ✓ ' + label); };

await asyncOk('dedupe HIT: existing object → deduped publicUrl, NO uploadUrl, sign NOT called', async () => {
  infoStatus = 200; signCalls = 0;
  const res = await signHandler(signReq({ project: 'nile', block_id: 'image_v', mimeType: 'video/mp4', sizeBytes: 60 * 1024 * 1024, contentHash: SHASH }));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.deduped, true);
  assert.ok(!out.uploadUrl, 'no signed upload URL on a dedupe hit');
  assert.match(out.publicUrl, new RegExp(`/object/public/script-images/scripts/_ca/${SHASH}\\.mp4$`));
  assert.equal(signCalls, 0, 'never minted a signed URL');
});
await asyncOk('dedupe MISS: absent object → mints a signed URL for the content-addressed path', async () => {
  infoStatus = 400; signCalls = 0;
  const res = await signHandler(signReq({ project: 'nile', block_id: 'image_v', mimeType: 'video/mp4', sizeBytes: 60 * 1024 * 1024, contentHash: SHASH }));
  const out = await res.json();
  assert.ok(!out.deduped);
  assert.ok(out.uploadUrl, 'signed upload URL present');
  assert.equal(out.path, `scripts/_ca/${SHASH}.mp4`);
  assert.equal(signCalls, 1);
});
await asyncOk('no contentHash → stamped path, no existence probe, byte-for-byte legacy behavior', async () => {
  signCalls = 0;
  const res = await signHandler(signReq({ project: 'nile', block_id: 'image_v', mimeType: 'image/png', sizeBytes: 1000, contentHash: 'bad' }));
  const out = await res.json();
  assert.ok(!out.path.includes('_ca'));
  assert.match(out.path, /^scripts\/nile\/image_v-[a-z0-9]+\.png$/);
});
globalThis.fetch = realFetch;

console.log(`script-image-sign.test.mjs: ${pass} assertions passed`);
