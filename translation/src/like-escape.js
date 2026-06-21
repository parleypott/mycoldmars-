// Escape a user search string for safe use inside a PostgreSQL LIKE / ILIKE
// pattern (as sent through PostgREST's .ilike()/.or() filters).
//
// PostgreSQL LIKE/ILIKE uses backslash (\) as the DEFAULT escape character.
// The two wildcards %  and _ must be escaped to be matched literally — but so
// must the escape character ITSELF. Escaping only % and _ (the bug this fixes)
// leaves a literal backslash in the query unescaped, which silently corrupts
// the match: a query ending in `\` (e.g. a pasted "C:\path\" fragment) becomes
// `%foo\%`, where the trailing `\` escapes the closing `%` wildcard and eats
// it — so the search returns wrong/empty results instead of a substring match.
//
// The fix: escape \  %  _ in a SINGLE character-class pass so each — INCLUDING
// the backslash — gets exactly one backslash prepended. Crucially this means a
// query ending in N backslashes yields 2N trailing backslashes (an even count),
// so the closing wildcard in `%${escaped}%` can never be consumed.
//
// Byte-identical to the old `replace(/[%_]/g, …)` for any query containing no
// backslash (the overwhelming common case) — only backslash-bearing queries
// change, and they change from broken to correct.
export function escapeLikePattern(q) {
  return String(q ?? '').replace(/[\\%_]/g, ch => '\\' + ch);
}
