// democracy/url-state.js
// Pure parser for the V-Dem sandbox's shareable `?s=` slider state.
//
// FIX (truthy-zero trap): a hand-set slider value of 0 — the most meaningful
// extreme on every axis ("no elections", "no rights") — must round-trip as 0,
// not silently become 50. The old inline readURL did:
//     parseInt(x, 10) || 50
// which is `0 || 50` === 50, so a shared "?s=0,..." link loaded the midpoint
// instead, flipping the regime classification (e.g. 0,0,0,0,0 "Closed Autocracy"
// loaded as 50,50,50,50,50 "Hybrid Regime"). The share button + URL state is the
// whole point of this piece, so the corruption hit exactly the feature it has.
//
// Parse FIRST, then default ONLY when the parse is genuinely NaN
// (missing / non-numeric), then clamp to [0, 100]. Garbage still falls back to
// the 50 midpoint, so the only behavior change is 0 (and other falsy-but-valid
// values can't occur here — the range is integer 0..100).

export function clampAxis(x, fallback = 50) {
  const n = parseInt(x, 10);
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : fallback));
}

// Parse the comma-joined `s` param into an { axis: value } object.
// Returns null unless there are exactly axes.length values — matching the old
// readURL guard, which only applied state when parts.length === 5.
export function parseAxisState(q, axes) {
  if (typeof q !== 'string' || !q) return null;
  if (!Array.isArray(axes) || !axes.length) return null;
  const parts = q.split(',').map((x) => clampAxis(x));
  if (parts.length !== axes.length) return null;
  return Object.fromEntries(axes.map((a, i) => [a, parts[i]]));
}
