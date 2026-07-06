import { pgrValue } from './_lib/pgrest.js';

export const config = { runtime: 'edge', maxDuration: 15 };

/**
 * STRUCTURE (public/structure/) team board sync.
 *
 *   GET  /api/structure-board?slug=palau        -> { state, updated_at } | 404
 *   POST /api/structure-board  body: { slug, state }
 *                                               -> { state, updated_at }
 *
 * One row per board slug. Last-write-wins — the client debounces pushes and
 * polls for newer remote state; no concurrency negotiation on purpose (small
 * team, low collision odds, the board is easy to re-drag).
 *
 * The state blob is opaque — the client owns the format. Keep payloads under
 * ~2MB total (defensive cap below; boards carry card text + inline HTML only).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_BYTES = 2 * 1024 * 1024; // 2MB hard cap on inbound state blob
const SLUG_RE = /^[a-z0-9-]{1,64}$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonError(500, 'NO_DB', 'Supabase env vars not configured on the server');
  }

  try {
    if (req.method === 'GET')  return await handleGet(req);
    if (req.method === 'POST') return await handlePost(req);
    return jsonError(405, 'METHOD_NOT_ALLOWED', `Method ${req.method} not allowed`);
  } catch (err) {
    return jsonError(500, 'INTERNAL', err?.message || 'unknown server error');
  }
}

async function handleGet(req) {
  const url = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return jsonError(400, 'BAD_SLUG', 'slug must be 1-64 chars of [a-z0-9-]');
  }

  const r = await sb(`/rest/v1/structure_boards?slug=eq.${pgrValue(slug)}&select=state,updated_at`, {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) {
    const text = await r.text();
    return jsonError(502, 'DB_READ_FAILED', text || `Supabase responded ${r.status}`);
  }
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonError(404, 'NOT_FOUND', `No board with slug '${slug}'`);
  }
  return jsonOk({ state: rows[0].state || {}, updated_at: rows[0].updated_at });
}

async function handlePost(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'BAD_JSON', 'Request body must be valid JSON');
  }

  const slug = (typeof body?.slug === 'string' ? body.slug : '').toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return jsonError(400, 'BAD_SLUG', 'slug must be 1-64 chars of [a-z0-9-]');
  }
  const state = body?.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return jsonError(400, 'BAD_STATE', 'state must be a JSON object');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(state)).length;
  if (bytes > MAX_BYTES) {
    return jsonError(413, 'TOO_LARGE', `state is ${bytes} bytes; the cap is ${MAX_BYTES}`);
  }

  // Upsert via PostgREST. `Prefer: return=representation` returns the new row.
  // `on_conflict=slug` + `resolution=merge-duplicates` lets the insert turn
  // into an update; the DB trigger bumps updated_at on every UPDATE.
  const upR = await sb(`/rest/v1/structure_boards?on_conflict=slug`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify({ slug, state }),
  });

  if (!upR.ok) {
    const text = await upR.text();
    return jsonError(502, 'DB_WRITE_FAILED', text || `Supabase responded ${upR.status}`);
  }
  const rows = await upR.json();
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return jsonError(502, 'DB_WRITE_FAILED', 'Upsert returned no row');
  return jsonOk({ state: row.state || {}, updated_at: row.updated_at });
}

// --- Supabase REST helper ---
async function sb(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', SUPABASE_KEY);
  headers.set('Authorization', `Bearer ${SUPABASE_KEY}`);
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(10_000),
  });
}

// --- Response helpers ---
function jsonOk(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
function jsonError(status, code, message, extra) {
  return new Response(JSON.stringify({ error: { code, message, ...(extra || {}) } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
