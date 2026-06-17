export const config = { runtime: 'edge', maxDuration: 120 };

import { stripMarkdown, firstLine, slug, clampNum } from './_lib/burma-essays-text.js';

/**
 * Burma Essays — paste an essay, get a narrated library item you can scrub.
 *
 *   GET  /api/burma-essays                 -> { essays: [ {id,title,duration_sec,position_sec,char_count,created_at,audio_url} ] }
 *   GET  /api/burma-essays?id=<uuid>        -> { essay: { ...full, body, audio_url } }
 *   POST /api/burma-essays  {action:'create',   title, body, voice?, quality?} -> { essay }
 *   POST /api/burma-essays  {action:'position', id, position, duration?}        -> { ok:true }
 *   POST /api/burma-essays  {action:'delete',   id}                             -> { ok:true }
 *
 * Audio is generated once via ElevenLabs (chunked + concatenated into a single
 * mp3), stored in the public `burma-audio` bucket, and streamed straight to an
 * <audio> tag — which is what lets iOS keep playing with the screen locked.
 * Single-user tool, last-write-wins, no auth gate.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ELEVEN_KEY  = process.env.ELEVENLABS_API_KEY;

const BUCKET = 'burma-audio';
const MAX_CHARS = 80_000;          // ~70 min of audio; generous for an essay
const CHUNK_LIMIT = 4800;          // ElevenLabs comfortable per-request size
const CONCURRENCY = 4;             // keep under ElevenLabs parallel-request cap

// Warm narrator voices. Keys are what the UI sends.
const VOICES = {
  parley:    'ZF6FPAbjXT4488VcRRnw', // Johnny's voice
  charlotte: 'XB0fDUnXU5powFXDhCwa', // soft adult female narrator
  george:    'JBFqnCBsd6RMkjVDRZzb', // warm adult male, British
  daniel:    'onwK4e9ZLuTAKqWW03F9', // deep adult male, UK
  matilda:   'XrExE9yKIg1WjnnlVkGX', // warm adult female
  adam:      'pNInz6obpgDQGcFmaJgB', // deep adult male
};
const DEFAULT_VOICE = 'charlotte';

// quality -> model + bitrate. 'mid' (turbo) is the default: good voice, half-ish credits.
const QUALITY = {
  fast: { model: 'eleven_flash_v2_5',      fmt: 'mp3_44100_128' },
  mid:  { model: 'eleven_turbo_v2_5',      fmt: 'mp3_44100_128' },
  rich: { model: 'eleven_multilingual_v2', fmt: 'mp3_44100_192' },
};
const DEFAULT_QUALITY = 'mid';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return err(500, 'NO_DB', 'Supabase env not configured');

  try {
    if (req.method === 'GET') {
      const u = new URL(req.url).searchParams;
      if (u.get('highlights') != null) return await listHighlights();
      const id = u.get('id');
      return id ? await getOne(id) : await list();
    }
    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return err(400, 'BAD_JSON', 'Body must be JSON'); }
      const action = body?.action || 'create';
      if (action === 'create')      return await create(body);
      if (action === 'position')    return await savePosition(body);
      if (action === 'delete')      return await remove(body);
      if (action === 'regenerate')  return await regenerate(body);
      if (action === 'highlight')   return await addHighlight(body);
      if (action === 'unhighlight') return await delHighlight(body);
      return err(400, 'BAD_ACTION', `Unknown action: ${action}`);
    }
    return err(405, 'METHOD', `Method ${req.method} not allowed`);
  } catch (e) {
    return err(500, 'INTERNAL', e?.message || 'unknown error');
  }
}

/* ----------------------------------------------------------------- reads */

