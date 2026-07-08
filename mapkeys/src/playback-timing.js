// ─── MapKeys playback timing core ───
//
// The pure math behind the animation engine: given a list of keyframes and a
// playhead time in seconds, decide WHICH segment the playhead is in and HOW far
// through it (eased). This is called on every requestAnimationFrame tick and on
// every scrub of the timeline, so a silent regression here = the camera jumps to
// the wrong place mid-flight or the route draws at the wrong progress.
//
// Extracted verbatim from main.js's applyAtTime / totalDuration so it can be
// headless-tested. The DOM/map side (map.jumpTo, setRouteSources, shape interp)
// stays in main.js; this module owns only the segment + easing arithmetic.
//
// Contract for a keyframe list of length N (>= 2):
//   • duration[i] is the time to fly FROM keyframe i TO keyframe i+1.
//   • The last keyframe (N-1) has no outgoing segment, so totalDuration sums
//     duration[0 .. N-2] only.
//   • resolveKeyframeSegment finds the first segment i whose window
//     [acc, acc+dur] contains timeSec; the final segment (N-2) is the catch-all
//     for any timeSec at or past the end (so playback overflow lands cleanly on
//     the last keyframe with localT === 1).
//   • A zero-duration segment yields localT === 1 (jump straight to the next kf),
//     never a divide-by-zero.

export const EASINGS = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) * (1 - t),
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
};

// Total animation length in seconds: sum of every segment's duration. A single
// keyframe (or none) has no segment, so it has zero duration.
export function totalDuration(keyframes) {
  if (!keyframes || keyframes.length < 2) return 0;
  let t = 0;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const dur = keyframes[i].duration;
    // A legacy/corrupt project (restored verbatim in main.js) can carry a
    // keyframe with a missing/null/non-numeric duration. Treat it as 0 so one
    // bad segment can't NaN-poison the whole timeline (time-total chip, play()
    // length, GIF-range math all read this).
    t += Number.isFinite(dur) ? dur : 0;
  }
  return t;
}

// Resolve the playhead time to { index, localT } where index is the segment's
// starting keyframe and localT is the clamped 0..1 position within it.
// Returns null when there is no segment to interpolate (fewer than 2 keyframes).
export function resolveKeyframeSegment(keyframes, timeSec) {
  if (!keyframes || keyframes.length < 2) return null;
  let acc = 0;
  for (let i = 0; i < keyframes.length - 1; i++) {
    // Non-finite duration (legacy/corrupt keyframe) → treat as a 0-length
    // segment: localT jumps to 1 instead of `timeSec <= acc + NaN` (always
    // false) silently skipping every segment and returning NaN localT.
    const rawDur = keyframes[i].duration;
    const dur = Number.isFinite(rawDur) ? rawDur : 0;
    if (timeSec <= acc + dur || i === keyframes.length - 2) {
      const localT = dur > 0 ? Math.max(0, Math.min(1, (timeSec - acc) / dur)) : 1;
      return { index: i, localT };
    }
    acc += dur;
  }
  // Unreachable: the i === length-2 catch-all above always returns. Defensive.
  return { index: keyframes.length - 2, localT: 1 };
}

// Convenience: resolve a segment AND apply its keyframe's easing curve, returning
// the eased 0..1 value plus the segment index. Mirrors how applyAtTime consumes
// the segment (unknown/missing easing names fall back to linear).
export function easedSegmentAt(keyframes, timeSec) {
  const seg = resolveKeyframeSegment(keyframes, timeSec);
  if (!seg) return null;
  const easeName = keyframes[seg.index].easing;
  const ease = EASINGS[easeName] || EASINGS.linear;
  return { index: seg.index, localT: seg.localT, eased: ease(seg.localT) };
}
