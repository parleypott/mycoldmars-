#!/usr/bin/env node
/**
 * Hunter API Babysitter
 * Monitors the ingest worker, detects problems, and auto-fixes them.
 * Run alongside the worker — it checks every 2 minutes.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';

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
import { purgeAllFiles } from './gemini-client.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
);

const CHECK_INTERVAL = 2 * 60 * 1000; // 2 minutes
const LOG_FILE = '/tmp/hunter-worker.log';
const CONCURRENCY = parseInt(process.env.HUNTER_CONCURRENCY || '10');

let lastAnalysisCount = 0;
let stallCount = 0;
let lastQuotaPurge = 0;
let consecutiveQuotaErrors = 0;

function log(msg) {
  console.log(`[babysitter ${new Date().toLocaleTimeString()}] ${msg}`);
}

function isWorkerRunning() {
  try {
    const ps = execSync('pgrep -f "node hunter/worker/ingest.js"', { encoding: 'utf8' });
    return ps.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function restartWorker() {
  log('restarting worker...');
  try { execSync('pkill -f "node hunter/worker/ingest.js"'); } catch {}
  execSync('sleep 2');

  // Restart via shell redirect so we don't need to manage streams
  const cwd = join(import.meta.dirname, '..', '..');
  execSync(`HUNTER_CONCURRENCY=${CONCURRENCY} node hunter/worker/ingest.js >> "${LOG_FILE}" 2>&1 &`, {
    cwd,
    shell: true,
    env: { ...process.env, HUNTER_CONCURRENCY: String(CONCURRENCY) },
  });

  // Get the new PID
  try {
    const pid = execSync('pgrep -n -f "node hunter/worker/ingest.js"', { encoding: 'utf8' }).trim();
    log(`worker restarted (PID ${pid})`);
  } catch {
    log('worker restart issued');
  }
}

function getRecentLogErrors() {
  if (!existsSync(LOG_FILE)) return { quota: 0, rateLimit: 0, total: 0, lastLines: [] };
  try {
    // Read last 200 lines of log
    const content = execSync(`tail -200 "${LOG_FILE}"`, { encoding: 'utf8' });
    const lines = content.split('\n');
    const quota = lines.filter(l => l.includes('file_storage_bytes') || l.includes('FileStorageBytes')).length;
    const rateLimit = lines.filter(l => l.includes('429') || l.includes('RESOURCE_EXHAUSTED')).length;
    const total = lines.filter(l => l.includes('✗')).length;
    const successes = lines.filter(l => l.includes('✓')).length;
    return { quota, rateLimit, total, successes, lastLines: lines.slice(-10) };
  } catch {
    return { quota: 0, rateLimit: 0, total: 0, successes: 0, lastLines: [] };
  }
}

async function getProgress() {
  const { count: analyses } = await supabase.from('analyses')
    .select('*', { count: 'exact', head: true });

  const { count: totalUnits } = await supabase.from('corpus_units')
    .select('*', { count: 'exact', head: true });

  const { data: assets } = await supabase.from('media_assets')
    .select('id, queue_status, tier, updated_at');

  const statusCounts = {};
  for (const a of assets || []) {
    statusCounts[a.queue_status] = (statusCounts[a.queue_status] || 0) + 1;
  }

  // Check for stuck assets (intermediate state for > 20 min)
  const stuck = (assets || []).filter(a => {
    if (!['fetching', 'analyzing', 'cached'].includes(a.queue_status)) return false;
    return Date.now() - new Date(a.updated_at).getTime() > 20 * 60 * 1000;
  });

  return { analyses, totalUnits, statusCounts, stuck, assets };
}

async function check() {
  try {
    // 1. Is worker alive?
    const pids = isWorkerRunning();
    if (pids.length === 0) {
      log('PROBLEM: worker is not running — restarting');
      restartWorker();
      return;
    }

    // 2. Check progress
    const progress = await getProgress();
    const newAnalyses = progress.analyses - lastAnalysisCount;
    const statusStr = Object.entries(progress.statusCounts).map(([k, v]) => `${k}:${v}`).join(' ');

    log(`progress: ${progress.analyses} analyses / ${progress.totalUnits} units | assets: ${statusStr} | +${newAnalyses} since last check`);

    // 3. Check for stalls
    if (newAnalyses === 0 && lastAnalysisCount > 0) {
      stallCount++;
      if (stallCount >= 3) {
        log(`PROBLEM: no progress for ${stallCount * 2} minutes — investigating`);

        // Check logs for errors
        const errors = getRecentLogErrors();
        if (errors.quota > 5) {
          log(`diagnosis: storage quota errors (${errors.quota} in recent logs) — purging files`);
          const purged = await purgeAllFiles();
          log(`purged ${purged} files — restarting worker`);
          restartWorker();
          stallCount = 0;
        } else if (errors.rateLimit > 10) {
          log(`diagnosis: rate limiting (${errors.rateLimit} 429s) — backing off, will retry in 5 min`);
          // Don't restart — let the retry logic handle it
          stallCount = 0;
        } else if (progress.stuck.length > 0) {
          log(`diagnosis: ${progress.stuck.length} stuck assets — resetting to pending`);
          for (const a of progress.stuck) {
            await supabase.from('media_assets')
              .update({ queue_status: 'pending', updated_at: new Date().toISOString() })
              .eq('id', a.id);
          }
          stallCount = 0;
        } else {
          log('diagnosis: unknown stall — restarting worker');
          restartWorker();
          stallCount = 0;
        }
      }
    } else {
      stallCount = 0;
    }

    // 4. Check for quota problems in recent logs
    const errors = getRecentLogErrors();
    if (errors.quota > 3 && Date.now() - lastQuotaPurge > 10 * 60 * 1000) {
      consecutiveQuotaErrors++;
      if (consecutiveQuotaErrors >= 2) {
        log(`PROBLEM: persistent quota errors (${errors.quota} recent) — purging Gemini files`);
        const purged = await purgeAllFiles();
        log(`purged ${purged} files`);
        lastQuotaPurge = Date.now();
        consecutiveQuotaErrors = 0;
      }
    } else {
      consecutiveQuotaErrors = 0;
    }

    // 5. Check if all work is done
    const pending = progress.statusCounts['pending'] || 0;
    const fetching = progress.statusCounts['fetching'] || 0;
    const analyzing = progress.statusCounts['analyzing'] || 0;
    if (pending === 0 && fetching === 0 && analyzing === 0) {
      log('all assets done — worker idle');
    }

    lastAnalysisCount = progress.analyses;

  } catch (err) {
    log(`error: ${err.message}`);
  }
}

// Handle being killed gracefully
process.on('SIGINT', () => { log('shutting down'); process.exit(0); });
process.on('SIGTERM', () => { log('shutting down'); process.exit(0); });

log(`starting — checking every ${CHECK_INTERVAL / 1000}s, worker concurrency=${CONCURRENCY}`);
check(); // immediate first check
setInterval(check, CHECK_INTERVAL);
