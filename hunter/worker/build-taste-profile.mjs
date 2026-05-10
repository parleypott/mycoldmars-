#!/usr/bin/env node

/**
 * Editorial Taste Training Engine for Hunter.
 *
 * Learns from editorial decisions across multiple projects:
 * - Which shot types, emotional registers, and editorial functions get kept
 * - How well Gemini's keepability scores correlate with actual editorial choices
 * - What patterns the editor consistently keeps or discards
 *
 * Produces a taste_profile that calibrates future keepability scoring.
 * Follows the same batching + synthesis pattern as build-script-context.mjs.
 *
 * Run standalone: node hunter/worker/build-taste-profile.mjs
 * Or import: import { runTasteTraining } from './build-taste-profile.mjs';
 */

import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Load env
const envPath = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envPath)) {
  const { readFileSync } = await import('node:fs');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
);

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const PRO_MODEL = 'gemini-2.5-pro';
const FLASH_MODEL = 'gemini-2.5-flash';

// ── Phase 1: Gather editorial decisions ──

async function gatherDecisions() {
  console.log('\n[taste] Phase 1: Gathering editorial decisions...');

  // Check for projects with raw+selects but no persisted decisions
  const { data: projects } = await supabase.from('hunter_projects').select('id, name');

  for (const project of projects || []) {
    const { count: decisionCount } = await supabase.from('editorial_decisions')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project.id);

    if (decisionCount > 0) continue;

    // Check if this project has raw + selects tiers
    const { data: assets } = await supabase.from('media_assets')
      .select('tier')
      .eq('project_id', project.id)
      .in('tier', ['raw', 'selects']);

    const tiers = new Set((assets || []).map(a => a.tier));
    if (tiers.has('raw') && tiers.has('selects')) {
      console.log(`[taste] Project "${project.name}" has raw+selects but no decisions — computing...`);
      const { computeAndPersistDecisions } = await import('./cross-tier-matching.mjs');
      await computeAndPersistDecisions(project.id);
    }
  }

  // Now fetch all decisions
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from('editorial_decisions')
      .select('*')
      .order('created_at', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`Fetch error: ${error.message}`);
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  const projectIds = [...new Set(all.map(d => d.project_id))];
  console.log(`[taste] Found ${all.length} decisions across ${projectIds.length} projects`);
  return { decisions: all, projectIds };
}

// ── Phase 2: Aggregate (pure computation) ──

