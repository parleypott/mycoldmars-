#!/usr/bin/env node
/**
 * Backfill analyses for raw corpus units that were created but never analyzed.
 * Downloads from Dropbox, uploads to Gemini, runs full analysis pipeline.
 *
 * Usage: node hunter/worker/backfill-analyses.mjs [--limit N] [--min-duration S]
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const envPath = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const l of lines) {
    const m = l.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

import { createClient } from '@supabase/supabase-js';
import { downloadFile, getMetadata } from './dropbox-client.js';
import { uploadFile, deleteFile, analyzeUnit, analyzeUnitStructured, transcribeVideo, generateEmbedding } from './gemini-client.js';
import { stat } from 'node:fs/promises';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CACHE_DIR = join(process.env.HOME, 'hunter-cache');
const PROJECT_ID = 'd745ee49-0ac1-47c7-b81e-94082ed25fed';
const RAW_ASSET = '51c7af61-6c96-419f-a242-638ef0063324';
const DROPBOX_FOLDER = '/02 JOHNNY/01 YOUTUBE VIDEOS/00 PROJECT ARCHIVE/209 SAUDI ARABIA/FOOTAGE/_PROXY';
const CONCURRENCY = parseInt(process.env.HUNTER_CONCURRENCY || '5');

// Parse args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
const minDurIdx = args.indexOf('--min-duration');
const MIN_DURATION = minDurIdx >= 0 ? parseInt(args[minDurIdx + 1]) : 0;

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
    if (error) throw new Error(`Fetch error: ${error.message}`);
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return all;
}

// Track consecutive 503s globally to detect sustained outage
let consecutive503s = 0;

async function retryWithBackoff(fn, label, maxRetries = 5) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const result = await fn();
      consecutive503s = 0; // Reset on success
      return result;
    } catch (err) {
      const msg = err.message || '';
      if (i < maxRetries && (msg.includes('429') || msg.includes('503') || msg.includes('RESOURCE_EXHAUSTED'))) {
        consecutive503s++;
        // Base wait: 15s, 30s, 60s, 120s, 240s — much more patient
        const baseWait = Math.pow(2, i) * 15;
        // If sustained outage (many consecutive 503s), add extra cooldown
        const extraWait = consecutive503s > 10 ? 60 : 0;
        const wait = baseWait + extraWait;
        console.log(`[backfill] ${label} retry ${i + 1}/${maxRetries} in ${wait}s (503 streak: ${consecutive503s})`);
        await new Promise(r => setTimeout(r, wait * 1000));
      } else {
        throw err;
      }
    }
  }
}

function getDuration(filePath) {
  try {
    const out = execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`, { timeout: 30000 });
    return parseFloat(out.toString().trim()) || 0;
  } catch {
    return 0;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  HUNTER RAW ANALYSIS BACKFILL        ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Get project context
  const { data: project } = await supabase.from('hunter_projects')
    .select('metadata').eq('id', PROJECT_ID).single();
  const projectContext = project?.metadata?.context || null;

  // Find raw units without analyses
  console.log('Scanning for missing analyses...');

  const allRawUnits = await fetchAllPaginated('corpus_units', 'id, source_clip_name, start_seconds, end_seconds', { media_asset_id: RAW_ASSET });
  console.log(`Total raw units: ${allRawUnits.length}`);

  // Get all analyzed unit IDs (batch 200 at a time for .in() compatibility)
  const analyzedIds = new Set();
  for (let i = 0; i < allRawUnits.length; i += 200) {
    const batch = allRawUnits.slice(i, i + 200).map(u => u.id);
    const { data } = await supabase.from('analyses').select('corpus_unit_id').in('corpus_unit_id', batch);
    if (data) for (const d of data) analyzedIds.add(d.corpus_unit_id);
  }

  let missing = allRawUnits.filter(u => !analyzedIds.has(u.id));
  console.log(`Missing analyses: ${missing.length}`);

  // Filter by duration
  if (MIN_DURATION > 0) {
    missing = missing.filter(u => (u.end_seconds - u.start_seconds) >= MIN_DURATION);
    console.log(`After min-duration filter (${MIN_DURATION}s): ${missing.length}`);
  }

  // Apply limit
  if (LIMIT < missing.length) {
    missing = missing.slice(0, LIMIT);
    console.log(`Limited to: ${missing.length}`);
  }

  if (missing.length === 0) {
    console.log('Nothing to backfill!');
    return;
  }

  const projectDir = join(CACHE_DIR, PROJECT_ID);
  mkdirSync(projectDir, { recursive: true });

  let success = 0;
  let failed = 0;
  const startTime = Date.now();

  // Progress reporter
  const progressInterval = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const rate = success > 0 ? (elapsed / success).toFixed(1) : '?';
    console.log(`[backfill] ── PROGRESS: ${success} ok, ${failed} fail, ${success + failed}/${missing.length} total, ${elapsed}min elapsed, ${rate}min/clip ──`);
  }, 120000); // Every 2 min

  // Use concurrency=1 during 503 storms, scale up when API recovers
  function getEffectiveConcurrency() {
    return consecutive503s > 5 ? 1 : CONCURRENCY;
  }

  const limit = createPool(CONCURRENCY);

  await Promise.allSettled(missing.map(unit => limit(async () => {
    // Pause if in sustained outage — don't pile up more requests
    if (consecutive503s > 15) {
      const cooldown = 120;
      console.log(`[backfill] ${unit.source_clip_name}: sustained outage, cooling down ${cooldown}s...`);
      await new Promise(r => setTimeout(r, cooldown * 1000));
    }
    const localPath = join(projectDir, unit.source_clip_name);
    try {
      // Download from Dropbox with size verification
      const dropboxPath = `${DROPBOX_FOLDER}/${unit.source_clip_name}`;
      if (!existsSync(localPath)) {
        for (let dl = 0; dl < 2; dl++) {
          await downloadFile(dropboxPath, localPath);
          // Verify file size matches Dropbox metadata
          try {
            const meta = await getMetadata(dropboxPath);
            const local = await stat(localPath);
            if (meta.size && local.size < meta.size * 0.95) {
              console.log(`[backfill] ${unit.source_clip_name}: incomplete download (${local.size}/${meta.size}), retrying...`);
              await rm(localPath, { force: true });
              continue;
            }
          } catch {}
          break;
        }
      }

      // Re-probe duration if it was 0
      let duration = unit.end_seconds - unit.start_seconds;
      if (duration <= 0) {
        duration = getDuration(localPath);
        if (duration > 0) {
          await supabase.from('corpus_units')
            .update({ end_seconds: duration })
            .eq('id', unit.id);
        }
      }

      // Upload to Gemini
      const file = await uploadFile(localPath);

      // Transcription-first pass
      let transcript = null;
      try {
        transcript = await retryWithBackoff(
          () => transcribeVideo({ fileUri: file.uri }),
          `${unit.source_clip_name}-transcript`
        );
      } catch (txErr) {
        // Non-fatal
      }

      // Narrative analysis
      const result = await retryWithBackoff(
        () => analyzeUnit({ fileUri: file.uri, startSeconds: 0, endSeconds: duration, projectContext, transcript }),
        unit.source_clip_name
      );

      // Structured analysis
      let structured = null;
      try {
        structured = await retryWithBackoff(
          () => analyzeUnitStructured({ fileUri: file.uri, startSeconds: 0, endSeconds: duration, projectContext, transcript }),
          `${unit.source_clip_name}-structured`
        );
      } catch {}

      await deleteFile(file.name);

      // Save analysis
      await supabase.from('analyses').insert({
        corpus_unit_id: unit.id,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        prompt_version: 'v3-training-grounded',
        output_text: result.text,
        output_json: structured,
        cost_usd: 0,
      });

      // Generate embedding
      try {
        const embedding = await generateEmbedding(result.text);
        await supabase.from('embeddings').insert({
          corpus_unit_id: unit.id,
          model: 'gemini-embedding-001',
          embedding: embedding,
        });
      } catch {}

      success++;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`[backfill] ✓ ${unit.source_clip_name} (${success + failed}/${missing.length}, ${elapsed}s elapsed)`);
    } catch (err) {
      failed++;
      console.error(`[backfill] ✗ ${unit.source_clip_name}: ${err.message?.slice(0, 80)}`);
    } finally {
      try { await rm(localPath, { force: true }); } catch {}
    }
  })));

  clearInterval(progressInterval);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  BACKFILL COMPLETE                    ║`);
  console.log(`╚══════════════════════════════════════╝`);
  console.log(`Success: ${success} | Failed: ${failed} | Time: ${elapsed}s`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
