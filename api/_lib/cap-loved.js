// Loved-aware cap for an ordered list of items each carrying a `loved` flag.
//
// Used to bound a QSS character card's portrait list (api/qss-cast.js) without
// silently dropping a portrait Henry marked "loved". Keep EVERY loved item,
// then top up with the MOST RECENT unloved items until we reach `max`; the
// oldest unloved are dropped first. The returned array preserves the original
// input order.
//
// Why this is separate from pruneVariations (api/_lib/prune-variations.js):
// pruneVariations re-merges by `id`, which is safe for variation objects (ids
// guaranteed unique) but NOT for raw character portraits, whose ids can be
// missing or duplicated before sanitizeCard assigns them. So this cap keeps
// items by REFERENCE IDENTITY, never by id — a portrait with no id (or a
// colliding id) is still capped correctly.
//
// Bug history: sanitizeCard previously capped portraits with a plain
// `.slice(-MAX_PORTRAITS)` (newest N, by insertion order). A loved portrait
// among the OLDEST in a >N-portrait card was silently dropped on the next
// save — the same loved-item-eaten-by-a-naive-cap class fixed for scene
// variations in prune-variations (commit f60ce17).
export function capLovedAware(items, max) {
  if (!Array.isArray(items)) return [];
  if (!(max > 0)) return [];
  if (items.length <= max) return items.slice();
  const loved = items.filter((it) => it && it.loved);
  const unloved = items.filter((it) => !(it && it.loved));
  const keepUnlovedCount = Math.max(0, max - loved.length);
  // Keep the MOST RECENT unloved (last in array); drop the oldest.
  // Guard against slice(-0) returning the whole array when count is 0.
  const keptUnloved = keepUnlovedCount > 0 ? unloved.slice(-keepUnlovedCount) : [];
  const keep = new Set([...loved, ...keptUnloved]); // reference identity, never id
  return items.filter((it) => keep.has(it));
}
