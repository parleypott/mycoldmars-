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
// library's fetch interceptor), imageStorageMeta coerces the Content-Type/extension to the
// raster allow-list (the signed token pins the exact path we mint here — a client can't
// redirect it), 25MB declared-size ceiling. The token is single-use and expires in ~2h
// (Supabase default). The declared size is advisory (Supabase enforces any bucket-level
// cap); the gate + tight mime coercion carry the real weight, as they do next door.
//
// Body:     { project, block_id, mimeType, sizeBytes }
// Response: { ok, uploadUrl, path, publicUrl, mime }
//   client then: PUT uploadUrl, headers { Content-Type: mime, x-upsert: 'false' }, body: file

import { checkAccess } from './_lib/access.js';
import { imageStorageMeta } from './_lib/image-storage.js';
import { readJsonBody } from './_lib/read-json-body.js';
import { buildImagePath } from './script-image-upload.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.QSS_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.QSS_SUPABASE_SERVICE_KEY || '';
const BUCKET = 'script-images';

// Generous enough for a 20MB reference GIF with headroom; small enough that a mis-dropped
// screen recording gets a clean 413 with the limit named, not a mystery storage failure.
export const MAX_SIGNED_BYTES = 25 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

function j(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

export default async function handler(req) {
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

  const { mime, ext } = imageStorageMeta(body.mimeType);
  const path = buildImagePath(body.project, body.block_id, ext, Date.now().toString(36));

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
}
