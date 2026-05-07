#!/usr/bin/env node
/**
 * Ingest a Premiere FCP7 XML export as the "selects" tier.
 * Parses the timeline, creates corpus units for each edit decision,
 * and cross-references against raw footage corpus units.
 *
 * Usage: node hunter/worker/ingest-selects.mjs <xml-path> [project-id]
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

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
import { analyzeUnit, generateEmbedding } from './gemini-client.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const CONCURRENCY = parseInt(process.env.HUNTER_CONCURRENCY || '10');

// ── XML Parsing (server-side, uses @xmldom/xmldom) ──

function getText(el, tagName) {
  if (!el) return '';
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    if (children[i].nodeName === tagName) {
      return children[i].textContent?.trim() || '';
    }
  }
  return '';
}

function getNum(el, tagName) {
  const n = parseFloat(getText(el, tagName));
  return isNaN(n) ? 0 : n;
}

function getDirectChildren(el, tagName) {
  const results = [];
  if (!el) return results;
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    if (children[i].nodeName === tagName) results.push(children[i]);
  }
  return results;
}

function isNestedInClipItem(el) {
  let node = el.parentNode;
  while (node) {
    if (node.nodeName === 'clipitem') return true;
    node = node.parentNode;
  }
  return false;
}

function parseClipItem(clipEl, fps) {
  const name = getText(clipEl, 'name');
  const start = getNum(clipEl, 'start');
  const end = getNum(clipEl, 'end');
  const inPoint = getNum(clipEl, 'in');
  const outPoint = getNum(clipEl, 'out');
  const duration = getNum(clipEl, 'duration');

  // Source file
  const fileEls = getDirectChildren(clipEl, 'file');
  let sourceFile = null;
  if (fileEls.length > 0) {
    const fileEl = fileEls[0];
    const fileName = getText(fileEl, 'name');
    const pathUrl = getText(fileEl, 'pathurl');
    if (fileName || pathUrl) {
      sourceFile = { id: fileEl.getAttribute('id'), name: fileName, pathUrl };
    }
  }

  const startSeconds = fps > 0 ? start / fps : 0;
  const endSeconds = fps > 0 ? end / fps : 0;
  const inSeconds = fps > 0 ? inPoint / fps : 0;
  const outSeconds = fps > 0 ? outPoint / fps : 0;

  return {
    name,
    start, end, inPoint, outPoint, duration,
    startSeconds: Math.round(startSeconds * 100) / 100,
    endSeconds: Math.round(endSeconds * 100) / 100,
    inSeconds: Math.round(inSeconds * 100) / 100,
    outSeconds: Math.round(outSeconds * 100) / 100,
    sourceFile,
  };
}

function parseSequence(seqEl) {
  const name = getText(seqEl, 'name');
  const duration = getNum(seqEl, 'duration');
  const rateEl = getDirectChildren(seqEl, 'rate')[0];
  const timebase = rateEl ? getNum(rateEl, 'timebase') : 24;
  const ntsc = rateEl ? getText(rateEl, 'ntsc') === 'TRUE' : false;
  const fps = ntsc ? (timebase === 24 ? 23.976 : timebase === 30 ? 29.97 : timebase) : timebase;

  const videoTracks = [];
  const mediaEl = getDirectChildren(seqEl, 'media')[0];
  const videoEl = mediaEl ? getDirectChildren(mediaEl, 'video')[0] : null;

  if (videoEl) {
    const trackEls = getDirectChildren(videoEl, 'track');
    for (let t = 0; t < trackEls.length; t++) {
      const clipEls = getDirectChildren(trackEls[t], 'clipitem');
      const clips = clipEls.map(c => parseClipItem(c, fps)).filter(Boolean);
      videoTracks.push({ index: t + 1, clips });
    }
  }

  return { name, duration, fps, timebase, ntsc, videoTracks };
}

function parseFCP7XML(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  const sequences = [];
  const allSeqElements = doc.getElementsByTagName('sequence');

  for (let i = 0; i < allSeqElements.length; i++) {
    const seqEl = allSeqElements[i];
    if (isNestedInClipItem(seqEl)) continue;

    const seq = parseSequence(seqEl);
    const totalClips = seq.videoTracks.reduce((sum, t) => sum + t.clips.length, 0);
    if (totalClips === 0) continue;
    if (/^Nested Sequence\s*\d*$/i.test(seq.name)) continue;

    sequences.push(seq);
  }

  return sequences;
}

function extractCorpusUnits(sequences) {
  const units = [];
  for (const seq of sequences) {
    for (const track of seq.videoTracks) {
      for (const clip of track.clips) {
        if (!clip.sourceFile && !clip.name) continue;
        const sourceClipName = clip.sourceFile?.name || clip.name || 'unknown';

        units.push({
          startSeconds: clip.inSeconds,
          endSeconds: clip.outSeconds,
          sourceClipName,
          trackLabel: `V${track.index}`,
          timelineStart: clip.startSeconds,
          timelineEnd: clip.endSeconds,
          sequenceName: seq.name,
        });
      }
    }
  }
  return units;
}

// ── Pool ──

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

async function retryWithBackoff(fn, label, maxRetries = 6) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message || '';
      const isRetryable = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('503') || msg.includes('UNAVAILABLE');
      if (!isRetryable || attempt === maxRetries) throw err;
      const waitSec = Math.min(Math.pow(2, attempt + 1) * 5, 120);
      console.log(`[selects] retryable error on ${label}, waiting ${waitSec}s...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }
}

// ── Main ──

async function main() {
  const xmlPath = process.argv[2];
  const projectId = process.argv[3] || 'd745ee49-0ac1-47c7-b81e-94082ed25fed'; // Saudi Arabia

  if (!xmlPath) {
    console.error('Usage: node ingest-selects.mjs <xml-path> [project-id]');
    process.exit(1);
  }

  console.log(`[selects] parsing ${basename(xmlPath)}...`);
  let xmlString = readFileSync(xmlPath, 'utf8');
  // Strip BOM if present
  if (xmlString.charCodeAt(0) === 0xFEFF) xmlString = xmlString.slice(1);
  const sequences = parseFCP7XML(xmlString);

  console.log(`[selects] found ${sequences.length} sequences:`);
  for (const seq of sequences) {
    const clipCount = seq.videoTracks.reduce((sum, t) => sum + t.clips.length, 0);
    console.log(`  - "${seq.name}": ${clipCount} clips, ${seq.videoTracks.length} video tracks, ${seq.fps} fps`);
  }

  const allUnits = extractCorpusUnits(sequences);
  console.log(`[selects] ${allUnits.length} total edit decisions (corpus units)`);

  // Get unique source clips
  const sourceClips = new Map();
  for (const u of allUnits) {
    if (!sourceClips.has(u.sourceClipName)) {
      sourceClips.set(u.sourceClipName, { count: 0, totalDuration: 0 });
    }
    const entry = sourceClips.get(u.sourceClipName);
    entry.count++;
    entry.totalDuration += (u.endSeconds - u.startSeconds);
  }
  console.log(`[selects] ${sourceClips.size} unique source clips referenced`);

  // Fetch project context
  const { data: project } = await supabase.from('hunter_projects')
    .select('name, metadata').eq('id', projectId).single();
  const projectContext = project?.metadata?.context || null;

  // Create media_asset for selects
  const { data: existingAsset } = await supabase.from('media_assets')
    .select('id')
    .eq('project_id', projectId)
    .eq('tier', 'selects')
    .single();

  let assetId;
  if (existingAsset) {
    assetId = existingAsset.id;
    console.log(`[selects] using existing selects asset ${assetId}`);
  } else {
    const { data: newAsset, error } = await supabase.from('media_assets')
      .insert({
        project_id: projectId,
        tier: 'selects',
        source_kind: 'local',
        source_ref: xmlPath,
        format: 'xml',
        queue_status: 'analyzing',
        metadata: {
          sequenceCount: sequences.length,
          totalClips: allUnits.length,
          uniqueSources: sourceClips.size,
          sequences: sequences.map(s => ({
            name: s.name,
            clipCount: s.videoTracks.reduce((sum, t) => sum + t.clips.length, 0),
            fps: s.fps,
          })),
        },
      })
      .select().single();

    if (error) { console.error('[selects] create asset error:', error.message); return; }
    assetId = newAsset.id;
    console.log(`[selects] created selects asset ${assetId}`);
  }

  // Check which units already exist
  const { data: existingUnits } = await supabase.from('corpus_units')
    .select('source_clip_name, start_seconds, end_seconds')
    .eq('media_asset_id', assetId);
  const existingSet = new Set((existingUnits || []).map(u =>
    `${u.source_clip_name}:${u.start_seconds}:${u.end_seconds}`
  ));

  const remaining = allUnits.filter(u =>
    !existingSet.has(`${u.sourceClipName}:${u.startSeconds}:${u.endSeconds}`)
  );
  console.log(`[selects] ${remaining.length} new units to create (${existingSet.size} already exist)`);

  // Cross-reference: fetch raw corpus units for matching
  const { data: rawAssets } = await supabase.from('media_assets')
    .select('id').eq('project_id', projectId).eq('tier', 'raw');
  const rawAssetIds = (rawAssets || []).map(a => a.id);

  let rawUnitsMap = new Map(); // source_clip_name → corpus_unit
  if (rawAssetIds.length > 0) {
    // Fetch all raw corpus units in pages
    let allRawUnits = [];
    let offset = 0;
    while (true) {
      const { data } = await supabase.from('corpus_units')
        .select('id, source_clip_name, start_seconds, end_seconds')
        .in('media_asset_id', rawAssetIds)
        .range(offset, offset + 999);
      if (!data?.length) break;
      allRawUnits = allRawUnits.concat(data);
      if (data.length < 1000) break;
      offset += 1000;
    }

    for (const u of allRawUnits) {
      rawUnitsMap.set(u.source_clip_name, u);
      // Map without extension
      const nameNoExt = u.source_clip_name.replace(/\.[^.]+$/, '');
      rawUnitsMap.set(nameNoExt, u);
      // Map without _Proxy suffix (Premiere uses original names, Dropbox has proxy names)
      const nameNoProxy = u.source_clip_name.replace(/_Proxy/i, '');
      rawUnitsMap.set(nameNoProxy, u);
      const nameNoProxyNoExt = nameNoExt.replace(/_Proxy/i, '');
      rawUnitsMap.set(nameNoProxyNoExt, u);
    }
    console.log(`[selects] loaded ${allRawUnits.length} raw corpus units for cross-referencing`);
  }

  // Create corpus units and build analysis context for each edit decision
  const limit = createPool(CONCURRENCY);
  let processed = 0;
  let matched = 0;
  const total = remaining.length;
  const startTime = Date.now();

  await Promise.allSettled(remaining.map((unit, i) => limit(async () => {
    try {
      // Find matching raw unit
      const rawMatch = rawUnitsMap.get(unit.sourceClipName)
        || rawUnitsMap.get(unit.sourceClipName.replace(/\.[^.]+$/, ''));

      // Create corpus unit with edit context in track_label
      const { data: cu, error } = await supabase.from('corpus_units')
        .insert({
          media_asset_id: assetId,
          start_seconds: unit.startSeconds,
          end_seconds: unit.endSeconds,
          source_clip_name: unit.sourceClipName,
          track_label: `${unit.trackLabel}|${unit.sequenceName}|tl:${unit.timelineStart}-${unit.timelineEnd}`,
        })
        .select().single();

      if (error) {
        console.error(`[selects] unit insert error: ${error.message}`);
        return;
      }

      if (rawMatch) matched++;

      // Build analysis context: describe the editorial decision
      const editContext = buildSelectsAnalysisContext(unit, rawMatch);

      // Generate embedding from the editorial context description
      // (This captures the "editorial decision" — what was chosen and how it sits in the timeline)
      const embedding = await retryWithBackoff(
        () => generateEmbedding(editContext),
        unit.sourceClipName
      );

      await supabase.from('embeddings').insert({
        corpus_unit_id: cu.id,
        model: 'gemini-embedding-001',
        embedding: embedding,
      });

      // Save analysis (editorial context as text)
      await supabase.from('analyses').insert({
        corpus_unit_id: cu.id,
        model: 'editorial-context',
        prompt_version: 'v1-selects-context',
        output_text: editContext,
        output_json: {
          sourceClip: unit.sourceClipName,
          sourceIn: unit.startSeconds,
          sourceOut: unit.endSeconds,
          timelineIn: unit.timelineStart,
          timelineOut: unit.timelineEnd,
          track: unit.trackLabel,
          sequence: unit.sequenceName,
          duration: Math.round((unit.endSeconds - unit.startSeconds) * 100) / 100,
          timelineDuration: Math.round((unit.timelineEnd - unit.timelineStart) * 100) / 100,
          rawMatchId: rawMatch?.id || null,
        },
        cost_usd: 0,
      });

      processed++;
      if (processed % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        console.log(`[selects] ${processed}/${total} (${(processed/total*100).toFixed(1)}%) — ${matched} matched to raw — ${rate.toFixed(1)}/s`);
      }
    } catch (err) {
      console.error(`[selects] ✗ ${unit.sourceClipName}: ${err.message}`);
    }
  })));

  // Mark asset done
  await supabase.from('media_assets')
    .update({ queue_status: 'done', updated_at: new Date().toISOString() })
    .eq('id', assetId);

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`[selects] done: ${processed}/${total} units, ${matched} cross-referenced to raw, ${elapsed.toFixed(0)}s`);

  // Print cross-reference summary
  const matchRate = total > 0 ? (matched / total * 100).toFixed(1) : 0;
  console.log(`[selects] cross-reference rate: ${matchRate}% of edit decisions matched to raw footage`);
}

/**
 * Build a textual description of an editorial decision for embedding + analysis.
 * This is what gets embedded and compared against raw footage descriptions.
 */
