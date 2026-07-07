// Script Library auth — email + password sign-in against the SAME Supabase
// project + user pool as the Interpreter. One workspace: every signed-in user
// sees the same script library. Auth here is IDENTITY, not per-project access
// control (mirrors translation/src/auth.js).
//
// Public API:
//   currentUser()                   — sync getter, cached user or null
//   onAuthChange(handler)           — subscribe to sign-in/out (fires immediately)
//   signInWithPassword(email, pw)   — { ok, error? }
//   sendMagicLink(email)            — { ok, error? } (forgot-password fallback)
//   updatePassword(newPassword)     — self-service change from the account menu
//   getAccessToken()                — current JWT for admin API calls
//   signOut()                       — local + remote sign-out
//   bootstrap()                     — call once at startup
//   authRequired()                  — true when Supabase is configured

import { supabase } from './supa.js';
import { tokenExpiresWithin } from './auth-token.js';

let _user = null;
const _listeners = new Set();

export function currentUser() { return _user; }

export function onAuthChange(handler) {
  _listeners.add(handler);
  try { handler(_user); } catch {}
  return () => _listeners.delete(handler);
}

function notify() {
  for (const h of _listeners) {
    try { h(_user); } catch (err) { console.warn('[auth] listener threw:', err); }
  }
}

export async function signInWithPassword(email, password) {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  if (!email || !password) return { ok: false, error: 'Email and password required.' };
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: error.message };
    return { ok: true, user: data?.user || null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function sendMagicLink(email) {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  if (!email || !/.+@.+\..+/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
        // HARD RULE: the magic link is a recovery path for EXISTING accounts
        // only. Without this flag, typing any email into the forgot-password
        // box would silently mint a brand-new account in the shared pool —
        // an open signup door. Accounts are created by admins, full stop.
        shouldCreateUser: false,
      },
    });
    if (error) {
      // Supabase phrases the shouldCreateUser rejection as a signup error
      // ("Signups not allowed for otp") — translate to what it means here.
      const msg = /signup/i.test(error.message)
        ? 'No account exists for that email. Ask an admin to add you.'
        : error.message;
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function updatePassword(newPassword) {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  if (!_user) return { ok: false, error: 'Not signed in' };
  if (!newPassword || newPassword.length < 4) return { ok: false, error: 'Password must be at least 4 characters.' };
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function getAccessToken() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch { return null; }
}

// Return a NON-EXPIRING access token, forcing a refresh when the current one is stale. getSession()
// returns the cached token (which may already be past its exp if the client's background auto-refresh
// hasn't fired — e.g. a backgrounded tab); refreshSession() forces a new one from the refresh token.
// This is what keeps a long editing session's cloud saves from silently 401-ing into "cloud offline".
// NEVER throws — returns the freshest token it can, or null.
export async function getFreshAccessToken() {
  if (!supabase) return null;
  try {
    let tok = null;
    try { const { data } = await supabase.auth.getSession(); tok = data?.session?.access_token || null; } catch {}
    if (!tok || tokenExpiresWithin(tok)) {
      try { const { data } = await supabase.auth.refreshSession(); tok = data?.session?.access_token || tok; } catch {}
    }
    return tok || null;
  } catch { return null; }
}

export async function signOut() {
  if (!supabase) return;
  try { await supabase.auth.signOut(); } catch (err) { console.warn('[auth] signOut failed:', err); }
  _user = null;
  notify();
}

export async function bootstrap() {
  if (!supabase) { notify(); return; }
  try {
    const { data } = await supabase.auth.getSession();
    _user = data?.session?.user || null;
  } catch (err) {
    console.warn('[auth] getSession failed:', err);
  }
  try {
    supabase.auth.onAuthStateChange((_evt, session) => {
      const next = session?.user || null;
      const changed = (next?.id || null) !== (_user?.id || null);
      _user = next;
      if (changed) notify();
    });
  } catch (err) {
    console.warn('[auth] subscribe failed:', err);
  }
  notify();
}

export function authRequired() { return !!supabase; }

// ── Admin: user management (calls /api/admin-users — the SAME endpoint the
// Interpreter uses). The caller's JWT is injected by the gate.js fetch
// interceptor, and the server checks it against ADMIN_EMAILS. When no password
// is supplied the server GENERATES a per-user random one and returns it ONCE
// (`generatedPassword`) so the admin can hand it over — there is no shared
// default password anymore. ─────────────────────────────────────────────────

async function adminCall(action, extra = {}) {
  const res = await fetch('/api/admin-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: out?.error || `HTTP ${res.status}`, status: res.status };
  return { ok: true, ...out };
}

/** List all users in the workspace. Admin-only server-side. */
export function listUsers() { return adminCall('list'); }

/** Create a user by email. Omit password → server generates a random one and
 *  returns it once as `generatedPassword` in the response. */
export function createUser(email, password) {
  return adminCall('create', { email, ...(password ? { password } : {}) });
}

/** Delete a user by id. */
export function deleteUser(userId) { return adminCall('delete', { userId }); }

/** Reset a user's password. Omit password → server generates a random one and
 *  returns it once as `generatedPassword` in the response. */
export function setUserPassword(userId, password) {
  return adminCall('set_password', { userId, ...(password ? { password } : {}) });
}
