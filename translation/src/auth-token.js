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
