#!/usr/bin/env node

/**
 * Script Training Engine for Hunter Script Copilot.
 *
 * Analyzes N Google Docs scripts (up to 100+) to learn:
 * - Color language (what each highlight color means, including inconsistencies)
 * - Structural habits (act structure, beat density, heading patterns)
 * - Voice/visual conventions (relationship, style, detail level)
 * - Sloppiness patterns (where formatting rules break down, how to infer intent)
 *
 * Produces structured rules with confidence scores + a context string for LLM injection.
 * Handles large-scale training by batching scripts into Gemini-sized chunks,
 * then running a synthesis pass across batch results.
 *
 * Run standalone: node hunter/worker/build-script-context.mjs <project-id>
 * Or import: import { runScriptTraining } from './build-script-context.mjs';
 *
 * This is the script equivalent of build-corpus-context.mjs for footage.
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
const MODEL = 'gemini-2.5-flash';

// ~600K tokens per Gemini call is safe. At ~4 chars/token and ~2K chars per script summary,
// we can fit ~75 script summaries per batch. Use 50 for safety margin.
const SCRIPTS_PER_BATCH = 50;

/**
 * Build a compact summary of a script snapshot for training.
 * Includes color profile, structure overview, and a diverse sample of beats.
 */
function buildScriptSummary(snap, index) {
  const doc = snap.parsed_doc;
  const elements = doc.elements || [];
  const beats = elements.filter(e => e.type === 'beat');
  const headings = elements.filter(e => e.type === 'heading' && !e.isTab).map(e => e.text);

  // Color summary
  const colorSummary = Object.entries(snap.color_profile || {})
    .sort((a, b) => b[1].count - a[1].count)
    .map(([color, data]) => {
      const samples = (data.sampleTexts || []).slice(0, 3).map(s => `"${s.slice(0, 50)}"`).join(', ');
      return `  ${color}: ${data.count}x — ${samples}`;
    })
    .join('\n');

  // Sample beats — take from beginning, middle, and end for diversity
  const sampleIndices = [];
  if (beats.length <= 20) {
    for (let i = 0; i < beats.length; i++) sampleIndices.push(i);
  } else {
    // 7 from start, 6 from middle, 7 from end
    for (let i = 0; i < 7; i++) sampleIndices.push(i);
    const mid = Math.floor(beats.length / 2);
    for (let i = mid - 3; i < mid + 3; i++) sampleIndices.push(i);
    for (let i = beats.length - 7; i < beats.length; i++) sampleIndices.push(i);
  }

  const sampleBeats = [...new Set(sampleIndices)].map(i => {
    const beat = beats[i];
    if (!beat) return '';

    const fmtRuns = (runs) => (runs || []).map(r => {
      const s = r.style || {};
      const a = [];
      if (s.highlight) a.push(s.highlight);
      if (s.bold) a.push('BOLD');
      if (s.italic) a.push('ITALIC');
      if (s.strikethrough) a.push('STRUCK');
      const txt = (r.text || '').trim().slice(0, 80);
      return a.length ? `[${a.join('/')}: ${txt}]` : txt;
    }).filter(Boolean).join(' ');

    const voice = fmtRuns(beat.voice?.runs) || beat.voice?.text?.slice(0, 100) || '(empty)';
    const visual = fmtRuns(beat.visual?.runs) || beat.visual?.text?.slice(0, 100) || '(empty)';
    return `  Beat ${i + 1}/${beats.length}:\n    VOICE: ${voice}\n    VISUAL: ${visual}`;
  }).filter(Boolean).join('\n');

  return `=== SCRIPT ${index + 1}: "${doc.title}" ===
Stats: ${beats.length} beats, ${doc.stats?.wordCount || '?'} words, ${doc.stats?.coloredRunCount || 0} colored runs
Headings: ${headings.join(' → ') || '(none)'}
Colors:
${colorSummary || '  (no colors)'}
Sample beats:
${sampleBeats}`;
}

/**
 * Run a single batch analysis on a subset of scripts.
 */
