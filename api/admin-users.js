// Admin: user management.
//
// One endpoint, four actions, all gated to ADMIN_EMAILS callers:
//   POST { action: 'list' }                          → { users: [...] }
//   POST { action: 'create', email, password? }      → { user: {...} }
//   POST { action: 'delete', userId }                → { ok: true }
//   POST { action: 'set_password', userId, password }→ { ok: true }
//
// Default password for new users: 'newpress'. The recipient is told (in
// the admin console UI) to change it via the avatar menu after sign-in.
//
// Auth model:
//   • Authorization: Bearer <jwt> required (the caller's Supabase session).
//   • The verified user's email must match an entry in ADMIN_EMAILS
//     (env var, comma-separated; e.g. 'johnny@newpress.com').
//   • Localhost without ADMIN_EMAILS set bypasses the check (dev only).
//
// Uses SUPABASE_SERVICE_ROLE_KEY to reach Supabase Admin API.

import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge' };

const DEFAULT_PASSWORD = 'newpress';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isLocalhost(req) {
  try {
    const u = new URL(req.url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch { return false; }
}

async function whoAmI(req) {
  const authHeader = req.headers.get('authorization') || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supaUrl || !anonKey) return null;
  try {
    const r = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${m[1]}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function isAdminEmail(email) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  return list.includes(String(email).toLowerCase());
}

async function adminFetch(supaUrl, serviceKey, path, init = {}) {
  return fetch(`${supaUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const denied = checkAccess(req);
  if (denied) return denied;

  let body = {};
  try { body = await req.json(); } catch {}
  const action = body.action;
  if (!action) return json({ error: 'action required (list|create|delete|set_password)' }, 400);

  const supaUrl    = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supaUrl || !serviceKey) return json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).' }, 500);

  const me = await whoAmI(req);
  const localDev = isLocalhost(req) && !process.env.ADMIN_EMAILS;
  if (!localDev) {
    if (!me) return json({ error: 'Sign in first.' }, 401);
    if (!isAdminEmail(me.email)) return json({ error: 'Only admins can do that.' }, 403);
  }

  // ── Dispatch ──────────────────────────────────────────────
  if (action === 'list') {
    const r = await adminFetch(supaUrl, serviceKey, '/auth/v1/admin/users?per_page=200', { method: 'GET' });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: out?.msg || `HTTP ${r.status}` }, 502);
    const users = (out?.users || []).map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      banned_until: u.banned_until,
      email_confirmed_at: u.email_confirmed_at,
    }));
    return json({ users });
  }

  if (action === 'create') {
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || DEFAULT_PASSWORD;
    if (!email || !email.includes('@')) return json({ error: 'Provide a valid email.' }, 400);
    if (password.length < 4) return json({ error: 'Password must be at least 4 characters.' }, 400);
    const r = await adminFetch(supaUrl, serviceKey, '/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,        // auto-confirm so they can sign in immediately
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: out?.msg || out?.error_description || `HTTP ${r.status}` }, 502);
    return json({
      ok: true,
      user: { id: out?.id, email: out?.email },
      defaultPassword: password === DEFAULT_PASSWORD ? DEFAULT_PASSWORD : null,
    });
  }

  if (action === 'delete') {
    const userId = body.userId;
    if (!userId) return json({ error: 'userId required' }, 400);
    if (me && me.id === userId) return json({ error: 'Cannot delete yourself.' }, 400);
    const r = await adminFetch(supaUrl, serviceKey, `/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
    if (!r.ok) {
      const out = await r.json().catch(() => ({}));
      return json({ error: out?.msg || `HTTP ${r.status}` }, 502);
    }
    return json({ ok: true });
  }

  if (action === 'set_password') {
    const userId = body.userId;
    const password = body.password || DEFAULT_PASSWORD;
    if (!userId) return json({ error: 'userId required' }, 400);
    if (password.length < 4) return json({ error: 'Password must be at least 4 characters.' }, 400);
    const r = await adminFetch(supaUrl, serviceKey, `/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: out?.msg || `HTTP ${r.status}` }, 502);
    return json({ ok: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}
