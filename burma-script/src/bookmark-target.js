// BOOKMARK DEEP LINK — resolve `?bm=<id>` from a URL (search OR hash-query).
//
// Extracted from main.jsx so it is (a) the SINGLE source of truth for how a bookmark deep link is
// parsed and (b) importable by tests in Node without loading main.jsx (which renders on import).
// Same posture as read-mode.js's ?read scan: a bookmark id may ride in the plain search string
// (standalone door: /burma-script/?read&bm=<id>) OR inside the hash-query (library door:
// /scripts-library/#<slug>?read&bm=<id>), so we scan BOTH. Pure(loc) — defaults to window.location.
export function bookmarkTargetFromUrl(loc) {
  try {
    const l = loc || (typeof window !== 'undefined' ? window.location : null);
    if (!l) return null;
    const { search = '', hash = '' } = l;
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
    for (const qs of [search, hashQuery]) {
      if (!qs) continue;
      const params = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
      const v = params.get('bm');
      if (v) return v;
    }
    return null;
  } catch { return null; }
}
