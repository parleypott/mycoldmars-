import { checkAccess } from './_lib/access.js';

// Edge runtime — streaming straight through ElevenLabs's stream endpoint
// so the browser starts receiving MP3 bytes within ~300-500ms instead of
// waiting 3-5s for the full file.
export const config = { runtime: 'edge', maxDuration: 60 };

// Voice presets — warm, kid-friendly, storyteller-y. Matilda is the
// default because it's calibrated for narration with gentle warmth.
const VOICES = {
  matilda:   'XrExE9yKIg1WjnnlVkGX',   // warm adult female narrator (default)
  gigi:      'jBpfuIE2acCO8z3wKNLl',   // bright child girl
  mimi:      'zrHiDhphv9ZnVXBqCLjz',   // young child voice
  liam:      'TX3LPaxmHKxFdv7VOQHJ',   // young adult male, American
  charlie:   'IKne3meq5aSn9XLyUdCD',   // casual young male, Australian
  george:    'JBFqnCBsd6RMkjVDRZzb',   // warm adult male, British
  daniel:    'onwK4e9ZLuTAKqWW03F9',   // deep adult male, UK
  dorothy:   'ThT5KcBeYPX3keUQqHPh',   // older female, warm
  adam:      'pNInz6obpgDQGcFmaJgB',   // deep adult male, consultant voice
  charlotte: 'XB0fDUnXU5powFXDhCwa',   // soft adult female, narrator
  parley:    'ZF6FPAbjXT4488VcRRnw',   // Johnny's voice
};

const ELEVEN_VOICE_ID_SHAPE = /^[A-Za-z0-9]{20}$/;

const DEFAULT_VOICE = VOICES.matilda;

// Speed presets — model + bitrate combo
//   'fast'  → flash_v2_5 + 64kbps  (latency ~400ms, smaller file)
//   'mid'   → turbo_v2_5 + 128kbps (latency ~1s, better quality)
//   'rich'  → multilingual_v2 + 192kbps (latency ~2-3s, premium)
const SPEED = {
  fast: { model: 'eleven_flash_v2_5',     fmt: 'mp3_44100_64'  },
  mid:  { model: 'eleven_turbo_v2_5',     fmt: 'mp3_44100_128' },
  rich: { model: 'eleven_multilingual_v2', fmt: 'mp3_44100_192' },
};
const DEFAULT_SPEED = 'fast';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const denied = await checkAccess(req);
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
  if (text.length > 4800) text = text.slice(0, 4800);

  let voiceId = (body.voice || '').toString().trim();
  if (VOICES[voiceId]) voiceId = VOICES[voiceId];
  else if (!ELEVEN_VOICE_ID_SHAPE.test(voiceId)) voiceId = DEFAULT_VOICE;

  // Speed tier — default to 'fast' (flash) for snappy QSS playback.
  // Caller can override: { speed: 'mid' } or { speed: 'rich' }.
  const speed = SPEED[body.speed] || SPEED[DEFAULT_SPEED];
  // If caller passes model_id explicitly that wins (advanced use).
  const modelId = (body.model || '').toString() || speed.model;
  const outputFormat = (body.format || '').toString() || speed.fmt;

  // Voice settings: tuned per model. Flash is faster but flatter — bump
  // expressivity. Multilingual and turbo handle style well at lower numbers.
  const styleByModel = modelId.includes('flash') ? 0.55 : 0.5;
  const voiceSettings = {
    stability: 0.42,
    similarity_boost: 0.85,
    style: styleByModel,
    use_speaker_boost: true,
  };

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${outputFormat}`;

  async function callEleven(mid) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: mid,
        voice_settings: voiceSettings,
        // optimize_streaming_latency: 3 reduces first-byte time at a tiny
        // quality cost. ElevenLabs' own recommendation for live UI.
        optimize_streaming_latency: 3,
      }),
    });
  }

  let res = await callEleven(modelId);
  // Fall back to multilingual_v2 if the requested model isn't available
  if (!res.ok && (res.status === 400 || res.status === 403 || res.status === 404) && modelId !== 'eleven_multilingual_v2') {
    res = await callEleven('eleven_multilingual_v2');
  }
  if (!res.ok) {
    const t = await res.text();
    return new Response(JSON.stringify({ error: `elevenlabs ${res.status}: ${t.slice(0, 300)}` }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Stream the upstream MP3 body straight through — no buffering. The
  // browser starts playback as soon as enough bytes arrive.
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=604800, immutable',
      // Hint to clients/CDNs that this is a streamed response.
      'Transfer-Encoding': 'chunked',
    },
  });
}
