// script engine (burma/palau/palau2/scripts-library): upload a dropped/pasted
// image to Supabase Storage and return the public CDN URL.
//
// WHY THIS ENDPOINT EXISTS — the script doc must NEVER carry image bytes. The
// doc is persisted whole to localStorage (~5MB origin budget — a REAL live
// quota failure is documented at ~167KB doc size in quota-escalation.test.mjs),
// mirrored to IndexedDB, PUT whole to /api/script-doc, appended as a FULL COPY
// to script_doc_revisions on every accepted autosave, and carried through the
// Liveblocks/Yjs collab room. A single base64 photo would multiply megabytes
// into every one of those sinks per save. So the client uploads the bytes HERE
// first, and only the returned ~100-byte public URL ever enters the doc
// (imageBlock.attrs.src) — same posture as the existing static /palau2/img/*
// srcs.
//
// Near-clone of api/qss-image-upload.js (the established public-bucket upload
// pattern): edge runtime, checkAccess gate (the scripts-library fetch
// interceptor injects the signed-in JWT on same-origin /api/* calls),
// imageStorageMeta mime allow-list, immutable Cache-Control. Bucket objects at
// existing paths are never overwritten in practice (stamped filenames) — the
// URL becomes part of every doc revision forever, so a broken historical
// revision restore must still render its images.
//
// Body: { project, block_id, dataBase64, mimeType? }
// Response: { ok, url, path }

import { checkAccess } from './_lib/access.js';
import { imageStorageMeta } from './_lib/image-storage.js';
import { readJsonBody } from './_lib/read-json-body.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.QSS_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.QSS_SUPABASE_SERVICE_KEY || '';
const BUCKET = 'script-images';

// Vercel edge functions cap the request body well under ~4.5MB of JSON; base64
// inflates bytes 4/3, so an 8MB decoded ceiling keeps us with headroom while
// rejecting the "dropped a RAW frame" mistake with a clean 413 instead of an
// opaque platform error.
export const MAX_DECODED_BYTES = 8 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

function j(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

// Path-segment guard: strip a client-supplied id to [A-Za-z0-9_-] before it is
// interpolated into the storage path (path-traversal / injection guard) — same
// contract as qss-image-upload's safeSlug, re-exported here so the test pins
// THIS endpoint's copy.
export function safeSlug(s, max = 80) {
  return String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
}

// Decoded size of a base64 string WITHOUT decoding it: 3 bytes per 4 chars,
// minus padding. Cheap pre-check so an oversized body is rejected before we
// spend CPU on atob.
export function base64DecodedBytes(s) {
  const str = String(s || '');
  const len = str.length;
  if (!len) return 0;
  let pad = 0;
  if (str.endsWith('==')) pad = 2;
  else if (str.endsWith('=')) pad = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - pad);
}

// Storage path shape: scripts/<project>/<blockId>-<stamp>.<ext>. The stamp
// makes every upload a FRESH object — historical doc revisions keep rendering
// because nothing at an old path is ever clobbered.
export function buildImagePath(project, blockId, ext, stamp) {
  const proj = safeSlug(project || 'no-project', 40) || 'no-project';
  const blk = safeSlug(blockId || 'no-block', 80) || 'no-block';
  return `scripts/${proj}/${blk}-${stamp}.${ext}`;
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

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return j(500, { error: 'Supabase env not configured' });
  }

  const _body = await readJsonBody(req);
  if (!_body.ok) return j(_body.status, { error: _body.error });
  const body = _body.body;

  const dataBase64 = String(body.dataBase64 || '').trim();
  if (!dataBase64) return j(400, { error: 'dataBase64 required' });
  if (base64DecodedBytes(dataBase64) > MAX_DECODED_BYTES) {
    return j(413, { error: 'image_too_large', maxBytes: MAX_DECODED_BYTES });
  }

  // Derive a SAFE Content-Type + matching extension from the client's mimeType.
  // The bucket is public, so we never echo an arbitrary client Content-Type
  // (e.g. text/html, image/svg+xml) back through the CDN — coerce to the tight
  // shared image allow-list. ext + mime always agree (both from one normalize).
  const { mime: mimeType, ext } = imageStorageMeta(body.mimeType);

  const path = buildImagePath(body.project, body.block_id, ext, Date.now().toString(36));

  // Decode base64 → bytes (Edge runtime — no Buffer global)
  let bin;
  try {
    const binStr = atob(dataBase64);
    bin = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bin[i] = binStr.charCodeAt(i);
  } catch (e) {
    return j(400, { error: 'bad_base64', detail: e?.message || String(e) });
  }

  let url, uploadErr;
  try {
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': mimeType,
        'x-upsert': 'true',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: bin,
    });
    if (up.ok) {
      url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    } else {
      uploadErr = `storage_${up.status}: ${(await up.text().catch(() => '')).slice(0, 200)}`;
    }
  } catch (e) {
    uploadErr = e?.message || String(e);
  }

  if (!url) return j(502, { error: 'storage_upload_failed', detail: uploadErr });
  return j(200, { ok: true, url, path });
}
