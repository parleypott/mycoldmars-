#!/usr/bin/env node

/**
 * Hunter ingest worker.
 * Polls Supabase for pending media_assets, fetches from Dropbox/YouTube,
 * uploads to Gemini, runs Flash analysis, generates embeddings.
 *
 * Run: node hunter/worker/ingest.js
 * Requires .env with SUPABASE_URL, SUPABASE_SERVICE_KEY, DROPBOX_ACCESS_TOKEN, GEMINI_API_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { listFolder, downloadFile } from './dropbox-client.js';
import { uploadFile, createCache, analyzeUnit, generateEmbedding } from './gemini-client.js';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

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

const CACHE_DIR = join(process.env.HOME, 'hunter-cache');
const POLL_INTERVAL = 10_000;
const CONCURRENCY = parseInt(process.env.HUNTER_CONCURRENCY || '5');

/** Simple concurrency pool — runs up to N async tasks in parallel. */
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

/**
 * Retry a function with exponential backoff on 429 rate limit errors.
 * Waits the retryDelay from the error response if available.
 */
async function retryWithBackoff(fn, label, maxRetries = 6) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message || '';
      const isRetryable = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand');
      if (!isRetryable || attempt === maxRetries) throw err;

      const delayMatch = msg.match(/retryDelay["\s:]+(\d+)/i) || msg.match(/retry in (\d+)/i);
      const waitSec = delayMatch ? parseInt(delayMatch[1]) + 5 : Math.min(Math.pow(2, attempt + 1) * 5, 120);
      console.log(`[worker] retryable error on ${label}, waiting ${waitSec}s (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
);

async function updateAsset(id, fields) {
  const { error } = await supabase.from('media_assets')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('[worker] updateAsset error:', error.message);
}

async function processAsset(asset) {
  console.log(`[worker] processing ${asset.id} (${asset.tier} / ${asset.source_kind})`);
  await updateAsset(asset.id, { queue_status: 'fetching' });

  // Fetch project context for grounded analysis prompts
  const { data: project } = await supabase.from('hunter_projects')
    .select('name, metadata').eq('id', asset.project_id).single();
  const projectContext = project?.metadata?.context || null;
  if (projectContext) {
    console.log(`[worker] project context loaded (${projectContext.length} chars)`);
  } else {
    console.log(`[worker] ⚠ no project context set — analyses will lack grounding`);
  }

  try {
    let localPath;

    if (asset.source_kind === 'dropbox') {
      localPath = await fetchFromDropbox(asset, projectContext);
    } else if (asset.source_kind === 'youtube') {
      localPath = await fetchFromYoutube(asset);
    } else if (asset.source_kind === 'local') {
      localPath = asset.source_ref;
    }

    if (!localPath) {
      await updateAsset(asset.id, { queue_status: 'error' });
      return;
    }

    await updateAsset(asset.id, { cache_path: localPath, queue_status: 'cached' });

    // For raw tier, analysis is done inline during download pipeline above
    // For other tiers with single files, run analysis separately
    if (asset.tier !== 'raw' && ['mp4', 'mov', 'mxf'].includes(asset.format?.toLowerCase())) {
      await updateAsset(asset.id, { queue_status: 'analyzing' });
      await analyzeVideo(asset.id, localPath, projectContext);
    }

    await updateAsset(asset.id, { queue_status: 'done' });
    console.log(`[worker] ✓ ${asset.id} done`);
  } catch (err) {
    console.error(`[worker] ✗ ${asset.id} error:`, err.message);
    await updateAsset(asset.id, { queue_status: 'error', metadata: { ...asset.metadata, error: err.message } });
  }
}

async function fetchFromDropbox(asset, projectContext) {
  if (asset.tier === 'raw') {
    // List folder, download all video files
    const entries = await listFolder(asset.source_ref);
    const videos = entries.filter(e => !e.isFolder && /\.(mp4|mov|mxf)$/i.test(e.name));
    console.log(`[worker] found ${videos.length} videos in ${asset.source_ref}`);

    const projectDir = join(CACHE_DIR, asset.project_id);
    mkdirSync(projectDir, { recursive: true });

    // Batch-check which clips already have corpus units (instead of per-clip query)
    const { data: existingUnits } = await supabase.from('corpus_units')
      .select('source_clip_name')
      .eq('media_asset_id', asset.id);
    const existingNames = new Set((existingUnits || []).map(u => u.source_clip_name));

    const remaining = videos.filter(v => !existingNames.has(v.name));
    const skipped = videos.length - remaining.length;
    if (skipped > 0) console.log(`[worker] skipping ${skipped} already-processed clips`);

    let processed = skipped;
    const total = videos.length;
    const limit = createPool(CONCURRENCY);

    console.log(`[worker] processing ${remaining.length} clips with concurrency=${CONCURRENCY}`);

    // Process clips concurrently — N at a time via pool
    await Promise.allSettled(remaining.map(video => limit(async () => {
      const localPath = join(projectDir, video.name);
      try {
        // Download
        if (!existsSync(localPath)) {
          await downloadFile(video.path, localPath);
        }

        // Get duration via ffprobe
        const duration = getDuration(localPath);

        // Create corpus unit
        const { data: unit, error } = await supabase.from('corpus_units')
          .insert({
            media_asset_id: asset.id,
            start_seconds: 0,
            end_seconds: duration,
            source_clip_name: video.name,
          })
          .select().single();
        if (error) {
          console.error(`[worker] createCorpusUnit error for ${video.name}:`, error.message);
          return;
        }

        // Upload + analyze (with rate limit retry)
        const file = await uploadFile(localPath);
        const result = await retryWithBackoff(
          () => analyzeUnit({ fileUri: file.uri, startSeconds: 0, endSeconds: duration, projectContext }),
          video.name
        );

        await supabase.from('analyses').insert({
          corpus_unit_id: unit.id,
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          prompt_version: 'v2-training',
          output_text: result.text,
          output_json: null,
          cost_usd: 0,
        });

        processed++;
        console.log(`[worker] ✓ ${video.name} (${processed}/${total}): ${result.text.slice(0, 60)}...`);
      } catch (err) {
        processed++;
        console.error(`[worker] ✗ ${video.name}:`, err.message);
      } finally {
        // Clean up local file to save disk space
        try { (await import('node:fs/promises')).unlink(localPath); } catch {}
      }
    })));

    console.log(`[worker] ✓ all ${processed}/${total} clips processed for ${asset.source_ref}`);
    return projectDir;
  }

  // Single file download
  const localPath = join(CACHE_DIR, asset.project_id, basename(asset.source_ref));
  mkdirSync(join(CACHE_DIR, asset.project_id), { recursive: true });
  if (!existsSync(localPath)) {
    await downloadFile(asset.source_ref, localPath);
  }
  return localPath;
}

async function fetchFromYoutube(asset) {
  const projectDir = join(CACHE_DIR, asset.project_id);
  mkdirSync(projectDir, { recursive: true });
  const outPath = join(projectDir, 'finished.mp4');

  if (!existsSync(outPath)) {
    console.log(`[worker] downloading YouTube: ${asset.source_ref}`);
    execSync(`yt-dlp -f "bestvideo[height<=720]+bestaudio/best[height<=720]" --merge-output-format mp4 -o "${outPath}" "${asset.source_ref}"`, {
      stdio: 'inherit',
    });
  }

  // Get duration and create corpus unit
  const duration = getDuration(outPath);
  await updateAsset(asset.id, { duration_seconds: duration });

  const { error } = await supabase.from('corpus_units')
    .insert({
      media_asset_id: asset.id,
      start_seconds: 0,
      end_seconds: duration,
      source_clip_name: 'finished.mp4',
    });
  if (error) console.error('[worker] createCorpusUnit error:', error.message);

  return outPath;
}

async function analyzeVideo(assetId, localPath, projectContext) {
  // Get all corpus units for this asset
  const { data: units, error } = await supabase.from('corpus_units')
    .select('*').eq('media_asset_id', assetId)
    .order('start_seconds', { ascending: true });
  if (error || !units?.length) return;

  // For each unit with a source clip, upload + analyze
  for (const unit of units) {
    const clipPath = unit.source_clip_name
      ? (existsSync(join(localPath, unit.source_clip_name)) ? join(localPath, unit.source_clip_name) : localPath)
      : localPath;

    // Skip if not a file
    const { statSync } = await import('node:fs');
    const stat = statSync(clipPath);
    if (stat.isDirectory()) continue;

    try {
      // Upload to Gemini File API
      const file = await uploadFile(clipPath);

      // Run Flash analysis
      const result = await analyzeUnit({
        fileUri: file.uri,
        startSeconds: unit.start_seconds,
        endSeconds: unit.end_seconds,
        projectContext,
      });

      // Save analysis
      await supabase.from('analyses').insert({
        corpus_unit_id: unit.id,
        model: 'gemini-2.5-flash',
        prompt_version: 'v2-training',
        output_text: result.text,
        output_json: null,
        cost_usd: 0,
      });

      // Generate embedding
      const embedding = await generateEmbedding(result.text);
      await supabase.from('embeddings').insert({
        corpus_unit_id: unit.id,
        model: 'text-embedding-004',
        embedding: embedding,
      });

      console.log(`[worker] analyzed unit ${unit.id}: ${result.text.slice(0, 80)}...`);
    } catch (err) {
      console.error(`[worker] analysis failed for unit ${unit.id}:`, err.message);
    }
  }
}

function getDuration(filePath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf8' }
    );
    return Math.round(parseFloat(out.trim()));
  } catch {
    return 0;
  }
}

// ── Poll loop ──

async function poll() {
  const { data: pending, error } = await supabase.from('media_assets')
    .select('*')
    .eq('queue_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5);

  if (error) {
    console.error('[worker] poll error:', error.message);
    return;
  }

  if (pending?.length > 0) {
    console.log(`[worker] ${pending.length} pending assets`);
    for (const asset of pending) {
      await processAsset(asset);
    }
  }
}

console.log('[hunter worker] starting, cache dir:', CACHE_DIR);
mkdirSync(CACHE_DIR, { recursive: true });

// Run immediately, then poll
poll();
setInterval(poll, POLL_INTERVAL);
