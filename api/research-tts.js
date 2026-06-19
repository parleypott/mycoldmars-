import { readJsonBody } from './_lib/read-json-body.js';

export const config = { runtime: 'edge', maxDuration: 120 };

const CHUNK_LIMIT = 4800;
const VOICE_DEFAULT = 'ZF6FPAbjXT4488VcRRnw';

export function chunkText(text, max = CHUNK_LIMIT) {
  if (text.length <= max) return [text];
  const out = [];
  const paragraphs = text.split(/\n\n+/);
  let buf = '';
  // Flush the working buffer as a chunk — never push an empty/whitespace chunk
  // (an empty chunk would be POSTed to ElevenLabs and fail the whole readout).
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
  for (const p of paragraphs) {
    if (p.length > max) {
      const sentences = p.match(/[^.!?]+[.!?]+/g) ?? [p];
      for (const s of sentences) {
        if (s.length > max) {
          // A single sentence (or a punctuation-less run) longer than the cap:
          // hard-split it so no chunk can ever exceed `max`.
          flush();
          for (let i = 0; i < s.length; i += max) {
            const piece = s.slice(i, i + max).trim();
            if (piece) out.push(piece);
          }
          continue;
        }
        if ((buf + ' ' + s).trim().length > max) {
          flush();
          buf = s;
        } else {
          buf = buf ? buf + ' ' + s : s;
        }
      }
    } else if ((buf + '\n\n' + p).length > max) {
      flush();
      buf = p;
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
  }
  flush();
  return out;
}

export function strip(md) {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[\d+\]/g, '')
    .replace(/^>+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
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
