// BURGUNDY — Resistance "get to know you" roster persistence.
// GET  → the current roster JSON (from the burgundy-art bucket, or {} if none)
// POST { roster } → writes roster.json to the bucket (Johnny's in-page edits persist)
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = 'burgundy-art';
const PATH = 'roster.json';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return j(500, { error: 'supabase not configured' });

  if (req.method === 'GET') {
    // public bucket — read straight from the CDN, cache-bust
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PATH}?t=${Date.now()}`);
    if (!r.ok) return j(200, { roster: null });
    const roster = await r.json().catch(() => null);
    return j(200, { roster });
  }

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return j(400, { error: 'bad json' }); }
    if (!body || typeof body.roster !== 'object') return j(400, { error: 'roster object required' });
    const bytes = new TextEncoder().encode(JSON.stringify(body.roster));
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${PATH}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'x-upsert': 'true', 'Cache-Control': 'no-cache, max-age=0' },
      body: bytes,
    });
    if (!up.ok) return j(502, { error: 'write_failed', detail: (await up.text().catch(() => '')).slice(0, 200) });
    return j(200, { ok: true });
  }
  return j(405, { error: 'method not allowed' });
}
