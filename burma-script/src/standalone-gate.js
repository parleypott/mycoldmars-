// STANDALONE-DOOR GATE (audit finding L).
//
// The standalone /burma-script/ and /palau-script/ pages mount the FULL editor + live cloud sync with
// NO login — bypassing the Script Library's sign-in gate (scripts-library/src/gate.js). This closes
// that bypass: the EDITABLE door redirects into the login-gated library route for the project
// (/scripts-library/#<slug>). Johnny's real session lives in localStorage, so the library unlocks him
// immediately on arrival — the redirect is invisible to a signed-in user.
//
// READ-ONLY SHARES ARE PRESERVED. A ?read / ?view share link opens a structurally write-incapable
// session (read-mode.js freezes the editor; saveDoc / pushDoc both refuse). Those must keep working
// WITHOUT a login — that is the entire purpose of a share — so we do NOT redirect them; they stay on
// the standalone read-only page exactly as before. (There is therefore nothing to "carry through" a
// redirect for shares: they never redirect.)

import { isReadOnly } from './read-mode.js';

// Decide-only core (pure, testable): given the read-only signal and the current path, return the
// library redirect target, or null to stay put. Exposed for tests.
export function libraryRedirectTarget({ readOnly, slug, pathname = '' }) {
  if (readOnly) return null;              // read-only share → keep the standalone page working
  if (!slug) return null;
  // Defensive: never redirect if we're somehow already under the library path (no loop).
  if (typeof pathname === 'string' && pathname.indexOf('/scripts-library/') === 0) return null;
  return '/scripts-library/#' + slug;
}

// Perform the redirect for the standalone editable door. Returns true if it redirected (caller then
// skips booting the engine), false to boot the standalone page normally (read-only share, or on any
// unexpected error — fail OPEN so a share/bookmark is never bricked).
export function redirectStandaloneToLibrary(slug, deps = {}) {
  try {
    const loc = deps.location || (typeof window !== 'undefined' ? window.location : null);
    if (!loc) return false;
    const readOnly = typeof deps.readOnly === 'boolean' ? deps.readOnly : isReadOnly();
    const target = libraryRedirectTarget({ readOnly, slug, pathname: loc.pathname || '' });
    if (!target) return false;
    if (typeof loc.replace === 'function') loc.replace(target);
    else loc.href = target;
    return true;
  } catch {
    return false; // fail open — never brick the door on an unexpected error.
  }
}
