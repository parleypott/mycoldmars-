// BURGUNDY — ingest a finished image (e.g. a Midjourney render) into the
// resistance art bucket. POST { dataBase64, mimeType, id } → { url }.
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = 'burgundy-art';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s, p) => new Response(JSON.stringify(p), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const slug = s => String(s || 'img').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'img';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return j(405, { error: 'POST only' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return j(500, { error: 'supabase not configured' });
  let body; try { body = await req.json(); } catch { return j(400, { error: 'bad json' }); }
  const data = String(body.dataBase64 || '').trim();
  if (!data) return j(400, { error: 'dataBase64 required' });
  const mime = /^image\/(png|jpe?g|webp)$/i.test(body.mimeType || '') ? body.mimeType : 'image/png';
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  const path = `resistance/upload/${slug(body.id)}-${Date.now().toString(36)}.${ext}`;
  let bin;
  try { const s = atob(data); bin = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bin[i] = s.charCodeAt(i); }
  catch (e) { return j(400, { error: 'bad_base64' }); }
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': mime, 'x-upsert': 'true', 'Cache-Control': 'public, max-age=31536000, immutable' },
    body: bin,
  });
  if (!up.ok) return j(502, { error: 'storage_upload_failed', detail: (await up.text().catch(() => '')).slice(0, 200) });
  return j(200, { url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}` });
}
