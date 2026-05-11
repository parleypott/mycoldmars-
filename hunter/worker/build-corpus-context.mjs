#!/usr/bin/env node
/**
 * Corpus Context Engine — build cross-clip continuity for an entire project.
 * Runs on the local worker Mac (no timeout). Estimated cost: $5–15. Runtime: ~1–2 hours.
 *
 * Usage: node hunter/worker/build-corpus-context.mjs --project-id <ID> [--force] [--skip-subjects]
 *
 * 5 phases:
 *   1. Subject extraction (Flash, ~20 min)
 *   2. Scene materialization (pure computation, ~2 min)
 *   3. Scene synthesis (Flash, ~45 min)
 *   4. Day synthesis (Flash, ~10 min)
 *   5. Project synthesis (Pro, ~2 min)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Load .env manually (same pattern as backfill-analyses.mjs) ──
const envPath = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const l of lines) {
    const m = l.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

import { createClient } from '@supabase/supabase-js';
import {
  synthesizeScene,
  synthesizeDay,
  synthesizeProject,
  extractSubjectsFromAnalyses,
} from './gemini-client.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── CLI args ──
const args = process.argv.slice(2);
const pidIdx = args.indexOf('--project-id');
const PROJECT_ID = pidIdx >= 0 ? args[pidIdx + 1] : null;
const FORCE = args.includes('--force');
const SKIP_SUBJECTS = args.includes('--skip-subjects');
const CONCURRENCY = parseInt(process.env.HUNTER_CONCURRENCY || '1'); // 1 to respect free-tier RPM
const MIN_DELAY_MS = parseInt(process.env.HUNTER_DELAY_MS || '12000'); // 12s between calls = ~5 RPM
const SCENE_GAP_MINUTES = 30; // wider gap than client-side (10min) for more coherent scenes

if (!PROJECT_ID) {
  console.error('Usage: node hunter/worker/build-corpus-context.mjs --project-id <ID> [--force] [--skip-subjects]');
  process.exit(1);
}

// ── Shared utilities (same patterns as backfill-analyses.mjs) ──

function createPool(concurrency) {
  let active = 0;
  const queue = [];
  function run() {
    while (active < concurrency && queue.length > 0) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(resolve, reject).finally(() => { active--; run(); });
    }
  }
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); run(); });
}

async function fetchAllPaginated(table, select, filters = {}) {
  let all = [];
  let offset = 0;
  while (true) {
    let q = supabase.from(table).select(select).range(offset, offset + 999);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error(`Fetch ${table}: ${error.message}`);
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return all;
}

let consecutive503s = 0;
let lastCallTime = 0;

async function throttle() {
  const elapsed = Date.now() - lastCallTime;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise(r => setTimeout(r, MIN_DELAY_MS - elapsed));
  }
  lastCallTime = Date.now();
}

async function retryWithBackoff(fn, label, maxRetries = 8) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      await throttle();
      const result = await fn();
      consecutive503s = 0;
      return result;
    } catch (err) {
      const msg = err.message || '';
      if (i < maxRetries && (msg.includes('429') || msg.includes('503') || msg.includes('RESOURCE_EXHAUSTED'))) {
        consecutive503s++;
        // Aggressive backoff: 30s, 60s, 120s, 300s, 300s, 300s...
        const wait = Math.min(300, Math.pow(2, i) * 30);
        console.log(`  [retry] ${label} retry ${i + 1}/${maxRetries} in ${wait}s (streak: ${consecutive503s})`);
        await new Promise(r => setTimeout(r, wait * 1000));
      } else {
        throw err;
      }
    }
  }
}

// ── Progress reporting (writes to DB so frontend can show live status) ──

async function reportProgress(phase, step, total, message) {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  const status = { phase, step, total, pct, message, updatedAt: new Date().toISOString() };
  console.log(`  [${phase}] ${pct}% — ${message}`);
  try {
    const { data: proj } = await supabase.from('hunter_projects')
      .select('metadata').eq('id', PROJECT_ID).single();
    const meta = proj?.metadata || {};
    meta.corpus_context_status = status;
    await supabase.from('hunter_projects').update({ metadata: meta }).eq('id', PROJECT_ID);
  } catch {}
}

async function clearProgress() {
  try {
    const { data: proj } = await supabase.from('hunter_projects')
      .select('metadata').eq('id', PROJECT_ID).single();
    const meta = proj?.metadata || {};
    delete meta.corpus_context_status;
    await supabase.from('hunter_projects').update({ metadata: meta }).eq('id', PROJECT_ID);
  } catch {}
}

// ── Graceful shutdown ──

let shuttingDown = false;

function setupShutdownHandler() {
  const handler = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[corpus-context] Received ${signal}, shutting down gracefully...`);
    process.exit(0);
  };
  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

// ── Timestamp parsing (ported from main.js groupIntoScenes) ──

function extractDateFromClipName(name) {
  const m = name?.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), parseInt(m[4]), parseInt(m[5]));
}

// ══════════════════════════════════════════════════════════
// STEP 1: SUBJECT EXTRACTION
// ══════════════════════════════════════════════════════════

async function step1SubjectExtraction(allUnits) {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 1: SUBJECT EXTRACTION          ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Check idempotency
  if (!FORCE) {
    const { count } = await supabase.from('subject_appearances')
      .select('subject_id', { count: 'exact', head: true });
    if (count > 0) {
      console.log(`  Skipping — ${count} subject appearances already exist. Use --force to re-run.`);
      return;
    }
  }

  // Get all units with analyses that have output_json
  const unitsWithJson = allUnits.filter(u => u.analyses?.[0]?.output_json);
  console.log(`  ${unitsWithJson.length} clips with structured analyses`);

  // Batch into groups of 50 (smaller to stay within per-minute token limits)
  const BATCH_SIZE = 50;
  const batches = [];
  for (let i = 0; i < unitsWithJson.length; i += BATCH_SIZE) {
    batches.push(unitsWithJson.slice(i, i + BATCH_SIZE));
  }
  console.log(`  Processing in ${batches.length} batches of up to ${BATCH_SIZE}...`);

  const allSubjects = [];

  for (let b = 0; b < batches.length; b++) {
    if (shuttingDown) return;
    const batch = batches[b];
    await reportProgress('subjects', b, batches.length, `Extracting subjects — batch ${b + 1}/${batches.length} (${batch.length} clips)`);

    const clipAnalyses = batch.map(u => ({
      clipName: u.source_clip_name,
      output_json: u.analyses[0].output_json,
    }));

    const result = await retryWithBackoff(
      () => extractSubjectsFromAnalyses(clipAnalyses),
      `subjects-batch-${b + 1}`
    );

    if (result.subjects) {
      // Map clip indices back to real unit IDs
      for (const subj of result.subjects) {
        subj._batchOffset = b * BATCH_SIZE;
        subj._batchUnits = batch;
      }
      allSubjects.push(...result.subjects);
    }
    console.log(`  Batch ${b + 1}: found ${result.subjects?.length || 0} subjects`);
  }

  // Final consolidation pass if multiple batches
  let consolidated = allSubjects;
  if (batches.length > 1 && allSubjects.length > 0) {
    console.log(`  Consolidating ${allSubjects.length} subjects across batches...`);
    // Simple name-based merge
    const byName = new Map();
    for (const s of allSubjects) {
      const key = s.canonical_name.toLowerCase().trim();
      if (byName.has(key)) {
        const existing = byName.get(key);
        existing.aliases = [...new Set([...existing.aliases, ...s.aliases])];
        existing.clip_appearances = [...new Set([...existing.clip_appearances, ...s.clip_appearances])];
        existing.confidence = Math.max(existing.confidence, s.confidence);
      } else {
        byName.set(key, { ...s });
      }
    }
    consolidated = [...byName.values()];
    console.log(`  Consolidated to ${consolidated.length} unique subjects`);
  }

  // Clear existing data if --force
  if (FORCE) {
    // Get existing subject IDs for this project's appearances
    const { data: existingAppearances } = await supabase.from('subject_appearances')
      .select('subject_id')
      .in('corpus_unit_id', allUnits.map(u => u.id).slice(0, 1000));
    if (existingAppearances?.length) {
      const subjectIds = [...new Set(existingAppearances.map(a => a.subject_id))];
      await supabase.from('subject_appearances').delete().in('subject_id', subjectIds);
      await supabase.from('subjects').delete().in('id', subjectIds);
      console.log(`  Cleared ${subjectIds.length} existing subjects`);
    }
  }

  // Write to subjects + subject_appearances
  for (const subj of consolidated) {
    if (shuttingDown) return;
    const { data: row, error } = await supabase.from('subjects')
      .upsert({
        name: subj.canonical_name,
        description: subj.description || '',
        reference_stills: [],
      }, { onConflict: 'name', ignoreDuplicates: false })
      .select('id')
      .single();

    if (error) {
      // If upsert fails (no unique constraint on name), try insert
      const { data: inserted, error: insertErr } = await supabase.from('subjects')
        .insert({
          name: subj.canonical_name,
          description: subj.description || '',
          reference_stills: [],
        })
        .select('id')
        .single();

      if (insertErr) {
        console.log(`  Warning: could not save subject "${subj.canonical_name}": ${insertErr.message}`);
        continue;
      }
      if (inserted) {
        await writeSubjectAppearances(inserted.id, subj, allUnits);
      }
    } else if (row) {
      await writeSubjectAppearances(row.id, subj, allUnits);
    }
  }

  console.log(`  ✓ Step 1 complete: ${consolidated.length} subjects saved`);
}

async function writeSubjectAppearances(subjectId, subj, allUnits) {
  // Map clip_appearances (1-indexed from batch) back to unit IDs
  const batchUnits = subj._batchUnits || allUnits;
  const offset = subj._batchOffset || 0;
  const appearances = (subj.clip_appearances || [])
    .map(clipNum => {
      const idx = clipNum - 1; // 1-indexed to 0-indexed
      const unit = batchUnits[idx];
      return unit?.id;
    })
    .filter(Boolean);

  const uniqueIds = [...new Set(appearances)];
  for (const unitId of uniqueIds.slice(0, 500)) {
    await supabase.from('subject_appearances')
      .upsert({
        subject_id: subjectId,
        corpus_unit_id: unitId,
        confidence: subj.confidence || 0.5,
      }, { onConflict: 'subject_id,corpus_unit_id', ignoreDuplicates: true });
  }
}

// ══════════════════════════════════════════════════════════
// STEP 2: SCENE MATERIALIZATION
// ══════════════════════════════════════════════════════════

async function step2SceneMaterialization(allUnits) {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 2: SCENE MATERIALIZATION       ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Check idempotency
  if (!FORCE) {
    const { count } = await supabase.from('scenes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', PROJECT_ID);
    if (count > 0) {
      console.log(`  Skipping — ${count} scenes already exist. Use --force to re-run.`);
      // Return existing scenes for downstream use
      const { data: existing } = await supabase.from('scenes')
        .select('*, scene_units(*)')
        .eq('project_id', PROJECT_ID)
        .order('chronological_order', { ascending: true });
      return existing || [];
    }
  }

  // Clear existing scenes if --force
  if (FORCE) {
    await supabase.from('scene_units').delete().in(
      'scene_id',
      (await supabase.from('scenes').select('id').eq('project_id', PROJECT_ID)).data?.map(s => s.id) || []
    );
    await supabase.from('scenes').delete().eq('project_id', PROJECT_ID);
    console.log('  Cleared existing scenes');
  }

  // Parse timestamps and sort
  const timed = allUnits
    .map(u => ({
      ...u,
      timestamp: extractDateFromClipName(u.source_clip_name),
    }))
    .filter(u => u.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);

  console.log(`  ${timed.length} clips with parseable timestamps out of ${allUnits.length} total`);

  if (!timed.length) {
    console.log('  No timestamped clips found. Cannot create scenes.');
    return [];
  }

  // Temporal clustering with SCENE_GAP_MINUTES gap
  const sceneGroups = [];
  let current = [timed[0]];

  for (let i = 1; i < timed.length; i++) {
    const gap = (timed[i].timestamp - current[current.length - 1].timestamp) / (1000 * 60);
    if (gap <= SCENE_GAP_MINUTES) {
      current.push(timed[i]);
    } else {
      sceneGroups.push(current);
      current = [timed[i]];
    }
  }
  if (current.length) sceneGroups.push(current);

  console.log(`  ${sceneGroups.length} scenes detected (${SCENE_GAP_MINUTES}min gap threshold)`);
  await reportProgress('scenes', 0, sceneGroups.length, `Materializing ${sceneGroups.length} scenes from temporal clustering`);

  // Write each scene to DB
  const sceneRows = [];
  for (let i = 0; i < sceneGroups.length; i++) {
    const clips = sceneGroups[i];
    const start = clips[0].timestamp;
    const day = start.toISOString().slice(0, 10);
    const time = start.toISOString().slice(11, 16);

    const totalDuration = clips.reduce((sum, c) => {
      const dur = (c.end_seconds || 0) - (c.start_seconds || 0);
      return sum + (dur > 0 ? dur : 0);
    }, 0);

    const { data: scene, error } = await supabase.from('scenes').insert({
      project_id: PROJECT_ID,
      name: `Scene at ${time}`,
      shoot_day: day,
      time_of_day: timeOfDayFromHour(start.getHours()),
      chronological_order: i,
      clip_count: clips.length,
      total_duration_seconds: Math.round(totalDuration),
      status: 'auto',
    }).select().single();

    if (error) {
      console.error(`  Error creating scene ${i}: ${error.message}`);
      continue;
    }

    // Write clip memberships to scene_units
    const unitRows = clips.map((c, pos) => ({
      scene_id: scene.id,
      corpus_unit_id: c.id,
      position: pos,
      role: 'supporting', // will be updated by scene synthesis
    }));

    // Insert in batches
    for (let j = 0; j < unitRows.length; j += 100) {
      await supabase.from('scene_units').insert(unitRows.slice(j, j + 100));
    }

    scene._clips = clips;
    sceneRows.push(scene);
  }

  console.log(`  ✓ Step 2 complete: ${sceneRows.length} scenes materialized, ${timed.length} clips assigned`);
  return sceneRows;
}

function timeOfDayFromHour(hour) {
  if (hour < 6) return 'night';
  if (hour < 8) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  if (hour < 19) return 'golden-hour';
  if (hour < 21) return 'evening';
  return 'night';
}

// ══════════════════════════════════════════════════════════
// STEP 3: SCENE SYNTHESIS
// ══════════════════════════════════════════════════════════

async function step3SceneSynthesis(scenes, allUnits) {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 3: SCENE SYNTHESIS             ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Check idempotency
  if (!FORCE) {
    const { count } = await supabase.from('arc_summaries')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', PROJECT_ID)
      .eq('level', 'scene');
    if (count > 0) {
      console.log(`  Skipping — ${count} scene summaries already exist. Use --force to re-run.`);
      return;
    }
  }

  // Clear existing scene-level arc_summaries if --force
  if (FORCE) {
    await supabase.from('arc_summaries').delete()
      .eq('project_id', PROJECT_ID)
      .eq('level', 'scene');
  }

  // Build unit lookup by ID
  const unitById = new Map(allUnits.map(u => [u.id, u]));

  const limit = createPool(CONCURRENCY);
  let success = 0;
  let failed = 0;
  const startTime = Date.now();

  // Progress reporter
  const progressInterval = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`  ── PROGRESS: ${success} ok, ${failed} fail, ${success + failed}/${scenes.length} scenes, ${elapsed}min elapsed ──`);
  }, 60000);

  await Promise.allSettled(scenes.map(scene => limit(async () => {
    if (shuttingDown) return;

    // Get clip IDs for this scene
    const { data: sceneUnits } = await supabase.from('scene_units')
      .select('corpus_unit_id, position')
      .eq('scene_id', scene.id)
      .order('position', { ascending: true });

    if (!sceneUnits?.length) {
      failed++;
      return;
    }

    // Gather full analysis texts for all clips, enriched with structured metadata
    const clipAnalyses = [];
    const clipNames = [];
    for (const su of sceneUnits) {
      const unit = unitById.get(su.corpus_unit_id);
      if (unit?.analyses?.[0]?.output_text) {
        // Enrich narrative text with structured metadata for denser signal
        let text = unit.analyses[0].output_text;
        const j = unit.analyses[0].output_json;
        if (j) {
          const meta = [];
          if (j.emotional_register) meta.push(`Emotion: ${j.emotional_register}`);
          if (j.shot_type) meta.push(`Shot: ${j.shot_type}`);
          if (j.keepability_score != null) meta.push(`Keep: ${j.keepability_score}`);
          if (j.keepability_reason) meta.push(`Why: ${j.keepability_reason}`);
          if (j.subjects?.length) meta.push(`Subjects: ${j.subjects.map(s => s.description || s.action || '').join('; ')}`);
          if (meta.length) text += `\n[METADATA] ${meta.join(' | ')}`;
        }
        clipAnalyses.push(text);
        clipNames.push(unit.source_clip_name || 'unknown');
      }
    }

    if (clipAnalyses.length === 0) {
      failed++;
      return;
    }

    try {
      // For mega-scenes (60+ clips), synthesize in chunks then merge
      const MAX_CLIPS_PER_CALL = 60;
      let result;
      if (clipAnalyses.length > MAX_CLIPS_PER_CALL) {
        const chunkResults = [];
        for (let ci = 0; ci < clipAnalyses.length; ci += MAX_CLIPS_PER_CALL) {
          const chunkAnalyses = clipAnalyses.slice(ci, ci + MAX_CLIPS_PER_CALL);
          const chunkNames = clipNames.slice(ci, ci + MAX_CLIPS_PER_CALL);
          const chunkResult = await retryWithBackoff(
            () => synthesizeScene({ clipAnalyses: chunkAnalyses, clipNames: chunkNames, sceneContext: `This is part ${Math.floor(ci / MAX_CLIPS_PER_CALL) + 1} of ${Math.ceil(clipAnalyses.length / MAX_CLIPS_PER_CALL)} chunks from a large scene with ${clipAnalyses.length} total clips.` }),
            `scene-${scene.chronological_order}-chunk-${ci}`
          );
          if (!chunkResult.parse_error) chunkResults.push(chunkResult);
        }
        // Merge chunks: use first chunk as base, aggregate hero/supporting/cutaway lists
        result = chunkResults[0] || { parse_error: true };
        if (chunkResults.length > 1 && !result.parse_error) {
          for (let cr = 1; cr < chunkResults.length; cr++) {
            const c = chunkResults[cr];
            result.arc_summary = (result.arc_summary || '') + '\n\n' + (c.arc_summary || '');
            result.hero_clips = [...(result.hero_clips || []), ...(c.hero_clips || [])];
            result.supporting_clips = [...(result.supporting_clips || []), ...(c.supporting_clips || [])];
            result.cutaway_clips = [...(result.cutaway_clips || []), ...(c.cutaway_clips || [])];
            result.subjects = [...new Set([...(result.subjects || []), ...(c.subjects || [])])];
          }
        }
      } else {
        result = await retryWithBackoff(
          () => synthesizeScene({ clipAnalyses, clipNames }),
          `scene-${scene.chronological_order}`
        );
      }

      if (result.parse_error) {
        console.log(`  Warning: scene ${scene.chronological_order} returned unparseable JSON`);
        failed++;
        return;
      }

      // Update scene row
      await supabase.from('scenes').update({
        name: result.name || scene.name,
        scene_type: result.scene_type || null,
        arc_summary: result.arc_summary || null,
        emotional_curve: result.emotional_curve || null,
        editorial_notes: result.editorial_notes || null,
        location: result.location || null,
        time_of_day: result.time_of_day || scene.time_of_day,
      }).eq('id', scene.id);

      // Update scene_units roles from hero/supporting/cutaway classification
      const roleMap = {};
      for (const name of (result.hero_clips || [])) roleMap[name] = 'hero';
      for (const name of (result.cutaway_clips || [])) roleMap[name] = 'cutaway';
      // supporting is default, only update hero and cutaway
      for (const su of sceneUnits) {
        const unit = unitById.get(su.corpus_unit_id);
        const clipName = unit?.source_clip_name;
        const role = roleMap[clipName];
        if (role) {
          await supabase.from('scene_units')
            .update({ role })
            .eq('scene_id', scene.id)
            .eq('corpus_unit_id', su.corpus_unit_id);
        }
      }

      // Write scene-level arc_summary
      await supabase.from('arc_summaries').insert({
        project_id: PROJECT_ID,
        level: 'scene',
        scope_ref: scene.id,
        summary_text: JSON.stringify(result),
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      });

      success++;
      if (success % 5 === 0 || success === scenes.length) {
        await reportProgress('scene_synthesis', success, scenes.length, `Synthesized ${success}/${scenes.length} scenes — "${(result.name || '').slice(0, 40)}"`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ Scene ${scene.chronological_order}: ${err.message?.slice(0, 80)}`);
    }
  })));

  clearInterval(progressInterval);
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`  ✓ Step 3 complete: ${success} ok, ${failed} fail, ${elapsed}min`);
}

// ══════════════════════════════════════════════════════════
// STEP 4: DAY SYNTHESIS
// ══════════════════════════════════════════════════════════

async function step4DaySynthesis(scenes) {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 4: DAY SYNTHESIS               ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Check idempotency
  if (!FORCE) {
    const { count } = await supabase.from('arc_summaries')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', PROJECT_ID)
      .eq('level', 'day');
    if (count > 0) {
      console.log(`  Skipping — ${count} day summaries already exist. Use --force to re-run.`);
      return;
    }
  }

  if (FORCE) {
    await supabase.from('arc_summaries').delete()
      .eq('project_id', PROJECT_ID)
      .eq('level', 'day');
  }

  // Fetch scene-level arc summaries
  const { data: sceneArcs } = await supabase.from('arc_summaries')
    .select('*')
    .eq('project_id', PROJECT_ID)
    .eq('level', 'scene');

  if (!sceneArcs?.length) {
    console.log('  No scene summaries found. Run step 3 first.');
    return;
  }

  // Build scene summaries map by scene ID
  const sceneSummaryById = new Map();
  for (const arc of sceneArcs) {
    try {
      sceneSummaryById.set(arc.scope_ref, JSON.parse(arc.summary_text));
    } catch {
      sceneSummaryById.set(arc.scope_ref, { arc_summary: arc.summary_text });
    }
  }

  // Refresh scenes from DB to get accurate shoot_day
  const { data: dbScenes } = await supabase.from('scenes')
    .select('id, shoot_day, chronological_order, name')
    .eq('project_id', PROJECT_ID)
    .order('chronological_order', { ascending: true });

  // Group scenes by shoot_day
  const dayGroups = new Map();
  for (const scene of (dbScenes || [])) {
    const day = scene.shoot_day || 'unknown';
    if (!dayGroups.has(day)) dayGroups.set(day, []);
    dayGroups.get(day).push(scene);
  }

  console.log(`  ${dayGroups.size} shooting days detected`);

  // Get project context if available
  const { data: project } = await supabase.from('hunter_projects')
    .select('metadata').eq('id', PROJECT_ID).single();
  const projectContext = project?.metadata?.context || null;

  const dayResults = [];

  for (const [dayLabel, dayScenes] of dayGroups) {
    if (shuttingDown) return;
    console.log(`  Day ${dayLabel}: ${dayScenes.length} scenes...`);

    const sceneSummaries = dayScenes.map(s => {
      const summary = sceneSummaryById.get(s.id) || {};
      return {
        name: summary.name || s.name || 'Untitled',
        scene_type: summary.scene_type || '',
        location: summary.location || '',
        time_of_day: summary.time_of_day || '',
        keepability: summary.keepability,
        arc_summary: summary.arc_summary || '',
        emotional_curve: summary.emotional_curve || '',
        editorial_notes: summary.editorial_notes || '',
      };
    });

    const sceneArcIds = dayScenes
      .map(s => sceneArcs.find(a => a.scope_ref === s.id)?.id)
      .filter(Boolean);

    try {
      const result = await retryWithBackoff(
        () => synthesizeDay({ sceneSummaries, dayLabel, projectContext }),
        `day-${dayLabel}`
      );

      if (result.parse_error) {
        console.log(`  Warning: day ${dayLabel} returned unparseable JSON`);
        continue;
      }

      await supabase.from('arc_summaries').insert({
        project_id: PROJECT_ID,
        level: 'day',
        scope_ref: dayLabel,
        summary_text: JSON.stringify(result),
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        input_summary_ids: sceneArcIds,
      });

      result.dayLabel = dayLabel;
      dayResults.push(result);
      await reportProgress('day_synthesis', dayResults.length, dayGroups.size, `Day ${dayLabel}: "${(result.day_character || '').slice(0, 50)}"`);
    } catch (err) {
      console.error(`  ✗ Day ${dayLabel}: ${err.message?.slice(0, 80)}`);
    }
  }

  console.log(`  ✓ Step 4 complete: ${dayResults.length} days synthesized`);
  return dayResults;
}

// ══════════════════════════════════════════════════════════
// STEP 5: PROJECT SYNTHESIS
// ══════════════════════════════════════════════════════════

async function step5ProjectSynthesis(dayResults) {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  STEP 5: PROJECT SYNTHESIS (PRO)     ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Check idempotency
  if (!FORCE) {
    const { count } = await supabase.from('arc_summaries')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', PROJECT_ID)
      .eq('level', 'project');
    if (count > 0) {
      console.log('  Skipping — project synthesis already exists. Use --force to re-run.');
      return;
    }
  }

  if (FORCE) {
    await supabase.from('arc_summaries').delete()
      .eq('project_id', PROJECT_ID)
      .eq('level', 'project');
  }

  // If day results weren't passed (e.g. step 4 was skipped), fetch from DB
  let daySummaries = dayResults;
  if (!daySummaries?.length) {
    const { data: dayArcs } = await supabase.from('arc_summaries')
      .select('*')
      .eq('project_id', PROJECT_ID)
      .eq('level', 'day')
      .order('scope_ref', { ascending: true });

    daySummaries = (dayArcs || []).map(a => {
      try {
        const parsed = JSON.parse(a.summary_text);
        parsed.dayLabel = a.scope_ref;
        return parsed;
      } catch {
        return { dayLabel: a.scope_ref, day_narrative: a.summary_text };
      }
    });
  }

  if (!daySummaries?.length) {
    console.log('  No day summaries found. Run step 4 first.');
    return;
  }

  // Get project info
  const { data: project } = await supabase.from('hunter_projects')
    .select('name, metadata').eq('id', PROJECT_ID).single();

  // Get stats
  const { count: totalClips } = await supabase.from('corpus_units')
    .select('id', { count: 'exact', head: true })
    .in('media_asset_id',
      (await supabase.from('media_assets').select('id').eq('project_id', PROJECT_ID)).data?.map(a => a.id) || []
    );

  const { count: totalScenes } = await supabase.from('scenes')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', PROJECT_ID);

  const stats = {
    totalClips: totalClips || 0,
    totalScenes: totalScenes || 0,
    totalDays: daySummaries.length,
  };

  console.log(`  Stats: ${stats.totalClips} clips, ${stats.totalScenes} scenes, ${stats.totalDays} days`);
  await reportProgress('project_synthesis', 0, 1, `Synthesizing master narrative with Gemini Pro — ${stats.totalClips} clips, ${stats.totalScenes} scenes, ${stats.totalDays} days`);

  try {
    const result = await retryWithBackoff(
      () => synthesizeProject({
        daySummaries,
        projectName: project?.name || 'Untitled',
        stats,
      }),
      'project-synthesis',
      3 // fewer retries for Pro
    );

    if (result.parse_error) {
      console.error('  Project synthesis returned unparseable JSON');
      console.log('  Raw text:', result.raw_text?.slice(0, 500));
      return;
    }

    // Write project-level arc_summary
    const dayArcIds = (await supabase.from('arc_summaries')
      .select('id')
      .eq('project_id', PROJECT_ID)
      .eq('level', 'day')).data?.map(a => a.id) || [];

    await supabase.from('arc_summaries').insert({
      project_id: PROJECT_ID,
      level: 'project',
      scope_ref: PROJECT_ID,
      summary_text: JSON.stringify(result),
      model: 'gemini-2.5-pro',
      input_summary_ids: dayArcIds,
    });

    // CRITICAL: Update hunter_projects.metadata.context with project_context_string
    const existingMetadata = project?.metadata || {};
    const updatedMetadata = {
      ...existingMetadata,
      context: result.project_context_string || '',
      master_narrative: {
        title: result.title || '',
        lede: result.lede || '',
      },
    };

    await supabase.from('hunter_projects')
      .update({ metadata: updatedMetadata })
      .eq('id', PROJECT_ID);

    console.log('  ✓ Project context string written to metadata.context');
    console.log(`  ✓ Title: "${result.title}"`);
    console.log(`  ✓ Lede: "${result.lede}"`);
    console.log(`  ✓ Context string: ${result.project_context_string?.length || 0} chars`);
    console.log('  ✓ Step 5 complete');
  } catch (err) {
    console.error(`  ✗ Project synthesis failed: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

async function main() {
  setupShutdownHandler();

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  CORPUS CONTEXT ENGINE                       ║');
  console.log('║  Cross-Clip Continuity Builder                ║');
  console.log('╚══════════════════════════════════════════════╝\n');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Force: ${FORCE} | Skip subjects: ${SKIP_SUBJECTS} | Concurrency: ${CONCURRENCY}`);

  // Verify project exists
  const { data: project, error: projErr } = await supabase.from('hunter_projects')
    .select('name, metadata').eq('id', PROJECT_ID).single();
  if (projErr || !project) {
    console.error(`Project ${PROJECT_ID} not found`);
    process.exit(1);
  }
  console.log(`Project name: "${project.name}"`);

  // Fetch ALL corpus units with analyses for this project
  console.log('\nFetching all corpus units with analyses...');
  const { data: assets } = await supabase.from('media_assets')
    .select('id').eq('project_id', PROJECT_ID);
  const assetIds = (assets || []).map(a => a.id);

  let allUnits = [];
  for (const assetId of assetIds) {
    const units = await fetchAllPaginated('corpus_units', 'id, source_clip_name, start_seconds, end_seconds, media_asset_id, analyses(output_text, output_json)', { media_asset_id: assetId });
    allUnits = allUnits.concat(units);
  }

  console.log(`Total corpus units: ${allUnits.length}`);
  const analyzed = allUnits.filter(u => u.analyses?.[0]?.output_text);
  console.log(`With analyses: ${analyzed.length}`);

  const startTime = Date.now();

  // Step 1: Subject Extraction
  if (!SKIP_SUBJECTS) {
    await step1SubjectExtraction(allUnits);
  } else {
    console.log('\nSkipping subject extraction (--skip-subjects)');
  }

  // Step 2: Scene Materialization
  const scenes = await step2SceneMaterialization(allUnits);

  // Step 3: Scene Synthesis
  if (scenes?.length) {
    await step3SceneSynthesis(scenes, allUnits);
  }

  // Step 4: Day Synthesis
  const dayResults = await step4DaySynthesis(scenes || []);

  // Step 5: Project Synthesis
  await step5ProjectSynthesis(dayResults);

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  await reportProgress('complete', 1, 1, `Corpus context engine complete — ${totalElapsed} minutes`);
  // Clear progress status after a short delay so frontend sees 'complete' before it disappears
  setTimeout(() => clearProgress(), 30000);
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  CORPUS CONTEXT ENGINE COMPLETE              ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`Total time: ${totalElapsed} minutes`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
