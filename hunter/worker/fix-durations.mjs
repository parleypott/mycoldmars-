#!/usr/bin/env node
/**
 * Fix zero-duration corpus units by re-downloading and probing via ffprobe.
 * Only processes units that already have analyses (already backfilled).
 *
 * Usage: node hunter/worker/fix-durations.mjs [--limit 100]
 */

import { createClient } from '@supabase/supabase-js';
import { join } from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execSync } from 'node:child_process';

// Load .env
const envPath = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envPath)) {
  for (const l of readFileSync(envPath, 'utf8').split('\n')) {
    const m = l.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// Import Dropbox client
const { downloadFile: dbxDownload } = await import('./dropbox-client.js');

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 100;
const CACHE_DIR = join(import.meta.dirname, '..', '..', '.cache', 'duration-fix');

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
  console.log('║  FIX ZERO-DURATION CORPUS UNITS      ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Find zero-duration units that have analyses
  const { data: units, error } = await supabase
    .from('corpus_units')
    .select('id, source_clip_name, media_asset_id, media_assets!inner(source_ref)')
    .eq('end_seconds', 0)
    .not('source_clip_name', 'is', null)
    .limit(LIMIT);

  if (error) {
    console.error('Failed to query:', error.message);
    process.exit(1);
  }

  console.log(`Found ${units.length} zero-duration units (limit: ${LIMIT})`);
  if (!units.length) {
    console.log('Nothing to fix!');
    return;
  }

  // Group by clip name (multiple units can share the same source file)
  const byClip = {};
  for (const u of units) {
    const key = u.source_clip_name;
    if (!byClip[key]) byClip[key] = { units: [], sourceRef: u.media_assets?.source_ref };
    byClip[key].units.push(u);
  }

  console.log(`${Object.keys(byClip).length} unique clips to probe\n`);

  mkdirSync(CACHE_DIR, { recursive: true });

  let fixed = 0;
  let failed = 0;

  for (const [clipName, { units: clipUnits, sourceRef }] of Object.entries(byClip)) {
    const localPath = join(CACHE_DIR, clipName);

    try {
      // Download from Dropbox
      const dropboxPath = sourceRef ? `${sourceRef}/${clipName}` : clipName;
      await dbxDownload(dropboxPath, localPath);

      // Probe duration
      const duration = getDuration(localPath);
      if (duration <= 0) {
        console.log(`  ✗ ${clipName}: ffprobe returned 0`);
        failed += clipUnits.length;
        continue;
      }

      // Update all units for this clip
      for (const u of clipUnits) {
        const { error: updateErr } = await supabase
          .from('corpus_units')
          .update({ end_seconds: duration })
          .eq('id', u.id);

        if (updateErr) {
          console.log(`  ✗ ${clipName} (${u.id}): update failed — ${updateErr.message}`);
          failed++;
        } else {
          fixed++;
        }
      }

      console.log(`  ✓ ${clipName}: ${duration.toFixed(1)}s (${clipUnits.length} units)`);
    } catch (err) {
      console.log(`  ✗ ${clipName}: ${err.message?.slice(0, 80)}`);
      failed += clipUnits.length;
    } finally {
      await rm(localPath, { force: true }).catch(() => {});
    }
  }

  // Clean up cache
  await rm(CACHE_DIR, { recursive: true, force: true }).catch(() => {});

  console.log(`\n${'═'.repeat(40)}`);
  console.log(`Fixed: ${fixed} | Failed: ${failed}`);
  console.log(`${'═'.repeat(40)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