function buildSelectsAnalysisContext(unit, rawMatch) {
  const duration = Math.round((unit.endSeconds - unit.startSeconds) * 100) / 100;
  const timelineDuration = Math.round((unit.timelineEnd - unit.timelineStart) * 100) / 100;

  let text = `EDITORIAL DECISION — Selects Tier\n`;
  text += `Sequence: "${unit.sequenceName}"\n`;
  text += `Source clip: ${unit.sourceClipName}\n`;
  text += `Source range: ${formatTime(unit.startSeconds)} – ${formatTime(unit.endSeconds)} (${duration}s of source used)\n`;
  text += `Timeline position: ${formatTime(unit.timelineStart)} – ${formatTime(unit.timelineEnd)} (${timelineDuration}s on timeline)\n`;
  text += `Track: ${unit.trackLabel}\n`;

  if (rawMatch) {
    text += `\nCROSS-REFERENCE: This clip matches raw corpus unit ${rawMatch.id}.\n`;
    text += `The editor selected ${duration}s from a ${Math.round(rawMatch.end_seconds - rawMatch.start_seconds)}s source clip.\n`;
    const usagePercent = ((duration / (rawMatch.end_seconds - rawMatch.start_seconds)) * 100).toFixed(1);
    text += `Usage: ${usagePercent}% of source material was used in this edit.\n`;
  } else {
    text += `\nNo raw footage match found for this source clip.\n`;
  }

  return text;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

main().catch(err => { console.error('[selects] fatal:', err.message); process.exit(1); });
