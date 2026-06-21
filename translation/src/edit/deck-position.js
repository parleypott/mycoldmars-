// Pure helper for persisting the floating video PIP's dropped position.
//
// The media deck saves the PIP's `left`/`bottom` CSS offsets to localStorage
// when you drop it, and restores them on the next mount. The restore path
// already accepts 0 (`typeof saved.left === 'number'`), so a PIP dragged flush
// to the screen's left or bottom EDGE (left:0 / bottom:0) is meant to reload in
// the same spot.
//
// The save path used `parseFloat(styleVal) || fallback` — a truthy-zero trap:
// `0 || 86` === 86, so a coordinate of exactly 0 was persisted as the default
// (16 for left, 86 for bottom) and the window visibly jumped inward on reload.
// Only an UNSET/empty/`auto` style (parseFloat → NaN) should fall back; a real
// 0 must round-trip verbatim. parseDeckCoord encodes that: parse first, fall
// back ONLY when the result isn't a finite number.
export function parseDeckCoord(styleVal, fallback) {
  const n = parseFloat(styleVal);
  return Number.isFinite(n) ? n : fallback;
}
