#!/usr/bin/env bun
// Transcode worker — runs on Johnny's workhorse Mac.
//
// Polls Supabase for media_uploads rows with transcode_status = 'pending',
// downloads the original file, ffmpeg-transcodes to web-friendly H.264 MP4,
// uploads the result back into the same `media` bucket under
// transcodes/<original-stamp>-<safe-name>.mp4, and updates the row with
// transcode_path + transcode_status = 'done' (or 'error' on failure).
//
// Why a poller on the Mac instead of a Vercel function:
//   - Vercel Functions have a 50 MB code limit; the static ffmpeg binary
//     blows past that.
//   - Vercel Functions cap at 60–300s; transcoding a 1 GB ProRes file
//     can easily take longer.
//   - Johnny already has the workhorse Mac running for Hunter (same pattern).
//   - ffmpeg is local, fast, and free.
//
// Usage:
//   1. Apply the schema: psql $SUPABASE_DB_URL -f supabase-transcode.sql
//      (or paste into the Supabase SQL editor)
//   2. Install ffmpeg if missing: brew install ffmpeg
//   3. Set env: SUPABASE_URL, SUPABASE_SERVICE_KEY (already in .env.local)
//   4. Run: bun tools/transcode-worker.ts
//   5. (Optional) Install as a launchd daemon — see tools/transcode-worker.plist
//
// The worker is intentionally simple: one job at a time, polling every 10s.
// Premiere proxies are usually small (<500 MB) and short, so single-stream
// is plenty. Concurrency can come later if it ever matters.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { mkdtemp, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const POLL_INTERVAL_MS = 10_000;
const BUCKET = 'media';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[transcode-worker] need SUPABASE_URL and SUPABASE_SERVICE_KEY in env');
  process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

interface MediaRow {
  id: string;
  storage_bucket: string;
  storage_path: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  transcode_status: string;
}

// ── Main loop ─────────────────────────────────────────────────────────
async function loop() {
  console.log(`[transcode-worker] starting · polling ${SUPABASE_URL} every ${POLL_INTERVAL_MS / 1000}s`);
  while (true) {
    try {
      const job = await claimNextJob();
      if (job) {
        await processJob(job);
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      console.error('[transcode-worker] loop error:', err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

// Atomically claim the oldest pending row by flipping it to 'processing'.
// Postgres update-with-where avoids two workers grabbing the same row.
async function claimNextJob(): Promise<MediaRow | null> {
  // Find a candidate.
  const { data: candidates, error } = await supabase
    .from('media_uploads')
    .select('id, storage_bucket, storage_path, filename, mime_type, size_bytes, transcode_status')
    .eq('transcode_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`fetch candidates: ${error.message}`);
  if (!candidates || candidates.length === 0) return null;
  const row = candidates[0] as MediaRow;

  // Atomic flip — only succeeds if status is still 'pending'.
  const { data: claimed, error: updateErr } = await supabase
    .from('media_uploads')
    .update({
      transcode_status: 'processing',
      transcode_started_at: new Date().toISOString(),
      transcode_error: null,
    })
    .eq('id', row.id)
    .eq('transcode_status', 'pending')
    .select()
    .maybeSingle();
  if (updateErr) throw new Error(`claim: ${updateErr.message}`);
  if (!claimed) return null; // someone else got it
  return row;
}

async function processJob(row: MediaRow): Promise<void> {
  const startedAt = Date.now();
  const sizeMb = row.size_bytes ? (row.size_bytes / 1024 / 1024).toFixed(1) : '?';
  console.log(`[transcode-worker] picked up ${row.id} · ${row.filename} (${sizeMb} MB)`);

  let workDir: string | null = null;
  try {
    workDir = await mkdtemp(join(tmpdir(), 'transcode-'));
    const inputPath = join(workDir, 'input' + extOf(row.filename));
    const outputPath = join(workDir, 'output.mp4');

    // 1) Download original from Storage.
    await downloadFromStorage(row.storage_bucket || BUCKET, row.storage_path, inputPath);
    console.log(`[transcode-worker] downloaded → ${inputPath}`);

    // 2) Transcode with ffmpeg. H.264 baseline + AAC, web-friendly defaults.
    //    -movflags +faststart so the moov atom is at the head (browsers can
    //    start playback before the full file lands).
    //    Scale to max 1280px wide (most proxies are smaller anyway).
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-vf', "scale='min(1280,iw)':'-2'",
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ]);
    console.log('[transcode-worker] ffmpeg done');

    // 3) Upload result back to Storage under transcodes/.
    const transcodePath = `transcodes/${row.storage_path.replace(/\.[^.]+$/, '')}.mp4`;
    await uploadToStorage(row.storage_bucket || BUCKET, transcodePath, outputPath);
    console.log(`[transcode-worker] uploaded → ${transcodePath}`);

    // 4) Mark done.
    const { error: doneErr } = await supabase
      .from('media_uploads')
      .update({
        transcode_status: 'done',
        transcode_path: transcodePath,
        transcode_completed_at: new Date().toISOString(),
        transcode_error: null,
      })
      .eq('id', row.id);
    if (doneErr) throw new Error(`mark done: ${doneErr.message}`);

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[transcode-worker] ✓ ${row.id} done in ${elapsed}s`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[transcode-worker] ✗ ${row.id}:`, msg);
    await supabase
      .from('media_uploads')
      .update({
        transcode_status: 'error',
        transcode_error: msg.slice(0, 1000),
        transcode_completed_at: new Date().toISOString(),
      })
      .eq('id', row.id);
  } finally {
    if (workDir) {
      try { await rm(workDir, { recursive: true, force: true }); } catch {}
    }
  }
}

// ── Storage helpers ───────────────────────────────────────────────────
async function downloadFromStorage(bucket: string, path: string, destPath: string): Promise<void> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`download ${path}: ${error.message}`);
  if (!data) throw new Error(`download ${path}: empty body`);
  const buffer = Buffer.from(await data.arrayBuffer());
  await Bun.write(destPath, buffer);
}

async function uploadToStorage(bucket: string, path: string, srcPath: string): Promise<void> {
  const file = Bun.file(srcPath);
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: 'video/mp4',
    upsert: true,
  });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

// ── ffmpeg ────────────────────────────────────────────────────────────
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      // Stream progress to console (ffmpeg writes progress to stderr).
      const last = chunk.toString().trim().split('\n').pop();
      if (last && /time=/.test(last)) process.stdout.write(`\r  ffmpeg: ${last.slice(0, 100)}   `);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      process.stdout.write('\n');
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// ── utils ─────────────────────────────────────────────────────────────
function extOf(filename: string): string {
  const m = filename.match(/(\.[^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── kickoff ───────────────────────────────────────────────────────────
loop().catch((err) => {
  console.error('[transcode-worker] fatal:', err);
  process.exit(1);
});
