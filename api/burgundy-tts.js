import { validateTtsRequest } from './_lib/burgundy-tts-validate.js';

export const config = { runtime: 'edge', maxDuration: 60 };

/**
 * Paragraph narration for the BERGUNDY reader (/burgundy) — cache-first.
 *
 *   POST /api/burgundy-tts   body: { text, voice_id? }
 *   → { url, cached }        url = public mp3 in Supabase storage
 *
 * Every paragraph is synthesized AT MOST ONCE per voice: audio is keyed by
 * sha-256(voice::text) in the public `burgundy-audio` bucket, so repeat
 * listens (and every other reader) stream the cached file straight from
 * storage. Same trust model as burgundy-notes: one trusted reader at an
 * unlisted URL; the text cap bounds worst-case spend per call.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;

const BUCKET = 'burgundy-audio';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return json(500, { error: 'supabase env missing' });
  if (!ELEVEN_KEY) return json(500, { error: 'elevenlabs env missing' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'bad json' }); }
  const v = validateTtsRequest(body);
  if (v.error) return json(v.status, { error: v.error });
  const { text, voice } = v;

  const hash = await sha256hex(`${voice}::${text}`);
  const path = `${voice}/${hash}.mp3`;
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  // cache hit? the bucket is public, a HEAD is free
  try {
    const head = await fetch(publicUrl, { method: 'HEAD' });
    if (head.ok) return json(200, { url: publicUrl, cached: true });
  } catch { /* treat as miss */ }

  // synthesize — 128k mp3 is plenty for spoken word on a phone
  const el = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!el.ok) {
    const t = await el.text();
    return json(502, { error: `elevenlabs ${el.status}: ${t.slice(0, 200)}` });
  }
  const mp3 = await el.arrayBuffer();

  // store it — next listener streams from the bucket, ElevenLabs never re-bills
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      'Content-Type': 'audio/mpeg',
      'x-upsert': 'true',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: mp3,
  });
  if (!up.ok) {
    const t = await up.text();
    return json(502, { error: `storage upload failed: ${t.slice(0, 200)}` });
  }
  return json(200, { url: publicUrl, cached: false });
}
