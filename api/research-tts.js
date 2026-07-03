import { readJsonBody } from './_lib/read-json-body.js';
// chunkText AND stripMarkdown are the single, mutation-locked TTS helpers shared
// with the Burma Essays narrator. Both feed the same ElevenLabs per-request budget
// (CHUNK_LIMIT = 4800) and the same synth voice, so there must be exactly ONE
// implementation of each — no divergent copy to drift.
import { chunkText, stripMarkdown } from './_lib/burma-essays-text.js';

export const config = { runtime: 'edge', maxDuration: 120 };

const VOICE_DEFAULT = 'ZF6FPAbjXT4488VcRRnw';

export { chunkText };

// strip() = the shared, hardened stripMarkdown core PLUS one research-only rule.
//
// The old local copy was a DIVERGENT-WEAKER twin of stripMarkdown: it missed bare
// URLs (deep-research output is full of them — ElevenLabs reads "h-t-t-p-s colon
// slash slash…" letter by letter), tables, thematic breaks (---), HTML comments,
// autolinks, AND it mangled __bold__ into "_strong_" and read ~~strike~~ as "tilde".
// Delegating to the shared core kills all of those leaks at once and ends the drift.
//
// The one rule that stays LOCAL: numeric citation markers that deep-research prose
// sprinkles inline and that would otherwise be read aloud as "bracket three". Burma
// essays don't use those, so it doesn't belong in the shared core. Applied after
// stripMarkdown (which leaves bare citations untouched).
//
// Handles the full citation shape, not just a lone [3]: research/academic output
// routinely CLUSTERS ("[3, 5]", "[3; 5]", "[3, 5, 7]") and RANGES ("[3-5]", the
// en-dash "[3–5]", the em-dash "[3—5]") its references. The old /\[\d+\]/ caught
// only a single number, so every cluster/range LEAKED into the audio, read aloud as
// "open bracket three comma five close bracket" — the exact read-it-aloud failure
// this stripping exists to kill. The pattern requires the bracket body to be ONLY
// digits joined by citation separators (start and end on a digit), so real prose
// brackets ("[see below]", "[3 things]", "[Smith 2020]", a decimal "[3.5]") are
// never touched. Removing a citation leaves a double space at the seam ("coup [3, 5]
// fell" -> "coup  fell"); the [ \t]{2,} collapse closes it so the readout is clean.
// Newlines are untouched, so paragraph structure survives. Final trim in case a
// citation sat at the very end.
export function strip(md) {
  return stripMarkdown(String(md ?? ''))
    .replace(/\[\d+(?:\s*[-–—,;]\s*\d+)*\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return new Response(JSON.stringify({ error: parsed.error }), { status: parsed.status, headers: { 'Content-Type': 'application/json' } });
  let { text, voice, model, stripMarkdown } = parsed.body;
  if (!text || !text.trim()) {
    return new Response(JSON.stringify({ error: 'text required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  // Cost guard: ElevenLabs premium voices bill per character. Without
  // a cap, a malicious caller could POST a 5 MB string and run up the
  // monthly bill. 50 KB is plenty for a research-tier readout.
  const MAX_INPUT = 50_000;
  if (text.length > MAX_INPUT) {
    return new Response(JSON.stringify({ error: `text too long (max ${MAX_INPUT} chars)` }), {
      status: 413, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (stripMarkdown) text = strip(text);
  const voiceId = voice || VOICE_DEFAULT;
  const modelId = model || 'eleven_v3';

  const chunks = chunkText(text);
  const pieces = [];
  for (let i = 0; i < chunks.length; i++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_192`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: chunks[i],
        model_id: modelId,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.85,
          style: 0.55,
          use_speaker_boost: true,
        },
      }),
    });
    if (!res.ok) {
      // If the requested model is unavailable on this account, fall back once to the proven flagship.
      if (modelId !== 'eleven_multilingual_v2' && (res.status === 400 || res.status === 403 || res.status === 404)) {
        const retry = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_192`, {
          method: 'POST',
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: chunks[i],
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.4, similarity_boost: 0.88, style: 0.5, use_speaker_boost: true },
          }),
        });
        if (retry.ok) {
          pieces.push(new Uint8Array(await retry.arrayBuffer()));
          continue;
        }
      }
      const t = await res.text();
      return new Response(JSON.stringify({ error: `elevenlabs ${res.status} on chunk ${i + 1}: ${t.slice(0, 300)}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    pieces.push(new Uint8Array(await res.arrayBuffer()));
  }

  // Concat MP3 frames (self-contained, naive concat works for sequential playback)
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const p of pieces) {
    merged.set(p, offset);
    offset += p.length;
  }

  return new Response(merged, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(total),
      'Cache-Control': 'no-store',
    },
  });
}
