// Tests for api/script-image-upload.js — the script engine's dropped/pasted-image
// upload endpoint (near-clone of qss-image-upload, bucket `script-images`).
//
// WHY it matters: this endpoint is what keeps image BYTES out of the script doc —
// the client uploads here first and only the returned public CDN URL enters
// imageBlock.attrs.src (see burma-script/src/extensions/image-drop.js). So the
// contract under test is the storage-safety surface:
//   • imageStorageMeta mime coercion (public bucket must never serve text/html,
//     image/svg+xml, or an untranscoded HEIC's real mime) — path ext + served
//     Content-Type always agree;
//   • safeSlug path-segment guard (no traversal via project/block_id);
//   • the 8MB decoded-size ceiling (413, computed WITHOUT decoding);
//   • bad_base64 → 400, storage failure → 502, method/auth gates.
//
// The Supabase storage call is mocked at globalThis.fetch, so the FULL edge
// handler runs headless (bun ships Request/Response natively).
//
// Run: bun api/script-image-upload.test.mjs   (auto-discovered by scripts/run-tests.mjs)

import assert from 'node:assert';

// Env BEFORE import — the module reads SUPABASE_URL/KEY at load time.
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
delete process.env.ACCESS_CODE; // dev-mode gate for most tests; re-set for the 401 test

const {
  default: handler,
  safeSlug,
  base64DecodedBytes,
  buildImagePath,
  buildHashImagePath,
  isContentHash,
  MAX_DECODED_BYTES,
} = await import('./script-image-upload.js');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ── fetch mock: capture the storage upload, respond as told ──────────────────
const realFetch = globalThis.fetch;
let lastUpload = null;
let storageStatus = 200;
let infoStatus = 400;      // dedupe existence probe: 400 = object absent (Supabase's missing code)
let infoCalls = 0;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/object/info/')) { infoCalls++; return new Response(infoStatus === 200 ? '{}' : 'missing', { status: infoStatus }); }
  lastUpload = { url: u, init: init || {} };
  return new Response(storageStatus === 200 ? '{}' : 'boom', { status: storageStatus });
};
const HASH = 'a'.repeat(64); // a valid lowercase-hex SHA-256

const post = (body, headers) => new Request('http://localhost/api/script-image-upload', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers || {}) },
  body: JSON.stringify(body),
});
const PNG_B64 = btoa('not-really-png-bytes-but-bytes');

// ── pure helpers ──────────────────────────────────────────────────────────────
await t('base64DecodedBytes: exact for no/one/two padding chars', () => {
  assert.strictEqual(base64DecodedBytes(''), 0);
  assert.strictEqual(base64DecodedBytes(btoa('abc')), 3);   // no padding
  assert.strictEqual(base64DecodedBytes(btoa('abcd')), 4);  // == padding
  assert.strictEqual(base64DecodedBytes(btoa('abcde')), 5); // = padding
});
await t('buildImagePath: scripts/<project>/<blockId>-<stamp>.<ext>', () => {
  assert.strictEqual(buildImagePath('burma', 'image_abc1234', 'png', 'zz9'), 'scripts/burma/image_abc1234-zz9.png');
});
await t('buildImagePath: traversal characters stripped from both segments', () => {
  const p = buildImagePath('../evil', 'a/b.c', 'png', 's1');
  assert.strictEqual(p, 'scripts/evil/abc-s1.png');
  assert.ok(!p.includes('..'), 'no dot-dot survives');
});
await t('buildImagePath: empty ids fall back to safe defaults', () => {
  assert.strictEqual(buildImagePath('', '', 'jpg', 's1'), 'scripts/no-project/no-block-s1.jpg');
});
await t('safeSlug strips outside [A-Za-z0-9_-] and caps length', () => {
  assert.strictEqual(safeSlug('../../etc/passwd'), 'etcpasswd');
  assert.strictEqual(safeSlug('x'.repeat(200), 40).length, 40);
  assert.strictEqual(safeSlug(null), '');
});

