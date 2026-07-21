// script engine (burma/palau/scripts-library): mint a SIGNED DIRECT-UPLOAD URL so the
// browser can PUT big image bytes (animated GIFs up to 25MB) straight into Supabase
// Storage — bypassing this platform's request-body ceiling entirely.
//
// WHY A SECOND ENDPOINT — /api/script-image-upload carries bytes as base64 JSON through a
// Vercel edge function, which caps out around ~4.5MB of body (MAX_DECODED_BYTES holds 8MB
// with the safety math, but the platform rejects large bodies first). Johnny's reference
// GIFs run ~20MB. A signed upload URL moves ONLY a token through Vercel; the bytes go
// browser → Supabase CDN directly. Same bucket, same stamped never-overwrite path shape,
// same public-URL-only-in-the-doc law as the base64 route.
//
// SECURITY POSTURE — same as script-image-upload: checkAccess gate (signed-in JWT via the
// library's fetch interceptor), then a STRICT mime allowlist (SIGNABLE_MIMES below — a
// declared type outside the client's media map is 415-refused, never coerced), then
// mediaStorageMeta normalizes the Content-Type/extension to the raster allow-list PLUS
// video/mp4 (local wrapper below — the gif→mp4 transcode's output; the shared QSS
// imageStorageMeta map stays image-only). The signed token pins the exact path we mint
// here — a client can't redirect it. The token is single-use and expires in ~2h (Supabase
// default). Size is enforced here too: a declared sizeBytes over MAX_SIGNED_BYTES is a
// clean 413 before any token is minted.
//
// Body:     { project, block_id, mimeType, sizeBytes }
// Response: { ok, uploadUrl, path, publicUrl, mime }
//   client then: PUT uploadUrl, headers { Content-Type: mime, x-upsert: 'false' }, body: file

import { checkAccess } from './_lib/access.js';
import { withSentry } from './_lib/sentry.js';
import { imageStorageMeta } from './_lib/image-storage.js';
import { readJsonBody } from './_lib/read-json-body.js';
import { buildImagePath, buildHashImagePath, isContentHash, storageObjectExists } from './script-image-upload.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.QSS_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.QSS_SUPABASE_SERVICE_KEY || '';
const BUCKET = 'script-images';

// 100MB (was 25MB): Johnny's real MapKeys reference GIFs run 60MB+ — a 61MB file PUT to the
// bucket in ~4s (verified 2026-07-07). Still a ceiling so a mis-dropped screen recording gets
// a clean 413 with the limit named, not a mystery storage failure.
export const MAX_SIGNED_BYTES = 100 * 1024 * 1024;

// VIDEO ALLOWANCE — LOCAL to this endpoint, deliberately NOT in the shared image-storage
// ALLOWED map. Two video sources ride this signed road: the browser gif→mp4 transcode
// (gif-transcode.js) AND direct video pastes/drops (image-drop.js — mp4/webm/mov clipboard
// files). This signed road is the ONLY one that may store video; the base64 edge route
// (script-image-upload) stays image-only because its shared imageStorageMeta would coerce
// video → png. imageStorageMeta is shared with the QSS upload endpoints (qss-image-upload,
// qss-cast, qss-scene-illustrate, qss-explorer) — widening THAT map would silently open every
// QSS bucket to video. Every VIDEO_TYPES entry is a pure media type the browser plays in a
// <video>, never renders as a document, so the stored-content-type-injection concern the
// shared allowlist guards is untouched. Everything else defers to imageStorageMeta unchanged.
// Exported so the QSS-map-stays-image-only contract is a locked test.
// quicktime → .mov keeps the container extension so isVideoSrc (blocks.js) can fork on it.
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
export function mediaStorageMeta(rawMime) {
  const mime = String(rawMime ?? '').trim().toLowerCase();
  if (VIDEO_TYPES[mime]) return { mime, ext: VIDEO_TYPES[mime] };
  return imageStorageMeta(rawMime);
}

// STRICT ALLOWLIST — the declared mimeType must be one the client's media map actually
// produces, or the sign request is REFUSED (415) instead of silently coerced. Mirrors
// SUPPORTED_IMAGE_MIMES in burma-script/src/extensions/image-drop.js (png/jpeg/jpg/webp/gif)
// plus the video/mp4 the gif-transcode road emits — nothing else can even mint a signed URL.
// Why refuse rather than coerce: mediaStorageMeta's coercion made the STORED type safe, but
// it still handed a signed direct-upload URL to any junk declaration (application/pdf,
// text/html, video/webm…). The real client pre-gates drops against this exact set, so a
// mime outside it is never a legitimate upload — refusing at sign time closes the road
// entirely instead of politely re-labeling it. Exported (with the set) for tests.
export const SIGNABLE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', // client SUPPORTED_IMAGE_MIMES
  'video/mp4', 'video/webm', 'video/quicktime',                      // gif→mp4 transcode + direct video paste/drop
]);
export function isSignableMime(rawMime) {
  return SIGNABLE_MIMES.has(String(rawMime ?? '').trim().toLowerCase());
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

function j(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

export default withSentry(async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return j(405, { error: 'Method not allowed' });

  const denied = await checkAccess(req);
  if (denied) {
    const h = new Headers(denied.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(denied.body, { status: denied.status, headers: h });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) return j(500, { error: 'Supabase env not configured' });

  const _body = await readJsonBody(req);
  if (!_body.ok) return j(_body.status, { error: _body.error });
  const body = _body.body;

  const sizeBytes = Math.floor(Number(body.sizeBytes)) || 0;
  if (sizeBytes <= 0) return j(400, { error: 'sizeBytes required' });
  if (sizeBytes > MAX_SIGNED_BYTES) {
    return j(413, { error: 'image_too_large', maxBytes: MAX_SIGNED_BYTES });
  }

  if (!isSignableMime(body.mimeType)) {
    return j(415, { error: 'unsupported_media_type', allowed: [...SIGNABLE_MIMES] });
  }

  const { mime, ext } = mediaStorageMeta(body.mimeType);

  // DEDUPE (mirrors script-image-upload): a SHA-256 of the bytes routes to a content-addressed path.
  // If that object already exists, we return its public URL with deduped:true and NO uploadUrl — the
  // client skips the PUT entirely, so a 60MB reference GIF re-used across scripts moves ZERO bytes the
  // second time. No hash → the original stamped never-overwrite path, byte-for-byte as before.
  const hash = String(body.contentHash || '').toLowerCase();
  const deduping = isContentHash(hash);
  const path = deduping
    ? buildHashImagePath(hash, ext)
    : buildImagePath(body.project, body.block_id, ext, Date.now().toString(36));

  if (deduping && await storageObjectExists(SUPABASE_URL, SUPABASE_KEY, BUCKET, path)) {
    return j(200, {
      ok: true,
      path,
      publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`,
      mime,
      deduped: true,
    });
  }

  let signed;
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || !out.url) {
      return j(502, { error: 'sign_failed', detail: (out && (out.message || out.error)) || `http ${res.status}` });
    }
    signed = out.url; // relative: /object/upload/sign/<bucket>/<path>?token=…
  } catch (e) {
    return j(502, { error: 'sign_failed', detail: e?.message || String(e) });
  }

  return j(200, {
    ok: true,
    uploadUrl: `${SUPABASE_URL}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`,
    path,
    publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`,
    mime,
  });
});
