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

// Clamp a RESTORED PIP position so the player stays reachable on the CURRENT
// viewport. The deck saves {left, bottom} from wherever it was dropped, but a
// position saved on a wide desk monitor (e.g. left:1800) reloads OFF-SCREEN on a
// laptop (innerWidth:1280) — stranding the PIP where it can't be grabbed to drag
// back. The live drag handler clamps as you move (Math.min(innerWidth - width, …)),
// but the restore-on-mount path applied the saved offsets raw. This re-applies the
// same envelope on restore.
//
// Each axis is clamped into [0, viewport − frame]. The far-edge cap is applied
// ONLY when both the viewport and the frame size are known positive numbers — if
// either is missing/zero (frame not yet laid out at mount), that axis keeps its
// saved value (floored at 0), so a position that was already on-screen is never
// disturbed. A non-finite saved value degrades to 0 (the near edge).
export function clampDeckPosition(saved, viewport, frame) {
  const vw = positive(viewport && viewport.width);
  const vh = positive(viewport && viewport.height);
  const fw = positive(frame && frame.width);
  const fh = positive(frame && frame.height);
  return {
    left: clampAxis(saved && saved.left, vw && fw ? Math.max(0, vw - fw) : null),
    bottom: clampAxis(saved && saved.bottom, vh && fh ? Math.max(0, vh - fh) : null),
  };
}

function positive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Floor at 0 always; cap at `max` only when max is a known number (viewport and
// frame both measured). `null` max means "size unknown" → leave the far edge free.
function clampAxis(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const floored = Math.max(0, n);
  return max == null ? floored : Math.min(floored, max);
}
