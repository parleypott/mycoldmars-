// Scene-builder status + confidence derivation (extracted from renderScenesTab).
//
// A scene's keepability `k` is normalized onto a 0–10 scale (see keepability.js).
// The SCENE BUILDER tab presents a *confidence* as a 0–100 percentage, so the raw
// 0–10 score has to be scaled by 10 before display. The original inline code scaled
// by 1 (`Math.round(k + Math.random() * 5)`), so a known-good scene (k≈8) rendered
// ~8% while a scene with UNKNOWN keepability fell back to 50–80% — i.e. the more we
// knew about a scene, the LESS confident the UI looked. That inversion is the bug
// this module fixes: `k * 10` puts a known-keep scene in the 50–95% band, at or above
// the unknown-keepability floor.

export function sceneStatus(k) {
  if (k != null && k >= 7) return 'accepted';
  if (k != null && k >= 5) return 'refined';
  return 'proposed';
}

// `rand` is injectable so the ±jitter is deterministic under test; defaults to
// Math.random() in production (a small cosmetic wobble, preserved from the original).
export function sceneConfidence(k, rand = Math.random()) {
  if (k != null) return Math.min(95, Math.round(k * 10 + rand * 5));
  return Math.round(50 + rand * 30);
}
