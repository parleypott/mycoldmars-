#!/usr/bin/env node
/**
 * Backfill embeddings for all analyses that don't have them.
 * The raw pipeline originally skipped embedding generation.
 * Run: node hunter/worker/backfill-embeddings.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
import { generateEmbedding } from './gemini-client.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const CONCURRENCY = parseInt(process.env.HUNTER_CONCURRENCY || '10');
const BATCH_SIZE = 100;

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

async function retryWithBackoff(fn, label, maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message || '';
      const isRetryable = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('503');
      if (!isRetryable || attempt === maxRetries) throw err;
      const waitSec = Math.min(Math.pow(2, attempt + 1) * 3, 60);
      console.log(`[backfill] retryable error on ${label}, waiting ${waitSec}s (attempt ${attempt + 1})...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }
}

async function fetchAllPaginated(table, select, orderCol = 'created_at') {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from(table)
      .select(select)
      .order(orderCol, { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Fetch ${table} error: ${error.message}`);
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function main() {
  let totalProcessed = 0;
  let totalErrors = 0;

  // Get ALL analyses with pagination (Supabase default limit is 1000)
  console.log('[backfill] fetching all analyses...');
  const allAnalyses = await fetchAllPaginated('analyses', 'corpus_unit_id, output_text');
  console.log(`[backfill] found ${allAnalyses.length} total analyses`);

  if (!allAnalyses?.length) {
    console.log('[backfill] no analyses found');
    return;
  }

  // Get ALL existing embeddings with pagination
  console.log('[backfill] fetching existing embeddings...');
  const existingEmbeddings = await fetchAllPaginated('embeddings', 'corpus_unit_id');
  const hasEmbedding = new Set(existingEmbeddings.map(e => e.corpus_unit_id));

  // Filter to only missing
  const missing = allAnalyses.filter(a => !hasEmbedding.has(a.corpus_unit_id));
  console.log(`[backfill] ${missing.length} analyses missing embeddings (${hasEmbedding.size} already have them)`);

  if (missing.length === 0) {
    console.log('[backfill] nothing to do');
    return;
  }

  const limit = createPool(CONCURRENCY);
  const startTime = Date.now();

  await Promise.allSettled(missing.map((analysis, i) => limit(async () => {
    try {
      const embedding = await retryWithBackoff(
        () => generateEmbedding(analysis.output_text),
        `unit-${analysis.corpus_unit_id}`
      );

      await supabase.from('embeddings').insert({
        corpus_unit_id: analysis.corpus_unit_id,
        model: 'gemini-embedding-001',
        embedding: embedding,
      });

      totalProcessed++;
      if (totalProcessed % 50 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = totalProcessed / elapsed;
        const remaining = (missing.length - totalProcessed) / rate;
        console.log(`[backfill] ${totalProcessed}/${missing.length} (${(totalProcessed / missing.length * 100).toFixed(1)}%) — ${rate.toFixed(1)}/s — ~${Math.round(remaining)}s remaining`);
      }
    } catch (err) {
      totalErrors++;
      console.error(`[backfill] ✗ unit ${analysis.corpus_unit_id}: ${err.message}`);
    }
  })));

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`[backfill] done: ${totalProcessed} embeddings generated, ${totalErrors} errors, ${elapsed.toFixed(0)}s elapsed`);
}

main().catch(err => { console.error('[backfill] fatal:', err.message); process.exit(1); });
