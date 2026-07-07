// NaN-safe date handling for the transcript library's recency sort.
//
// The "recent" library view sorts transcripts by updated_at via a subtraction
// comparator. A missing / unparseable updated_at makes `new Date(v).getTime()`
// return NaN, and a SINGLE NaN inside a subtraction comparator poisons V8's
// sort: the partitioning breaks, undated rows land in arbitrary positions, and
// a genuinely-recent transcript can get pushed out of the top-25 slice (proven:
// an undated row jumps into the recent list and displaces a real recent one).
// Same NaN-sort-poison class as the commentbank slack_ts fix (496cdf4) and the
// hunter semantic-search fix (2dfe675). The codebase already treats updated_at
// as possibly-absent in sibling render paths (main.js guards it at the
// optimistic-concurrency + realtime sites), so the unguarded sort was the
// outlier.
//
// recencyKey() coerces any bad/missing date to 0 (epoch) — a finite key that
// sorts oldest in a most-recent-first list and, crucially, never produces NaN
// (so two undated rows compare 0-0=0, not NaN-NaN). For a valid date it returns
// the exact same getTime() the old inline comparator used, so byUpdatedDesc is
// byte-identical to the old sort for the all-valid case (the universal one) —
// only a NaN-poisoning row changes behavior.

/** NaN-safe sort key: epoch-ms for a valid date, 0 for missing/unparseable. */
export function recencyKey(v) {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Comparator: newest updated_at first, NaN-poison-proof. */
export function byUpdatedDesc(a, b) {
  return recencyKey(b && b.updated_at) - recencyKey(a && a.updated_at);
}

/**
 * General library column-sort comparator (Name / Status / Edited columns).
 * NaN/missing-safe — the sibling of byUpdatedDesc for the DEFAULT column sort.
 *
 * The pre-fix inline compare used raw `<`/`>` on `a[key]`. For the `updated_at`
 * column (the library default) that compared ISO strings lexicographically,
 * which matches chronological order for valid same-format dates — but a
 * missing/null/undefined updated_at returned 0 against EVERY other value
 * (`undefined < "2026…"` and `undefined > "2026…"` are both false). A
 * comparator that reports "equal" between an undated row and every dated row
 * breaks transitivity, and V8's TimSort then scrambles the whole library order
 * (not just the undated row). Same NaN/0-poison class as byUpdatedDesc — this
 * was simply the second, un-migrated sort path on the same field.
 *
 * Fix: the `updated_at` column now sorts by real epoch-ms via recencyKey (a
 * missing/bad date → 0 → sorts oldest, consistent and never poisoning), so the
 * default library order matches the recent-view sort. String columns coerce a
 * missing field to '' so an absent value compares as empty, not as a wildcard.
 *
 * For the all-valid case this is order-identical to the old inline compare.
 */
export function compareForLibrary(a, b, key, asc) {
  if (key === 'updated_at') {
    const ka = recencyKey(a && a.updated_at), kb = recencyKey(b && b.updated_at);
    return asc ? ka - kb : kb - ka;
  }
  let va = a ? a[key] : undefined, vb = b ? b[key] : undefined;
  if (key === 'name') { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); }
  else { va = va == null ? '' : va; vb = vb == null ? '' : vb; }
  if (va < vb) return asc ? -1 : 1;
  if (va > vb) return asc ? 1 : -1;
  return 0;
}

// ── NaN-safe trash retention + relative-time display ──
//
// Same unguarded-`new Date(x).getTime()` class as the sort above, on the two
// display sites the recent-view fix (4ead52a) logged as the follow-up:
//   • the trash filter dropped a deleted transcript with a bad deleted_at from
//     the recovery UI entirely (NaN < window === false), making it
//     unrecoverable — the most consequential of the two, it's a data-loss path;
//   • relativeTime fell through to toLocaleDateString on a NaN diff and rendered
//     "Invalid Date".
// These guard both. For any VALID date every helper is byte-identical to the old
// inline code (proven by equivalence cases), so only a bad/missing date changes.

const TRASH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parsed epoch-ms for a valid date, or null for missing/unparseable. Treats
 * null/undefined/'' as missing (not the JS `new Date(null)` === epoch quirk), so
 * a row with an absent deleted_at is recognized as "unknown time" and kept.
 */
