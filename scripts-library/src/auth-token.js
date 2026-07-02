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
