// Pure tiling helper for the gallery/blinds/floating scenes.
//
// All three scene builders need to fill a fixed number of cells from a media
// pool, repeating the pool when it's shorter than the cell count. The old
// inline form — `while (items.length < N) items = items.concat(pool)` — is a
// LANDMINE: an EMPTY pool never grows, so the loop spins forever and HARD-
// FREEZES the browser tab. Today the only thing standing between the user and
// that freeze is getMediaForSpace()'s 12-placeholder fallback; one new empty
// space (or any caller passing []) reintroduces the hang.
//
// tileToCount repeats the pool cyclically to exactly `count` items and CANNOT
// loop forever: an empty/invalid pool degrades to [] (caller shows nothing)
// instead of locking the page. Byte-identical to the old inline form for every
// non-empty pool (index i maps to pool[i % pool.length]).
export function tileToCount(pool, count) {
  if (!Array.isArray(pool) || pool.length === 0 || !(count > 0)) return [];
  const out = [];
  for (let i = 0; i < count; i++) out.push(pool[i % pool.length]);
  return out;
}
