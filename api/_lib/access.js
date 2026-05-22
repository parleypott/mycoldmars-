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

// A JWT has three base64url parts joined by dots, each part starts with
// the base64-encoded JSON object (`eyJ`). The previous gate accepted any
// non-empty string after "Bearer " — meaning `Authorization: Bearer x`
// trivially opened /api/claude, /api/gemini, /api/transcribe, etc., to
// the open internet. This regex is the cheap perimeter check; endpoint-
// level handlers still do the real JWT verification when they need an
// identity (admin-users.js whoAmI, etc.).
const BEARER_JWT_SHAPE = /^Bearer\s+(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/i;

export function checkAccess(req) {
  const validCode = process.env.ACCESS_CODE;
  if (!validCode) return null; // dev mode
  // Two ways past the gate:
  // 1) The legacy x-access-code header (single shared secret).
  // 2) An Authorization: Bearer <jwt> that has the actual JWT shape —
  //    not "Bearer x" or any other free-text fragment. Endpoint-level
  //    auth (whoAmI + isAdminEmail in admin-users.js, etc.) is the
  //    real check; the access code / shape check is the perimeter.
  const auth = readHeader(req, 'authorization');
  if (BEARER_JWT_SHAPE.test(auth)) return null;
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
