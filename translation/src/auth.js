// Multi-user auth: Supabase magic-link only. No passwords, no signup form.
// Sign-in flow:
//   1. User enters email
//   2. We call supabase.auth.signInWithOtp({ email })
//   3. Supabase sends a magic link to that email
//   4. User clicks link → returns to app with a session token in the URL
//   5. supabase-js auto-detects the session and stores it
//   6. onAuthStateChange fires → app unlocks, header avatar appears
//
// Workspace model (see supabase/migrations/010_auth_workspace.sql): every
// signed-in user sees the same library + projects. Auth here is for
// IDENTITY (presence, attribution, audit) — not access control.
//
// Public API:
//   currentUser()             — synchronous getter, returns the cached user or null
//   currentProfile()          — synchronous getter, returns { user_id, display_name, color, email }
//   onAuthChange(handler)     — subscribes to sign-in/sign-out
//   sendMagicLink(email)      — fires the OTP email; returns { ok, error? }
//   signOut()                 — local + remote sign-out
//   bootstrap()               — call once at app start; restores session + listens for changes

import { supabase } from './db.js';

let _user = null;
let _profile = null;
const _listeners = new Set();

export function currentUser() { return _user; }
export function currentProfile() { return _profile; }

export function onAuthChange(handler) {
  _listeners.add(handler);
  // Fire immediately with current state so the caller can render right away.
  try { handler(_user, _profile); } catch {}
  return () => _listeners.delete(handler);
}

function notify() {
  for (const h of _listeners) {
    try { h(_user, _profile); } catch (err) { console.warn('[auth] listener threw:', err); }
  }
}

async function loadProfile(userId) {
  if (!userId || !supabase) { _profile = null; return; }
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('user_id, display_name, color, email, avatar_url')
      .eq('user_id', userId)
      .maybeSingle();
    if (!error && data) {
      _profile = data;
      return;
    }
    // If the row doesn't exist yet (trigger hasn't run, or migration not
    // applied), synthesize a placeholder so callers don't crash.
    _profile = {
      user_id: userId,
      display_name: (_user?.email || 'You').split('@')[0],
      color: '#dd2c1e',
      email: _user?.email || null,
      avatar_url: null,
    };
  } catch (err) {
    console.warn('[auth] loadProfile failed:', err);
    _profile = null;
  }
}

/**
 * Email + password sign-in (preferred). The magic-link path stays as a
 * fallback / forgot-password recovery. New accounts default to password
 * 'newpress' — they're prompted to change it later from the dropdown.
 */
export async function signInWithPassword(email, password) {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  if (!email || !password) return { ok: false, error: 'Email and password required.' };
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, user: data?.user || null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Lets the signed-in user change their own password. The admin
 * console can reset other users via the /api/admin-set-password
 * endpoint — this one is for self-service.
 */
export async function updatePassword(newPassword) {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  if (!_user) return { ok: false, error: 'Not signed in' };
  if (!newPassword || newPassword.length < 4) {
    return { ok: false, error: 'Password must be at least 4 characters.' };
  }
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Returns the current Supabase access JWT (or null) so admin-only API
 * endpoints can verify the caller server-side via Authorization: Bearer.
 */
export async function getAccessToken() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch { return null; }
}

export async function sendMagicLink(email) {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  if (!email || !/.+@.+\..+/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // Send the user back to the same app URL after they click the link.
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function signOut() {
  if (!supabase) return;
  try { await supabase.auth.signOut(); } catch (err) { console.warn('[auth] signOut failed:', err); }
  _user = null;
  _profile = null;
  notify();
  // Drop the legacy access cookie + session bits so a future sign-in is clean.
  try { sessionStorage.removeItem('mcm_access_code'); } catch {}
}

export async function updateDisplayName(name) {
  if (!supabase || !_user) return { ok: false, error: 'Not signed in' };
  const trimmed = (name || '').trim();
  if (!trimmed) return { ok: false, error: 'Name required' };
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .update({ display_name: trimmed, updated_at: new Date().toISOString() })
      .eq('user_id', _user.id)
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    _profile = { ..._profile, ...data };
    notify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// Call once at app start. Subscribes to auth-state changes so sign-in /
// sign-out from other tabs propagates immediately.
export async function bootstrap() {
  if (!supabase) {
    notify();
    return;
  }
  try {
    const { data } = await supabase.auth.getSession();
    _user = data?.session?.user || null;
    if (_user) await loadProfile(_user.id);
  } catch (err) {
    console.warn('[auth] getSession failed:', err);
  }
  // Listen for changes (sign-in via magic link, sign-out from another tab,
  // token refresh, etc.).
  try {
    supabase.auth.onAuthStateChange(async (_evt, session) => {
      const next = session?.user || null;
      const userChanged = (next?.id || null) !== (_user?.id || null);
      _user = next;
      if (_user) await loadProfile(_user.id);
      else _profile = null;
      if (userChanged) notify();
    });
  } catch (err) {
    console.warn('[auth] subscribe failed:', err);
  }
  notify();
}

// Whether auth is required for this deployment. If supabase isn't
// configured at all, we run open (dev mode). Otherwise we require sign-in.
export function authRequired() {
  return !!supabase;
}
