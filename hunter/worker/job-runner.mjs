#!/usr/bin/env node
/**
 * Hunter Job Runner — daemon that polls Supabase for pending jobs and executes them.
 * Runs on the local worker Mac. Start and forget:
 *
 *   node hunter/worker/job-runner.mjs
 *
 * Or with pm2:
 *   pm2 start hunter/worker/job-runner.mjs --name hunter-jobs
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Load env
const envPath = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const l of lines) {
    const m = l.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
);

const POLL_INTERVAL = 5000; // 5 seconds
const WORKER_DIR = import.meta.dirname;
const ROOT_DIR = join(WORKER_DIR, '..', '..');
const CACHE_DIR = join(process.env.HOME, 'hunter-cache', 'uploads');
mkdirSync(CACHE_DIR, { recursive: true });

let currentJob = null;

// ── Job type handlers ──

const JOB_HANDLERS = {
  async ingest_selects(job) {
    const { projectId, storagePath, fileName } = job.params;
    if (!storagePath) throw new Error('No storagePath provided');

    await updateProgress(job.id, { phase: 'downloading', pct: 5, message: `Downloading ${fileName || 'XML'}...` });

    // Download from Supabase storage
    const { data, error } = await supabase.storage.from('hunter-uploads').download(storagePath);
    if (error) throw new Error(`Storage download failed: ${error.message}`);

    const xmlContent = await data.text();
    const localPath = join(CACHE_DIR, `selects-${job.id}.xml`);
    writeFileSync(localPath, xmlContent);

    await updateProgress(job.id, { phase: 'ingesting', pct: 10, message: `Ingesting ${fileName || 'XML'}...` });

    // Run ingest-selects.mjs
    const result = await runScript('ingest-selects.mjs', [localPath, projectId || ''], job.id);
    return { output: result.slice(-2000) };
  },

  async compute_decisions(job) {
    const { projectId } = job.params;
    if (!projectId) throw new Error('No projectId provided');

    await updateProgress(job.id, { phase: 'matching', pct: 10, message: 'Cross-referencing raw vs selects...' });

    const result = await runScript('cross-tier-matching.mjs', [], job.id, `
      import { computeAndPersistDecisions } from './cross-tier-matching.mjs';
      const r = await computeAndPersistDecisions('${projectId}');
      console.log(JSON.stringify(r));
    `);
    return { output: result.slice(-2000) };
  },

  async train_taste(job) {
    await updateProgress(job.id, { phase: 'training', pct: 10, message: 'Training taste profile...' });
    const result = await runScript('build-taste-profile.mjs', [], job.id);
    return { output: result.slice(-2000) };
  },

  async run_synthesis(job) {
    const { projectId, force, skipSubjects } = job.params;
    if (!projectId) throw new Error('No projectId provided');

    const args = ['--project-id', projectId];
    if (force) args.push('--force');
    if (skipSubjects) args.push('--skip-subjects');

    await updateProgress(job.id, { phase: 'synthesis', pct: 5, message: 'Starting corpus context engine...' });
    const result = await runScript('build-corpus-context.mjs', args, job.id);
    return { output: result.slice(-2000) };
  },

  async backfill_analyses(job) {
    const { projectId } = job.params;
    const args = projectId ? ['--project-id', projectId] : [];

    await updateProgress(job.id, { phase: 'backfill', pct: 5, message: 'Backfilling analyses...' });
    const result = await runScript('backfill-analyses.mjs', args, job.id);
    return { output: result.slice(-2000) };
  },
};

// ── Run a worker script as a subprocess ──

function runScript(scriptName, args, jobId, inlineCode) {
  return new Promise((resolve, reject) => {
    const scriptPath = join(WORKER_DIR, scriptName);
    let proc;

    if (inlineCode) {
      // Run inline code with proper env loading
      const wrapper = `
        import { readFileSync, existsSync } from 'node:fs';
        import { join } from 'node:path';
        const envPath = '${envPath}';
        if (existsSync(envPath)) {
          const lines = readFileSync(envPath, 'utf8').split('\\n');
          for (const l of lines) { const m = l.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
        }
        process.chdir('${WORKER_DIR}');
        ${inlineCode}
      `;
      proc = spawn('node', ['--input-type=module', '-e', wrapper], {
        cwd: WORKER_DIR,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      proc = spawn('node', [scriptPath, ...args], {
        cwd: ROOT_DIR,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    let output = '';
    let lastProgressUpdate = 0;

    function parseProgress(line) {
      // Parse progress lines from the various scripts
      const pctMatch = line.match(/(\d+)%/);
      const phaseMatch = line.match(/\[([\w_]+)\]/);
      if (pctMatch && Date.now() - lastProgressUpdate > 3000) {
        lastProgressUpdate = Date.now();
        const pct = parseInt(pctMatch[1]);
        const phase = phaseMatch ? phaseMatch[1] : 'running';
        const message = line.replace(/^\s*/, '').slice(0, 200);
        updateProgress(jobId, { phase, pct, message }).catch(() => {});
      }
    }

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      text.split('\n').forEach(parseProgress);
      process.stdout.write(`[job:${jobId.slice(0, 8)}] ${text}`);
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      text.split('\n').forEach(parseProgress);
      // Filter out the MODULE_TYPELESS warning
      if (!text.includes('MODULE_TYPELESS')) {
        process.stderr.write(`[job:${jobId.slice(0, 8)}] ${text}`);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Script ${scriptName} exited with code ${code}\n${output.slice(-500)}`));
    });

    proc.on('error', reject);
  });
}

// ── Progress & status helpers ──

async function updateProgress(jobId, progress) {
  await supabase.from('hunter_jobs').update({ progress }).eq('id', jobId);
}

async function markRunning(jobId) {
  await supabase.from('hunter_jobs').update({
    status: 'running',
    started_at: new Date().toISOString(),
  }).eq('id', jobId);
}

async function markCompleted(jobId, result) {
  await supabase.from('hunter_jobs').update({
    status: 'completed',
    result: result || {},
    progress: { phase: 'complete', pct: 100, message: 'Done' },
    completed_at: new Date().toISOString(),
  }).eq('id', jobId);
}

async function markFailed(jobId, error) {
  await supabase.from('hunter_jobs').update({
    status: 'failed',
    error: String(error).slice(0, 2000),
    progress: { phase: 'failed', pct: 0, message: String(error).slice(0, 200) },
    completed_at: new Date().toISOString(),
  }).eq('id', jobId);
}

// ── Poll loop ──

async function pollOnce() {
  if (currentJob) return; // already running a job

  // Grab oldest pending job
  const { data: jobs } = await supabase.from('hunter_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (!jobs?.length) return;

  const job = jobs[0];
  currentJob = job.id;

  console.log(`\n[runner] Picked up job ${job.id.slice(0, 8)}: ${job.type}`);

  try {
    await markRunning(job.id);

    const handler = JOB_HANDLERS[job.type];
    if (!handler) throw new Error(`Unknown job type: ${job.type}`);

    const result = await handler(job);
    await markCompleted(job.id, result);
    console.log(`[runner] Job ${job.id.slice(0, 8)} completed`);
  } catch (err) {
    console.error(`[runner] Job ${job.id.slice(0, 8)} failed:`, err.message);
    await markFailed(job.id, err.message);
  } finally {
    currentJob = null;
  }
}

// ── Main ──

console.log('╔═══════════════════════════════════╗');
console.log('║  HUNTER JOB RUNNER                ║');
console.log('║  Polling for jobs every 5s...      ║');
console.log('╚═══════════════════════════════════╝');

// Heartbeat: update a status row so the UI knows the worker is online
async function heartbeat() {
  await supabase.from('hunter_jobs').upsert({
    id: '00000000-0000-0000-0000-000000000000',
    type: '_heartbeat',
    status: 'running',
    progress: { online: true, timestamp: new Date().toISOString(), currentJob },
    started_at: new Date().toISOString(),
  }, { onConflict: 'id' });
}

setInterval(async () => {
  try {
    await pollOnce();
  } catch (err) {
    console.error('[runner] Poll error:', err.message);
  }
}, POLL_INTERVAL);

// Heartbeat every 30s
setInterval(() => heartbeat().catch(() => {}), 30000);
heartbeat().catch(() => {});

// Keep alive
process.on('SIGINT', () => { console.log('\n[runner] Shutting down...'); process.exit(0); });
