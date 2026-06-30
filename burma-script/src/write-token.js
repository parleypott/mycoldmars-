// Burma Script Tool — CLOUD WRITE TOKEN (share-safety: server-side write gate, device-held secret).
//
// THE GAP THIS CLOSES (share-safety, server side): api/burma-script-doc.js PUT used to be
// unauthenticated. Read-only was enforced CLIENT-SIDE only (read-mode short-circuits + editable:false).
// Through the app's own code a `?read` recipient could never write — but a recipient with DevTools could
// hand-craft fetch('/api/burma-script-doc',{method:'PUT',body:{doc,version:HUGE}}) and clobber Johnny's
// canonical cloud doc, because the server only enforced optimistic version concurrency. To make the share
// STRUCTURALLY safe, the PUT now requires a write SECRET the server holds (BURMA_WRITE_TOKEN) and the read
// link does NOT carry.
//
// WHERE THE SECRET LIVES — and why it is NOT in the bundle:
//   Johnny's edit device and a `?read` recipient load the SAME JavaScript bundle. So a token baked into
//   the bundle (e.g. via VITE_*) would be readable by the recipient too — it would NOT close the gap. The
//   secret therefore lives in Johnny's BROWSER (localStorage on his device), never in the shipped code and
//   never in a share link. Provisioning is a one-time capture: Johnny opens his edit URL once with
//   `?key=THE_SECRET` (or `#?key=…`); this module stashes it into localStorage and STRIPS it from the
//   address bar so it isn't shoulder-surfed or copy-pasted into a share. From then on every push carries
//   the header from localStorage; a recipient's browser simply doesn't have that key, so even a hand-
//   crafted PUT is rejected 401 by the server. The read link is just the bare prod URL with `?read`.
//
// GRACEFUL DEGRADATION: if the server has NO BURMA_WRITE_TOKEN configured (local dev, or before Johnny
// provisions one), the server keeps accepting unauthenticated PUTs exactly as before — nothing breaks.
// The gate only ENGAGES once the env secret exists, so turning it on is a pure server-side flip plus a
// one-time `?key=` visit on Johnny's device. No bundle change ships the secret.

import { getEpisode, getEpisodeStorage, onEpisodeChange } from './episode-config.js';

export let LS_WRITE_TOKEN = '';

// The header the server reads. Kept in sync with api/burma-script-doc.js (WRITE_TOKEN_HEADER).
export let WRITE_TOKEN_HEADER = '';

// The URL param Johnny uses ONCE to provision his device. Accepted in the search string AND in the hash
// (so static/hash routing works), mirroring read-mode.js's dual-source parsing.
const KEY_PARAM = 'key';

// In-memory cache of the resolved token so every push reads it without touching localStorage on the hot
// path. Resolved lazily on first getWriteToken(), and refreshed by captureWriteTokenFromUrl().
let _token = undefined; // undefined = not yet resolved; null = resolved-but-absent; string = present

function syncEpisodeKeys() {
  LS_WRITE_TOKEN = getEpisodeStorage().WRITE_TOKEN;
  WRITE_TOKEN_HEADER = getEpisode().cloud.tokenHeader;
  _token = undefined;
}

onEpisodeChange(syncEpisodeKeys);

function readStored() {
  try {
    const v = localStorage.getItem(LS_WRITE_TOKEN);
    return v && typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

// Capture a `?key=SECRET` from the URL (search OR hash query), persist it to localStorage, and SCRUB it
// from the address bar so the secret isn't left visible or pasted into a shared link. Idempotent and
// NEVER throws. Returns true if a token was captured (and stored) this call. Safe to call on every load.
//
// IMPORTANT: a `?read` / `?view` recipient must NEVER be provisioned, even if a malicious link tacked a
// `?key=` on. We deliberately do NOT special-case that here — read-mode's own guards refuse every write
// regardless — but capture is still skipped under read-only so a reader's device never silently acquires
// a write secret from a crafted link.
export function captureWriteTokenFromUrl(opts = {}) {
  const { isReadOnly = () => false } = opts;
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    if (isReadOnly()) return false; // never provision a read-only recipient's device
    const { search = '', hash = '' } = window.location;
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';

    let found = null;
    for (const qs of [search, hashQuery]) {
      if (!qs) continue;
      const params = new URLSearchParams(qs.startsWith('?') ? qs : '?' + qs);
      const k = params.get(KEY_PARAM);
      if (k && k.length > 0) { found = k; break; }
    }
    if (!found) return false;

    try { localStorage.setItem(LS_WRITE_TOKEN, found); } catch {}
    _token = found; // refresh the in-memory cache immediately

    // SCRUB the secret out of the address bar (both search and hash) without a reload, so it doesn't
    // linger in history, get shoulder-surfed, or get copied into a `?read` share. NEVER throws.
    try { scrubKeyFromUrl(); } catch {}
    return true;
  } catch {
    return false;
  }
}

// Remove the `key` param from BOTH the search string and the hash query, then replaceState so the bar is
// clean and the entry can't be re-shared with the secret attached.
function scrubKeyFromUrl() {
  if (typeof window === 'undefined' || !window.history || !window.history.replaceState) return;
  const url = new URL(window.location.href);

  // search
  if (url.searchParams.has(KEY_PARAM)) url.searchParams.delete(KEY_PARAM);

  // hash query (e.g. #/foo?key=… or #?key=…)
  if (url.hash.includes('?')) {
    const hi = url.hash.indexOf('?');
    const base = url.hash.slice(0, hi);
    const hp = new URLSearchParams(url.hash.slice(hi + 1));
    hp.delete(KEY_PARAM);
    const rest = hp.toString();
    url.hash = rest ? base + '?' + rest : base;
  }

  window.history.replaceState(null, '', url.toString());
}

// The resolved write token for THIS device, or null if none. Reads the in-memory cache first; resolves
// from localStorage once. NEVER throws.
export function getWriteToken() {
  if (_token === undefined) _token = readStored();
  return _token;
}

// Has this device been provisioned with a write token? (UI/diagnostics; not a security gate — the server
// is the gate.) NEVER throws.
export function hasWriteToken() {
  return !!getWriteToken();
}

// Build the auth header object for a PUT. Empty object when no token (so an unconfigured server still
// accepts the push, and a configured server returns 401 — exactly the graceful-degradation contract).
export function writeTokenHeaders() {
  const t = getWriteToken();
  return t ? { [WRITE_TOKEN_HEADER]: t } : {};
}

// TEST SEAM — set/clear the in-memory token deterministically without a real URL or localStorage.
export function __setWriteTokenForTest(v) {
  _token = (v === undefined) ? readStored() : (v === null ? null : String(v));
  return _token;
}

export { KEY_PARAM };
