// Parse the 'hk-studied' localStorage value into a GUARANTEED Set of studied ids.
//
// main.js loads progress at MODULE TOP LEVEL with
//   const studied = new Set(JSON.parse(localStorage.getItem('hk-studied') || '[]'));
// with NO try/catch — so a corrupt/legacy store crashed the WHOLE tool on load
// (blank grid, no recovery) in two ways:
//   (1) MALFORMED JSON ('{bad', '')        -> JSON.parse throws.
//   (2) valid-but-NON-iterable ('{}', '5') -> new Set(<non-iterable>) throws
//       "is not iterable". (A bare string like '"ab"' is iterable and would
//       silently seed the Set with single characters — also wrong.)
// 'hk-studied' is only ever written as JSON.stringify([...studied]) (an array),
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
