// queen-scarlet-school: bootstrap exchange — gate password → API access code.
//
// Why this exists:
//   The shared perimeter (api/_lib/access.js) was tightened so that
//   `Authorization: Bearer <anything>` no longer passes — it now needs a
//   JWT-shaped token OR the `x-access-code` header. QSS doesn't use
//   Supabase user accounts (Henry is the only user; the gate is a single
//   shared password), so it falls into the x-access-code lane.
//
//   The ACCESS_CODE env var is a server-side secret. The school/library
//   client can't ship with it baked into JS without leaking it. So:
//   after the user gets through the cosmetic gate by typing the gate
//   password, they call this endpoint to exchange the gate password
//   for the access code, which then unlocks the rest of /api/*.
//
//   This endpoint deliberately skips the shared checkAccess() — it IS
//   the bootstrap, so the gate password is its own authorization.

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Hardcoded gate password. Mirrors the one in the school/library gate UI
// ("newpress"). If we ever rotate the gate, both places change.
const GATE_PASSWORD = 'newpress';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body = {};
  try { body = await req.json(); } catch {}
  const supplied = String(body?.password || '').trim().toLowerCase();
  if (supplied !== GATE_PASSWORD) {
    return new Response(JSON.stringify({ error: 'bad_password' }), {
      status: 403, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  // Return whatever ACCESS_CODE is set to. If unset (local dev), the
  // perimeter is open anyway — return an empty string and the client's
  // x-access-code header will be set to '' which still satisfies the
  // shared checkAccess() in its no-validCode branch.
  const accessCode = process.env.ACCESS_CODE || '';

  return new Response(JSON.stringify({ accessCode }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
