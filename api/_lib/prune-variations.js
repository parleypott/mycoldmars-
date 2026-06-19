// Loved-aware variation pruning for QSS saved stories.
//
// A story block can accumulate many illustration variations as Henry
// re-rolls a scene. To keep the saved blob bounded we prune down to `max`,
// but NEVER drop a variation Henry marked "loved": keep every loved one,
// then top up with the MOST RECENT unloved variations until we reach `max`.
// Oldest unloved are dropped first. The returned array preserves the
// original `variations` order.
//
// Bug history (the reason this is its own tested function): the inline
// version used `unloved.slice(-keepUnlovedCount)`. JS `slice(-0)` returns
// the WHOLE array, not none — so when loved.length >= max, keepUnlovedCount
// was 0 and EVERY unloved variation survived, defeating the cap entirely
// (a story with 12 loved + 8 unloved kept all 20). The explicit
// `keepUnlovedCount > 0 ? ... : []` guard is the fix.
export function pruneVariations(variations, max = 12) {
  if (!Array.isArray(variations)) return [];
  if (variations.length <= max) return variations.slice();
  const loved = variations.filter(v => v?.loved);
  const unloved = variations.filter(v => !v?.loved);
  const keepUnlovedCount = Math.max(0, max - loved.length);
  // Keep the MOST RECENT unloved (last in array); drop the oldest.
  // Guard against slice(-0) returning the whole array when count is 0.
  const keptUnloved = keepUnlovedCount > 0 ? unloved.slice(-keepUnlovedCount) : [];
  const keepSet = new Set([...loved, ...keptUnloved].map(v => v.id));
  // Re-merge against the original array to preserve order.
  return variations.filter(v => keepSet.has(v.id));
}
