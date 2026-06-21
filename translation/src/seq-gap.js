// Parse the Sacred Selects sequence "gap" field (frames between soundbites) from
// its raw input value. The #seq-gap input is `type="number" min="0" max="240"`, so
// a gap of 0 (soundbites butted directly together — a legitimate tight-assembly
// choice) is a valid, reachable value.
//
// The old call sites used `parseInt(value) || 12`, the truthy-zero trap: a user
// who set the gap to 0 silently got the 12-frame default in the exported sequence
// (`0 || 12 === 12`). This preserves a real 0 and only falls back to the default
// when the field is empty/unparseable (NaN) — exactly matching the input's
// declared `value="12"`. Every other value (including the pre-existing negative
// passthrough) is byte-identical to the old behavior, so the only change is the
// 0 case the bug ate.
export function parseGapFrames(rawValue, fallback = 12) {
  const n = parseInt(rawValue, 10);
  return Number.isFinite(n) ? n : fallback;
}
