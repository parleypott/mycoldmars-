// Admin: invite a user by email to the workspace.
//
// Uses Supabase service-role key to call auth.admin.inviteUserByEmail().
// Service role is required because the public anon key can't create users
// when "Allow new signups" is disabled in the Supabase Auth settings —
// which is the recommended posture once the workspace is "set up by
// invitation only."
//
// Auth model:
//   • Caller must pass x-access-code (legacy gate, optional).
//   • Caller must include their Supabase access token in
//     Authorization: Bearer <jwt> — we verify the token, then check
//     that the calling user's email is in ADMIN_EMAILS (env var,
//     comma-separated). Only those emails can invite.
//   • For convenience in dev mode (ACCESS_CODE unset, no jwt sent),
//     the endpoint also accepts a request from localhost without auth.

import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge' };

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
  const jwt = m[1];

  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supaUrl || !anonKey) return null;

  try {
    const r = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` },
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
  return list.includes(email.toLowerCase());
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const accessErr = checkAccess(req);
  if (accessErr) return accessErr;

  let body = {};
  try { body = await req.json(); } catch {}
  const inviteEmail = (body.email || '').trim().toLowerCase();
  if (!inviteEmail || !inviteEmail.includes('@')) {
    return json({ error: 'Provide a valid email.' }, 400);
  }

  // Auth check.
  const me = await whoAmI(req);
  const isLocalDev = isLocalhost(req) && !process.env.ADMIN_EMAILS;
  if (!isLocalDev) {
    if (!me) return json({ error: 'Sign in first.' }, 401);
    if (!isAdminEmail(me.email)) return json({ error: 'Only admins can invite users.' }, 403);
  }

  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    return json({ error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' }, 500);
  }

  // Use Supabase Admin API to send a magic-link invite. Recipient gets
  // an email with a one-tap link; on click they're created + signed in.
  try {
    const r = await fetch(`${supaUrl}/auth/v1/invite`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: inviteEmail,
        // Where the invite click lands — back at the app root.
        // Override via INVITE_REDIRECT env var if needed.
        redirect_to: process.env.INVITE_REDIRECT || undefined,
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json({ error: out?.msg || out?.error_description || `Invite failed: HTTP ${r.status}` }, 502);
    }
    return json({
      ok: true,
      invitedEmail: inviteEmail,
      userId: out?.id || null,
    });
  } catch (err) {
    return json({ error: 'Invite request failed: ' + (err?.message || String(err)) }, 502);
  }
}
