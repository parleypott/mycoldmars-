import { sanitizeNoteRow, isValidNoteId } from './_lib/burgundy-note-validate.js';

export const config = { runtime: 'edge', maxDuration: 15 };

/**
 * Reader notes for the BERGUNDY iPad reading experience (/burgundy).
 *
 *   GET    /api/burgundy-notes            -> { notes: [...] }
 *   POST   /api/burgundy-notes            body: { para_key, quote, prefix?, note?, color?, reader?, chapter_idx?, book_version? }
 *   DELETE /api/burgundy-notes?id=<uuid>  -> { ok: true }   (reader can remove their own highlight)
 *
 * Deliberately no access gate: a single trusted reader at an unlisted URL,
 * writes are capped and additive. The local writing tool pulls GET to show
 * the reader's notes in its comment gutter.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

const sb = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return json(500, { error: 'supabase env missing' });

  try {
    if (req.method === 'GET') {
      const page = Math.max(0, Math.min(20, +(new URL(req.url).searchParams.get('page') || 0)));
      const r = await sb(`burgundy_notes?select=*&order=created_at.desc&limit=500&offset=${page * 500}`);
      if (!r.ok) return json(502, { error: 'db read failed' });
      return json(200, { notes: await r.json() });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const row = sanitizeNoteRow(body);
      if (!row) return json(400, { error: 'para_key and quote required' });
      const r = await sb('burgundy_notes', { method: 'POST', body: JSON.stringify(row) });
      if (!r.ok) return json(502, { error: 'db write failed' });
      const [saved] = await r.json();
      return json(200, { ok: true, note: saved });
    }

    if (req.method === 'DELETE') {
      const id = new URL(req.url).searchParams.get('id') || '';
      if (!isValidNoteId(id)) return json(400, { error: 'bad id' });
      const r = await sb(`burgundy_notes?id=eq.${id}`, { method: 'DELETE' });
      if (!r.ok) return json(502, { error: 'db delete failed' });
      return json(200, { ok: true });
    }

    return json(405, { error: 'method not allowed' });
  } catch (err) {
    return json(500, { error: 'server error', detail: String(err?.message || err).slice(0, 200) });
  }
}
