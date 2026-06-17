export const config = { runtime: 'edge', maxDuration: 15 };

import { validateStatePayload } from './_lib/winchester-validate.js';

/**
 * Nile flights booking-tracker state sync.
 *
 *   GET  /api/nile-flights-state                 -> { state, updated_at }
 *   POST /api/nile-flights-state  body: { state } -> { state, updated_at }
 *
 * One row, id='singleton'. The `state` blob is the booking map the client owns:
 *   { bookings: { [legId]: { booked: true, by: 'Marisa', at: '<iso>' } } }
 *
 * Deliberately NOT behind the ACCESS_CODE gate — this is a low-stakes booking
 * checklist meant to be opened and ticked off by Johnny's EA with zero friction.
 * Last-write-wins (no optimistic concurrency); a single assistant ticking boxes
 * doesn't need conflict resolution.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const ROW_ID = 'singleton';
const MAX_BYTES = 256 * 1024; // booking map is tiny; generous cap

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

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
  const r = await sb(`/rest/v1/nile_flights_state?id=eq.${ROW_ID}&select=state,updated_at`, {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) return jsonError(502, 'DB_READ_FAILED', (await r.text()) || `Supabase ${r.status}`);
  const rows = await r.json();
  const row = Array.isArray(rows) && rows.length ? rows[0] : { state: {}, updated_at: null };
  return jsonOk({ state: row.state || {}, updated_at: row.updated_at });
}

async function handlePost(req) {
  let body;
  try { body = await req.json(); } catch { return jsonError(400, 'BAD_JSON', 'Body must be valid JSON'); }

  // Shared, byte-accurate validation. The cap is a UTF-8 BYTE cap (matching the
  // MAX_BYTES name + the wire/DB storage size), counted via TextEncoder — NOT
  // serialized.length, which is UTF-16 code units and silently undercounts every
  // non-ASCII char (a CJK glyph is 1 unit but 3 bytes), letting an over-cap blob
  // slip past. (Booking maps are ASCII today, so this is correctness/parity, not
  // a hot bug — but the name promised bytes and the check counted chars.)
  const v = validateStatePayload(body, MAX_BYTES);
  if (!v.ok) {
    // BAD_BODY collapses to BAD_STATE here — this endpoint only exposes a state blob.
    const code = v.code === 'BAD_BODY' ? 'BAD_STATE' : v.code;
    return jsonError(v.status, code, v.message);
  }
  const { state } = v;

  const upR = await sb(`/rest/v1/nile_flights_state?on_conflict=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify({ id: ROW_ID, state }),
  });
  if (!upR.ok) return jsonError(502, 'DB_WRITE_FAILED', (await upR.text()) || `Supabase ${upR.status}`);
  const rows = await upR.json();
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return jsonError(502, 'DB_WRITE_FAILED', 'Upsert returned no row');
  return jsonOk({ state: row.state || {}, updated_at: row.updated_at });
}

async function sb(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', SUPABASE_KEY);
  headers.set('Authorization', `Bearer ${SUPABASE_KEY}`);
  return fetch(`${SUPABASE_URL}${path}`, { ...init, headers, signal: AbortSignal.timeout(10_000) });
}

function jsonOk(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}
function jsonError(status, code, message, extra) {
  return new Response(JSON.stringify({ error: { code, message, ...(extra || {}) } }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
