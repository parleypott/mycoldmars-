// Legacy localStorage index reader for the one-time pre-Supabase migration.
//
// Extracted from db.js so the array-safety guarantee is unit-testable. Reads
// the global `localStorage` at CALL time (never at import) so this module
// imports cleanly in a headless test (the same pattern as ./snapshot.js).
//
// These `mcm_index_projects` / `mcm_index_transcripts` keys are legacy keys
// from the pre-Supabase era — only ever written as a JSON array. But a
// corrupt / hand-edited / quota-truncated / legacy-format store can hold a
// valid-but-NON-array value. The old `lsGet(...) || []` returned that
// non-array verbatim (a truthy object/number passes `||`), and the migration
// then did `for (const id of index)` → "object is not iterable" → the whole
// migration threw, was swallowed by the call-site `.catch`, never set the
// MIGRATION_KEY, and so RE-RAN and re-crashed on every app load — leaving the
// user's legacy local transcripts stuck in localStorage, never reaching the
// cloud. `lsGetIndex` now GUARANTEES an array.

export const LS_PREFIX = 'mcm_';

export function lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function lsDelete(key) {
  try { localStorage.removeItem(LS_PREFIX + key); } catch {}
}

// GUARANTEES an array. Any non-array (corrupt object/number/string, or a
// missing/malformed store) degrades to [] so the migration's `for...of` and
// `.length` can never throw on a poisoned index.
export function lsGetIndex(collection) {
  const v = lsGet(`index_${collection}`);
  return Array.isArray(v) ? v : [];
}
