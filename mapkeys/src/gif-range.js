// Pure index/time math behind the GIF-export range selector (extracted from main.js
// so it's unit-testable; main.js imports mapbox-gl at module load and can't run headless).
//
// The two <select>s carry option values "0".."n-1" (one per keyframe). The original
// inline code resolved the "to" index with `parseInt(toSel.value, 10) || (n - 1)` — the
// truthy-zero trap: selecting the FIRST keyframe (value "0") made `0 || (n-1)` === n-1,
// so "to = K01" silently jumped to the LAST keyframe and exported the wrong range. The
// fix distinguishes an empty/unparseable value (→ fallback) from a real 0.

/** Resolve a <select> string value to a clamped [0, n-1] keyframe index, falling back
 *  ONLY when the value is empty/unparseable (never on a legitimate "0"). */
export function resolveFrameIndex(rawValue, n, fallbackIdx) {
  const v = parseInt(rawValue, 10);
  const idx = Number.isFinite(v) ? v : fallbackIdx;
  return Math.min(n - 1, Math.max(0, idx));
}

/** Given the from/to select values and the per-keyframe durations, return the export
 *  window: sorted indices [a,b] and the cumulative time offsets to each. Pure. */
export function computeGifRange(fromValue, toValue, durations) {
  const n = durations.length;
  if (n === 0) return { tStart: 0, tEnd: 0, fromIdx: 0, toIdx: 0 };
  const fromIdx = resolveFrameIndex(fromValue, n, 0);
  const toIdx = resolveFrameIndex(toValue, n, n - 1);
  const a = Math.min(fromIdx, toIdx);
  const b = Math.max(fromIdx, toIdx);
  let tStart = 0, tEnd = 0;
  for (let i = 0; i < a; i++) tStart += durations[i];
  for (let i = 0; i < b; i++) tEnd += durations[i];
  return { tStart, tEnd, fromIdx: a, toIdx: b };
}
