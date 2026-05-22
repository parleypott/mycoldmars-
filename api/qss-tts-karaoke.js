import { checkAccess } from './_lib/access.js';

// Edge runtime — calls ElevenLabs's WITH-TIMESTAMPS endpoint and returns
// audio + character/word timing data the client uses for karaoke-style
// word-by-word highlighting as the audio plays.
//
// Trade-off: this can't stream the audio chunked the way qss-tts.js does
// because we need the full alignment payload up front. Henry tolerates the
// extra ~1-2s startup lag in exchange for the read-along.
export const config = { runtime: 'edge', maxDuration: 60 };

const VOICES = {
  matilda:   'XrExE9yKIg1WjnnlVkGX',   // warm, gentle storyteller (default)
  rachel:    '21m00Tcm4TlvDq8ikWAM',
  charlotte: 'XB0fDUnXU5powFXDhCwa',
  bella:     'EXAVITQu4vr4xnSDxMaL',
  adam:      'pNInz6obpgDQGcFmaJgB',
  parley:    'ZF6FPAbjXT4488VcRRnw',
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

  let text = (body.text || '').toString();
  // Don't trim — leading/trailing whitespace would shift word boundaries.
  // Just guard length and basic non-empty.
  if (!text.trim()) return new Response(JSON.stringify({ error: 'text required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (text.length > 4800) text = text.slice(0, 4800);

  let voiceId = (body.voice || '').toString().trim();
  if (VOICES[voiceId]) voiceId = VOICES[voiceId];
  if (!voiceId) voiceId = DEFAULT_VOICE;

  // Use flash for speed — Henry tolerates slight quality dip for the
  // read-along snappiness. Format must be mp3 for browser <audio>.
  const modelId = (body.model || '').toString() || 'eleven_flash_v2_5';
  const outputFormat = (body.format || '').toString() || 'mp3_44100_128';

  const voiceSettings = {
    stability: 0.42,
    similarity_boost: 0.85,
    style: modelId.includes('flash') ? 0.55 : 0.5,
    use_speaker_boost: true,
  };

  // The "with-timestamps" endpoint returns JSON containing both the base64
  // mp3 AND character-level alignment data. We then group chars → words.
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${outputFormat}`;

  async function callEleven(mid) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: mid,
        voice_settings: voiceSettings,
      }),
    });
  }

  let res = await callEleven(modelId);
  if (!res.ok && (res.status === 400 || res.status === 403 || res.status === 404) && modelId !== 'eleven_multilingual_v2') {
    res = await callEleven('eleven_multilingual_v2');
  }
  if (!res.ok) {
    const t = await res.text();
    return new Response(JSON.stringify({ error: `elevenlabs ${res.status}: ${t.slice(0, 300)}` }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  let data;
  try { data = await res.json(); }
  catch (e) {
    return new Response(JSON.stringify({ error: 'invalid response from elevenlabs' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ElevenLabs returns:
  //   data.audio_base64                                — base64 mp3
  //   data.alignment.{characters, character_start_times_seconds, character_end_times_seconds}
  //   data.normalized_alignment.* (same shape, normalized for spoken variants)
  // We use `alignment` because the `characters` array matches the original
  // input text — which is what the client renders. The normalized variant
  // may differ (numbers expanded to words, etc.) and would break the
  // char-index → DOM mapping.
  const alignment = data.alignment || data.normalized_alignment || {};
  const words = groupCharsIntoWords(text, alignment);

  return new Response(JSON.stringify({
    audio_base64: data.audio_base64,
    mime: 'audio/mpeg',
    words,
    duration: words.length ? words[words.length - 1].end : 0,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // 7-day immutable cache — audio for an unchanged text is identical.
      'Cache-Control': 'public, max-age=604800, immutable',
    },
  });
}

// Walk the character-level alignment and group runs of non-whitespace into
// words. Punctuation glomms onto whatever word it sits adjacent to, which
// matches how a reader visually scans ("hello," is one chunk, not two).
//
// Returns: [{ text, start, end, charStart, charEnd }]
//   charStart / charEnd index into the ORIGINAL text so the client can
//   highlight by substring slice (cheap + collision-free).
function groupCharsIntoWords(srcText, alignment) {
  const chars = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  const words = [];

  let buf = '';
  let bufStartTime = -1;
  let bufEndTime = -1;
  let bufCharStart = 0;
  let bufCharEnd = 0;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const isWS = /\s/.test(ch);
    if (!isWS) {
      if (buf === '') {
        bufStartTime = typeof starts[i] === 'number' ? starts[i] : -1;
        bufCharStart = i;
      }
      buf += ch;
      bufEndTime = typeof ends[i] === 'number' ? ends[i] : bufEndTime;
      bufCharEnd = i + 1;
    } else if (buf) {
      words.push({
        text: buf,
        start: bufStartTime,
        end: bufEndTime,
        charStart: bufCharStart,
        charEnd: bufCharEnd,
      });
      buf = '';
      bufStartTime = -1;
      bufEndTime = -1;
    }
  }
  if (buf) {
    words.push({
      text: buf,
      start: bufStartTime,
      end: bufEndTime,
      charStart: bufCharStart,
      charEnd: bufCharEnd,
    });
  }
  return words;
}
