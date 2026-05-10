// Shared gate helper used by every /api/* edge function. Keeping this
// out of `api/` proper so Vercel doesn't treat it as a route.
//
// The shared secret lives in ACCESS_CODE. Clients send it via the
// `x-access-code` header — index.html installs a window.fetch wrapper
// after gate-success that injects this header on every /api/* call.
//
// If ACCESS_CODE is unset, the gate runs in dev mode (open). Set it in
// production — see /SECURITY.md for the full posture.

export function checkAccess(req) {
  const validCode = process.env.ACCESS_CODE;
  if (!validCode) return null; // dev mode
  const supplied = req.headers.get('x-access-code') || '';
  if (supplied === validCode) return null;
  return new Response(JSON.stringify({
    error: 'unauthorized',
    message: 'Missing or invalid x-access-code header.',
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
