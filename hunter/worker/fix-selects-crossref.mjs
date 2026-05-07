#!/usr/bin/env node
/**
 * Fix cross-references between selects and raw corpus units.
 * The initial ingest didn't match because raw files have "_Proxy" suffix.
 * This script updates the analyses.output_json with rawMatchId.
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
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fetchAll(table, select, filters = {}) {
  let all = [];
  let offset = 0;
  while (true) {
    let q = supabase.from(table).select(select).range(offset, offset + 999);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data } = await q;
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return all;
}

async function main() {
  const PROJECT_ID = 'd745ee49-0ac1-47c7-b81e-94082ed25fed';
  const SELECTS_ASSET = '3f384dbd-7a86-43da-a175-4ab46f413777';

  // Get raw asset
  const { data: rawAssets } = await supabase.from('media_assets')
    .select('id').eq('project_id', PROJECT_ID).eq('tier', 'raw');
  const rawAssetIds = rawAssets.map(a => a.id);

  // Fetch all raw corpus units
  const rawUnits = await fetchAll('corpus_units', 'id, source_clip_name, start_seconds, end_seconds',
    { media_asset_id: rawAssetIds[0] });

  // Build lookup map with proxy-stripped names
  const rawMap = new Map();
  for (const u of rawUnits) {
    rawMap.set(u.source_clip_name, u);
    rawMap.set(u.source_clip_name.replace(/_Proxy/i, ''), u);
    rawMap.set(u.source_clip_name.replace(/\.[^.]+$/, ''), u);
    rawMap.set(u.source_clip_name.replace(/_Proxy/i, '').replace(/\.[^.]+$/, ''), u);
  }

  console.log(`Loaded ${rawUnits.length} raw units, ${rawMap.size} lookup entries`);

  // Fetch all selects corpus units
  const selectsUnits = await fetchAll('corpus_units', 'id, source_clip_name, start_seconds, end_seconds',
    { media_asset_id: SELECTS_ASSET });
  console.log(`Found ${selectsUnits.length} selects units`);

  // Fetch all selects analyses
  const selectsUnitIds = new Set(selectsUnits.map(u => u.id));
  const allAnalyses = await fetchAll('analyses', 'id, corpus_unit_id, output_json, output_text');
  const selectsAnalyses = allAnalyses.filter(a => selectsUnitIds.has(a.corpus_unit_id));
  console.log(`Found ${selectsAnalyses.length} selects analyses`);

  let matched = 0;
  let updated = 0;

  for (const unit of selectsUnits) {
    const rawMatch = rawMap.get(unit.source_clip_name)
      || rawMap.get(unit.source_clip_name.replace(/\.[^.]+$/, ''));

    if (!rawMatch) continue;
    matched++;

    // Find analysis for this unit
    const analysis = selectsAnalyses.find(a => a.corpus_unit_id === unit.id);
    if (!analysis) continue;

    // Update output_json with rawMatchId
    const json = analysis.output_json || {};
    if (json.rawMatchId === rawMatch.id) continue; // already set

    json.rawMatchId = rawMatch.id;
    const duration = unit.end_seconds - unit.start_seconds;
    const rawDuration = rawMatch.end_seconds - rawMatch.start_seconds;
    json.usagePercent = rawDuration > 0 ? Math.round((duration / rawDuration) * 1000) / 10 : null;

    // Update the analysis text to include cross-reference
    let newText = analysis.output_text;
    if (!newText.includes('CROSS-REFERENCE')) {
      newText += `\n\nCROSS-REFERENCE: Matches raw corpus unit ${rawMatch.id} (${rawMatch.source_clip_name}).`;
      newText += ` Editor used ${duration.toFixed(1)}s of ${rawDuration.toFixed(0)}s source (${json.usagePercent}%).`;
    }

    await supabase.from('analyses')
      .update({ output_json: json, output_text: newText })
      .eq('id', analysis.id);
    updated++;
  }

  console.log(`Done: ${matched}/${selectsUnits.length} matched to raw, ${updated} analyses updated`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
