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
import { uploadFile, createCache, analyzeUnit, analyzeScript, generateEmbedding } from './gemini-client.js';
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
const WATCHDOG_INTERVAL = 10 * 60 * 1000; // 10 minutes
const STUCK_THRESHOLD = 15 * 60 * 1000;   // 15 minutes
let lastProgressAt = Date.now();

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
    } else if (asset.source_kind === 'google_docs') {
      await processGoogleDoc(asset, projectContext);
      await updateAsset(asset.id, { queue_status: 'done' });
      console.log(`[worker] ✓ ${asset.id} done (google_docs)`);
      return;
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
        lastProgressAt = Date.now();
        console.log(`[worker] ✓ ${video.name} (${processed}/${total}): ${result.text.slice(0, 60)}...`);
      } catch (err) {
        processed++;
        console.error(`[worker] ✗ ${video.name}:`, err.message);
      } finally {
        // Clean up local file to save disk space
        try { const { rm } = await import('node:fs/promises'); await rm(localPath, { force: true }); } catch {}
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
        model: 'gemini-embedding-001',
        embedding: embedding,
      });

      console.log(`[worker] analyzed unit ${unit.id}: ${result.text.slice(0, 80)}...`);
    } catch (err) {
      console.error(`[worker] analysis failed for unit ${unit.id}:`, err.message);
    }
  }
}

// ── Google Docs script ingestion ──

function extractDocId(url) {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error(`Can't extract doc ID from: ${url}`);
  return match[1];
}

async function fetchGoogleDocText(sourceRef) {
  const docId = extractDocId(sourceRef);
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  console.log(`[worker] fetching Google Doc ${docId} as plain text...`);

  const resp = await fetch(exportUrl);
  if (!resp.ok) {
    throw new Error(`Google Docs export failed (${resp.status}): ${resp.statusText}. Make sure the doc is publicly accessible or "anyone with link".`);
  }

  const text = await resp.text();
  console.log(`[worker] fetched ${text.length} chars from Google Doc`);
  return text;
}

/**
 * Pre-process a Google Docs two-column script export.
 *
 * Google Docs tables export to plain text with tab-prefixed lines for cell content.
 * Rather than trying to perfectly parse the inconsistent cell boundaries, we mark
 * tab-prefixed lines as table cells and add a structural header so the AI understands
 * this is a two-column script with voice/visual pairing.
 */
function parseTwoColumnScript(text) {
  const lines = text.split('\n');
  const output = [];
  let inTableSection = false;
  let cellBuffer = [];

  function flushBuffer() {
    if (cellBuffer.length === 0) return;
    // Group consecutive cells into pairs (voice, visual)
    // In Google Docs export, cells alternate: left col (voice), right col (visual)
    for (let i = 0; i < cellBuffer.length; i += 2) {
      const a = cellBuffer[i]?.trim();
      const b = cellBuffer[i + 1]?.trim();
      if (!a && !b) continue;
      output.push('---BEAT---');
      if (a) output.push(`COL_A: ${a}`);
      if (b) output.push(`COL_B: ${b}`);
    }
    cellBuffer = [];
  }

  let currentCell = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTab = line.startsWith('\t');
    const content = isTab ? line.slice(1).trim() : '';

    if (isTab) {
      if (!inTableSection) {
        inTableSection = true;
        currentCell = [];
      }

      if (content === '') {
        // Empty tab line = cell boundary
        if (currentCell.length > 0) {
          cellBuffer.push(currentCell.join(' '));
          currentCell = [];
        }
      } else {
        currentCell.push(content);
      }
    } else {
      // Non-tab line
      if (inTableSection) {
        // Could be content overflow from a cell
        if (currentCell.length > 0 && line.trim() !== '') {
          currentCell.push(line.trim());
        } else {
          // End of cell / row
          if (currentCell.length > 0) {
            cellBuffer.push(currentCell.join(' '));
            currentCell = [];
          }
          if (line.trim() === '') {
            // Blank line after tab section — could be row boundary, continue looking
          } else {
            // Real non-table content
            flushBuffer();
            inTableSection = false;
            output.push(line);
          }
        }
      } else {
        output.push(line);
      }
    }
  }

  // Flush remaining
  if (currentCell.length > 0) cellBuffer.push(currentCell.join(' '));
  flushBuffer();

  return output.join('\n');
}

/**
 * Split a script into chunks by scene headings or by size.
 * First parses two-column table structure if present, then chunks.
 */
function chunkScript(rawText, maxChars = 4000) {
  // Detect and parse two-column script format (tab-prefixed table cells)
  const hasTableStructure = rawText.split('\n').filter(l => l.startsWith('\t')).length > 20;
  const text = hasTableStructure ? parseTwoColumnScript(rawText) : rawText;

  if (hasTableStructure) {
    console.log(`[worker] detected two-column script format, reconstructed ${text.length} chars`);
  }

  const lines = text.split('\n');
  const chunks = [];
  let current = { title: 'Opening', lines: [] };

  for (const line of lines) {
    // Scene heading patterns: INT., EXT., SCENE, ACT, CHAPTER, or all-caps lines > 10 chars that look like headings
    const isHeading = /^\s*(INT\.|EXT\.|SCENE\s|ACT\s|CHAPTER\s)/i.test(line)
      || (/^[A-Z][A-Z\s\d:—–-]{10,}$/.test(line.trim()) && line.trim().length < 80);

    if (isHeading && current.lines.length > 0) {
      chunks.push({ title: current.title, text: current.lines.join('\n') });
      current = { title: line.trim().slice(0, 80), lines: [line] };
    } else {
      current.lines.push(line);
      // Also split on size if a section gets too long
      if (current.lines.join('\n').length > maxChars) {
        chunks.push({ title: current.title, text: current.lines.join('\n') });
        current = { title: `${current.title} (cont.)`, lines: [] };
      }
    }
  }

  if (current.lines.length > 0) {
    chunks.push({ title: current.title, text: current.lines.join('\n') });
  }

  // Filter out tiny chunks (whitespace-only, etc.)
  return chunks.filter(c => c.text.trim().length > 50);
}

