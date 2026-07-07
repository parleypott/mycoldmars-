// The domain gate for self-signup — the ONE definition of "a newpress email".
//
// Anyone with an @newpress.com address may mint their own account (magic link
// with shouldCreateUser:true); every other domain stays on the recovery-only
// posture. This predicate is imported by BOTH sides that need the rule in JS:
//   • scripts-library/src/auth.js — flips shouldCreateUser on the signup path
//     (UX only: a tampered client can flip the flag itself)
//   • any server code that wants to pre-check an address
// The actual WALL is server-side in Supabase: the `before-user-created` auth
// hook calls public.hook_restrict_signup_to_newpress(event jsonb), which
// applies this same rule (lower + trim + exact-domain regex) and rejects the
// insert with a 403 before the user row ever exists. If this predicate
// changes, that Postgres function must change with it — the SQL lives in the
// Supabase migration `restrict_signup_to_newpress_domain`.
//
// Exact-match discipline (mirrors admin-auth.js isAdminEmail): the domain is
// compared whole, never by suffix/substring, so lookalikes fail closed —
// evil-newpress.com, newpress.com.evil.com, sub.newpress.com, newpress.co.
// Exactly one @, non-empty local part, no whitespace anywhere after trim.

export const SIGNUP_DOMAIN = 'newpress.com';

// ^ one-or-more non-space/non-@ chars, a single @, the exact domain, end.
const SIGNUP_EMAIL_RE = /^[^\s@]+@newpress\.com$/;

export function isNewpressEmail(email) {
  if (typeof email !== 'string') return false;
  return SIGNUP_EMAIL_RE.test(email.trim().toLowerCase());
}
