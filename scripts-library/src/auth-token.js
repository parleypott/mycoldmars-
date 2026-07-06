// Reads the Supabase access token synchronously from localStorage so the
// fetch interceptor (gate.js) can inject `Authorization: Bearer <jwt>` on every
// same-origin /api/* request without an async getSession() round-trip.
//
// Copied verbatim from translation/src/auth-token.js — the storage-key shapes
// and the three session-payload variants are identical (same Supabase project).
export function readSupabaseAccessTokenSync() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!/^sb-.*-auth-token$/i.test(key) && key !== 'supabase.auth.token') continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.access_token) return parsed.access_token;
      if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
      if (parsed?.currentSession?.access_token) return parsed.currentSession.access_token;
    }
  } catch {}
  return null;
}

// Is this JWT expired, or within `skewSec` of expiring? A Supabase access token lives ~1 hour; the
// interceptor used to inject whatever sat in localStorage with NO expiry check, so after ~an hour of
// editing every /api write 401'd and the save pill silently dropped to "CLOUD OFFLINE" (the exact
// mid-session token-expiry trap the audit flagged). We decode the JWT's `exp` claim and treat a
// missing/unparseable exp as "expiring" (fail safe → force a refresh) rather than injecting a token we
// can't vouch for. Pure + synchronous so the interceptor can gate its refresh on it. NEVER throws.
export function tokenExpiresWithin(token, skewSec = 60) {
  try {
    if (!token || typeof token !== 'string') return true;
    const part = token.split('.')[1];
    if (!part) return true;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json);
    if (!payload || typeof payload.exp !== 'number') return true; // unknown expiry → refresh
    return payload.exp * 1000 <= Date.now() + skewSec * 1000;
  } catch {
    return true; // can't read it → force a refresh rather than send a token we can't verify
  }
}
