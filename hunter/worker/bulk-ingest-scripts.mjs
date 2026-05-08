#!/usr/bin/env node

/**
 * Bulk Script Ingest for Hunter Script Copilot Training.
 *
 * Takes a list of Google Docs URLs, fetches + parses each (tab 0 only by default),
 * stores snapshots in script_snapshots, creates media_assets if needed.
 * After ingestion, optionally runs cross-script training analysis.
 *
 * Usage:
 *   node hunter/worker/bulk-ingest-scripts.mjs <project-id> [options]
 *
 * Input: reads Google Docs URLs from stdin, one per line.
 *   echo "https://docs.google.com/document/d/ABC.../edit" | node bulk-ingest-scripts.mjs <project-id>
 *   cat script-urls.txt | node bulk-ingest-scripts.mjs <project-id>
 *
 * Options:
 *   --tab=N          Which tab to parse (0-based). Default: 0 (first/script tab)
 *   --all-tabs       Parse all tabs instead of just one
 *   --train          Run cross-script training analysis after ingestion
 *   --dry-run        Fetch + parse but don't store to DB (for testing)
 *   --concurrency=N  Max parallel fetches. Default: 3
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Load env
const envPath = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

import { fetchDocStructured, extractDocId, getLatestRevisionId } from './google-docs-client.js';
import { parseDocStructured } from './google-docs-parser.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
);

// Parse args
const args = process.argv.slice(2);
const projectId = args.find(a => !a.startsWith('--'));
const tabIndex = args.find(a => a.startsWith('--tab=')) ? parseInt(args.find(a => a.startsWith('--tab=')).split('=')[1]) : 0;
const allTabs = args.includes('--all-tabs');
const runTraining = args.includes('--train');
const dryRun = args.includes('--dry-run');
const concurrency = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '3');

if (!projectId) {
  console.error(`
Usage: node bulk-ingest-scripts.mjs <project-id> [options]

Options:
  --tab=N          Which tab to parse (0-based). Default: 0
  --all-tabs       Parse all tabs
  --train          Run training after ingestion
  --dry-run        Fetch + parse without storing
  --concurrency=N  Max parallel fetches (default: 3)

Input: pipe Google Docs URLs via stdin, one per line.
  cat urls.txt | node bulk-ingest-scripts.mjs <project-id> --train
`);
  process.exit(1);
}

// Read URLs from stdin
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  console.log(`\n[bulk-ingest] project: ${projectId}`);
  console.log(`[bulk-ingest] tab: ${allTabs ? 'ALL' : tabIndex}`);
  console.log(`[bulk-ingest] mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

  // Read URLs
  const input = await readStdin();
  const urls = input.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
    .filter(l => l.includes('docs.google.com/document') || l.match(/^[a-zA-Z0-9_-]{20,}$/)); // URL or bare doc ID

  if (!urls.length) {
    console.error('[bulk-ingest] no valid Google Docs URLs found in stdin');
    process.exit(1);
  }

  console.log(`[bulk-ingest] ${urls.length} docs to ingest\n`);

  // Process in batches
  const results = [];
  const errors = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((url, j) => processDoc(url, i + j, urls.length))
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      } else if (r.status === 'rejected') {
        errors.push(r.reason?.message || String(r.reason));
      }
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[bulk-ingest] DONE: ${results.length}/${urls.length} docs ingested`);

  if (results.length > 0) {
    const totalBeats = results.reduce((s, r) => s + r.beats, 0);
    const totalWords = results.reduce((s, r) => s + r.words, 0);
    const totalColors = results.reduce((s, r) => s + r.coloredRuns, 0);
    console.log(`[bulk-ingest] total: ${totalBeats} beats, ${totalWords} words, ${totalColors} colored runs`);
    console.log(`[bulk-ingest] avg per script: ${Math.round(totalBeats / results.length)} beats, ${Math.round(totalWords / results.length)} words`);

    // Aggregate color profile across all scripts
    const allColors = {};
    for (const r of results) {
      for (const [color, data] of Object.entries(r.colorProfile || {})) {
        if (!allColors[color]) allColors[color] = { count: 0, scripts: 0 };
        allColors[color].count += data.count;
        allColors[color].scripts++;
      }
    }
    console.log(`\n[bulk-ingest] aggregate color profile (${Object.keys(allColors).length} colors):`);
    for (const [color, data] of Object.entries(allColors).sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  ${color}: ${data.count} uses across ${data.scripts}/${results.length} scripts`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n[bulk-ingest] ${errors.length} errors:`);
    for (const e of errors) console.log(`  - ${e}`);
  }

  // Run training if requested
  if (runTraining && results.length > 0 && !dryRun) {
    console.log(`\n[bulk-ingest] starting cross-script training...`);
    // Dynamic import to avoid loading Gemini SDK unless needed
    const { runScriptTraining } = await import('./build-script-context.mjs');
    await runScriptTraining(projectId);
  }
}

async function processDoc(urlOrId, index, total) {
  const docId = urlOrId.includes('/') ? extractDocId(urlOrId) : urlOrId;
  const tag = `[${index + 1}/${total}]`;

  try {
    console.log(`${tag} fetching ${docId}...`);
    const fetchOpts = allTabs ? {} : { tabIndex };
    const docJson = await fetchDocStructured(docId, fetchOpts);
    const title = docJson.title || docId;

    console.log(`${tag} parsing "${title}"...`);
    const parseOpts = allTabs ? {} : { tabIndex };
    const parsed = parseDocStructured(docJson, parseOpts);

    console.log(`${tag} "${title}": ${parsed.stats.totalBeats} beats, ${parsed.stats.wordCount} words, ${parsed.stats.coloredRunCount} colored runs`);

    if (dryRun) {
      return { docId, title, beats: parsed.stats.totalBeats, words: parsed.stats.wordCount, coloredRuns: parsed.stats.coloredRunCount, colorProfile: parsed.colorProfile };
    }

    // Find or create media_asset
    const sourceRef = `https://docs.google.com/document/d/${docId}/edit`;
    let { data: asset } = await supabase.from('media_assets')
      .select('id')
      .eq('project_id', projectId)
      .eq('source_ref', sourceRef)
      .single();

    if (!asset) {
      const { data: newAsset, error } = await supabase.from('media_assets')
        .insert({
          project_id: projectId,
          tier: 'google_docs',
          source_kind: 'google_docs',
          source_ref: sourceRef,
          filename: title,
          metadata: { title, docId, tabIndex: allTabs ? 'all' : tabIndex },
          queue_status: 'done',
        })
        .select().single();

      if (error) throw new Error(`media_asset insert: ${error.message}`);
      asset = newAsset;
      console.log(`${tag} created media_asset ${asset.id}`);
    }

    // Get revision ID
    const revisionId = await getLatestRevisionId(docId).catch(() => null);

    // Determine version number
    const { data: existing } = await supabase.from('script_snapshots')
      .select('version_number')
      .eq('media_asset_id', asset.id)
      .order('version_number', { ascending: false })
      .limit(1);
    const versionNumber = (existing?.[0]?.version_number || 0) + 1;

    // Store snapshot
    const { data: snapshot, error: snapError } = await supabase.from('script_snapshots')
      .insert({
        media_asset_id: asset.id,
        revision_id: revisionId,
        version_number: versionNumber,
        parsed_doc: parsed,
        color_profile: parsed.colorProfile,
        beat_count: parsed.stats.totalBeats,
        word_count: parsed.stats.wordCount,
      })
      .select().single();

    if (snapError) throw new Error(`snapshot insert: ${snapError.message}`);
    console.log(`${tag} stored snapshot v${versionNumber} (${snapshot.id})`);

    return {
      docId, title,
      beats: parsed.stats.totalBeats,
      words: parsed.stats.wordCount,
      coloredRuns: parsed.stats.coloredRunCount,
      colorProfile: parsed.colorProfile,
      assetId: asset.id,
      snapshotId: snapshot.id,
    };
  } catch (err) {
    console.error(`${tag} ERROR (${docId}): ${err.message}`);
    throw err;
  }
}

main().catch(err => {
  console.error('[bulk-ingest] fatal:', err);
  process.exit(1);
});
