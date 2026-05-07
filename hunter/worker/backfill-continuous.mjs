#!/usr/bin/env node
/**
 * Continuous backfill wrapper — runs backfill-analyses.mjs in batches
 * until 100% coverage or no more missing units.
 *
 * Usage: node hunter/worker/backfill-continuous.mjs [--batch-size 200] [--cooldown 30]
 *
 * Options:
 *   --batch-size N   Clips per batch (default: 200)
 *   --cooldown N     Seconds between batches (default: 30)
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1]) : defaultVal;
}

const BATCH_SIZE = getArg('batch-size', 200);
const COOLDOWN = getArg('cooldown', 30);
const SCRIPT = join(import.meta.dirname, 'backfill-analyses.mjs');

let totalSuccess = 0;
let totalFailed = 0;
let batchNum = 0;
let shuttingDown = false;

process.on('SIGINT', () => {
  shuttingDown = true;
  console.log('\n[continuous] Stopping after current batch...');
});
process.on('SIGTERM', () => {
  shuttingDown = true;
  console.log('\n[continuous] Stopping after current batch...');
});

function runBatch() {
  return new Promise((resolve) => {
    batchNum++;
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  BATCH ${batchNum} — ${BATCH_SIZE} clips`);
    console.log(`${'═'.repeat(50)}\n`);

    const child = execFile('node', [SCRIPT, '--limit', String(BATCH_SIZE)], {
      cwd: join(import.meta.dirname, '..', '..'),
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const output = stdout + stderr;
      process.stdout.write(output);

      // Parse results
      const successMatch = output.match(/Success:\s*(\d+)/);
      const failedMatch = output.match(/Failed:\s*(\d+)/);
      const missingMatch = output.match(/Missing analyses:\s*(\d+)/);

      const batchSuccess = successMatch ? parseInt(successMatch[1]) : 0;
      const batchFailed = failedMatch ? parseInt(failedMatch[1]) : 0;
      const missing = missingMatch ? parseInt(missingMatch[1]) : null;

      totalSuccess += batchSuccess;
      totalFailed += batchFailed;

      resolve({ batchSuccess, batchFailed, missing });
    });

    // Forward SIGINT to child
    process.on('SIGINT', () => child.kill('SIGINT'));
  });
}

function sleep(seconds) {
  return new Promise(r => setTimeout(r, seconds * 1000));
}

// Main loop
console.log('╔══════════════════════════════════════════╗');
console.log('║  HUNTER CONTINUOUS BACKFILL              ║');
console.log(`║  batch size: ${BATCH_SIZE}, cooldown: ${COOLDOWN}s${' '.repeat(Math.max(0, 15 - String(BATCH_SIZE).length - String(COOLDOWN).length))}║`);
console.log('╚══════════════════════════════════════════╝');

while (!shuttingDown) {
  const result = await runBatch();

  if (shuttingDown) break;

  // No more missing clips
  if (result.missing !== null && result.missing <= 0) {
    console.log('\n🏁 No more missing analyses — corpus is complete!');
    break;
  }

  // Batch produced nothing (all failed or nothing to do)
  if (result.batchSuccess === 0 && result.batchFailed === 0) {
    console.log('\n⚠ Batch produced no results — stopping.');
    break;
  }

  const remaining = result.missing ? result.missing - result.batchSuccess : '?';
  console.log(`\n[continuous] Batch ${batchNum} done. Total: ${totalSuccess} ok, ${totalFailed} fail. ~${remaining} remaining.`);
  console.log(`[continuous] Cooling down ${COOLDOWN}s before next batch...`);
  await sleep(COOLDOWN);
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`  CONTINUOUS BACKFILL SUMMARY`);
console.log(`  Batches: ${batchNum}`);
console.log(`  Total success: ${totalSuccess}`);
console.log(`  Total failed: ${totalFailed}`);
console.log(`${'═'.repeat(50)}`);