async function analyzeBatch(snapshots, batchIndex, totalBatches) {
  const corpus = snapshots.map((snap, i) => buildScriptSummary(snap, i)).join('\n\n' + '='.repeat(50) + '\n\n');

  console.log(`[training] batch ${batchIndex + 1}/${totalBatches}: ${snapshots.length} scripts, ${corpus.length} chars`);

  const result = await genai.models.generateContent({
    model: MODEL,
    contents: [{
      role: 'user',
      parts: [{
        text: `You are analyzing ${snapshots.length} documentary scripts by the SAME FILMMAKER. All formatting has been preserved — highlight colors, bold/italic, table structure (voice column vs visual direction column).

Your job: learn this filmmaker's script conventions. Pay special attention to:
1. INCONSISTENCIES and SLOPPINESS — where do formatting rules break down? Some scripts might use colors loosely or skip conventions. Note these patterns without judgment.
2. INFERRED INTENT — when formatting is absent or messy, what was likely intended based on the surrounding context?

${corpus}

Analyze these scripts and return a JSON object:

{
  "color_rules": [
    {
      "color": "#HEX",
      "meaning": "what this color means",
      "confidence": 0.0-1.0,
      "consistency": "how consistently this color is used (always/usually/sometimes/rarely)",
      "exceptions": "notable exceptions or alternative uses observed",
      "scripts_observed_in": number
    }
  ],
  "structural_patterns": {
    "typical_act_count": number or null,
    "avg_beats_per_section": number,
    "heading_conventions": "how headings are formatted and used",
    "beat_structure": "typical voice/visual relationship pattern",
    "pacing_notes": "observations about pacing (dense sections, sparse sections, rhythm)"
  },
  "sloppiness_patterns": [
    {
      "pattern": "description of where formatting rules break down",
      "frequency": "how often this happens (rare/occasional/common)",
      "workaround": "how to interpret the content despite the inconsistency"
    }
  ],
  "voice_style": {
    "tone": "primary tone (conversational/journalistic/lyrical/etc)",
    "person": "first/second/third person preference",
    "typical_beat_length": "short phrase / sentence / paragraph",
    "distinctive_habits": "recurring phrasing patterns or stylistic tics"
  },
  "visual_direction_style": {
    "detail_level": "minimal/moderate/detailed",
    "common_shot_types": ["list of frequently used visual directions"],
    "animation_frequency": "how often animation is called for",
    "archive_frequency": "how often archive footage is referenced"
  },
  "cross_script_observations": "2-3 sentences about patterns that emerge ACROSS scripts (not per-script)"
}

Return ONLY valid JSON.`
      }],
    }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
  });

  try {
    return JSON.parse(result.text);
  } catch {
    console.error(`[training] batch ${batchIndex + 1} JSON parse failed, using raw text`);
    return { raw_text: result.text };
  }
}

/**
 * Synthesize multiple batch analyses into a final unified training result.
 */
async function synthesizeBatches(batchResults, totalScripts) {
  if (batchResults.length === 1) return batchResults[0];

  console.log(`[training] synthesizing ${batchResults.length} batch results...`);

  const batchSummaries = batchResults.map((r, i) =>
    `--- BATCH ${i + 1} ANALYSIS ---\n${JSON.stringify(r, null, 2)}`
  ).join('\n\n');

  const result = await genai.models.generateContent({
    model: MODEL,
    contents: [{
      role: 'user',
      parts: [{
        text: `You analyzed ${totalScripts} documentary scripts across ${batchResults.length} batches. Here are the per-batch analyses:

${batchSummaries}

Now SYNTHESIZE these into a single unified analysis. Where batches agree, strengthen confidence. Where they disagree, note the inconsistency. Merge color rules, structural patterns, and sloppiness patterns.

Return a single JSON object with the same structure as the batch analyses, plus two additional fields:

{
  "color_rules": [...merged, with updated confidence and scripts_observed_in...],
  "structural_patterns": {...merged...},
  "sloppiness_patterns": [...merged and deduplicated...],
  "voice_style": {...merged...},
  "visual_direction_style": {...merged...},
  "cross_script_observations": "Updated with full-corpus perspective",
  "script_context_string": "3-4 dense paragraphs briefing a new editor on this filmmaker's script language. Be specific — cite examples from the analysis. Cover color conventions (including inconsistencies), structural habits, voice/visual relationship, and editorial personality. Write as if the reader will use this to interpret any new script by this filmmaker.",
  "style_signature": "One bold sentence capturing this filmmaker's script personality"
}

Return ONLY valid JSON.`
      }],
    }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 12000 },
  });

  try {
    return JSON.parse(result.text);
  } catch {
    console.error('[training] synthesis JSON parse failed');
    return {
      ...batchResults[0],
      script_context_string: result.text,
      synthesis_failed: true,
    };
  }
}

/**
 * Main training function. Exported for use by bulk-ingest-scripts.mjs.
 */
export async function runScriptTraining(projectId) {
  console.log(`\n[training] building script context for project ${projectId}\n`);

  // 1. Fetch all script assets for this project
  const { data: assets } = await supabase.from('media_assets')
    .select('id, source_ref, metadata')
    .eq('project_id', projectId)
    .eq('source_kind', 'google_docs');

  if (!assets?.length) {
    console.error('[training] no Google Docs assets found. Ingest scripts first.');
    return null;
  }

  console.log(`[training] found ${assets.length} script assets`);

  // 2. Fetch latest snapshot for each asset
  const snapshots = [];
  for (const asset of assets) {
    const { data: snap } = await supabase.from('script_snapshots')
      .select('*')
      .eq('media_asset_id', asset.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .single();

    if (snap) {
      snapshots.push({ ...snap, source_ref: asset.source_ref });
    }
  }

  if (!snapshots.length) {
    console.error('[training] no script snapshots found. Run ingestion first.');
    return null;
  }

  console.log(`[training] loaded ${snapshots.length} snapshots`);

  // 3. Batch and analyze
  const batches = [];
  for (let i = 0; i < snapshots.length; i += SCRIPTS_PER_BATCH) {
    batches.push(snapshots.slice(i, i + SCRIPTS_PER_BATCH));
  }

  console.log(`[training] processing in ${batches.length} batch(es)...`);

  const batchResults = [];
  for (let i = 0; i < batches.length; i++) {
    const result = await analyzeBatch(batches[i], i, batches.length);
    batchResults.push(result);
  }

  // 4. Synthesize if multiple batches
  let analysis;
  if (batches.length === 1) {
    // Single batch — need to generate the context string
    const singleResult = batchResults[0];
    console.log('[training] generating context string from single-batch analysis...');

    const ctxResult = await genai.models.generateContent({
      model: MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `Based on this analysis of ${snapshots.length} scripts by one filmmaker:

${JSON.stringify(singleResult, null, 2)}

Write two things:
1. "script_context_string": 3-4 dense paragraphs briefing a new editor on this filmmaker's script language. Cover color conventions (including inconsistencies), structural habits, voice/visual relationship, and editorial personality. Be specific — cite examples. Write as if the reader will use this to correctly interpret any new script.
2. "style_signature": One bold sentence capturing this filmmaker's script personality.

Return ONLY valid JSON: { "script_context_string": "...", "style_signature": "..." }`
        }],
      }],
      config: { responseMimeType: 'application/json', maxOutputTokens: 4000 },
    });

    try {
      const ctx = JSON.parse(ctxResult.text);
      analysis = { ...singleResult, ...ctx };
    } catch {
      analysis = { ...singleResult, script_context_string: ctxResult.text };
    }
  } else {
    analysis = await synthesizeBatches(batchResults, snapshots.length);
  }

  console.log(`[training] analysis complete`);
  console.log(`[training] style: ${analysis.style_signature || 'N/A'}`);
  console.log(`[training] color rules: ${(analysis.color_rules || []).length}`);
  console.log(`[training] sloppiness patterns: ${(analysis.sloppiness_patterns || []).length}`);

  // 5. Build color_conventions map (backwards-compatible with existing code)
  const colorConventions = {};
  for (const rule of (analysis.color_rules || [])) {
    if (rule.color && rule.meaning) {
      colorConventions[rule.color] = rule.meaning;
    }
  }

  // 6. Store in project metadata
  const { data: project } = await supabase.from('hunter_projects')
    .select('metadata').eq('id', projectId).single();

  const updatedMetadata = {
    ...(project?.metadata || {}),
    script_context: analysis.script_context_string,
    script_color_conventions: colorConventions,
    script_color_rules: analysis.color_rules,
    script_structural_patterns: analysis.structural_patterns,
    script_sloppiness_patterns: analysis.sloppiness_patterns,
    script_voice_style: analysis.voice_style,
    script_visual_direction_style: analysis.visual_direction_style,
    script_style_signature: analysis.style_signature,
    script_training_stats: {
      scripts_analyzed: snapshots.length,
      batches: batches.length,
      trained_at: new Date().toISOString(),
    },
    script_context_updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await supabase.from('hunter_projects')
    .update({ metadata: updatedMetadata })
    .eq('id', projectId);

  if (updateError) {
    console.error('[training] failed to update project metadata:', updateError.message);
  } else {
    console.log('[training] saved to project metadata');
  }

  // 7. Store per-snapshot training pass
  for (const snap of snapshots) {
    await supabase.from('script_passes').insert({
      snapshot_id: snap.id,
      pass_type: 'script_training',
      output_json: analysis,
      output_text: analysis.script_context_string,
      model: MODEL,
    });
  }

  // 8. Print summary
  console.log('\n[training] DONE');
  console.log(`  Scripts: ${snapshots.length}`);
  console.log(`  Color rules: ${(analysis.color_rules || []).length}`);
  console.log(`  Sloppiness patterns: ${(analysis.sloppiness_patterns || []).length}`);
  console.log(`  Context: ${(analysis.script_context_string || '').length} chars`);

  if (analysis.color_rules?.length) {
    console.log('\n  Color conventions:');
    for (const rule of analysis.color_rules) {
      console.log(`    ${rule.color}: ${rule.meaning} (${Math.round(rule.confidence * 100)}% confidence, ${rule.consistency})`);
    }
  }

  if (analysis.sloppiness_patterns?.length) {
    console.log('\n  Sloppiness patterns:');
    for (const p of analysis.sloppiness_patterns) {
      console.log(`    [${p.frequency}] ${p.pattern}`);
      console.log(`      → ${p.workaround}`);
    }
  }

  return analysis;
}

// CLI mode
if (process.argv[1]?.includes('build-script-context')) {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Usage: node build-script-context.mjs <project-id>');
    process.exit(1);
  }
  runScriptTraining(projectId).catch(err => {
    console.error('[training] fatal:', err);
    process.exit(1);
  });
}
