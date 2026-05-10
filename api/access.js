export const config = { runtime: 'edge' };

/**
 * Shared-secret access gate. Validates a code against ACCESS_CODE.
 * No usernames, no sessions — single-user app deployed behind a shared secret.
 *
 * On success the client stashes the validated code in sessionStorage and
 * the global fetch interceptor (installed in index.html) injects it as
 * `x-access-code` on every /api/* call. The other proxies import
 * checkAccess from api/_lib/access.js to enforce the same gate server-side.
 * If ACCESS_CODE is unset the app runs open (dev mode).
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

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
