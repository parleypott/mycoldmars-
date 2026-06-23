// Devchat relative-age formatter (extracted from devchat.js for testability +
// to harden the present-but-bad-date class).
//
// relAgo renders the thread-list "when" stamp in the devchat panel
// (devchat.js: `${escDc(relAgo(t.updated_at))}`). A null/empty timestamp is an
// empty stamp; a valid ISO string becomes "Ns"/"Nm"/"Nh"/"Nd". A
// PRESENT-but-unparseable timestamp (corrupt/legacy/tampered row, schema drift)
// makes `new Date(iso).getTime()` NaN — so without a guard every branch's
// `s < N` comparison is false and the function falls through to the days branch,
// rendering the literal "NaNd". updated_at is a DB-set column so this is latent,
// but it's the surviving copy of the present-but-bad-date class already hardened
// in commentbank (relTimeAgo → "recently"), the interpreter trash view
// (relativeTimeFrom → "unknown"), and the QSS library/write relTime
// (→ "just now"). Match the commentbank precedent: a corrupt date → "recently".

export function relAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return 'recently';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
