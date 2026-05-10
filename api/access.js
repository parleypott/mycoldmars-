export const config = { runtime: 'edge' };

/**
 * Shared-secret access gate. Validates a code against ACCESS_CODE.
 * No usernames, no sessions — single-user app deployed behind a shared secret.
 *
 * On success returns the validated code so the client can stash it and send
 * it as `x-access-code` on subsequent calls to /api/transcribe, /api/claude,
 * /api/gemini. That's how the gate becomes load-bearing instead of cosmetic
 * (without server-side check, anyone could hit those endpoints directly and
 * burn through Johnny's API budget). If ACCESS_CODE is unset the app runs
 * open (dev mode).
 */
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body = {};
  try { body = await req.json(); } catch {}
  const validCode = process.env.ACCESS_CODE;

  if (!validCode) {
    return jsonResponse({ ok: true, dev: true });
  }
  if (body?.code === validCode) {
    return jsonResponse({ ok: true });
  }
  return new Response('Invalid code', { status: 401 });
}

// Shared helper used by api/transcribe.js, api/claude.js, api/gemini.js to
// enforce the same gate on every server-side proxy endpoint.
export function checkAccess(req) {
  const validCode = process.env.ACCESS_CODE;
  // Dev mode (no code configured) — allow.
  if (!validCode) return null;
  const supplied = req.headers.get('x-access-code') || '';
  if (supplied === validCode) return null;
  return new Response(JSON.stringify({ error: 'unauthorized', message: 'Missing or invalid x-access-code header.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
