/*
 * script-image-sign-allowlist.test.mjs — server-side ENFORCEMENT on the signed-upload road.
 *
 * The sign endpoint used to coerce any junk mimeType to a safe png label but still MINT the
 * signed URL. Now the declared type must be in SIGNABLE_MIMES (the client's media map:
 * png/jpeg/jpg/webp/gif + the transcoder's video/mp4) or the request is 415-refused before
 * any token exists. The size cap (100MB → 413) is locked here too, driving the REAL handler
 * with mock Requests and a stubbed fetch — no network.
 *
 * Run: bun api/script-image-sign-allowlist.test.mjs
 */
import assert from 'node:assert/strict';

// Env before import: open access mode (no ACCESS_CODE) so checkAccess passes in the tests.
delete process.env.ACCESS_CODE;
process.env.SUPABASE_URL = 'https://supa.test';
process.env.SUPABASE_SERVICE_KEY = 'service-key';

const mod = await import('./script-image-sign.js');
const { default: handler, SIGNABLE_MIMES, isSignableMime, MAX_SIGNED_BYTES } = mod;

// ── fetch stub: plays the Supabase sign endpoint, records whether it was ever reached ──
let signCalls = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/storage/v1/object/upload/sign/')) {
    signCalls++;
    return new Response(JSON.stringify({ url: '/object/upload/sign/script-images/x?token=t' }), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${u}`);
};

function post(payload) {
  return new Request('https://example.test/api/script-image-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

let passed = 0;
async function t(name, fn) {
  signCalls = 0;
  try { await fn(); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
}

/* ---- the pure allowlist mirrors the client media map exactly ---- */
await t('SIGNABLE_MIMES is exactly the client image map + the video set', async () => {
  // SUPPORTED_IMAGE_MIMES + SUPPORTED_VIDEO_MIMES in burma-script/src/extensions/image-drop.js —
  // kept literal here so a drift on either side goes red (the extension module is too heavy to
  // import headlessly).
  const clientImages = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
  const clientVideos = ['video/mp4', 'video/webm', 'video/quicktime'];
  assert.deepEqual([...SIGNABLE_MIMES].sort(), [...clientImages, ...clientVideos].sort());
});

await t('isSignableMime: trims + lowercases, accepts the video set, refuses everything off-map', async () => {
  assert.equal(isSignableMime('  IMAGE/PNG '), true);
  assert.equal(isSignableMime('video/mp4'), true);
  assert.equal(isSignableMime('VIDEO/WEBM'), true, 'webm allowed (direct paste)');
  assert.equal(isSignableMime(' video/quicktime '), true, 'mov allowed (direct paste)');
  for (const bad of ['text/html', 'image/svg+xml', 'application/pdf', 'video/avi', 'video/x-matroska', '', null, undefined]) {
    assert.equal(isSignableMime(bad), false, `must refuse ${JSON.stringify(bad)}`);
  }
});

/* ---- handler: off-map mime → 415, no signed URL ever minted ---- */
await t('handler 415-refuses a junk mimeType BEFORE minting a token', async () => {
  for (const bad of ['text/html', 'application/pdf', 'video/avi', '']) {
    const res = await handler(post({ project: 'burma', block_id: 'b1', mimeType: bad, sizeBytes: 1024 }));
    assert.equal(res.status, 415, `expected 415 for ${JSON.stringify(bad)}`);
    const out = await res.json();
    assert.equal(out.error, 'unsupported_media_type');
    assert.ok(Array.isArray(out.allowed) && out.allowed.includes('image/png'), 'names the allowed list');
  }
  assert.equal(signCalls, 0, 'the Supabase sign endpoint must never be reached for a refused mime');
});

/* ---- handler: size cap → 413, no signed URL ever minted ---- */
await t('handler 413-refuses over-cap sizeBytes before minting', async () => {
  const res = await handler(post({ project: 'burma', block_id: 'b1', mimeType: 'image/gif', sizeBytes: MAX_SIGNED_BYTES + 1 }));
  assert.equal(res.status, 413);
  const out = await res.json();
  assert.equal(out.error, 'image_too_large');
  assert.equal(out.maxBytes, MAX_SIGNED_BYTES);
  assert.equal(signCalls, 0, 'no token for an over-cap declaration');
});

/* ---- the happy road is untouched (gif + the transcoded mp4 both still sign) ---- */
await t('handler still signs the real roads: image/gif, the video set, and jpg', async () => {
  const roads = [['image/gif', 'gif'], ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/quicktime', 'mov'], ['IMAGE/JPG', 'jpg']];
  for (const [mime, ext] of roads) {
    const res = await handler(post({ project: 'burma', block_id: 'b1', mimeType: mime, sizeBytes: 78 * 1024 * 1024 }));
    assert.equal(res.status, 200, `expected 200 for ${mime}`);
    const out = await res.json();
    assert.equal(out.ok, true);
    assert.ok(out.uploadUrl.startsWith('https://supa.test/storage/v1/'), 'uploadUrl shape unchanged');
    assert.ok(out.path.endsWith('.' + ext), `path extension derives from the normalized mime (${mime} → .${ext})`);
    assert.ok(out.publicUrl.includes('/object/public/script-images/'), 'publicUrl shape unchanged');
  }
  assert.equal(signCalls, roads.length);
});

console.log(`script-image-sign-allowlist: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
