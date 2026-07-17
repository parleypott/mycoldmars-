// Pure input-validation contract for the BERGUNDY reader-notes endpoint
// (api/burgundy-notes.js) — a PUBLIC, service-role, un-gated write+delete API
// (single trusted reader at an unlisted URL). Extracted so the sanitize/guard
// contract is mutation-locked against a future loosening of a caps/allowlist.
//
// Edge-runtime safe: plain ESM, no node built-ins.

export const NOTE_COLORS = ['amber', 'green', 'blue', 'rose'];

// A note POST is valid iff it carries a string para_key and a non-empty,
// non-whitespace string quote. Returns the SANITIZED row to insert, or null
// when the body is missing the required fields. Every free-text field is
// length-capped; color is allowlisted; chapter_idx is coerced to an integer in
// [0, 999] to match the `int` column (a fractional value would otherwise round
// server-side into the wrong chapter).
export function sanitizeNoteRow(body) {
  if (!body || typeof body.para_key !== 'string' ||
      typeof body.quote !== 'string' || !body.quote.trim()) return null;
  return {
    para_key: String(body.para_key).slice(0, 40),
    quote: String(body.quote).slice(0, 2000),
    prefix: String(body.prefix || '').slice(0, 64),
    note: String(body.note || '').slice(0, 4000),
    color: NOTE_COLORS.includes(body.color) ? body.color : 'amber',
    reader: String(body.reader || 'reader').slice(0, 40),
    name: String(body.name || '').slice(0, 60),
    chapter_idx: Number.isFinite(+body.chapter_idx)
      ? Math.max(0, Math.min(999, Math.floor(+body.chapter_idx))) : 0,
    book_version: String(body.book_version || '').slice(0, 40),
    // the authoring tool's PERMANENT chapter id (rides book.json since
    // 2026-07-16) — survives chapter insertion/reordering forever
    chapter_id: String(body.chapter_id || '').slice(0, 40),
    // client-generated idempotency key (2026-07-16): dedups a POST that the
    // client retried after it looked failed but had actually reached the DB.
    // Omitted (null) for legacy clients — the partial unique index only
    // constrains non-null keys, so those still insert as before.
    dedupe_key: (typeof body.dedupe_key === 'string' && body.dedupe_key.trim())
      ? body.dedupe_key.slice(0, 60) : null,
  };
}

// DELETE takes ?id=<uuid> and interpolates it straight into the PostgREST
// filter `id=eq.${id}`. Guard the exact canonical UUID shape (8-4-4-4-12 hex)
// — the prior /^[0-9a-f-]{36}$/i accepted any 36-char hex/hyphen soup (e.g. 36
// bare hyphens), which is malformed and just wastes a DB round-trip.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidNoteId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}
