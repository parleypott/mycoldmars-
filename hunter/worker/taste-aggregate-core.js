/**
 * Pure aggregation core for the Hunter editorial taste profile (extracted verbatim
 * from build-taste-profile.mjs so it is unit-testable — that module builds a Supabase
 * client + GoogleGenAI client at load time and reads .env with top-level await, so it
 * cannot be imported in a test).
 *
 * aggregateDecisions(decisions) turns the editorial_decisions rows (one per clip:
 * { kept, keepability_score, shot_type, emotional_register, editorial_function,
 *   usage_count, ... }) into the calibration stats that brief Gemini on THIS editor's
 * taste (Phase 3) — keep rates per shot/emotion/function, keepability calibration,
 * and the score/decision mismatches.
 *
 * SCALE CONTRACT: keepability_score is 0.0–1.0 here, matching the SOURCE OF TRUTH that
 * generates it — the Gemini analysis schema in hunter/worker/gemini-client.js:195
 * (`"keepability_score": 0.0-1.0`). The sibling worker consumers agree (cross-tier-
 * matching averages with .toFixed(3); build-corpus-context prints the raw value). The
 * 0.7 / 0.4 mismatch thresholds below are 0–1 thresholds and are correct against that
 * schema. (See the NOTE in BACKLOG.md: the Hunter FRONTEND — hunter/src/main.js — has
 * drifted to a 0–10 interpretation at several display sites; that's an attended fix,
 * not touched here. This core is the schema-consistent side.)
 */

export function aggregateDecisions(decisions) {
  console.log('\n[taste] Phase 2: Aggregating stats...');

  // Shot type keep rates
  const shotStats = {};
  for (const d of decisions) {
    if (!d.shot_type) continue;
    if (!shotStats[d.shot_type]) shotStats[d.shot_type] = { kept: 0, total: 0 };
    shotStats[d.shot_type].total++;
    if (d.kept) shotStats[d.shot_type].kept++;
  }
  for (const key of Object.keys(shotStats)) {
    shotStats[key].rate = shotStats[key].total > 0 ? shotStats[key].kept / shotStats[key].total : 0;
  }

  // Keepability calibration
  const keptScores = decisions.filter(d => d.kept && d.keepability_score != null).map(d => d.keepability_score);
  const discardedScores = decisions.filter(d => !d.kept && d.keepability_score != null).map(d => d.keepability_score);
  const avgKeptScore = keptScores.length > 0 ? keptScores.reduce((a, b) => a + b, 0) / keptScores.length : null;
  const avgDiscardedScore = discardedScores.length > 0 ? discardedScores.reduce((a, b) => a + b, 0) / discardedScores.length : null;

  // Simple correlation: what % of high-score clips were actually kept?
  const highScoreClips = decisions.filter(d => d.keepability_score != null && d.keepability_score > 0.7);
  const highScoreKeptRate = highScoreClips.length > 0 ? highScoreClips.filter(d => d.kept).length / highScoreClips.length : null;

  const keepabilityCalibration = {
    avg_kept_score: avgKeptScore,
    avg_discarded_score: avgDiscardedScore,
    correlation: highScoreKeptRate,
    kept_sample_size: keptScores.length,
    discarded_sample_size: discardedScores.length,
  };

  // Mismatches: high score but discarded, or low score but kept
  const mismatches = [];
  for (const d of decisions) {
    if (d.keepability_score == null) continue;
    if (d.keepability_score > 0.7 && !d.kept) {
      mismatches.push({ type: 'high_score_discarded', decision: d });
    } else if (d.keepability_score < 0.4 && d.kept) {
      mismatches.push({ type: 'low_score_kept', decision: d });
    }
  }

  // Emotional register keep rates
  const emotionStats = {};
  for (const d of decisions) {
    if (!d.emotional_register) continue;
    if (!emotionStats[d.emotional_register]) emotionStats[d.emotional_register] = { kept: 0, total: 0 };
    emotionStats[d.emotional_register].total++;
    if (d.kept) emotionStats[d.emotional_register].kept++;
  }
  for (const key of Object.keys(emotionStats)) {
    emotionStats[key].rate = emotionStats[key].total > 0 ? emotionStats[key].kept / emotionStats[key].total : 0;
  }

  // Editorial function keep rates
  const functionStats = {};
  for (const d of decisions) {
    if (!d.editorial_function) continue;
    if (!functionStats[d.editorial_function]) functionStats[d.editorial_function] = { kept: 0, total: 0 };
    functionStats[d.editorial_function].total++;
    if (d.kept) functionStats[d.editorial_function].kept++;
  }
  for (const key of Object.keys(functionStats)) {
    functionStats[key].rate = functionStats[key].total > 0 ? functionStats[key].kept / functionStats[key].total : 0;
  }

  // Usage patterns for kept clips
  const keptUsage = decisions.filter(d => d.kept && d.usage_count > 0).map(d => d.usage_count);
  const avgUsageCount = keptUsage.length > 0 ? keptUsage.reduce((a, b) => a + b, 0) / keptUsage.length : 0;

  const overallKeptRate = decisions.length > 0 ? decisions.filter(d => d.kept).length / decisions.length : 0;

  console.log(`[taste] Shot types: ${Object.keys(shotStats).length}, Emotions: ${Object.keys(emotionStats).length}`);
  console.log(`[taste] Mismatches: ${mismatches.length}, Overall keep rate: ${(overallKeptRate * 100).toFixed(1)}%`);

  return {
    shotStats,
    keepabilityCalibration,
    mismatches,
    emotionStats,
    functionStats,
    avgUsageCount,
    overallKeptRate,
  };
}
