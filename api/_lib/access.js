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

function readHeader(req, name) {
  const h = req?.headers;
  if (!h) return '';
  // Web Request / Headers
  if (typeof h.get === 'function') return h.get(name) || '';
  // Node IncomingMessage — plain object, lowercase keys
  const v = h[name.toLowerCase()];
  if (v == null) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

export function checkAccess(req) {
  const validCode = process.env.ACCESS_CODE;
  if (!validCode) return null; // dev mode
  // Two ways past the gate:
  // 1) The legacy x-access-code header (single shared secret).
  // 2) Any Authorization: Bearer <jwt> — i.e., the caller is a signed-in
  //    Supabase user. Endpoint-level auth (whoAmI + isAdminEmail in
  //    admin-users.js, etc.) is the real check; the access code is just a
  //    perimeter. Don't double-gate signed-in users.
  const auth = readHeader(req, 'authorization');
  if (/^Bearer\s+\S/i.test(auth)) return null;
  const supplied = readHeader(req, 'x-access-code');
  if (supplied === validCode) return null;
  return new Response(JSON.stringify({
    error: 'unauthorized',
    message: 'Missing or invalid x-access-code header (or sign in).',
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
