// Shared gate helper. Works in BOTH the Edge runtime (req.headers is a
// Web Headers object with .get()) and the Node serverless runtime
// (req.headers is a plain object with lowercase keys). Don't assume either.
//
// The shared secret lives in ACCESS_CODE. Clients send it via the
// `x-access-code` header — index.html installs a window.fetch wrapper
// after gate-success that injects this header on every /api/* call.
//
// If ACCESS_CODE is unset, the gate runs in dev mode (open). Set it in
// production — see /SECURITY.md for the full posture.

export function readHeader(req, name) {
  const h = req?.headers;
  if (!h) return '';
  // Web Request / Headers
  if (typeof h.get === 'function') return h.get(name) || '';
  // Node IncomingMessage — plain object, lowercase keys
  const v = h[name.toLowerCase()];
  if (v == null) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

// A JWT has three base64url parts joined by dots. Shape regex is a
// CHEAP first filter — but shape alone is not enough. The adversarial
// audit verified that hand-crafted `eyJabc.eyJdef.xxx` strings passed
// the shape check, opening /api/claude (Opus 4.5, 64k tokens) and
// every other paid endpoint to the open internet. Now: shape check
// followed by a real /auth/v1/user round-trip, results cached in
// memory for 60s to amortize the latency.
export const BEARER_JWT_SHAPE = /^Bearer\s+(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/i;

// Module-level cache. Edge runtime keeps the module alive across
// requests in the same instance, so this is per-instance. Key: JWT
// string. Value: { ok, expiresAt }.
const _jwtCache = new Map();
const JWT_CACHE_TTL_MS = 60_000;
const JWT_CACHE_MAX = 200;

// Keep the per-instance JWT cache bounded. The old version only dropped
// EXPIRED entries — so a burst of >MAX distinct still-valid tokens within the
// TTL window deleted nothing and the cache grew without limit (a slow memory
// leak on a long-lived edge instance). This guarantees forward progress:
// drop expired entries first (free — they'd be re-validated anyway), then, if
// still over the cap, evict the OLDEST entries (Map preserves insertion order)
// down to a low-water mark. Evicting a valid entry is harmless — it only costs
// one extra /auth/v1/user round-trip the next time that token appears.
export function pruneJwtCache(cache, now, max = JWT_CACHE_MAX) {
  if (cache.size <= max) return;
  const target = Math.floor(max / 2);
  // Pass 1: expired entries.
  for (const [k, v] of cache) {
    if (cache.size <= target) return;
    if (v.expiresAt <= now) cache.delete(k);
  }
  // Pass 2: a burst of all-valid tokens — drop oldest until under the mark.
  for (const k of cache.keys()) {
    if (cache.size <= target) return;
    cache.delete(k);
  }
}

async function verifyBearerJwt(token) {
  const now = Date.now();
  // Trim the cache lazily on the hot path (no-op until it's over the cap).
  pruneJwtCache(_jwtCache, now);
  const cached = _jwtCache.get(token);
  if (cached && cached.expiresAt > now) return cached.ok;
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supaUrl || !anon) return false;
  let ok = false;
  try {
    const r = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
      signal: AbortSignal.timeout(5000),
    });
    ok = r.ok;
  } catch {}
  _jwtCache.set(token, { ok, expiresAt: now + JWT_CACHE_TTL_MS });
  return ok;
}

export async function checkAccess(req) {
  const validCode = process.env.ACCESS_CODE;
  if (!validCode) return null; // dev mode
  // Two ways past the gate:
  // 1) The legacy x-access-code header (single shared secret).
  // 2) Authorization: Bearer <jwt> verified against our own Supabase
  //    project's /auth/v1/user. Shape pre-filter avoids the network
  //    round-trip for obvious garbage.
  const supplied = readHeader(req, 'x-access-code');
  if (supplied === validCode) return null;

  const auth = readHeader(req, 'authorization');
  const m = BEARER_JWT_SHAPE.exec(auth);
  if (m) {
    const token = m[1];
    if (await verifyBearerJwt(token)) return null;
  }

  return new Response(JSON.stringify({
    error: 'unauthorized',
    message: 'Missing or invalid x-access-code header (or sign in).',
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