// ── method + auth gates ───────────────────────────────────────────────────────
await t('OPTIONS → 204 with CORS', async () => {
  const res = await handler(new Request('http://x/api/script-image-upload', { method: 'OPTIONS' }));
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
});
await t('GET → 405', async () => {
  const res = await handler(new Request('http://x/api/script-image-upload', { method: 'GET' }));
  assert.strictEqual(res.status, 405);
});
await t('checkAccess denial passes through as 401 (with CORS re-applied)', async () => {
  process.env.ACCESS_CODE = 'sesame';
  try {
    const res = await handler(post({ dataBase64: PNG_B64 }, { 'x-access-code': 'wrong' }));
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
  } finally {
    delete process.env.ACCESS_CODE;
  }
});

// ── body validation ───────────────────────────────────────────────────────────
await t('missing dataBase64 → 400', async () => {
  const res = await handler(post({ project: 'burma', block_id: 'image_x' }));
  assert.strictEqual(res.status, 400);
});
await t('non-object JSON body → 400 (readJsonBody)', async () => {
  const res = await handler(new Request('http://x/api/script-image-upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null',
  }));
  assert.strictEqual(res.status, 400);
});
await t('oversized image (decoded > 8MB) → 413 BEFORE any decode/upload', async () => {
  lastUpload = null;
  // 4 base64 chars per 3 bytes: this string decodes to just over the ceiling.
  const big = 'A'.repeat(Math.ceil((MAX_DECODED_BYTES + 4) / 3) * 4);
  const res = await handler(post({ project: 'burma', block_id: 'image_x', dataBase64: big }));
  assert.strictEqual(res.status, 413);
  assert.strictEqual(lastUpload, null, 'storage never touched');
});
await t('garbage base64 → 400 bad_base64', async () => {
  const res = await handler(post({ project: 'burma', block_id: 'image_x', dataBase64: '!!!!' }));
  assert.strictEqual(res.status, 400);
  const out = await res.json();
  assert.strictEqual(out.error, 'bad_base64');
});

