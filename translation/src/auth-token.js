// Reads the Supabase access token synchronously from localStorage so the
// Interpreter's fetch interceptor (gate.js) can inject
// `Authorization: Bearer <jwt>` on every authenticated /api/* request
// without an async getSession() round-trip.
//
// The storage key shape is `sb-<projectRef>-auth-token`; pre-v2 used
// `supabase.auth.token`. We match either and parse the JWT out of the
// payload, tolerating the three real session shapes:
//   1. v2 object        { access_token, refresh_token, ... }
//   2. array-wrapped     [ <access_token>, ... ]
//   3. legacy v1 object  { currentSession: { access_token, ... } }
//
// Returns the JWT string, or null when the user is not signed in / the
// payload is missing or unparseable. The interceptor treats null as
// "no Authorization header" and must never see this throw — every failure
// path degrades to null. Reads the global `localStorage` at CALL time (not
// at import), so the module imports cleanly anywhere a localStorage exists.
export function readSupabaseAccessTokenSync() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!/^sb-.*-auth-token$/i.test(key) && key !== 'supabase.auth.token') continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      // v2 stores { access_token, refresh_token, ... }
      if (parsed && typeof parsed === 'object' && parsed.access_token) return parsed.access_token;
      // Some adapter versions wrap in an array; element 0 is access token.
      if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
      // currentSession.access_token (legacy)
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