async function list() {
  const r = await sb(`/rest/v1/burma_essays?select=id,title,duration_sec,position_sec,char_count,voice,status,audio_path,created_at,updated_at&order=created_at.desc`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json();
  return ok({ essays: rows.map(shape) });
}

async function getOne(id) {
  const r = await sb(`/rest/v1/burma_essays?id=eq.${id}&select=*`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json();
  if (!rows.length) return err(404, 'NOT_FOUND', 'no such essay');
  const essay = shape(rows[0], true);
  const hr = await sb(`/rest/v1/burma_highlights?essay_id=eq.${id}&select=id,quote,note,color,created_at&order=created_at.asc`);
  essay.highlights = hr.ok ? await hr.json() : [];
  return ok({ essay });
}

async function listHighlights() {
  // all highlights, newest first, with their essay's title for the collection tab
  const r = await sb(`/rest/v1/burma_highlights?select=id,quote,note,color,created_at,essay_id,burma_essays(title)&order=created_at.desc`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json();
  return ok({ highlights: rows.map((h) => ({
    id: h.id, quote: h.quote, note: h.note || '', color: h.color || 'gold',
    created_at: h.created_at, essay_id: h.essay_id,
    essay_title: h.burma_essays?.title || 'Essay',
  })) });
}

async function addHighlight(body) {
  const essay_id = body.essay_id;
  const quote = (body.quote || '').toString().trim();
  if (!essay_id) return err(400, 'NO_ID', 'essay_id required');
  if (!quote) return err(400, 'EMPTY', 'quote required');
  const ins = await sb(`/rest/v1/burma_highlights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ essay_id, quote: quote.slice(0, 6000), note: (body.note || '').toString().slice(0, 2000), color: body.color || 'gold' }),
  });
  if (!ins.ok) return err(502, 'DB_WRITE', await ins.text());
  return ok({ highlight: (await ins.json())[0] });
}

async function delHighlight(body) {
  if (!body.id) return err(400, 'NO_ID', 'id required');
  const r = await sb(`/rest/v1/burma_highlights?id=eq.${body.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!r.ok) return err(502, 'DB_WRITE', await r.text());
  return ok({ ok: true });
}

/* --------------------------------------------------------------- writes */

async function create(body) {
  if (!ELEVEN_KEY) return err(500, 'NO_TTS', 'ELEVENLABS_API_KEY not configured on the server');

  let text = (body.body || '').toString();
  const title = (body.title || '').toString().trim() || firstLine(text) || 'Untitled essay';
  const clean = stripMarkdown(text).trim();
  if (!clean) return err(400, 'EMPTY', 'essay body is empty');
  if (clean.length > MAX_CHARS) return err(413, 'TOO_LONG', `essay is ${clean.length} chars (max ${MAX_CHARS})`);

  const voice = VOICES[body.voice] ? body.voice : DEFAULT_VOICE;
  const voiceId = VOICES[voice];
  const q = QUALITY[body.quality] ? body.quality : DEFAULT_QUALITY;

  // 1) synth audio + word timings
  const gen = await generateAudio(clean, voiceId, q);
  if (gen.error) return err(502, 'TTS_FAILED', gen.error);
  const { merged, words, narration, duration } = gen;

  // 2) upload single mp3 to public bucket
  const path = `${Date.now()}-${slug(title)}.mp3`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'audio/mpeg',
      'x-upsert': 'true',
      'cache-control': '31536000',
    },
    body: merged,
  });
  if (!up.ok) return err(502, 'UPLOAD', await up.text());

  // 3) insert row
  const ins = await sb(`/rest/v1/burma_essays`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      title, body: text, audio_path: path, voice,
      char_count: clean.length, status: 'ready',
      narration_text: narration, words, duration_sec: duration,
    }),
  });
  if (!ins.ok) return err(502, 'DB_WRITE', await ins.text());
  const row = (await ins.json())[0];
  return ok({ essay: shape(row, true) });
}

async function regenerate(body) {
  if (!ELEVEN_KEY) return err(500, 'NO_TTS', 'ELEVENLABS_API_KEY not configured on the server');
  const id = body.id;
  if (!id) return err(400, 'NO_ID', 'id required');
  const r = await sb(`/rest/v1/burma_essays?id=eq.${id}&select=*`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json();
  if (!rows.length) return err(404, 'NOT_FOUND', 'no such essay');
  const row = rows[0];

  const clean = stripMarkdown((row.body || '').toString()).trim();
  if (!clean) return err(400, 'EMPTY', 'stored essay body is empty');
  if (clean.length > MAX_CHARS) return err(413, 'TOO_LONG', `essay is ${clean.length} chars (max ${MAX_CHARS})`);

  const voice = VOICES[body.voice] ? body.voice : (VOICES[row.voice] ? row.voice : DEFAULT_VOICE);
  const q = QUALITY[body.quality] ? body.quality : DEFAULT_QUALITY;

  const gen = await generateAudio(clean, VOICES[voice], q);
  if (gen.error) return err(502, 'TTS_FAILED', gen.error);

  const path = `${Date.now()}-${slug(row.title)}.mp3`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'audio/mpeg', 'x-upsert': 'true', 'cache-control': '31536000' },
    body: gen.merged,
  });
  if (!up.ok) return err(502, 'UPLOAD', await up.text());

  const u = await sb(`/rest/v1/burma_essays?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      audio_path: path, voice, narration_text: gen.narration, words: gen.words,
      duration_sec: gen.duration, position_sec: 0, status: 'ready', updated_at: new Date().toISOString(),
    }),
  });
  if (!u.ok) return err(502, 'DB_WRITE', await u.text());

  // best-effort: remove the stale (buggy) audio file
  if (row.audio_path && row.audio_path !== path) {
    fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${row.audio_path}`, {
      method: 'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    }).catch(() => {});
  }
  return ok({ essay: shape((await u.json())[0], true) });
}