export function parseDateMs(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Trash retention predicate. A deleted transcript stays in the 30-day trash
 * window iff it was deleted within the window — OR its deleted_at is
 * missing/unparseable, in which case we KEEP it so it stays recoverable.
 * The old inline check `Date.now() - new Date(deletedAt).getTime() < window`
 * returned `NaN < window === false` for a bad date, silently DROPPING the
 * transcript from the recovery UI (unrecoverable). Keeping it is strictly safer
 * — a deleted item should never vanish from the place you go to restore it.
 */
export function isInTrashWindow(deletedAt, now = Date.now(), windowMs = TRASH_WINDOW_MS) {
  const ms = parseDateMs(deletedAt);
  if (ms === null) return true; // unknown deletion time -> keep, stay recoverable
  return now - ms < windowMs;
}

/**
 * Days left before a trashed item is purged (0..windowDays), or null when
 * deleted_at is missing/unparseable (caller renders a dash, not "NaNd left").
 */
export function trashDaysLeft(deletedAt, now = Date.now(), windowDays = 30) {
  const ms = parseDateMs(deletedAt);
  if (ms === null) return null;
  return Math.max(0, windowDays - Math.floor((now - ms) / DAY_MS));
}

// ── 90-day trash ARCHIVE (script library) ──
//
// Johnny's rule: nothing is ever destroyed. A script project that has sat in the trash for 90 days
// is ARCHIVED — it stops appearing in the trash view (server filter in api/script-projects.js
// trashListFilter; these helpers are the offline-cache belt), but the row and its full revision
// history stay in the DB and an admin can still restore it via a direct PATCH (age-blind).
// Distinct from the transcript library's 30-day TRASH_WINDOW_MS purge semantics above — archive
// hides, it never deletes, so the label wording must say "archives", never "left"/"deleted".

export const TRASH_ARCHIVE_DAYS = 90;
const TRASH_ARCHIVE_MS = TRASH_ARCHIVE_DAYS * DAY_MS;

/**
 * Has this trash row aged past the archive window (hidden from the trash view)? A missing or
 * unparseable trash clock is NOT archived — keep it visible and recoverable, the same safety
 * posture as isInTrashWindow (never hide what you can't date). Boundary matches the server's
 * strict `gt` cutoff: exactly-90d is archived, a millisecond younger is shown.
 */
export function isArchivedTrash(trashedAt, now = Date.now(), windowMs = TRASH_ARCHIVE_MS) {
  const ms = parseDateMs(trashedAt);
  if (ms === null) return false; // unknown trash time -> keep visible, stay recoverable
  return now - ms >= windowMs;
}

/**
 * Whole days until a trashed row archives (0..windowDays), or null when the trash clock is
 * missing/unparseable (caller renders "in trash", never "NaNd"). Feeds the "archives in Nd"
 * label — archive is NOT deletion, and the copy must not pretend it is.
 */
export function archiveDaysLeft(trashedAt, now = Date.now(), windowDays = TRASH_ARCHIVE_DAYS) {
  const ms = parseDateMs(trashedAt);
  if (ms === null) return null;
  return Math.max(0, windowDays - Math.floor((now - ms) / DAY_MS));
}

/**
 * Human relative-time label ("just now", "5m ago", "yesterday", "Mar 3").
 * Returns 'unknown' for a missing/unparseable date — the old inline relativeTime
 * fell through to toLocaleDateString on a NaN diff and rendered "Invalid Date".
 * Byte-identical to the old logic for any valid date.
 */
export function relativeTimeFrom(dateStr, now = Date.now()) {
  const then = parseDateMs(dateStr);
  if (then === null) return 'unknown';
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Guarded absolute-time stamp for conflict / recovery UI ──
//
// Same present-but-bad-date class as relativeTimeFrom above, on the ABSOLUTE
// `new Date(x).toLocale*String()` stamps the interpreter renders in its
// conflict/recovery surfaces: the snapshot-restore modal ("Newer local copy
// found"), the remote-change banner ("updated elsewhere at <time>"), the
// lock-conflict modal ("another tab, last seen <time>"), and the unsaved-work
// recovery overlay. Each was truthiness-guarded (`value ? new Date(value)
// .toLocale*() : fallback`) but NOT finite-guarded — and .toLocaleString() /
// .toLocaleTimeString() on an Invalid Date RETURN the literal string
// "Invalid Date" (they never throw), so a present-but-unparseable timestamp
// rendered "Invalid Date" in exactly the moments (a recovery prompt) where a
// confusing stamp matters most. These are DB/local-set timestamps, so latent —
// but it's the established class, in Johnny's most-used tool.
//
// fmtAbsoluteTime preserves the old truthiness branch (falsy value -> fallback,
// matching `value ?`) AND adds the finite guard (truthy-but-unparseable ->
// fallback). For any valid date it is byte-identical to the old inline code,
// so only a corrupt/absent value changes (from "Invalid Date" to the fallback).
// `time` -> toLocaleTimeString (clock only), `date` -> toLocaleDateString
// (calendar only), neither -> toLocaleString (date + time).
export function fmtAbsoluteTime(value, fallback = '', { time = false, date = false } = {}) {
  if (!value) return fallback;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return fallback;
  const d = new Date(value);
  if (date) return d.toLocaleDateString();
  return time ? d.toLocaleTimeString() : d.toLocaleString();
}
