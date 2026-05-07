#!/usr/bin/env node
/**
 * Standalone four-tier synthesis runner.
 * Gathers data from all tiers and runs the Gemini Pro synthesis.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const l of lines) {
    const m = l.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const PROJECT_ID = process.argv[2] || 'd745ee49-0ac1-47c7-b81e-94082ed25fed';

async function getAnalysesByTier(projectId) {
  const { data: assets } = await supabase.from('media_assets')
    .select('id, tier').eq('project_id', projectId);
  const tiers = {};
  for (const a of assets) tiers[a.tier] = a.id;

  const result = {};
  for (const [tier, assetId] of Object.entries(tiers)) {
    // Count total units
    const { count } = await supabase.from('corpus_units')
      .select('id', { count: 'exact', head: true })
      .eq('media_asset_id', assetId);

    // Get sample analyses (evenly spaced)
    const sampleSize = tier === 'finished' ? 1 : tier === 'google_docs' ? 10 : 15;
    const { data: units } = await supabase.from('corpus_units')
      .select('id, source_clip_name, start_seconds, end_seconds')
      .eq('media_asset_id', assetId)
      .order('start_seconds')
      .limit(sampleSize);

    if (!units?.length) { result[tier] = { total: count, samples: [] }; continue; }

    // Batch fetch analyses
    const ids = units.map(u => u.id);
    const { data: analyses } = await supabase.from('analyses')
      .select('corpus_unit_id, output_text, output_json')
      .in('corpus_unit_id', ids);

    const aMap = {};
    for (const a of analyses || []) aMap[a.corpus_unit_id] = a;

    result[tier] = {
      total: count,
      samples: units.filter(u => aMap[u.id]).map(u => ({
        clip: u.source_clip_name || `${u.start_seconds}-${u.end_seconds}s`,
        text: aMap[u.id].output_text?.slice(0, 500) || '',
        json: aMap[u.id].output_json || null,
      })),
    };
  }
  return result;
}

async function main() {
  console.log('Gathering four-tier data...');
  const tiers = await getAnalysesByTier(PROJECT_ID);

  for (const [t, d] of Object.entries(tiers)) {
    console.log(`  ${t}: ${d.total} units, ${d.samples.length} samples`);
  }

  const prompt = `You are the most perceptive documentary editor alive. You have access to ALL FOUR TIERS of a documentary project about Saudi Arabia (Johnny Harris). Your job: trace the complete editorial journey.

## TIER 1: SCRIPT (${tiers.google_docs?.total || 0} sections — original writing plan)
${(tiers.google_docs?.samples || []).map(s => `[${s.clip}]\n${s.text}`).join('\n\n')}

## TIER 2: RAW FOOTAGE (${tiers.raw?.total || 0} clips — everything the camera captured)
${(tiers.raw?.samples || []).map(s => `[${s.clip}]\n${s.text}`).join('\n\n')}

## TIER 3: SELECTS (${tiers.selects?.total || 0} clips — what the editor chose to use)
${(tiers.selects?.samples || []).map(s => `[${s.clip}]\n${s.text}`).join('\n\n')}

## TIER 4: FINISHED PIECE (${tiers.finished?.total || 0} unit — the final 34-min documentary)
${(tiers.finished?.samples || []).map(s => s.text).join('\n\n')}

## QUANTITATIVE CONTEXT
- Raw→Selects retention: ~28.5% (2168 of 7616 clips)
- 100% script coverage (all 28 script sections have matching raw footage)
- ~5.5% of selects have high similarity (>0.7) to finished piece

## YOUR TASK
Synthesize 7 observations. For each, cite specific clips by name.

1. **INTENTION vs REALITY** — How the script's vision diverged from what the camera captured, and how the final piece resolved the tension
2. **THE FUNNEL** — What the 7616→2168→1→34min compression reveals about editing philosophy
3. **REUSE & ANCHORING** — Which clips or moments serve as editorial anchors across tiers
4. **COVERAGE GAP RESOLUTION** — How script gaps were solved (cut, rewritten, substituted)
5. **SIGNATURE MOVES** — This filmmaker's distinctive editorial techniques visible across tiers
6. **TASTE PROFILE** — Concrete, programmable rules for what this editor keeps vs cuts
7. **SURPRISE INSIGHTS** — What the four-tier view reveals that the filmmaker probably hasn't consciously articulated

3-5 sentences each. Be fearlessly specific. Name clips. This is for a filmmaker who wants to understand their own craft better.`;

  console.log('\nSending to gemini-2.5-pro...');

  for (const model of ['gemini-2.5-pro', 'gemini-2.5-flash']) {
    let succeeded = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await genai.models.generateContent({
          model,
          contents: prompt,
          config: { temperature: 0.7, maxOutputTokens: 8000 },
        });
        console.log(`SUCCESS with ${model} — ${result.text.length} chars\n`);
        console.log(result.text);

        // Save
        const { data, error } = await supabase.from('pattern_observations').insert({
          project_id: PROJECT_ID,
          observation_text: result.text,
          example_unit_ids: [],
          status: 'surfaced',
        }).select().single();

        if (error) console.error('Save error:', error.message);
        else console.log(`\nSaved as pattern observation: ${data.id}`);

        succeeded = true;
        break;
      } catch (err) {
        const msg = err.message || '';
        console.log(`${model} attempt ${attempt + 1}: ${msg.slice(0, 80)}`);
        if (msg.includes('503') && attempt < 4) {
          const wait = Math.pow(2, attempt) * 15;
          console.log(`Waiting ${wait}s...`);
          await new Promise(r => setTimeout(r, wait * 1000));
        } else if (msg.includes('503')) {
          console.log(`Giving up on ${model}...`);
          break;
        } else {
          throw err;
        }
      }
    }
    if (succeeded) break;
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
