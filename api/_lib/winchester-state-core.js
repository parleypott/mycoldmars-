// Winchester (Westchester House Hunter) cross-machine state-sync — pure
// data-integrity core, extracted from api/winchester-state.js so the
// load-bearing decisions can be unit-tested without a live DB.
//
// Two guarantees this module encodes:
//   1. extractStateRow — a GET/merge response NEVER carries a broken state.
//      An empty/null/non-array PostgREST result, or a row whose `state` is
//      null, degrades to `{ state: {}, updated_at: <ts|null> }`. The client
//      hydrates from this on cold start, so a thrown/undefined here would
//      wipe Johnny's saved listings/scores/notes.
//   2. wantsConcurrencyCheck + shouldReject409 — the optimistic-concurrency
//      guard. A POST that carries `expectedUpdatedAt` is rejected with 409
//      (so the client can merge) iff the server has since advanced past that
//      timestamp. Omitting expectedUpdatedAt is the deliberate
//      last-write-wins fallback for the cold-start "push my merged state" path.

const isNonEmptyStr = (v) => typeof v === 'string' && v.length > 0;

/**
 * Normalize a PostgREST `select=state,updated_at` result into the response
 * shape, defaulting an empty/null/non-array result to an empty state and a
 * null-`state` row to `{}`. Always returns a plain object — never throws.
 */
export function extractStateRow(rows) {
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return { state: {}, updated_at: null };
  return {
    state: row.state || {},
    updated_at: row.updated_at != null ? row.updated_at : null,
  };
}

/**
 * Should the handler even fetch the server timestamp to compare? Only when the
 * caller supplied a non-empty string `expectedUpdatedAt`. Omitted/empty/
 * non-string → skip the check (last-write-wins).
 */
export function wantsConcurrencyCheck(expectedUpdatedAt) {
  return isNonEmptyStr(expectedUpdatedAt);
}

/**
 * The optimistic-concurrency decision: reject the write with 409 iff BOTH the
 * server timestamp and the caller's expected timestamp are non-empty strings
 * AND they differ (the server has advanced — the client must merge first).
 * A null/empty server timestamp (fresh row, nothing to clobber) or a match
 * (client holds the latest) → allow the write.
 */
export function shouldReject409(serverTs, expectedUpdatedAt) {
  return isNonEmptyStr(serverTs) && isNonEmptyStr(expectedUpdatedAt) && serverTs !== expectedUpdatedAt;
}
