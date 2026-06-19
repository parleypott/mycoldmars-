// Pure, testable cores extracted from command-palette.js (the Interpreter's
// ⌘K / Ctrl-K fuzzy launcher). Kept DOM-free so they can be unit-tested headlessly.

export function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Fuzzy score for a query against a command/transcript item.
// Sum of:
//   exact substring match in label  — 100
//   starts-with match in label      — +60
//   word-boundary match in label    — +30
//   substring in hint or group      — +15
//   subsequence (in-order chars)    — up to +20
// A non-positive score means "no match" and the item is filtered out.
export function fuzzyScore(q, label, group, hint) {
  if (!q) return 1;
  const ql = q.toLowerCase();
  const ll = label.toLowerCase();
  let score = 0;
  if (ll.includes(ql)) {
    score += 100;
    if (ll.startsWith(ql)) score += 60;
    // bonus for word-boundary match
    if (new RegExp(`\\b${escapeReg(ql)}`).test(ll)) score += 30;
  }
  const gl = (group || '').toLowerCase();
  const hl = (hint || '').toLowerCase();
  if (gl.includes(ql) || hl.includes(ql)) score += 15;

  // Subsequence: every char of query appears in order in label.
  let i = 0;
  for (const ch of ll) {
    if (ch === ql[i]) i++;
    if (i === ql.length) break;
  }
  if (i === ql.length) score += 20 - Math.min(20, ll.indexOf(ql[0]));

  return score;
}

// Hardened recents parser. The old loadRecent did
// `JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')` and returned the parsed
// value VERBATIM — so a corrupt RECENT_KEY holding valid JSON that is NOT an
// array (e.g. '{}') was returned as-is. render()'s `loadRecent().map(...)` and
// rememberRecent's `loadRecent().filter(...)` then threw a TypeError on the
// non-array, breaking ⌘K open. parseRecent GUARANTEES an array: a missing key,
// malformed JSON, or a non-array value all degrade to [].
export function parseRecent(raw) {
  if (raw == null) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
