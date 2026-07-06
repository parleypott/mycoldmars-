// Parse the 'nm-studied' localStorage value into a GUARANTEED Set of studied ids.
//
// main.js loads progress at MODULE TOP LEVEL with
//   const studied = new Set(JSON.parse(localStorage.getItem('nm-studied') || '[]'));
// with NO try/catch — so a corrupt/legacy store crashed the WHOLE tool on load
// (blank grid, no recovery) in two ways:
//   (1) MALFORMED JSON ('{bad', '')        -> JSON.parse throws.
//   (2) valid-but-NON-iterable ('{}', '5') -> new Set(<non-iterable>) throws
//       "is not iterable". (A bare string like '"ab"' is iterable and would
//       silently seed the Set with single characters — also wrong.)
// 'nm-studied' is only ever written as JSON.stringify([...studied]) (an array),
// so anything else is corruption/legacy — latent today, but a real reachable
// crash that takes the entire tool down.
//
// Returns a Set built from the array's members for a real array (byte-identical
// behavior for the common case -> zero regression); an EMPTY Set for any
// missing / unparseable / non-array value.
export function parseStudiedSet(raw) {
  if (raw == null) return new Set();
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? new Set(v) : new Set();
  } catch {
    return new Set();
  }
}

// Crash-safe localStorage READ for the studied-progress key. main.js reads it at
// MODULE TOP LEVEL, before the grid renders — and merely ACCESSING localStorage
// throws a SecurityError in storage-blocked contexts (Safari "Block All Cookies",
// the Gmail/Slack in-app webviews people tap links from). A bare
// localStorage.getItem(key) there would abort the whole module → blank grid, no
// recovery. This is the storage-ACCESS sibling of the value-corruption crash
// parseStudiedSet already fixes: parseStudiedSet guards what the store CONTAINS;
// this guards the act of TOUCHING the store. Degrade to null on throw —
// parseStudiedSet turns null into an empty Set. Byte-identical to a bare
// localStorage.getItem(key) on the happy path.
export function safeLsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
