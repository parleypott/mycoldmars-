import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const envPath = '/Users/orangejacket/playground/mycoldmars/.env';
const lines = readFileSync(envPath, 'utf8').split('\n');
for (const l of lines) {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const UNIT_ID = '33715e71-f68c-4946-adcc-1e5ac5487b50';
const ASSET_ID = 'd1bcae3c-bb1b-447b-b7fb-d9f23da51146';
const VIDEO = join(process.env.HOME, 'hunter-cache/d745ee49-0ac1-47c7-b81e-94082ed25fed/finished.mp4');

async function main() {
  // Upload
  console.log('Uploading...');
  const uploaded = await genai.files.upload({
    file: VIDEO,
    config: { mimeType: 'video/mp4', displayName: 'saudi-finished' },
  });

  // Poll for ready
  let file = uploaded;
  while (file.state === 'PROCESSING') {
    await new Promise(r => setTimeout(r, 10000));
    file = await genai.files.get({ name: file.name });
    console.log('State:', file.state);
  }

  if (file.state !== 'ACTIVE') {
    console.error('File failed:', file.state);
    return;
  }
  console.log('Ready:', file.uri);

  // Get project context
  const { data: proj } = await sb.from('hunter_projects')
    .select('metadata').eq('id', 'd745ee49-0ac1-47c7-b81e-94082ed25fed').single();
  const ctx = proj?.metadata?.context || '';
  const ctxBlock = ctx ? `PROJECT CONTEXT:\n${ctx}\n\n` : '';

  // Analysis - do immediately after file is ready
  console.log('Analyzing...');
  const result = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [
      { fileData: { fileUri: file.uri, mimeType: 'video/mp4' } },
      { text: `${ctxBlock}You are analyzing a FINISHED DOCUMENTARY in TRAINING MODE. This is the final published piece — the "answer key" for what the editor chose from thousands of raw clips.

Analyze the complete editorial arc:

- **Opening strategy**: How does the film begin? What hooks the viewer?
- **Narrative structure**: Major acts/segments, how tension builds and releases
- **Visual grammar**: Recurring visual motifs, cinematography shifts, interview vs B-roll vs archival ratio
- **Audio design**: Music, ambient sound, voiceover, silence usage
- **Pacing**: Where the edit speeds up vs slows down
- **Key editorial decisions**: Bold choices — long holds, jump cuts, unexpected juxtapositions
- **Ending strategy**: How does it close?
- **Thesis**: What is this film arguing?

Be specific and detailed. This analysis will be compared against raw footage, script, and selects to understand how editorial vision transformed raw material into a finished piece.` }
    ] }],
    config: { maxOutputTokens: 8000 },
  });

  console.log('Analysis:', result.text.length, 'chars');
  console.log(result.text.slice(0, 300) + '...\n');

  // Save analysis
  const { error } = await sb.from('analyses').insert({
    corpus_unit_id: UNIT_ID,
    model: 'gemini-2.5-flash',
    prompt_version: 'v3-finished-training',
    output_text: result.text,
    cost_usd: 0,
  });
  if (error) console.error('Save error:', error.message);
  else console.log('Analysis saved');

  // Embedding
  const emb = await genai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: [{ parts: [{ text: result.text }] }],
    config: { outputDimensionality: 768 },
  });
  await sb.from('embeddings').insert({
    corpus_unit_id: UNIT_ID,
    model: 'gemini-embedding-001',
    embedding: emb.embeddings[0].values,
  });
  console.log('Embedding saved');

  // Mark done
  await sb.from('media_assets')
    .update({ queue_status: 'done', updated_at: new Date().toISOString() })
    .eq('id', ASSET_ID);
  console.log('Asset done');

  // Cleanup
  await genai.files.delete({ name: file.name }).catch(() => {});
  console.log('Complete');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
