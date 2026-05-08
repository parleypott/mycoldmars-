#!/usr/bin/env node

/**
 * Script Training Engine for Hunter Script Copilot.
 * Ingests N Google Docs scripts, runs cross-script analysis with Gemini,
 * produces a script_context_string, writes to hunter_projects.metadata.script_context.
 *
 * This is the script equivalent of build-corpus-context.mjs for footage.
 *
 * Run: node hunter/worker/build-script-context.mjs <project-id>
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

const projectId = process.argv[2];
if (!projectId) {
  console.error('Usage: node build-script-context.mjs <project-id>');
  process.exit(1);
}

async function main() {
  console.log(`\n[script-context] building script context for project ${projectId}\n`);

  // 1. Fetch all script snapshots for this project
  const { data: assets } = await supabase.from('media_assets')
    .select('id, source_ref, metadata')
    .eq('project_id', projectId)
    .eq('source_kind', 'google_docs');

  if (!assets?.length) {
    console.error('No Google Docs assets found for this project. Ingest scripts first.');
    process.exit(1);
  }

  console.log(`[script-context] found ${assets.length} script assets`);

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
    } else {
      console.log(`[script-context] ⚠ no snapshot for asset ${asset.id} — skipping`);
    }
  }

  if (!snapshots.length) {
    console.error('No script snapshots found. Run rich ingestion first (need Google OAuth).');
    process.exit(1);
  }

  console.log(`[script-context] loaded ${snapshots.length} script snapshots`);

  // 3. Build the cross-script corpus
  // Each snapshot has parsed_doc with elements, color_profile, stats
  const scriptSummaries = snapshots.map((snap, i) => {
    const doc = snap.parsed_doc;
    const colorSummary = Object.entries(snap.color_profile || {})
      .map(([color, data]) => `  ${color}: ${data.count} uses. Samples: ${data.sampleTexts?.slice(0, 2).map(s => `"${s}"`).join(', ')}`)
      .join('\n');

    // Extract first ~200 elements as representative content
    const elements = doc.elements || [];
    const headings = elements.filter(e => e.type === 'heading').map(e => e.text);
    const beatCount = elements.filter(e => e.type === 'beat').length;

    // Build a representative sample of beats with formatting
    const sampleBeats = elements
      .filter(e => e.type === 'beat')
      .slice(0, 15)
      .map((beat, j) => {
        const voiceRuns = (beat.voice?.runs || []).map(r => {
          const style = r.style || {};
          const annots = [];
          if (style.highlight) annots.push(style.highlight);
          if (style.bold) annots.push('BOLD');
          return annots.length ? `[${annots.join('/')}: ${(r.text || '').trim()}]` : (r.text || '').trim();
        }).join(' ');

        const visualRuns = (beat.visual?.runs || []).map(r => {
          const style = r.style || {};
          const annots = [];
          if (style.highlight) annots.push(style.highlight);
          if (style.bold) annots.push('BOLD');
          return annots.length ? `[${annots.join('/')}: ${(r.text || '').trim()}]` : (r.text || '').trim();
        }).join(' ');

        return `  Beat ${j + 1}:\n    VOICE: ${voiceRuns || '(empty)'}\n    VISUAL: ${visualRuns || '(empty)'}`;
      }).join('\n');

    return `=== SCRIPT ${i + 1}: "${doc.title}" ===
Stats: ${beatCount} beats, ${doc.stats?.wordCount || '?'} words, ${doc.stats?.coloredRunCount || 0} colored runs
Headings: ${headings.join(' → ')}
Color profile:
${colorSummary || '  (no colors)'}

Sample beats (first 15):
${sampleBeats}`;
  });

  const corpus = scriptSummaries.join('\n\n' + '='.repeat(60) + '\n\n');

  console.log(`[script-context] corpus built: ${corpus.length} chars across ${snapshots.length} scripts`);

  // 4. Run cross-script analysis with Gemini
  console.log('[script-context] running cross-script analysis with Gemini...');

  const model = 'gemini-2.5-flash';
  const result = await genai.models.generateContent({
    model,
    contents: [{
      role: 'user',
      parts: [{
        text: `You are analyzing ${snapshots.length} documentary scripts by the SAME FILMMAKER. All formatting has been preserved — you can see highlight colors, bold/italic, and the two-column voice/visual structure.

Your job: learn this filmmaker's script conventions, habits, and style across all their scripts. This understanding will be injected into future analysis prompts so the AI can interpret new scripts correctly.

${corpus}

Produce a comprehensive SCRIPT CONTEXT document (3-4 dense paragraphs) covering:

1. **Color Language**: What does each highlight color mean? Are there consistent conventions (e.g., purple always = animation)? Note any inconsistencies between scripts. Be specific about each color observed.

2. **Structural Habits**: How does this filmmaker structure scripts? Beat density patterns, typical act structure, how headings are used, voice/visual ratio preferences, preferred scene transitions.

3. **Voice/Visual Conventions**: How does the voice column relate to the visual column? Literal illustration? Counterpoint? What's the typical voice style (conversational, journalistic, lyrical, academic)? How detailed are visual directions?

4. **Editorial Patterns**: Recurring motifs, themes, narrative techniques. How does the filmmaker handle data/facts? How do they signal tone shifts? What's their relationship to archive vs. original footage vs. animation?

Write as if you're briefing a new editor who needs to understand this filmmaker's script language. Be specific — cite examples. Don't be generic.

Also return a JSON object with your analysis:

{
  "script_context_string": "The 3-4 paragraph context document described above",
  "color_conventions": {
    "#HEX": "what this color means based on observed usage"
  },
  "structural_patterns": {
    "typical_act_count": number,
    "avg_beats_per_section": number,
    "voice_visual_ratio": "description",
    "heading_style": "how headings are typically formatted"
  },
  "style_signature": "One bold sentence capturing this filmmaker's script personality"
}

Return ONLY valid JSON.`
      }],
    }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
  });

  let analysis;
  try {
    analysis = JSON.parse(result.text);
  } catch {
    console.error('[script-context] failed to parse Gemini response as JSON');
    analysis = { script_context_string: result.text, color_conventions: {}, structural_patterns: {} };
  }

  console.log(`[script-context] analysis complete`);
  console.log(`[script-context] style signature: ${analysis.style_signature || 'N/A'}`);

  // 5. Store script context in project metadata
  const { data: project } = await supabase.from('hunter_projects')
    .select('metadata').eq('id', projectId).single();

  const updatedMetadata = {
    ...(project?.metadata || {}),
    script_context: analysis.script_context_string,
    script_color_conventions: analysis.color_conventions,
    script_structural_patterns: analysis.structural_patterns,
    script_style_signature: analysis.style_signature,
    script_context_updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await supabase.from('hunter_projects')
    .update({ metadata: updatedMetadata })
    .eq('id', projectId);

  if (updateError) {
    console.error('[script-context] failed to update project metadata:', updateError.message);
  } else {
    console.log('[script-context] ✓ script context saved to project metadata');
  }

  // 6. Store individual pass results for each snapshot
  for (const snap of snapshots) {
    const { error: passError } = await supabase.from('script_passes').insert({
      snapshot_id: snap.id,
      pass_type: 'script_training',
      output_json: analysis,
      output_text: analysis.script_context_string,
      model,
    });

    if (passError) {
      console.error(`[script-context] failed to save pass for snapshot ${snap.id}:`, passError.message);
    }
  }

  console.log('\n[script-context] ✓ DONE');
  console.log(`  Scripts analyzed: ${snapshots.length}`);
  console.log(`  Color conventions: ${Object.keys(analysis.color_conventions || {}).length} colors mapped`);
  console.log(`  Context length: ${(analysis.script_context_string || '').length} chars`);
  console.log(`  Style: ${analysis.style_signature || 'N/A'}`);
}

main().catch(err => {
  console.error('[script-context] fatal error:', err);
  process.exit(1);
});