async function processGoogleDoc(asset, projectContext) {
  await updateAsset(asset.id, { queue_status: 'fetching' });

  const fullText = await fetchGoogleDocText(asset.source_ref);

  // Save full text to cache
  const projectDir = join(CACHE_DIR, asset.project_id);
  mkdirSync(projectDir, { recursive: true });
  const cachePath = join(projectDir, `script-${asset.id.slice(0, 8)}.txt`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(cachePath, fullText);
  await updateAsset(asset.id, { cache_path: cachePath });

  // Chunk the script
  const chunks = chunkScript(fullText);
  console.log(`[worker] script chunked into ${chunks.length} sections`);

  await updateAsset(asset.id, { queue_status: 'analyzing' });

  // Batch-check which sections already have corpus units
  const { data: existingUnits } = await supabase.from('corpus_units')
    .select('source_clip_name')
    .eq('media_asset_id', asset.id);
  const existingNames = new Set((existingUnits || []).map(u => u.source_clip_name));

  const limit = createPool(CONCURRENCY);
  let processed = 0;
  const total = chunks.length;

  await Promise.allSettled(chunks.map((chunk, i) => limit(async () => {
    const sectionName = `section-${String(i + 1).padStart(3, '0')}`;

    if (existingNames.has(sectionName)) {
      processed++;
      return; // already done
    }

    try {
      // Create corpus unit (start_seconds/end_seconds represent char offsets for scripts)
      const charOffset = fullText.indexOf(chunk.text);
      const { data: unit, error } = await supabase.from('corpus_units')
        .insert({
          media_asset_id: asset.id,
          start_seconds: charOffset,
          end_seconds: charOffset + chunk.text.length,
          source_clip_name: sectionName,
        })
        .select().single();

      if (error) {
        console.error(`[worker] corpus unit error for ${sectionName}:`, error.message);
        return;
      }

      // Analyze with script-specific prompt (with rate limit retry)
      const result = await retryWithBackoff(
        () => analyzeScript({ text: chunk.text, sectionTitle: chunk.title, projectContext }),
        sectionName
      );

      // Save analysis
      await supabase.from('analyses').insert({
        corpus_unit_id: unit.id,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        prompt_version: 'v1-script-training',
        output_text: result.text,
        output_json: null,
        cost_usd: 0,
      });

      // Generate embedding
      const embedding = await generateEmbedding(result.text);
      await supabase.from('embeddings').insert({
        corpus_unit_id: unit.id,
        model: 'gemini-embedding-001',
        embedding: embedding,
      });

      processed++;
      lastProgressAt = Date.now();
      console.log(`[worker] ✓ script ${sectionName} "${chunk.title}" (${processed}/${total}): ${result.text.slice(0, 60)}...`);
    } catch (err) {
      processed++;
      console.error(`[worker] ✗ script ${sectionName}:`, err.message);
    }
  })));

  console.log(`[worker] ✓ script ingestion complete: ${processed}/${total} sections`);
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

// ── Watchdog — self-healing for stuck assets ──

async function watchdog(isStartup = false) {
  try {
    // Find assets stuck in intermediate states
    const { data: stuck } = await supabase.from('media_assets')
      .select('id, queue_status, updated_at')
      .in('queue_status', ['fetching', 'analyzing', 'cached']);

    if (stuck?.length) {
      const now = Date.now();
      let resetCount = 0;

      for (const asset of stuck) {
        const age = now - new Date(asset.updated_at).getTime();
        // On startup: reset everything (no other worker is running)
        // On interval: only reset if stuck > 15 min
        if (isStartup || age > STUCK_THRESHOLD) {
          console.log(`[watchdog] resetting stuck asset ${asset.id} (${asset.queue_status}${isStartup ? ', startup recovery' : ` for ${Math.round(age / 60000)}min`})`);
          await updateAsset(asset.id, { queue_status: 'pending' });
          resetCount++;
        }
      }

      if (resetCount > 0) console.log(`[watchdog] reset ${resetCount} stuck asset(s) → pending`);
    }

    // Warn if no clips have completed in a while (skip on startup)
    if (!isStartup) {
      const silent = Date.now() - lastProgressAt;
      if (silent > WATCHDOG_INTERVAL) {
        console.log(`[watchdog] ⚠ no successful analysis in ${Math.round(silent / 60000)} minutes — may be stalled`);
      }
    }
  } catch (err) {
    console.error('[watchdog] error:', err.message);
  }
}

// ── Global error handlers — keep the process alive ──

process.on('uncaughtException', (err) => {
  console.error('[worker] uncaught exception (continuing):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandled rejection (continuing):', reason?.message || reason);
});

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

console.log('[hunter worker] starting, cache dir:', CACHE_DIR, `concurrency=${CONCURRENCY}`);
mkdirSync(CACHE_DIR, { recursive: true });

// Run watchdog immediately on startup — aggressively reset anything stuck from previous crash
await watchdog(true);

// Run immediately, then poll
poll();
setInterval(poll, POLL_INTERVAL);
setInterval(watchdog, WATCHDOG_INTERVAL);