async function savePosition(body) {
  const { id } = body;
  if (!id) return err(400, 'NO_ID', 'id required');
  const patch = { position_sec: clampNum(body.position), updated_at: new Date().toISOString() };
  if (body.duration != null) patch.duration_sec = clampNum(body.duration);
  const r = await sb(`/rest/v1/burma_essays?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return err(502, 'DB_WRITE', await r.text());
  return ok({ ok: true });
}

async function remove(body) {
  const { id } = body;
  if (!id) return err(400, 'NO_ID', 'id required');
  const r = await sb(`/rest/v1/burma_essays?id=eq.${id}&select=audio_path`);
  const rows = r.ok ? await r.json() : [];
  if (rows[0]?.audio_path) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${rows[0].audio_path}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    }).catch(() => {});
  }
  const del = await sb(`/rest/v1/burma_essays?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!del.ok) return err(502, 'DB_WRITE', await del.text());
  return ok({ ok: true });
}

/* ---------------------------------------------------- audio assembly */

// Synth every chunk, then stitch into one clean mp3 + a single global word timeline.
async function generateAudio(clean, voiceId, q) {
  const chunks = chunkText(clean);
  const results = await mapLimit(chunks, CONCURRENCY, (c) => synth(c, voiceId, q));
  const failed = results.findIndex((r) => !r);
  if (failed !== -1) return { error: `ElevenLabs failed on chunk ${failed + 1}` };

  const audioPieces = [];
  const words = [];
  let narration = '';
  let offset = 0; // cumulative audio seconds across chunks
  for (const r of results) {
    audioPieces.push(r.audio);
    if (narration.length) narration += '\n\n'; // keep paragraph breaks at chunk seams
    const base = narration.length;
    const n = r.chars.length;
    let wi = -1; // first char of the current word within this chunk
    for (let i = 0; i <= n; i++) {
      const isSpace = i === n || /\s/.test(r.chars[i]);
      if (!isSpace && wi < 0) wi = i;
      if (isSpace && wi >= 0) {
        words.push({ s: +(r.starts[wi] + offset).toFixed(3), e: +(r.ends[i - 1] + offset).toFixed(3), a: base + wi, b: base + i });
        wi = -1;
      }
    }
    narration += r.chars.join('');
    offset += r.ends.length ? r.ends[r.ends.length - 1] : 0;
  }
  return { merged: concat(audioPieces), words, narration, duration: +offset.toFixed(3) };
}

/* ---------------------------------------------------------- ElevenLabs */

async function synth(text, voiceId, quality) {
  const { model, fmt } = QUALITY[quality];
  // with-timestamps returns audio + per-character alignment in one JSON response,
  // same credit cost as plain TTS. Drives karaoke + click-to-seek.
  const call = (modelId) => fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${fmt}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.45, similarity_boost: 0.85, style: 0.3, use_speaker_boost: true },
      }),
    },
  );
  let res = await call(model);
  if (!res.ok && model !== 'eleven_multilingual_v2' && [400, 403, 404].includes(res.status)) {
    res = await call('eleven_multilingual_v2'); // fall back to flagship if model unavailable on account
  }
  if (!res.ok) return null;
  let j; try { j = await res.json(); } catch { return null; }
  const al = j.alignment || {};
  return {
    audio: stripId3(b64ToBytes(j.audio_base64 || '')),
    chars: al.characters || [],
    starts: al.character_start_times_seconds || [],
    ends: al.character_end_times_seconds || [],
  };
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Strip a leading ID3v2 tag so concatenated chunks form one continuous mp3 stream.
// A mid-stream ID3 header is what made iOS loop the first segment forever.
function stripId3(bytes) {
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    return bytes.subarray(10 + size);
  }
  return bytes;
}

/* -------------------------------------------------------------- helpers */

function shape(row, withBody = false) {
  const out = {
    id: row.id, title: row.title,
    duration_sec: row.duration_sec || 0,
    position_sec: row.position_sec || 0,
    char_count: row.char_count || 0,
    voice: row.voice, status: row.status,
    created_at: row.created_at, updated_at: row.updated_at,
    audio_url: row.audio_path ? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${row.audio_path}` : null,
  };
  if (withBody) {
    out.body = row.body || '';
    out.narration_text = row.narration_text || '';
    out.words = row.words || [];
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function concat(pieces) {
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const p of pieces) { merged.set(p, off); off += p.length; }
  return merged;
}

function chunkText(text, max = CHUNK_LIMIT) {
  if (text.length <= max) return [text];
  const out = [];
  let buf = '';
  for (const p of text.split(/\n\n+/)) {
    if (p.length > max) {
      const sentences = p.match(/[^.!?]+[.!?]+/g) ?? [p];
      for (const s of sentences) {
        if ((buf + ' ' + s).trim().length > max) { if (buf) out.push(buf.trim()); buf = s; }
        else buf = buf ? buf + ' ' + s : s;
      }
    } else if ((buf + '\n\n' + p).length > max) { out.push(buf.trim()); buf = p; }
    else buf = buf ? buf + '\n\n' + p : p;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function sb(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', SUPABASE_KEY);
  headers.set('Authorization', `Bearer ${SUPABASE_KEY}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  return fetch(`${SUPABASE_URL}${path}`, { ...init, headers, signal: AbortSignal.timeout(115_000) });
}

function ok(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
function err(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
