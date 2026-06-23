// Shared, regex-free cookie reader for the client bundles.
//
// Replaces the old `document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"))`
// pattern that lived (divergently) in research/app.js and translation/src/gate.js.
// That built a RegExp from an interpolated `name` with NO escaping, so a cookie
// name carrying regex metacharacters (. * + ? [ ] etc.) would be compiled as a
// PATTERN instead of a literal — a regex-injection footgun. Parsing without a
// regex closes that class structurally: there is no pattern to inject into.
//
// Behavior matches the old regex for the real call sites (a constant `np_access`
// name + encodeURIComponent'd values): finds `name=` at the start of the cookie
// string or after a "; " separator (how browsers serialize document.cookie),
// returns the decoded value, or null when absent.

export function parseCookieValue(cookieString, name) {
  if (typeof cookieString !== 'string' || !name) return null;
  for (const part of cookieString.split('; ')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1));
      } catch {
        // Malformed percent-encoding — return the raw value rather than throw.
        return part.slice(eq + 1);
      }
    }
  }
  return null;
}
