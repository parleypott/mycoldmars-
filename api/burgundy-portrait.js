// BURGUNDY — Resistance portrait generator.
// POST { prompt, id, kind, referenceImages?:[{mimeType,dataBase64}] }
//   → Gemini 2.5 Flash Image (nano-banana) → uploads PNG to the public
//     `burgundy-art` Supabase bucket → returns { url, model, ms }.
// Node runtime so the image call can run past the edge timeout.

export const config = { maxDuration: 300 };

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = 'burgundy-art';
const MODEL = 'gemini-2.5-flash-image';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  res.end(JSON.stringify(payload));
}

function safeSlug(s, max = 60) {
  return String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { const p = JSON.parse(raw || '{}'); return (p && typeof p === 'object') ? p : {}; } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v); return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  if (!GEMINI_KEY) return json(res, 500, { error: 'GEMINI_API_KEY not configured' });

  const body = await readBody(req);
  const prompt = String(body.prompt || '').trim();
  if (!prompt) return json(res, 400, { error: 'prompt required' });

  // build parts: reference images (inline base64 only) + text
  const parts = [];
  const MAX = 6 * 1024 * 1024 * 1.4;
  if (Array.isArray(body.referenceImages)) {
    for (const ref of body.referenceImages) {
      if (typeof ref?.dataBase64 !== 'string' || typeof ref?.mimeType !== 'string') continue;
      if (ref.url || ref.uri || ref.src) continue;
      if (ref.dataBase64.length > MAX) continue;
      if (!/^image\/(png|jpe?g|webp)$/i.test(ref.mimeType)) continue;
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.dataBase64 } });
    }
  }
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const t0 = Date.now();
  async function call(sendParts) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts: sendParts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
    });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text().catch(() => '')).slice(0, 500) };
    const data = await r.json().catch(() => null);
    let img = null, text = '';
    for (const c of (data?.candidates || [])) for (const p of (c?.content?.parts || [])) {
      if (p.inlineData?.data) img = { mime: p.inlineData.mimeType || 'image/png', data: p.inlineData.data };
      else if (p.text) text += p.text;
    }
    if (!img) return { ok: false, status: 502, error: 'no image' + (text ? ': ' + text.slice(0, 200) : '') };
    return { ok: true, img, text };
  }

  let out = await call(parts);
  if (!out.ok && parts.some(p => p.inlineData)) out = await call(parts.filter(p => !p.inlineData)); // retry text-only
  if (!out.ok) return json(res, out.status || 502, { error: 'gemini_failed', detail: out.error });

  // upload to Supabase storage
  const ext = (out.img.mime.includes('jpeg') || out.img.mime.includes('jpg')) ? 'jpg' : (out.img.mime.includes('webp') ? 'webp' : 'png');
  const id = safeSlug(body.id || 'char');
  const kind = safeSlug(body.kind || 'portrait');
  const path = `resistance/${kind}/${id}-${Date.now().toString(36)}.${ext}`;
  let publicUrl = null;
  if (SUPABASE_URL && SUPABASE_KEY) {
    const bin = Buffer.from(out.img.data, 'base64');
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': out.img.mime, 'x-upsert': 'true', 'Cache-Control': 'public, max-age=31536000, immutable' },
      body: bin,
    });
    if (up.ok) publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    else return json(res, 502, { error: 'storage_upload_failed', detail: (await up.text().catch(() => '')).slice(0, 200) });
  }
  return json(res, 200, { url: publicUrl, dataUrl: publicUrl ? null : `data:${out.img.mime};base64,${out.img.data}`, model: MODEL, ms: Date.now() - t0, text: out.text || '' });
}
