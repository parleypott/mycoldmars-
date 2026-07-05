// Shared regex-literal escaper. Turns an arbitrary string into one that matches
// itself LITERALLY inside a RegExp — every metachar (. * + ? ^ $ { } ( ) | [ ] \)
// is backslash-prefixed. Without it, a character key / alias carrying a metachar
// (e.g. a name with "(" or ".") makes `new RegExp(name)` either silently
// mis-match (a bare "." matches any char) or throw SyntaxError and crash the whole
// pass. Consolidated here because qss-canon.js and qss-signals.js each carried a
// byte-identical private copy (obs 6441) — the divergent-copy landmine the loop
// kills by funnelling twins through one tested helper so they can never drift.
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
