// Admin: user management.
//
// One endpoint, four actions, all gated to ADMIN_EMAILS callers:
//   POST { action: 'list' }                          → { users: [...] }
//   POST { action: 'create', email, password? }      → { user, generatedPassword? }
//   POST { action: 'delete', userId }                → { ok: true }
//   POST { action: 'set_password', userId, password? }→ { ok: true, generatedPassword? }
//
// Passwords: there is NO shared default anymore (the old fixed default was
// printed on the public login page — a skeleton key for every account that
// never rotated it). When create/set_password get no explicit password,
// the server generates a per-user random one and returns it ONCE as
// `generatedPassword` so the admin can hand it over. It is never stored or
// echoed again.
//
// Auth model:
//   • Authorization: Bearer <jwt> required (the caller's Supabase session).
//   • The verified user's email must match an entry in ADMIN_EMAILS
//     (env var, comma-separated; e.g. 'johnny@newpress.com' plus Ryan and
//     any future teammates at the same domain).
//   • Localhost without ADMIN_EMAILS set bypasses the check (dev only).
//
// Managing ADMIN_EMAILS (lives in Vercel, Production + Preview, type
// "encrypted" — NOT "sensitive", or `vercel env pull` reads back empty and
// the value can never be verified). To add an admin, pull the current value
// and re-add the MERGED list — a plain `vercel env add --force` clobbers,
// it does not append:
//   vercel env pull --environment=production /tmp/e && grep ADMIN_EMAILS /tmp/e
//   printf 'old1@x.com,old2@x.com,new@x.com' | vercel env add ADMIN_EMAILS production --force
// (repeat for `preview`; takes effect on the next deploy). Or dashboard:
// vercel.com → mycoldmars project → Settings → Environment Variables.
//
// Uses SUPABASE_SERVICE_ROLE_KEY to reach Supabase Admin API.

import { checkAccess } from './_lib/access.js';
import { parseAdminEmails, isAdminEmail, isLoopbackHost } from './_lib/admin-auth.js';
import { readJsonBody } from './_lib/read-json-body.js';
import { generatePassword } from './_lib/generate-password.js';

export const config = { runtime: 'edge' };

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;
  const action = body.action;
  if (!action) return json({ error: 'action required (list|create|delete|set_password|bootstrap)' }, 400);

  // Bootstrap is the one action that bypasses ACCESS_CODE — first-time
  // setup needs to work before anyone has the code. Still safe: it only
  // ever creates emails from the server-controlled ADMIN_EMAILS list and
  // is idempotent (existing users are skipped, never modified).
  if (action !== 'bootstrap') {
    const denied = await checkAccess(req);
    if (denied) return denied;
  }

  const supaUrl    = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supaUrl || !serviceKey) return json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).' }, 500);

  // ── Bootstrap: idempotent seed of ADMIN_EMAILS users. No JWT required —
  // chicken-and-egg: there's no admin yet to auth as. Safe because it only
  // ever creates emails that the server itself listed in ADMIN_EMAILS, and
  // only if they don't already exist. Seeded accounts get an UNDISCLOSED
  // random password (this endpoint is anonymous, so returning one would hand
  // it to whoever probed first) — the admin's first sign-in is the magic
  // link, which works for existing accounts, then they set a password from
  // the account menu.
  if (action === 'bootstrap') {
    const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
    if (!adminEmails.length) {
      return json({ error: 'ADMIN_EMAILS env var not set on the server.' }, 400);
    }
    // Find which already exist.
    const listR = await adminFetch(supaUrl, serviceKey, '/auth/v1/admin/users?per_page=200', { method: 'GET' });
    const listOut = await listR.json().catch(() => ({}));
    if (!listR.ok) return json({ error: listOut?.msg || `list failed: HTTP ${listR.status}` }, 502);
    const existingEmails = new Set((listOut?.users || []).map(u => String(u.email || '').toLowerCase()));

    const created = [], skipped = [], failed = [];
    for (const email of adminEmails) {
      if (existingEmails.has(email)) { skipped.push(email); continue; }
      const r = await adminFetch(supaUrl, serviceKey, '/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password: generatePassword(), email_confirm: true }),
      });
      const out = await r.json().catch(() => ({}));
      if (r.ok) created.push({ email, id: out?.id });
      else failed.push({ email, error: out?.msg || out?.error_description || `HTTP ${r.status}` });
    }
    // Response intentionally leaks NOTHING about admin emails or seeded
    // passwords. The bootstrap endpoint is anonymous-by-design
    // (chicken-and-egg) — if it echoed the admin list or a credential back,
    // anyone probing the open internet could sign in as admin before the
    // real owner had a chance. Client only needs counts for the toast.
    return json({
      ok: true,
      createdCount: created.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
    });
  }

  const me = await whoAmI(req);
  // Defense in depth: the localhost dev-bypass only fires when ALSO not
  // in production. Previously a Vercel deploy that had ADMIN_EMAILS unset
  // and was probed with a spoofed `Host: localhost` header could trip
  // the bypass and hand out admin actions to the open internet.
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  const localDev = !isProd && isLoopbackHost(req.url) && !process.env.ADMIN_EMAILS;
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
    // No password supplied → generate a per-user random one. `generated`
    // gates whether we return it: an admin-chosen password is theirs to
    // remember, a generated one is shown exactly once here.
    const generated = !body.password;
    const password = generated ? generatePassword() : body.password;
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
      generatedPassword: generated ? password : null,
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
    // Same contract as create: no password → generate one and return it once.
    const generated = !body.password;
    const password = generated ? generatePassword() : body.password;
    if (!userId) return json({ error: 'userId required' }, 400);
    if (password.length < 4) return json({ error: 'Password must be at least 4 characters.' }, 400);
    const r = await adminFetch(supaUrl, serviceKey, `/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: out?.msg || `HTTP ${r.status}` }, 502);
    return json({ ok: true, generatedPassword: generated ? password : null });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}
