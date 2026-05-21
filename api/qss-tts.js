import { checkAccess } from './_lib/access.js';

// Edge runtime. Single short clip per call (no chunking needed for QSS —
// blocks are 1-3 sentences, options are 5-12 lines). Streams MP3.
export const config = { runtime: 'edge', maxDuration: 60 };

// Voice presets — warm, kid-friendly, storyteller-y. Matilda is the
// default because it's calibrated for narration with gentle warmth.
const VOICES = {
  matilda:   'XrExE9yKIg1WjnnlVkGX',   // warm, gentle storyteller (default)
  rachel:    '21m00Tcm4TlvDq8ikWAM',   // clear, friendly female
  charlotte: 'XB0fDUnXU5powFXDhCwa',   // soft narrator
  bella:     'EXAVITQu4vr4xnSDxMaL',   // soft warm female
  adam:      'pNInz6obpgDQGcFmaJgB',   // warm male narrator
  parley:    'ZF6FPAbjXT4488VcRRnw',   // Johnny's DA voice
};

const DEFAULT_VOICE = VOICES.matilda;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const denied = checkAccess(req);
  if (denied) return denied;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  let text = (body.text || '').toString().trim();
  if (!text) return new Response(JSON.stringify({ error: 'text required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  // Cap to a reasonable length — single chunk, no streaming concat
  if (text.length > 4800) text = text.slice(0, 4800);

  // Voice resolution: short alias name OR full voice id
  let voiceId = (body.voice || '').toString().trim();
  if (VOICES[voiceId]) voiceId = VOICES[voiceId];
  if (!voiceId) voiceId = DEFAULT_VOICE;

  // Model — prefer v3 (most expressive), fall back to multilingual_v2 (most reliable)
  const requestedModel = (body.model || 'eleven_v3').toString();
  // Voice settings — warm + expressive, dialed for a kid-storytelling vibe
  const voiceSettings = {
    stability: 0.42,        // some variation, doesn't drone
    similarity_boost: 0.85, // stays in-voice
    style: 0.6,             // expressive but not theatrical
    use_speaker_boost: true,
  };

  async function tryModel(modelId) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_192`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: voiceSettings,
      }),
    });
    return res;
  }

  let res = await tryModel(requestedModel);
  if (!res.ok && (res.status === 400 || res.status === 403 || res.status === 404) && requestedModel !== 'eleven_multilingual_v2') {
    res = await tryModel('eleven_multilingual_v2');
  }

  if (!res.ok) {
    const t = await res.text();
    return new Response(JSON.stringify({ error: `elevenlabs ${res.status}: ${t.slice(0, 300)}` }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  const audio = new Uint8Array(await res.arrayBuffer());
  return new Response(audio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.length),
      'Cache-Control': 'public, max-age=604800, immutable',
    },
  });
}
