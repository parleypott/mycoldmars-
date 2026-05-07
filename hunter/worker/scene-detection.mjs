#!/usr/bin/env node
/**
 * Scene Auto-Detection for Hunter
 *
 * Groups raw footage clips into scenes using:
 * 1. Temporal proximity (clips filmed within X minutes)
 * 2. Embedding similarity (semantic clustering within temporal groups)
 * 3. Analysis theme extraction for scene labels
 *
 * No Gemini API calls needed — uses existing embeddings + analyses.
 *
 * Usage: node hunter/worker/scene-detection.mjs [--project-id ID] [--threshold 0.65]
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

// Parse args
const args = process.argv.slice(2);
const pidIdx = args.indexOf('--project-id');
const PROJECT_ID = pidIdx >= 0 ? args[pidIdx + 1] : 'd745ee49-0ac1-47c7-b81e-94082ed25fed';
const threshIdx = args.indexOf('--threshold');
const SIM_THRESHOLD = threshIdx >= 0 ? parseFloat(args[threshIdx + 1]) : 0.65;
const TEMPORAL_GAP_MINUTES = 30; // Clips more than 30min apart = different temporal group

function cosineSim(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d > 0 ? dot / d : 0;
}

function parseEmbedding(emb) {
  if (Array.isArray(emb)) return emb;
  if (typeof emb === 'string') {
    try { return JSON.parse(emb); } catch {}
    return emb.replace(/[[\]()]/g, '').split(',').map(Number);
  }
  return null;
}

function extractDateFromClipName(name) {
  // Pattern: 20241007-1332-C8757_Proxy.MP4 → date=2024-10-07, time=13:32
  const m = name?.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), parseInt(m[4]), parseInt(m[5]));
}

function extractCameraId(name) {
  // Pattern: C8757 from 20241007-1332-C8757_Proxy.MP4
  const m = name?.match(/C(\d+)/);
  return m ? parseInt(m[1]) : null;
}

async function fetchAllPaginated(table, select, filters = {}) {
  let all = [];
  let offset = 0;
  while (true) {
    let q = supabase.from(table).select(select).range(offset, offset + 999);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error(`Fetch error: ${error.message}`);
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return all;
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  HUNTER SCENE AUTO-DETECTION         ║');
  console.log('╚══════════════════════════════════════╝\n');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Similarity threshold: ${SIM_THRESHOLD}`);
  console.log(`Temporal gap: ${TEMPORAL_GAP_MINUTES} min\n`);

  // Get raw asset
  const { data: assets } = await supabase.from('media_assets')
    .select('id').eq('project_id', PROJECT_ID).eq('tier', 'raw');
  if (!assets?.length) { console.log('No raw asset found.'); return; }
  const rawAssetId = assets[0].id;

  // Fetch all raw units with analyses
  console.log('Fetching corpus units...');
  const allUnits = await fetchAllPaginated('corpus_units', 'id, source_clip_name, start_seconds, end_seconds', { media_asset_id: rawAssetId });
  console.log(`Total raw units: ${allUnits.length}`);

  // Fetch analyses for units that have them (batched)
  const analysisMap = new Map();
  for (let i = 0; i < allUnits.length; i += 200) {
    const batch = allUnits.slice(i, i + 200).map(u => u.id);
    const { data } = await supabase.from('analyses').select('corpus_unit_id, output_text').in('corpus_unit_id', batch);
    if (data) for (const a of data) analysisMap.set(a.corpus_unit_id, a.output_text);
  }

  // Fetch embeddings (batched)
  const embeddingMap = new Map();
  for (let i = 0; i < allUnits.length; i += 200) {
    const batch = allUnits.slice(i, i + 200).map(u => u.id);
    const { data } = await supabase.from('embeddings').select('corpus_unit_id, embedding').in('corpus_unit_id', batch);
    if (data) for (const e of data) embeddingMap.set(e.corpus_unit_id, parseEmbedding(e.embedding));
  }

  // Filter to only analyzed units with embeddings
  const units = allUnits
    .filter(u => analysisMap.has(u.id) && embeddingMap.has(u.id))
    .map(u => ({
      ...u,
      timestamp: extractDateFromClipName(u.source_clip_name),
      cameraId: extractCameraId(u.source_clip_name),
      analysis: analysisMap.get(u.id),
      embedding: embeddingMap.get(u.id),
    }))
    .filter(u => u.timestamp) // Only units with parseable timestamps
    .sort((a, b) => a.timestamp - b.timestamp);

  console.log(`Analyzed units with timestamps: ${units.length}`);

  // Step 1: Temporal grouping
  const temporalGroups = [];
  let currentGroup = [];

  for (const unit of units) {
    if (currentGroup.length === 0) {
      currentGroup.push(unit);
    } else {
      const lastUnit = currentGroup[currentGroup.length - 1];
      const gapMinutes = (unit.timestamp - lastUnit.timestamp) / (1000 * 60);
      if (gapMinutes <= TEMPORAL_GAP_MINUTES) {
        currentGroup.push(unit);
      } else {
        temporalGroups.push(currentGroup);
        currentGroup = [unit];
      }
    }
  }
  if (currentGroup.length) temporalGroups.push(currentGroup);

  console.log(`\nTemporal groups: ${temporalGroups.length}`);
  for (let i = 0; i < Math.min(temporalGroups.length, 10); i++) {
    const g = temporalGroups[i];
    const start = g[0].timestamp.toISOString().slice(0, 16);
    const end = g[g.length - 1].timestamp.toISOString().slice(0, 16);
    console.log(`  Group ${i + 1}: ${g.length} clips (${start} → ${end})`);
  }

  // Step 2: Within each temporal group, cluster by embedding similarity
  const scenes = [];

  for (const group of temporalGroups) {
    if (group.length === 1) {
      scenes.push({ units: group, label: null });
      continue;
    }

    // Simple greedy clustering
    const clusters = [];
    const assigned = new Set();

    for (const unit of group) {
      if (assigned.has(unit.id)) continue;

      const cluster = [unit];
      assigned.add(unit.id);

      for (const other of group) {
        if (assigned.has(other.id)) continue;
        const sim = cosineSim(unit.embedding, other.embedding);
        if (sim >= SIM_THRESHOLD) {
          cluster.push(other);
          assigned.add(other.id);
        }
      }

      clusters.push(cluster);
    }

    for (const cluster of clusters) {
      scenes.push({ units: cluster, label: null });
    }
  }

  // Step 3: Generate scene labels from analysis text
  for (const scene of scenes) {
    const texts = scene.units.map(u => u.analysis?.slice(0, 100) || '');
    // Extract common themes (very simple: most frequent meaningful words)
    const words = texts.join(' ').toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4 && !STOP_WORDS.has(w));

    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    const topWords = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([w]) => w);

    scene.label = topWords.join(' / ') || 'unlabeled';

    // Add temporal info
    const dates = scene.units.map(u => u.timestamp).filter(Boolean);
    if (dates.length) {
      const day = dates[0].toISOString().slice(0, 10);
      const time = dates[0].toISOString().slice(11, 16);
      scene.dayLabel = day;
      scene.timeLabel = time;
    }
  }

  // Step 4: Report
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`DETECTED ${scenes.length} SCENES`);
  console.log(`${'═'.repeat(50)}\n`);

  // Group by day
  const byDay = {};
  for (const scene of scenes) {
    const day = scene.dayLabel || 'unknown';
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(scene);
  }

  for (const [day, dayScenes] of Object.entries(byDay).sort()) {
    const totalClips = dayScenes.reduce((s, sc) => s + sc.units.length, 0);
    console.log(`\n── ${day} (${dayScenes.length} scenes, ${totalClips} clips) ──`);

    for (const scene of dayScenes) {
      const clipNames = scene.units.map(u => u.source_clip_name?.replace(/_Proxy\.MP4$/i, '') || 'unknown');
      const cameras = [...new Set(scene.units.map(u => u.cameraId).filter(Boolean))];
      console.log(`\n  [${scene.timeLabel || '??:??'}] "${scene.label}" — ${scene.units.length} clip${scene.units.length > 1 ? 's' : ''}`);
      if (cameras.length > 1) console.log(`    Cameras: ${cameras.map(c => 'C' + c).join(', ')}`);
      console.log(`    Clips: ${clipNames.slice(0, 5).join(', ')}${clipNames.length > 5 ? ` +${clipNames.length - 5} more` : ''}`);
      // Show first analysis excerpt
      const firstAnalysis = scene.units[0]?.analysis?.slice(0, 150);
      if (firstAnalysis) console.log(`    Preview: ${firstAnalysis}...`);
    }
  }

  // Save scene data as pattern observation
  const sceneSummary = Object.entries(byDay).sort().map(([day, dayScenes]) => {
    return `## ${day}\n\n${dayScenes.map(scene => {
      const clipCount = scene.units.length;
      return `**[${scene.timeLabel}] ${scene.label}** — ${clipCount} clip${clipCount > 1 ? 's' : ''}\n${scene.units[0]?.analysis?.slice(0, 200) || ''}`;
    }).join('\n\n')}`;
  }).join('\n\n');

  const summaryText = `# Scene Detection Summary\n\n${scenes.length} scenes detected across ${units.length} analyzed clips.\n\n${sceneSummary}`;

  const { data, error } = await supabase.from('pattern_observations').insert({
    project_id: PROJECT_ID,
    observation_text: summaryText.slice(0, 50000),
    example_unit_ids: scenes.flatMap(s => s.units.slice(0, 2).map(u => u.id)).slice(0, 50),
    status: 'surfaced',
  }).select().single();

  if (error) console.error('Save error:', error.message);
  else console.log(`\nScene summary saved as pattern observation: ${data.id}`);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`SCENE DETECTION COMPLETE`);
  console.log(`${scenes.length} scenes · ${units.length} clips · ${Object.keys(byDay).length} shooting days`);
  console.log(`${'═'.repeat(50)}`);
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'being', 'below', 'between', 'could', 'doing',
  'during', 'every', 'first', 'found', 'going', 'great', 'having', 'here',
  'large', 'later', 'light', 'might', 'never', 'often', 'other', 'place',
  'point', 'right', 'second', 'seems', 'should', 'since', 'small', 'still',
  'their', 'there', 'these', 'thing', 'think', 'those', 'three', 'through',
  'under', 'using', 'video', 'watch', 'where', 'which', 'while', 'whose',
  'would', 'scene', 'shows', 'appears', 'camera', 'footage', 'towards',
  'within', 'without', 'before', 'begins', 'opens', 'captures', 'likely',
  'several', 'different', 'another', 'around', 'along', 'across',
]);

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
