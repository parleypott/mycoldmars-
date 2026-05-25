// queen-scarlet-school: upload an already-generated image to Supabase
// Storage and return the public CDN URL.
//
// The storyboard, character-card, and scene-illustrate endpoints all
// upload to Supabase Storage directly during generation. The Storybook
// reader calls /api/nano-banana which only returns inline base64 — too
// big to store in the qss_stories row when there are 14+ images per
// story. This endpoint takes the base64 bytes, uploads them to the
// qss-scenes bucket under a per-story path, and returns the public URL.
//
// Body: { story_id, block_id, cue_id, dataBase64, mimeType?, world? }
// Response: { ok, url, path }
//
// Same pattern as qss-scene-illustrate's upload step — same bucket,
// same Cache-Control. Anyone with the URL can read (Storage bucket is
// public). The URL is what gets stored on block.__cues[i].image.url.

import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.QSS_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.QSS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = 'qss-scenes';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

function j(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

function safeSlug(s, max = 80) {
  return String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
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

  let body;
  try { body = await req.json(); }
  catch { return j(400, { error: 'invalid JSON' }); }

  const dataBase64 = String(body.dataBase64 || '').trim();
  if (!dataBase64) return j(400, { error: 'dataBase64 required' });
  const mimeType = String(body.mimeType || 'image/png');
  const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';

  const storyId = safeSlug(body.story_id || 'no-story', 80) || 'no-story';
  const blockId = safeSlug(body.block_id || 'no-block', 80) || 'no-block';
  const cueId = safeSlug(body.cue_id || `cue-${Date.now().toString(36)}`, 80);
  const worldSlug = safeSlug(body.world || 'queen-scarlet', 40) || 'queen-scarlet';
  const stamp = Date.now().toString(36);
  // Path: <world>/<story>/storybook/<block>/<cue>-<stamp>.<ext>
  // Versions stack under the same cue so a regenerate doesn't clobber.
  const path = `${worldSlug}/${storyId}/storybook/${blockId}/${cueId}-${stamp}.${ext}`;

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
