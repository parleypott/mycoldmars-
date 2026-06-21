// Recency key for The Hunter's "Recent analyses" feed.
//
// The feed sorts corpus units descending by their most-recent analysis time:
//   units.filter(u => u.analyses?.length > 0)
//        .sort((a, b) => recencyMs(b) - recencyMs(a))
//        .slice(0, 40)
//
// The inline comparator used to read the timestamp as
//   new Date(b.analyses[0].created_at || 0) - new Date(a.analyses[0].created_at || 0)
// The `|| 0` guards a falsy created_at (null / undefined / '') by falling back
// to the epoch — but a PRESENT-BUT-UNPARSEABLE created_at (a garbage string, a
// malformed timestamp from a partial/legacy row) yields `new Date("garbage")`
// = Invalid Date, so the subtraction is NaN. A SINGLE NaN inside a subtraction
// comparator poisons V8's sort: the partitioning breaks and the ENTIRE feed
// order scrambles — not just the bad row — silently mis-ordering the recent
// feed. Same NaN-sort-poison class as the commentbank slack_ts and interpreter
// recent-view fixes; the codebase's sibling unit sorts already guard with `??`,
// this feed comparator was the inconsistent `|| 0` outlier.
//
// analysisRecencyMs returns a FINITE epoch-ms for the unit's first analysis, or
// 0 (sorts oldest) for any missing / unparseable timestamp, so the comparator
// can never produce NaN. Byte-identical ordering for clean data (every valid
// created_at parses the same), so consolidating is zero-regression — only a
// bad/missing timestamp changes behavior (deterministic oldest instead of poison).
export function analysisRecencyMs(unit) {
  const raw = unit && unit.analyses && unit.analyses[0] ? unit.analyses[0].created_at : null;
  const t = new Date(raw == null ? 0 : raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

// Descending comparator (newest analysis first) built on the NaN-safe key.
export function byAnalysisRecencyDesc(a, b) {
  return analysisRecencyMs(b) - analysisRecencyMs(a);
}
