#!/usr/bin/env node
/**
 * Manually analyze the finished YouTube video.
 * Bypasses the worker to debug/complete the finished tier.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const l of lines) {
    const m = l.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

import { createClient } from '@supabase/supabase-js';
import { uploadFile, deleteFile, analyzeUnit, generateEmbedding } from './gemini-client.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const FINISHED_ASSET = 'd1bcae3c-bb1b-447b-b7fb-d9f23da51146';
const FINISHED_UNIT = '33715e71-f68c-4946-adcc-1e5ac5487b50';
const VIDEO_PATH = join(process.env.HOME, 'hunter-cache/d745ee49-0ac1-47c7-b81e-94082ed25fed/finished.mp4');

async function main() {
  console.log('Uploading finished video...');
  const file = await uploadFile(VIDEO_PATH);
  console.log('File ready:', file.uri);

  // Get project context
  const { data: project } = await supabase.from('hunter_projects')
    .select('metadata').eq('id', 'd745ee49-0ac1-47c7-b81e-94082ed25fed').single();
  const projectContext = project?.metadata?.context || null;

  // Skip transcript for now — just do the narrative analysis
  console.log('Running analysis on 34-min video (this takes a while)...');

  try {
    const result = await analyzeUnit({
      fileUri: file.uri,
      startSeconds: 0,
      endSeconds: 2058,
      projectContext,
    });

    console.log('Analysis complete:', result.text.slice(0, 200));
    console.log('Full length:', result.text.length, 'chars');

    // Save analysis
    const { error } = await supabase.from('analyses').insert({
      corpus_unit_id: FINISHED_UNIT,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      prompt_version: 'v3-training-grounded',
      output_text: result.text,
      output_json: null,
      cost_usd: 0,
    });
    if (error) console.error('Analysis save error:', error.message);
    else console.log('Analysis saved');

    // Generate embedding
    const embedding = await generateEmbedding(result.text);
    await supabase.from('embeddings').insert({
      corpus_unit_id: FINISHED_UNIT,
      model: 'gemini-embedding-001',
      embedding: embedding,
    });
    console.log('Embedding saved');

    // Mark asset done
    await supabase.from('media_assets')
      .update({ queue_status: 'done', updated_at: new Date().toISOString() })
      .eq('id', FINISHED_ASSET);
    console.log('Asset marked done');

  } catch (err) {
    console.error('Analysis failed:', err.message);
  }

  // Cleanup
  await deleteFile(file.name);
  console.log('Done');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
