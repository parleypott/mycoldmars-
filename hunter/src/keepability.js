// Keepability scale bridge.
//
// The Gemini analysis schema stores `keepability_score` on a 0–1 scale
// (hunter/worker/gemini-client.js: `"keepability_score": 0.0-1.0`), and every
// worker consumer + the stored analyses.output_json carry the raw 0–1 value.
// The Hunter UI, however, displays and thresholds keepability on a 0–10 scale —
// every label reads "/10", the browse bands are >=7 / 4–6 / <=3, scene status
// flips at >=7 / >=5, Best Clips filters >=6. So on real (0–1) data those
// thresholds are never met: the "high"/"mid" browse tabs and Best Clips come up
// permanently empty, scene status is always "proposed", and every clip reads
// "0.7/10" / "cut". This bridges the two.
//
// Auto-detecting (mirrors the long-standing inline convention in the scene
// strip): a value <= 1 is the 0–1 scale → ×10; a value > 1 is already on the
// 0–10 scale (a legacy row) → returned unchanged. So it fixes 0–1 data AND is a
// no-op for any legacy 0–10 row — the only behavior change is for scores that
// were already being mis-bucketed.
//
// Rounds the ×10 result to one decimal so float artifacts can't miss a band
// boundary (e.g. a raw `0.3 * 10` of 3.0000000000000004 would slip past "<= 3").
export function normalizeKeepability(score) {
  if (typeof score !== 'number' || !isFinite(score)) return null;
  if (score <= 1) return Math.round(score * 100) / 10;
  return score;
}
