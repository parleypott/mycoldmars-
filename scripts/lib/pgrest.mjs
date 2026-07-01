// Shared PostgREST query-building helpers for the fort's Supabase REST callers.
//
// Why this file exists: a raw "+00:00" timezone offset in a PostgREST query
// VALUE is a live footgun. A literal '+' in a URL query decodes to a space, so
// `created_at=gt.2026-06-30T12:34:56+00:00` reaches PostgREST as
// `...12:34:56 00:00` and it 400s the request as an invalid timestamp (22007).
// PostgreSQL/PostgREST serialize timestamptz columns WITH that offset, so any DB
// timestamp fed back into a filter must be percent-encoded. `Date.toISOString()`
// happens to end in 'Z' (no '+'), which hid this — but DB-sourced timestamps do
// carry the offset. Route every timestamp filter through here so the encoding
// can never be forgotten at one call site while remembered at another.

/** Build a percent-encoded PostgREST filter clause: `col=op.<encoded ts>`. */
export function pgTsFilter(col, op, ts) {
  return `${col}=${op}.${encodeURIComponent(String(ts))}`;
}
