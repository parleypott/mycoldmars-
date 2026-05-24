import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 15 };

/**
 * Winchester (Westchester House Hunter) cross-machine state sync.
 *
 *   GET  /api/winchester-state                  -> { state, updated_at }
 *   POST /api/winchester-state  body: { state, expectedUpdatedAt? }
 *                                              -> { state, updated_at }
 *
 * One row, id='singleton'. Single-user app behind ACCESS_CODE gate.
 *
 * Optimistic concurrency:
 *   If the POST body includes expectedUpdatedAt and it doesn't match the
 *   server's current updated_at, returns 409 + the current server state.
 *   The client should then merge and retry, or last-write-wins by omitting
 *   expectedUpdatedAt — that's the deliberate fallback for the cold-start
 *   "I just hydrated, now push my merged state" path.
 *
 * The state blob is opaque — the server doesn't validate its shape because
 * it's a single-user app and the client owns the format. Keep payloads
 * under ~1MB total (defensive cap below).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const ROW_ID = 'singleton';
const MAX_BYTES = 1024 * 1024; // 1MB hard cap on inbound state blob

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const denied = await checkAccess(req);
  if (denied) return withCors(denied);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonError(500, 'NO_DB', 'Supabase env vars not configured on the server');
  }

  try {
    if (req.method === 'GET')  return await handleGet();
    if (req.method === 'POST') return await handlePost(req);
    return jsonError(405, 'METHOD_NOT_ALLOWED', `Method ${req.method} not allowed`);
  } catch (err) {
    return jsonError(500, 'INTERNAL', err?.message || 'unknown server error');
  }
}

async function handleGet() {
  const r = await sb(`/rest/v1/winchester_state?id=eq.${ROW_ID}&select=state,updated_at`, {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) {
    const text = await r.text();
    return jsonError(502, 'DB_READ_FAILED', text || `Supabase responded ${r.status}`);
  }
  const rows = await r.json();
  const row = Array.isArray(rows) && rows.length ? rows[0] : { state: {}, updated_at: null };
  return jsonOk({ state: row.state || {}, updated_at: row.updated_at });
}

async function handlePost(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'BAD_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') {
    return jsonError(400, 'BAD_BODY', 'Body must be an object');
  }

  const state = body.state;
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    return jsonError(400, 'BAD_STATE', 'state must be a plain object');
  }

  // Defensive size cap — JSON.stringify is the wire size proxy.
  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch (err) {
    return jsonError(400, 'BAD_STATE', 'state is not JSON-serializable: ' + (err?.message || ''));
  }
  if (serialized.length > MAX_BYTES) {
    return jsonError(413, 'STATE_TOO_BIG', `state is ${serialized.length} bytes; max ${MAX_BYTES}`);
  }

  // Optimistic concurrency check (optional — caller can omit to last-write-wins)
  if (typeof body.expectedUpdatedAt === 'string' && body.expectedUpdatedAt) {
    const headR = await sb(`/rest/v1/winchester_state?id=eq.${ROW_ID}&select=updated_at`);
    if (headR.ok) {
      const rows = await headR.json();
      const serverTs = Array.isArray(rows) && rows.length ? rows[0].updated_at : null;
      if (serverTs && serverTs !== body.expectedUpdatedAt) {
        // Return the current server state so the client can merge.
        const cur = await handleGet();
        const curJson = await cur.json();
        return jsonError(409, 'CONFLICT', 'updated_at mismatch — server state included', {
          serverState: curJson.state,
          serverUpdatedAt: curJson.updated_at,
        });
      }
    }
    // If the HEAD fetch fails we don't block the write — falls through to upsert.
  }

  // Upsert via PostgREST. `Prefer: return=representation` returns the new row.
  // `on_conflict=id` + `resolution=merge-duplicates` lets the insert turn into an update.
  const upR = await sb(`/rest/v1/winchester_state?on_conflict=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: ROW_ID, state }),
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
function withCors(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
