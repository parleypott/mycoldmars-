import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 120 };

const CHUNK_LIMIT = 4800;
const VOICE_DEFAULT = 'ZF6FPAbjXT4488VcRRnw';

function chunkText(text, max = CHUNK_LIMIT) {
  if (text.length <= max) return [text];
  const out = [];
  const paragraphs = text.split(/\n\n+/);
  let buf = '';
  for (const p of paragraphs) {
    if (p.length > max) {
      const sentences = p.match(/[^.!?]+[.!?]+/g) ?? [p];
      for (const s of sentences) {
        if ((buf + ' ' + s).trim().length > max) {
          if (buf) out.push(buf.trim());
          buf = s;
        } else {
          buf = buf ? buf + ' ' + s : s;
        }
      }
    } else if ((buf + '\n\n' + p).length > max) {
      out.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function strip(md) {
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
  const denied = checkAccess(req);
  if (denied) return denied;

  let { text, voice, stripMarkdown } = await req.json();
  if (!text || !text.trim()) {
    return new Response(JSON.stringify({ error: 'text required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (stripMarkdown) text = strip(text);
  const voiceId = voice || VOICE_DEFAULT;

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
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.38,
          similarity_boost: 0.88,
          style: 0.45,
          use_speaker_boost: true,
        },
      }),
    });
    if (!res.ok) {
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
