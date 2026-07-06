export const config = { runtime: 'edge' };

import { Liveblocks } from '@liveblocks/node';
import { checkAccess, requestUserId } from './_lib/access.js';
import { pgrValue } from './_lib/pgrest.js';

/**
 * Script Library — LIVEBLOCKS AUTH (collab Phase 1).
 *
 * Issues a room-scoped Liveblocks session token so a signed-in teammate can join a script's
 * real-time collaboration room. This is the standard Liveblocks `authEndpoint` contract: the
 * client POSTs `{ room }`, we authorize against OUR gate, and return the Liveblocks token body.
 *
 *   POST /api/liveblocks-auth   { room: 'script-<projectSlugOrId>' }
 *        -> 200 (the Liveblocks token payload, passed through verbatim)
 *        -> 401 not signed in (same checkAccess gate as every other write endpoint)
 *        -> 400 malformed / non-script room id (this endpoint mints tokens ONLY for script rooms)
 *        -> 503 LIVEBLOCKS_SECRET_KEY not configured (collab simply unavailable — never a crash)
 *
 * Identity: the requester's Supabase auth user id (requestUserId) + their user_profiles row
 * (display_name, color) ride along as Liveblocks `userInfo`, so presence/carets show real names
 * and colors. Access-code / dev-mode callers (no JWT) get a stable per-session guest identity —
 * they passed the gate, they just aren't individually attributable.
 *
 * SECURITY: the secret key never leaves the server; the token is scoped to the ONE room the
 * client asked for (session.allow(room, FULL_ACCESS)) and only `script-*` rooms are mintable.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Code',
  'Access-Control-Max-Age': '86400',
};

// PURE — only `script-<slug|uuid>` rooms can be minted here. Slugs/uuids are [A-Za-z0-9_-];
// length-capped so a hostile client can't stuff junk into the room namespace. Exported for tests.
export const COLLAB_ROOM_RE = /^script-[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export function isValidCollabRoom(room) {
  return typeof room === 'string' && COLLAB_ROOM_RE.test(room);
}

// Deterministic fallback color from a string — mirrors scripts-library/src/presence.js's palette so
// a profile-less user gets the SAME stable dot color in both presence systems.
const FALLBACK_COLORS = ['#2b7fff', '#9b59d0', '#1f8a72', '#d4703a', '#c0405f', '#5c7cc0', '#b0431f'];
export function stableColorFor(seed) {
  let h = 0;
  const s = String(seed || 'x');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

// PURE — accept a profile color ONLY at a valid CSS hex length (3/4/6/8 digits — #RGB, #RGBA,
// #RRGGBB, #RRGGBBAA). This is the SAME shared user_profiles.color column the presence system reads,
// and api/script-presence.js's validateHeartbeat already drops non-hex / 5- and 7-digit junk to null
// so the client can paint a real fallback dot. Mirror that contract here: a malformed profile color
// must fall back to stableColorFor() instead of riding into a Liveblocks caret as a colorless
// userInfo.color. Returns the trimmed color or null. Exported for tests.
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export function validProfileColor(raw) {
  if (typeof raw !== 'string') return null;
  const c = raw.trim();
  return HEX_COLOR_RE.test(c) ? c : null;
}

// PURE — shape the Liveblocks identity from what we know. A null userId (access-code / dev-mode
// caller) becomes a per-request guest id: they passed OUR gate, they're just not attributable to a
// profile. Profile fields are best-effort; every gap gets a sensible, stable fallback. Exported for tests.
export function collabIdentity(userId, profile, randomSuffix = null) {
  const attributed = typeof userId === 'string' && userId.length > 0;
  const id = attributed
    ? userId
    : 'guest-' + (randomSuffix || Math.random().toString(36).slice(2, 10));
  const rawName = profile && typeof profile.display_name === 'string' ? profile.display_name.trim() : '';
  const name = rawName || (attributed ? 'Teammate' : 'Guest');
  const color = validProfileColor(profile && profile.color) || stableColorFor(id);
  return { id, name, color, attributed };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return err(405, 'METHOD', `Method ${req.method} not allowed`);

  // Same gate as every other write endpoint: signed-in JWT (or the legacy access code; or dev mode
  // with no ACCESS_CODE configured). A caller that can't save the doc can't join its room either.
  const denied = await checkAccess(req);
  if (denied) return withCors(denied);

  let body;
  try { body = await req.json(); } catch { return err(400, 'BAD_JSON', 'Body must be JSON'); }
  const room = body?.room;
  if (!isValidCollabRoom(room)) {
    return err(400, 'BAD_ROOM', 'room must look like script-<project> ([A-Za-z0-9_-], <=80 chars)');
  }

  // Read the secret at REQUEST time (not module init) so the local dev middleware, which injects
  // env just before importing this handler, works — and so a misconfigured deploy degrades to a
  // clean 503 the client treats as "collab unavailable", never a crash.
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) return err(503, 'NO_LIVEBLOCKS', 'LIVEBLOCKS_SECRET_KEY not configured');

  try {
    // WHO is asking — attribution via the verified JWT; null on the access-code/dev path.
    const userId = await requestUserId(req);
    const profile = userId ? await fetchProfile(userId) : null;
    const identity = collabIdentity(userId, profile);

    const liveblocks = new Liveblocks({ secret });
    const session = liveblocks.prepareSession(identity.id, {
      userInfo: { name: identity.name, color: identity.color },
    });
    // Room-scoped: this token opens EXACTLY the one room asked for, nothing else.
    session.allow(room, session.FULL_ACCESS);
    const { status, body: tokenBody } = await session.authorize();
    return new Response(tokenBody, {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (e) {
    return err(502, 'LIVEBLOCKS_AUTH', e?.message || 'liveblocks authorize failed');
  }
}

// Best-effort user_profiles lookup ({ display_name, color }) via the service key. Any failure —
// missing env, missing table, no row — resolves to null and the identity falls back gracefully.
// NEVER throws.
async function fetchProfile(userId) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${pgrValue(userId)}&select=display_name,color&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null;
  }
}

function err(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// checkAccess returns a bare 401 Response with no CORS headers; re-wrap it so the browser can read it.
function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
