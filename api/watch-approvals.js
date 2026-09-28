export const config = { runtime: 'edge', maxDuration: 15 };

/**
 * Shared "Mel Approves" state for The James Watch Hunt (/watch).
 *
 *   GET  /api/watch-approvals            -> { approved: ["<listing_id>", ...] }
 *   POST /api/watch-approvals            body: { id, approved: bool, by? }
 *                                        approved:true upserts, false deletes.
 *
 * No auth gate on purpose: an unlisted gift-hunt link, one trusted person
 * (Mel) tapping approvals on her phone. Writes are tiny and idempotent. Johnny
 * reads the same shared list from any device.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });

const sb = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

// listing ids are base36 hashes from the hunt — keep it strict.
const cleanId = (v) => (typeof v === 'string' && /^[a-z0-9]{1,40}$/i.test(v) ? v : null);

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return json(500, { error: 'supabase env missing' });

  try {
    if (req.method === 'GET') {
      const r = await sb('watch_approvals?select=listing_id&approved=is.true&limit=2000');
      if (!r.ok) return json(502, { error: 'db read failed' });
      const rows = await r.json();
      return json(200, { approved: rows.map((x) => x.listing_id) });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const id = cleanId(body?.id);
      if (!id) return json(400, { error: 'valid id required' });
      const approved = !!body?.approved;
      const by = typeof body?.by === 'string' ? body.by.slice(0, 40) : 'mel';

      if (approved) {
        // upsert (merge on listing_id primary key)
        const r = await sb('watch_approvals?on_conflict=listing_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ listing_id: id, approved: true, approved_by: by, updated_at: new Date().toISOString() }),
        });
        if (!r.ok && r.status !== 409) return json(502, { error: 'db write failed', status: r.status });
      } else {
        const r = await sb(`watch_approvals?listing_id=eq.${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        });
        if (!r.ok) return json(502, { error: 'db delete failed', status: r.status });
      }
      return json(200, { ok: true, id, approved });
    }

    return json(405, { error: 'method not allowed' });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
}
