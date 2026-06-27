// Server-side keepability scale bridge for the Hunter's Gemini-facing prompts.
//
// The Gemini analysis schema stores `keepability_score` on a 0–1 scale
// (hunter/worker/gemini-client.js: `"keepability_score": 0.0-1.0`), and every
// stored analyses.output_json carries the raw 0–1 value. The Hunter UI displays
// and thresholds keepability on a 0–10 scale (every label reads "/10"), bridging
// the two via hunter/src/keepability.js — the canonical CLIENT copy.
//
// This is the SERVER copy of that same bridge. It exists because the narrative-
// insights prompt in api/gemini.js (handleNarrativeInsights) frames each scene's
// keepability as `${avgKeep.toFixed(1)}/10` — asserting the 0–10 scale — but the
// client sent `scene.avgKeep` RAW on the 0–1 scale. So the narrative AI was told
// the editor's strongest scenes scored "0.7/10" (bottom-tier) when they were
// really 7/10. Same scale class hunter/src/keepability.js fixed for the UI; this
// was the surviving un-normalized copy on the AI-narrative path.
//
// Auto-detecting (mirrors hunter/src/keepability.js exactly): a value <= 1 is the
// 0–1 scale → ×10; a value > 1 is already on the 0–10 scale (a legacy row) →
// returned unchanged. So it fixes 0–1 data AND is a no-op for any legacy 0–10
// row. Rounds the ×10 result to one decimal so float artifacts can't miss a band
// boundary. Returns null for non-numbers so callers can render a "?" fallback.
export function normalizeKeepability(score) {
  if (typeof score !== 'number' || !isFinite(score)) return null;
  if (score <= 1) return Math.round(score * 100) / 10;
  return score;
}
