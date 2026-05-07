#!/usr/bin/env node
/**
 * Cross-Tier Matching Engine for Hunter
 *
 * Performs three types of analysis:
 * 1. Script → Raw: Which raw footage matches each script beat?
 * 2. Raw → Selects: What did the editor keep? What patterns emerge?
 * 3. Selects → Finished: How did the final cut differ from selects?
 *
 * Uses pgvector cosine similarity on embeddings + Gemini Pro synthesis.
 *
 * Usage: node hunter/worker/cross-tier-matching.mjs [project-id]
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
import { generateEmbedding, synthesizePatterns } from './gemini-client.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// ── Helpers ──

async function fetchAllPaginated(table, select, filters = {}, orderCol = 'created_at') {
  let all = [];
  let offset = 0;
  while (true) {
    let q = supabase.from(table).select(select).order(orderCol, { ascending: true }).range(offset, offset + 999);
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

function parseEmbedding(emb) {
  if (Array.isArray(emb)) return emb;
  if (typeof emb === 'string') {
    // pgvector returns "[0.1,0.2,...]" format
    try { return JSON.parse(emb); } catch {}
    // Or "(0.1,0.2,...)" format
    return emb.replace(/[[\]()]/g, '').split(',').map(Number);
  }
  return null;
}

function cosineSimilarity(a, b) {
  const va = parseEmbedding(a);
  const vb = parseEmbedding(b);
  if (!va || !vb || va.length !== vb.length) return 0;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    normA += va[i] * va[i];
    normB += vb[i] * vb[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ── Script → Raw Matching ──

async function scriptToRawMatching(projectId) {
  console.log('\n═══════════════════════════════════');
  console.log('SCRIPT → RAW FOOTAGE MATCHING');
  console.log('═══════════════════════════════════\n');

  // Get script and raw assets
  const { data: assets } = await supabase.from('media_assets')
    .select('id, tier')
    .eq('project_id', projectId)
    .in('tier', ['google_docs', 'script', 'raw']);

  const scriptAssetIds = assets.filter(a => a.tier === 'google_docs' || a.tier === 'script').map(a => a.id);
  const rawAssetIds = assets.filter(a => a.tier === 'raw').map(a => a.id);

  if (!scriptAssetIds.length || !rawAssetIds.length) {
    console.log('Need both script and raw tiers for matching.');
    return null;
  }

  // Fetch script units + embeddings
  let scriptUnits = [];
  for (const id of scriptAssetIds) {
    const units = await fetchAllPaginated('corpus_units', 'id, source_clip_name, start_seconds, end_seconds', { media_asset_id: id });
    scriptUnits = scriptUnits.concat(units);
  }

  // Fetch raw units
  let rawUnits = [];
  for (const id of rawAssetIds) {
    const units = await fetchAllPaginated('corpus_units', 'id, source_clip_name', { media_asset_id: id });
    rawUnits = rawUnits.concat(units);
  }

  // Fetch all embeddings for these units
  const allUnitIds = [...scriptUnits, ...rawUnits].map(u => u.id);

  // We can't use .in() for large arrays, so fetch all embeddings
  const allEmbeddings = await fetchAllPaginated('embeddings', 'corpus_unit_id, embedding');
  const embeddingMap = new Map();
  for (const e of allEmbeddings) {
    embeddingMap.set(e.corpus_unit_id, e.embedding);
  }

  // Fetch analyses for script units (to get the section titles)
  const allAnalyses = await fetchAllPaginated('analyses', 'corpus_unit_id, output_text');
  const analysisMap = new Map();
  for (const a of allAnalyses) {
    analysisMap.set(a.corpus_unit_id, a.output_text);
  }

  console.log(`Script units: ${scriptUnits.length}, Raw units: ${rawUnits.length}`);
  console.log(`Embeddings loaded: ${embeddingMap.size}`);

  // For each script unit, find top-5 matching raw units
  const results = [];

  for (const scriptUnit of scriptUnits) {
    const scriptEmb = embeddingMap.get(scriptUnit.id);
    if (!scriptEmb) continue;

    const matches = [];
    for (const rawUnit of rawUnits) {
      const rawEmb = embeddingMap.get(rawUnit.id);
      if (!rawEmb) continue;

      const sim = cosineSimilarity(scriptEmb, rawEmb);
      matches.push({ rawUnitId: rawUnit.id, clipName: rawUnit.source_clip_name, similarity: sim });
    }

    matches.sort((a, b) => b.similarity - a.similarity);
    const top5 = matches.slice(0, 5);

    const scriptAnalysis = analysisMap.get(scriptUnit.id) || '';
    const sectionPreview = scriptAnalysis.slice(0, 150).replace(/\n/g, ' ');

    results.push({
      scriptUnit: scriptUnit.source_clip_name,
      sectionPreview,
      topMatches: top5,
      coverageScore: top5[0]?.similarity || 0,
    });
  }

  // Generate coverage report
  results.sort((a, b) => a.coverageScore - b.coverageScore); // worst coverage first

  console.log('\n── COVERAGE REPORT ──\n');

  const HIGH_THRESHOLD = 0.65;
  const LOW_THRESHOLD = 0.45;

  const wellCovered = results.filter(r => r.coverageScore >= HIGH_THRESHOLD);
  const partiallyCovered = results.filter(r => r.coverageScore >= LOW_THRESHOLD && r.coverageScore < HIGH_THRESHOLD);
  const gaps = results.filter(r => r.coverageScore < LOW_THRESHOLD);

  console.log(`Well covered (>${HIGH_THRESHOLD}): ${wellCovered.length}/${results.length} sections`);
  console.log(`Partial coverage: ${partiallyCovered.length}/${results.length} sections`);
  console.log(`GAPS (<${LOW_THRESHOLD}): ${gaps.length}/${results.length} sections\n`);

  if (gaps.length > 0) {
    console.log('── COVERAGE GAPS (script sections with weak raw footage match) ──\n');
    for (const gap of gaps) {
      console.log(`  ⚠ ${gap.scriptUnit}: score ${gap.coverageScore.toFixed(3)}`);
      console.log(`    ${gap.sectionPreview}`);
      if (gap.topMatches.length > 0) {
        console.log(`    Best match: ${gap.topMatches[0].clipName} (${gap.topMatches[0].similarity.toFixed(3)})`);
      }
      console.log();
    }
  }

  console.log('\n── BEST MATCHES (per script section) ──\n');
  for (const r of results.sort((a, b) => b.coverageScore - a.coverageScore).slice(0, 10)) {
    console.log(`  ${r.scriptUnit}: score ${r.coverageScore.toFixed(3)}`);
    console.log(`    ${r.sectionPreview.slice(0, 100)}`);
    for (const m of r.topMatches.slice(0, 3)) {
      console.log(`      → ${m.clipName} (${m.similarity.toFixed(3)})`);
    }
    console.log();
  }

  return results;
}

// ── Raw → Selects Analysis ──

async function rawToSelectsAnalysis(projectId) {
  console.log('\n═══════════════════════════════════');
  console.log('RAW → SELECTS: What Did the Editor Keep?');
  console.log('═══════════════════════════════════\n');

  const { data: assets } = await supabase.from('media_assets')
    .select('id, tier')
    .eq('project_id', projectId)
    .in('tier', ['raw', 'selects']);

  const rawAssetIds = assets.filter(a => a.tier === 'raw').map(a => a.id);
  const selectsAssetIds = assets.filter(a => a.tier === 'selects').map(a => a.id);

  if (!rawAssetIds.length || !selectsAssetIds.length) {
    console.log('Need both raw and selects tiers.');
    return null;
  }

  // Fetch raw and selects units
  let rawUnits = [];
  for (const id of rawAssetIds) {
    rawUnits = rawUnits.concat(await fetchAllPaginated('corpus_units', 'id, source_clip_name, start_seconds, end_seconds', { media_asset_id: id }));
  }

  let selectsUnits = [];
  for (const id of selectsAssetIds) {
    selectsUnits = selectsUnits.concat(await fetchAllPaginated('corpus_units', 'id, source_clip_name, start_seconds, end_seconds', { media_asset_id: id }));
  }

  // Cross-reference: which raw clips appear in selects?
  const selectsClipNames = new Set();
  for (const u of selectsUnits) {
    selectsClipNames.add(u.source_clip_name);
    selectsClipNames.add(u.source_clip_name.replace(/\.[^.]+$/, ''));
  }

  const kept = [];
  const discarded = [];

  for (const raw of rawUnits) {
    const name = raw.source_clip_name;
    const nameNoProxy = name.replace(/_Proxy/i, '');
    const nameNoExt = nameNoProxy.replace(/\.[^.]+$/, '');

    if (selectsClipNames.has(nameNoProxy) || selectsClipNames.has(nameNoExt)) {
      kept.push(raw);
    } else {
      discarded.push(raw);
    }
  }

  console.log(`Raw clips: ${rawUnits.length}`);
  console.log(`Kept in selects: ${kept.length} (${(kept.length / rawUnits.length * 100).toFixed(1)}%)`);
  console.log(`Discarded: ${discarded.length} (${(discarded.length / rawUnits.length * 100).toFixed(1)}%)`);

  // Count how many times each clip was used in selects
  const usageCount = new Map();
  for (const u of selectsUnits) {
    const name = u.source_clip_name;
    usageCount.set(name, (usageCount.get(name) || 0) + 1);
  }

  const heavilyUsed = Array.from(usageCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log('\n── MOST USED CLIPS IN EDIT ──\n');
  for (const [name, count] of heavilyUsed) {
    console.log(`  ${name}: used ${count} times`);
  }

  // Fetch analyses for kept vs discarded to find patterns
  const allAnalyses = await fetchAllPaginated('analyses', 'corpus_unit_id, output_text, output_json');
  const analysisMap = new Map();
  for (const a of allAnalyses) {
    analysisMap.set(a.corpus_unit_id, a);
  }

  // Extract structured data if available
  const keptStructured = kept.map(u => analysisMap.get(u.id)?.output_json).filter(Boolean);
  const discardedStructured = discarded.map(u => analysisMap.get(u.id)?.output_json).filter(Boolean);

  if (keptStructured.length > 0) {
    console.log('\n── KEPT vs DISCARDED: Structured Analysis ──\n');

    // Compare shot types
    const keptShotTypes = {};
    const discardedShotTypes = {};
    for (const s of keptStructured) {
      if (s.shot_type) keptShotTypes[s.shot_type] = (keptShotTypes[s.shot_type] || 0) + 1;
    }
    for (const s of discardedStructured) {
      if (s.shot_type) discardedShotTypes[s.shot_type] = (discardedShotTypes[s.shot_type] || 0) + 1;
    }

    console.log('Shot types — KEPT:');
    for (const [type, count] of Object.entries(keptShotTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count} (${(count / keptStructured.length * 100).toFixed(0)}%)`);
    }
    console.log('\nShot types — DISCARDED:');
    for (const [type, count] of Object.entries(discardedShotTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count} (${(count / discardedStructured.length * 100).toFixed(0)}%)`);
    }

    // Compare keepability scores
    const keptScores = keptStructured.map(s => s.keepability_score).filter(s => s != null);
    const discardedScores = discardedStructured.map(s => s.keepability_score).filter(s => s != null);

    if (keptScores.length > 0 && discardedScores.length > 0) {
      const avgKept = keptScores.reduce((a, b) => a + b, 0) / keptScores.length;
      const avgDiscarded = discardedScores.reduce((a, b) => a + b, 0) / discardedScores.length;
      console.log(`\nAvg keepability score — KEPT: ${avgKept.toFixed(3)} vs DISCARDED: ${avgDiscarded.toFixed(3)}`);
    }
  }

  // Prepare data for Pro synthesis
  const keptTexts = kept.slice(0, 50).map(u => analysisMap.get(u.id)?.output_text).filter(Boolean);
  const discardedTexts = discarded.slice(0, 50).map(u => analysisMap.get(u.id)?.output_text).filter(Boolean);

  return { kept, discarded, keptTexts, discardedTexts, heavilyUsed };
}

// ── Pro Synthesis: What patterns emerge? ──

async function synthesizeCrossTierPatterns(projectId, rawToSelects, scriptToRaw) {
  console.log('\n═══════════════════════════════════');
  console.log('CROSS-TIER SYNTHESIS (Gemini Pro)');
  console.log('═══════════════════════════════════\n');

  if (!rawToSelects?.keptTexts?.length) {
    console.log('Insufficient data for synthesis');
    return;
  }

  const { GoogleGenAI } = await import('@google/genai');
  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Build synthesis prompt with cross-tier data
  const keptSample = rawToSelects.keptTexts.slice(0, 30).map((t, i) => `[KEPT ${i+1}]\n${t.slice(0, 300)}`).join('\n\n');
  const discardedSample = rawToSelects.discardedTexts.slice(0, 30).map((t, i) => `[DISCARDED ${i+1}]\n${t.slice(0, 300)}`).join('\n\n');

  const coverageGaps = scriptToRaw
    ? scriptToRaw.filter(r => r.coverageScore < 0.45).map(r => `${r.scriptUnit}: ${r.sectionPreview.slice(0, 100)}`).join('\n')
    : 'No script data available.';

  const prompt = `You are analyzing a documentary filmmaker's EDITORIAL DECISIONS by comparing what they shot (raw footage) against what they kept in the edit (selects).

## CONTEXT
- Raw footage: ${rawToSelects.kept.length + rawToSelects.discarded.length} clips total
- Kept in edit: ${rawToSelects.kept.length} clips (${(rawToSelects.kept.length / (rawToSelects.kept.length + rawToSelects.discarded.length) * 100).toFixed(1)}%)
- Discarded: ${rawToSelects.discarded.length} clips

## MOST-USED CLIPS IN EDIT
${rawToSelects.heavilyUsed.map(([name, count]) => `${name}: ${count} uses`).join('\n')}

## SAMPLE: CLIPS THE EDITOR KEPT
${keptSample}

## SAMPLE: CLIPS THE EDITOR DISCARDED
${discardedSample}

## SCRIPT COVERAGE GAPS
${coverageGaps}

---

Analyze the editor's taste. Write 5-8 observations about:

1. **What makes footage "keepable" to this editor** — What qualities do the kept clips share? Visual style, emotional register, composition, audio quality, subject behavior?

2. **What gets cut** — What qualities characterize the discarded footage? Is it redundancy, technical issues, wrong energy, or something more subtle?

3. **Pattern of reuse** — Which clips get used multiple times? What does that reveal about the editor's go-to moments?

4. **Coverage gaps** — Where does the script ask for footage that doesn't exist? What does this suggest about shooting vs. writing habits?

5. **Editorial instinct signature** — What's unique about THIS editor's approach? If you had to describe their taste in 2-3 sentences, what would you say?

Be specific. Cite clip names. Surprise the filmmaker with insights they might not have noticed.`;

  console.log('Running Pro synthesis (this may take a minute)...');

  let result;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      result = await genai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { maxOutputTokens: 6000 },
      });
      break;
    } catch (err) {
      const msg = err.message || '';
      if ((msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand')) && attempt < 4) {
        const wait = Math.pow(2, attempt + 1) * 10;
        console.log(`Pro synthesis 503, retrying in ${wait}s (attempt ${attempt + 1}/5)...`);
        await new Promise(r => setTimeout(r, wait * 1000));
      } else {
        throw err;
      }
    }
  }
  if (!result) throw new Error('Pro synthesis failed after 5 retries');

  const synthesis = result.text;
  console.log('\n── CROSS-TIER SYNTHESIS ──\n');
  console.log(synthesis);

  // Save as pattern observation
  const { data: project } = await supabase.from('hunter_projects')
    .select('id').eq('id', projectId).single();

  if (project) {
    await supabase.from('pattern_observations').insert({
      project_id: projectId,
      observation_text: synthesis,
      example_unit_ids: rawToSelects.kept.slice(0, 10).map(u => u.id),
      status: 'surfaced',
      user_notes: null,
    });
    console.log('\nSaved as pattern observation.');
  }

  return synthesis;
}

// ── Main ──

async function main() {
  const projectId = process.argv[2] || 'd745ee49-0ac1-47c7-b81e-94082ed25fed';

  console.log('╔══════════════════════════════════════╗');
  console.log('║  HUNTER CROSS-TIER MATCHING ENGINE   ║');
  console.log('╚══════════════════════════════════════╝\n');

  // 1. Script → Raw matching
  const scriptResults = await scriptToRawMatching(projectId);

  // 2. Raw → Selects analysis
  const rawToSelects = await rawToSelectsAnalysis(projectId);

  // 3. Pro synthesis of cross-tier patterns
  if (rawToSelects) {
    await synthesizeCrossTierPatterns(projectId, rawToSelects, scriptResults);
  }

  console.log('\n✓ Cross-tier matching complete.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
