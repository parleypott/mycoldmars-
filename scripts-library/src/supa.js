// Supabase client for the Script Library's auth (sign-in + add-user).
//
// Mirrors translation/src/db.js's client init exactly: reads the SAME
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY that the Interpreter uses, so a
// user created in one tool signs into the other (one workspace, one user pool).
// If the env isn't configured we return null everywhere and the app runs OPEN
// (local-first, no gate) — Palau's posture.

import { createClient } from '@supabase/supabase-js';

let supabase = null;
let initError = null;

try {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    supabase = createClient(url, key);
  } else {
    initError = 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY';
  }
} catch (err) {
  initError = err?.message || String(err);
}

export { supabase };
export function authConfigured() { return !!supabase; }
export function getInitError() { return initError; }
