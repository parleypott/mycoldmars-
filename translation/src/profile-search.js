// Multi-field collaborator search for the Share dialog's add-collaborator
// picker (searchUserProfiles). We want rows whose display_name OR email match
// the query.
//
// The old implementation OR-combined the two fields with PostgREST's `.or()`,
// which takes a COMMA-SEPARATED filter string:
//     display_name.ilike.%VALUE%,email.ilike.%VALUE%
// When the Supabase client serializes that, every comma — structural AND any
// inside VALUE — is percent-encoded to %2C, and PostgREST decodes them all back
// to literal commas and treats them as condition separators. So a search VALUE
// that itself contains a comma (a "Last, First" name typed into the picker)
// splits the .or() string into extra, malformed conditions:
//     display_name.ilike.%Smith | ` John%` | email.ilike.%Smith | ` John%`
// PostgREST rejects that (400) and the whole search throws — the picker breaks
// on any comma-bearing query.
//
// The fix mirrors searchTranscripts in this same file: run ONE single-column
// `.ilike()` per field instead. A scalar `.ilike()` filter value is taken
// literally up to the next query param — a comma (or paren/quote) inside it is
// part of the pattern, never a separator — so the corruption is structurally
// impossible. The two result sets are OR-combined in JS (dedupe + cap).

export const PROFILE_SEARCH_COLUMNS = ['display_name', 'email'];

// The list of single-column ILIKE filters to run for an (already
// LIKE-escaped) query. Each entry is a scalar filter, so a comma / paren /
// quote in `escaped` stays a literal part of the pattern — none of the chars
// that corrupt an `.or()` filter string apply.
export function planProfileSearch(escaped, columns = PROFILE_SEARCH_COLUMNS) {
  const pattern = `%${String(escaped ?? '')}%`;
  return columns.map(column => ({ column, pattern }));
}

// OR-combine the per-column result sets: dedupe by user_id, preserve order
// (the first column's matches come first), cap to `limit`. This reproduces
// what PostgREST's `.or()` returned — minus the comma corruption.
export function mergeProfileMatches(resultSets, limit = 8) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 8;
  const seen = new Set();
  const out = [];
  for (const rows of (resultSets || [])) {
    for (const row of (rows || [])) {
      if (!row) continue;
      const id = row.user_id;
      if (id != null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(row);
      if (out.length >= cap) return out;
    }
  }
  return out;
}
