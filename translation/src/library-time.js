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