// ── happy path + storage contract ─────────────────────────────────────────────
await t('png upload → 200 {ok,url,path}; bucket/path/headers correct', async () => {
  storageStatus = 200; lastUpload = null;
  const res = await handler(post({ project: 'burma', block_id: 'image_abc1234', dataBase64: PNG_B64, mimeType: 'image/png' }));
  assert.strictEqual(res.status, 200);
  const out = await res.json();
  assert.strictEqual(out.ok, true);
  assert.match(out.path, /^scripts\/burma\/image_abc1234-[a-z0-9]+\.png$/);
  assert.strictEqual(out.url, `https://fake-project.supabase.co/storage/v1/object/public/script-images/${out.path}`);
  assert.ok(lastUpload.url.includes('/storage/v1/object/script-images/'), 'uploads into the script-images bucket');
  assert.strictEqual(lastUpload.init.headers['Content-Type'], 'image/png');
  assert.strictEqual(lastUpload.init.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.strictEqual(lastUpload.init.headers['x-upsert'], 'true');
});
await t('mime coercion: image/heic (macOS Photos) stored as safe image/png', async () => {
  const res = await handler(post({ project: 'burma', block_id: 'image_h', dataBase64: PNG_B64, mimeType: 'image/heic' }));
  const out = await res.json();
  assert.ok(out.path.endsWith('.png'));
  assert.strictEqual(lastUpload.init.headers['Content-Type'], 'image/png');
});
await t('mime coercion: text/html never served from the public bucket', async () => {
  const res = await handler(post({ project: 'burma', block_id: 'image_t', dataBase64: PNG_B64, mimeType: 'text/html' }));
  const out = await res.json();
  assert.ok(out.path.endsWith('.png'));
  assert.strictEqual(lastUpload.init.headers['Content-Type'], 'image/png');
});
await t('mime normalization: image/jpg → .jpg path + image/jpeg Content-Type (always agree)', async () => {
  const res = await handler(post({ project: 'palau2', block_id: 'image_j', dataBase64: PNG_B64, mimeType: 'image/jpg' }));
  const out = await res.json();
  assert.ok(out.path.endsWith('.jpg'));
  assert.strictEqual(lastUpload.init.headers['Content-Type'], 'image/jpeg');
});
await t('path traversal via project/block_id is neutralized in the storage path', async () => {
  const res = await handler(post({ project: '../../buckets', block_id: 'a/b.c', dataBase64: PNG_B64 }));
  const out = await res.json();
  assert.match(out.path, /^scripts\/buckets\/abc-[a-z0-9]+\.png$/);
});

// ── storage failure is loud, never a fake success ─────────────────────────────
await t('storage 500 → handler 502 storage_upload_failed', async () => {
  storageStatus = 500;
  const res = await handler(post({ project: 'burma', block_id: 'image_f', dataBase64: PNG_B64 }));
  assert.strictEqual(res.status, 502);
  const out = await res.json();
  assert.strictEqual(out.error, 'storage_upload_failed');
  storageStatus = 200;
});

// ── CONTENT-HASH DEDUPE ───────────────────────────────────────────────────────
await t('isContentHash: exactly 64 lowercase hex is a hash; anything else is not', () => {
  assert.ok(isContentHash(HASH));
  assert.ok(isContentHash('0123456789abcdef'.repeat(4)));
  assert.ok(isContentHash(HASH.toUpperCase()), 'uppercase normalized to lowercase, then matches');
  assert.ok(!isContentHash('a'.repeat(63)), 'too short');
  assert.ok(!isContentHash('a'.repeat(65)), 'too long');
  assert.ok(!isContentHash('g'.repeat(64)), 'non-hex');
  assert.ok(!isContentHash(''), 'empty');
  assert.ok(!isContentHash(undefined), 'undefined');
});
await t('buildHashImagePath: content-addressed, project-independent scripts/_ca/<hash>.<ext>', () => {
  assert.strictEqual(buildHashImagePath(HASH, 'png'), `scripts/_ca/${HASH}.png`);
  assert.strictEqual(buildHashImagePath(HASH.toUpperCase(), 'webp'), `scripts/_ca/${HASH}.webp`);
});
await t('dedupe HIT: existing object → deduped url, ZERO upload bytes moved', async () => {
  infoStatus = 200; infoCalls = 0; lastUpload = null;
  const res = await handler(post({ project: 'nile', block_id: 'image_x', dataBase64: PNG_B64, contentHash: HASH }));
  assert.strictEqual(res.status, 200);
  const out = await res.json();
  assert.strictEqual(out.deduped, true);
  assert.strictEqual(out.path, `scripts/_ca/${HASH}.png`);
  assert.match(out.url, new RegExp(`/object/public/script-images/scripts/_ca/${HASH}\\.png$`));
  assert.strictEqual(infoCalls, 1, 'existence probed once');
  assert.strictEqual(lastUpload, null, 'no PUT/POST of bytes on a dedupe hit');
});
await t('dedupe MISS: absent object → uploads to the content-addressed path', async () => {
  infoStatus = 400; lastUpload = null;
  const res = await handler(post({ project: 'nile', block_id: 'image_y', dataBase64: PNG_B64, contentHash: HASH }));
  assert.strictEqual(res.status, 200);
  const out = await res.json();
  assert.ok(!out.deduped, 'not a dedupe hit');
  assert.strictEqual(out.path, `scripts/_ca/${HASH}.png`);
  assert.ok(lastUpload && lastUpload.url.includes(`/script-images/scripts/_ca/${HASH}.png`), 'bytes uploaded to the hash path');
});
await t('no contentHash → legacy stamped path, dedupe machinery untouched', async () => {
  infoCalls = 0; lastUpload = null; storageStatus = 200;
  const res = await handler(post({ project: 'nile', block_id: 'image_z', dataBase64: PNG_B64 }));
  const out = await res.json();
  assert.match(out.path, /^scripts\/nile\/image_z-[a-z0-9]+\.png$/);
  assert.ok(!out.path.includes('_ca'), 'not content-addressed');
  assert.strictEqual(infoCalls, 0, 'no existence probe without a hash');
});
await t('invalid contentHash (bad length) is ignored → stamped path, no probe', async () => {
  infoCalls = 0;
  const res = await handler(post({ project: 'nile', block_id: 'image_w', dataBase64: PNG_B64, contentHash: 'nope' }));
  const out = await res.json();
  assert.ok(!out.path.includes('_ca'));
  assert.strictEqual(infoCalls, 0);
});

globalThis.fetch = realFetch;
console.log(`\nscript-image-upload: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