function aggregateDecisions(decisions) {
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

// ── Phase 3: Gemini synthesis ──

async function synthesizeTaste(aggregated, decisions, projectIds) {
  console.log('\n[taste] Phase 3: Gemini synthesis...');

  // Build mismatch examples with context
  const mismatchExamples = aggregated.mismatches.slice(0, 30).map(m => {
    const d = m.decision;
    return `[${m.type}] "${d.source_clip_name}" — score: ${d.keepability_score}, kept: ${d.kept}
  shot: ${d.shot_type}, emotion: ${d.emotional_register}, function: ${d.editorial_function}
  reason: ${d.keepability_reason || '(none)'}`;
  }).join('\n\n');

  // Format shot stats
  const shotSummary = Object.entries(aggregated.shotStats)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([type, s]) => `  ${type}: ${s.kept}/${s.total} kept (${(s.rate * 100).toFixed(0)}%)`)
    .join('\n');

  // Format emotion stats
  const emotionSummary = Object.entries(aggregated.emotionStats)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([reg, s]) => `  ${reg}: ${s.kept}/${s.total} kept (${(s.rate * 100).toFixed(0)}%)`)
    .join('\n');

  // Format function stats
  const functionSummary = Object.entries(aggregated.functionStats)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([fn, s]) => `  ${fn}: ${s.kept}/${s.total} kept (${(s.rate * 100).toFixed(0)}%)`)
    .join('\n');

  const cal = aggregated.keepabilityCalibration;

  const prompt = `You are analyzing the editorial decisions of a documentary filmmaker across ${projectIds.length} project(s) and ${decisions.length} clips. Your job: extract rules specific enough to calibrate future keepability scoring for THIS editor's taste.

=== OVERALL STATS ===
Keep rate: ${(aggregated.overallKeptRate * 100).toFixed(1)}%
Avg usage count for kept clips: ${aggregated.avgUsageCount.toFixed(1)}

=== KEEPABILITY SCORE CALIBRATION ===
Avg keepability score for KEPT clips: ${cal.avg_kept_score?.toFixed(3) ?? 'N/A'}
Avg keepability score for DISCARDED clips: ${cal.avg_discarded_score?.toFixed(3) ?? 'N/A'}
High-score (>0.7) clips that were actually kept: ${cal.correlation != null ? (cal.correlation * 100).toFixed(0) + '%' : 'N/A'}
Sample size: ${cal.kept_sample_size} kept, ${cal.discarded_sample_size} discarded

=== SHOT TYPE PREFERENCES ===
${shotSummary || '(no data)'}

=== EMOTIONAL REGISTER PREFERENCES ===
${emotionSummary || '(no data)'}

=== EDITORIAL FUNCTION PREFERENCES ===
${functionSummary || '(no data)'}

=== MISMATCHES (where AI score disagreed with editorial choice) ===
${mismatchExamples || '(none)'}

Return a JSON object:

{
  "editorial_rules": [
    { "rule": "description of a specific editorial preference", "confidence": 0.0-1.0, "evidence_count": number }
  ],
  "negative_patterns": [
    { "pattern": "what this editor consistently discards", "keep_rate": 0.0-1.0, "sample_count": number }
  ],
  "mismatch_insights": [
    { "type": "high_score_discarded|low_score_kept", "description": "what the AI scoring missed about this editor's taste", "count": number }
  ],
  "taste_context": "3-4 DENSE paragraphs briefing a future AI on this editor's footage taste. Cover: what shot types survive, what emotional registers this editor is drawn to, where the AI's generic keepability scores fail to predict this editor's choices, and specific rules for calibrating future scores. Be specific — cite the numbers. Write as if the reader will use this to correctly score any new footage for this filmmaker.",
  "taste_signature": "One bold sentence capturing this editor's footage taste personality"
}

Return ONLY valid JSON.`;

  // Try Pro first, fallback to Flash
  let model = PRO_MODEL;
  let result;
  try {
    result = await genai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json', maxOutputTokens: 10000 },
    });
  } catch (err) {
    console.log(`[taste] Pro failed (${err.message?.slice(0, 60)}), falling back to Flash...`);
    model = FLASH_MODEL;
    result = await genai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json', maxOutputTokens: 10000 },
    });
  }

  let analysis;
  try {
    analysis = JSON.parse(result.text);
  } catch {
    analysis = { taste_context: result.text, editorial_rules: [], negative_patterns: [], mismatch_insights: [] };
  }

  console.log(`[taste] Synthesis complete (${model}): ${analysis.editorial_rules?.length || 0} rules, ${analysis.negative_patterns?.length || 0} negative patterns`);
  return { analysis, model };
}

// ── Phase 4: Store taste profile ──

async function storeTasteProfile(aggregated, analysis, model, projectIds, clipCount) {
  console.log('\n[taste] Phase 4: Storing taste profile...');

  // Build shot_preferences from aggregated stats
  const shotPreferences = {};
  for (const [type, stats] of Object.entries(aggregated.shotStats)) {
    shotPreferences[type] = stats.rate;
  }

  const row = {
    project_count: projectIds.length,
    clip_count: clipCount,
    project_ids: projectIds,
    shot_preferences: shotPreferences,
    keepability_calibration: aggregated.keepabilityCalibration,
    editorial_rules: analysis.editorial_rules || [],
    negative_patterns: analysis.negative_patterns || [],
    mismatch_insights: analysis.mismatch_insights || [],
    taste_context: analysis.taste_context || '',
    taste_signature: analysis.taste_signature || '',
    model,
  };

  const { error } = await supabase.from('taste_profile').insert(row);
  if (error) throw new Error(`Failed to store taste profile: ${error.message}`);

  console.log(`[taste] Stored taste profile: ${projectIds.length} projects, ${clipCount} clips`);
  return row;
}

// ── Main: run taste training ──

export async function runTasteTraining() {
  console.log('\n════════════════════════════════════');
  console.log('EDITORIAL TASTE TRAINING');
  console.log('════════════════════════════════════');

  const { decisions, projectIds } = await gatherDecisions();

  if (decisions.length === 0) {
    console.log('[taste] No editorial decisions found. Run cross-tier matching on projects with raw+selects tiers first.');
    return null;
  }

  const aggregated = aggregateDecisions(decisions);
  const { analysis, model } = await synthesizeTaste(aggregated, decisions, projectIds);
  const profile = await storeTasteProfile(aggregated, analysis, model, projectIds, decisions.length);

  console.log('\n[taste] Done! Taste signature: "' + (analysis.taste_signature || '') + '"');
  return profile;
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  runTasteTraining()
    .then(profile => {
      if (profile) {
        console.log('\n[taste] Profile stored successfully.');
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('[taste] Fatal:', err);
      process.exit(1);
    });
}
