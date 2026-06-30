// Beat-interval → BPM, octave-folded into a musical range.
//
// Extracted from the AudioEngine kick detector so it can be unit-tested
// WITHOUT pulling in THREE / Web Audio. The inline version used to read:
//
//   let bpm = 60 / median;
//   while (bpm < 70)  bpm *= 2;
//   while (bpm > 180) bpm /= 2;
//
// which has a hard browser-FREEZE landmine: if `median` is ever 0 (two beats
// in the same instant), bpm becomes Infinity and `while (bpm > 180) bpm /= 2`
// spins forever (Infinity/2 === Infinity). A NaN median makes both loops'
// comparisons false (silently poisons this.bpm); a negative median makes
// `while (bpm < 70) bpm *= 2` spin forever (negative * 2 stays negative).
//
// Today the 0.18s refractory gate keeps real beat intervals ≥ 0.18s, so the
// freeze isn't reachable — but that's an implicit, tweakable invariant. This
// guard makes the function robust regardless of how the detector thresholds
// are tuned, and is byte-identical for every finite, positive median.

/**
 * @param {number} median  median inter-beat interval in seconds
 * @returns {number|null}   folded BPM in [70, 180], or null if median is
 *                          non-finite or ≤ 0 (caller should skip the update)
 */
export function foldBpm(median) {
  if (!Number.isFinite(median) || median <= 0) return null;
  let bpm = 60 / median;
  // bpm is now finite and > 0, so both folds terminate.
  while (bpm < 70)  bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return bpm;
}
