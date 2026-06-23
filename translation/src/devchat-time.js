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

// Does this fetched message count as a NEW assistant reply (vs the user's
// just-sent message) for the 30s reply poll in devchat.js (pollAssistantReply)?
//
// The poll compares each message's created_at against `sinceIso` (the DB
// created_at of the user message that kicked the reply). The old inline form
// was `m.sender !== 'user' && new Date(m.created_at) > new Date(sinceIso)` —
// unguarded `new Date()` arithmetic of the present-but-bad-date class. A
// present-but-unparseable timestamp makes the comparison NaN, which is always
// false: a corrupt `sinceIso` silently no-ops the WHOLE poll (the reply never
// paints via the poll for the full 30s window), and a corrupt reply
// created_at drops that reply from the poll. Both are DB-set columns so this is
// latent — but it's the surviving copy of the systemic unguarded-Date class
// (obs 3460), sibling to the relAgo "NaNd" fix above.
//
// When either timestamp is unparseable we can't order them, so fall back to
// INCLUDING the non-user message and letting the call site's data-msg-id dedup
// guard decide — an un-painted reply still gets painted, an already-painted one
// is skipped. Strictly safer than hanging. For the common case (both finite)
// this is byte-identical to the old comparison (Date `>` coerces via getTime).
export function isNewAssistantMessage(m, sinceIso) {
  if (!m || m.sender === 'user') return false;
  // A missing timestamp is "can't order" — include it (`new Date(null)` would
  // otherwise coerce to epoch 0 and silently drop the message as ancient).
  if (m.created_at == null || sinceIso == null) return true;
  const t = new Date(m.created_at).getTime();
  const since = new Date(sinceIso).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(since)) return true;
  return t > since;
}
