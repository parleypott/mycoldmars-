// queen-scarlet-school: detect scene-break offsets inside a long block.
//
// A story block in QSS can be one short beat or one giant wall of
// prose. The Storybook reader needs to know WHERE inside that block
// the picture should change. This endpoint reads the block text and
// returns a list of CHARACTER OFFSETS where new image cues should be
// placed — at moments where a fresh visual would help.
//
// What counts as a scene break:
//   1. Explicit movie-direction cuts ("Cut to:", "Meanwhile", "Three
//      weeks earlier", "Back at the bunker", etc.)
//   2. A new character enters / takes the stage
//   3. The setting / location changes
//   4. A big tonal swing (action → dialogue, calm → chaos)
//   5. A surprising new image / object enters the story
//
// Body: { text: string, world?: string }
// Response: { breaks: [{ offset: number, label: string, why: string }] }
//
// The first cue at offset=0 is implicit — we always return ADDITIONAL
// breaks. Returns [] for short blocks. Empty offsets are fine.
//
// Cheap Haiku call. Aim for 0-5 breaks per block; never more than 8.

import { checkAccess } from './_lib/access.js';
import { canonOverlayForBody } from './_lib/qss-worlds.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

const SYSTEM = `You read a single block of a kid's story and decide where the ILLUSTRATION should change. Your output is a list of character offsets inside the input text where a new picture would help the reader visualize what's happening.

You're acting as a picture-book art director. One picture per beat. Don't break too often (no break per sentence), don't break too rarely (no walls of text without visuals).

ALWAYS BREAK AT:
- Explicit cuts: "Cut to:", "Meanwhile,", "Back at...", time jumps like "three weeks earlier" or "the next morning".
- A new important character enters the scene for the first time in this block.
- The setting changes — a different room, a different planet, a flashback.
- A big tonal swing — calm to chaos, dialogue to action, action to quiet aftermath.
- A surprising new IMAGE enters the story — a giant cardboard box, a forklift, a check, anything visually striking.

DO NOT BREAK AT:
- Every sentence. Every paragraph. Every line of dialogue.
- Tiny camera moves that the same picture could cover.
- A character pausing or thinking inside the same beat.

OFFSET RULES (critical):
- The offset is the character index in the INPUT text where the new picture should start being relevant.
- Use the START of the sentence where the new beat begins (or "Cut to:" line, or the character's entrance sentence).
- Offsets must be > 0 and < text.length.
- Offsets must be in increasing order.
- Never two breaks within 200 chars of each other.

OUTPUT — strict JSON, no prose outside the object:

{
  "breaks": [
    { "offset": 184, "label": "boxes appear", "why": "first image of the orange boxes" },
    { "offset": 612, "label": "Scarlet enters", "why": "Queen Scarlet arrives in the new sash" },
    { "offset": 1340, "label": "Mark's studio, three weeks earlier", "why": "explicit cut to flashback" }
  ]
}

If the text is short (<400 chars) or there are no natural breaks, return { "breaks": [] }.
Cap at 8 breaks total.`;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const denied = await checkAccess(req);
  if (denied) {
    const h = new Headers(denied.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(denied.body, { status: denied.status, headers: h });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'invalid JSON' }); }

  const text = String(body.text || '').slice(0, 8000);
  if (!text.trim()) return json(200, { breaks: [] });
  if (text.length < 400) return json(200, { breaks: [] });

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system: SYSTEM + canonOverlayForBody(body),
        messages: [{
          role: 'user',
          content: `Find the image-break offsets inside this story block. Return the JSON object only.\n\nTEXT (length=${text.length}):\n${text}`,
        }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return json(502, { error: 'anthropic_unreachable', detail: err?.message || String(err) });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return json(res.status, { error: `anthropic_${res.status}`, detail: errText.slice(0, 300) });
  }

  let payload;
  try { payload = await res.json(); }
  catch { return json(502, { error: 'anthropic_bad_json' }); }

  const rawText = payload?.content?.[0]?.text || '';
  let parsed;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return json(502, { error: 'parse_failed', detail: rawText.slice(0, 120) });
  }

  // Validate offsets — must be within text, increasing, deduped, not too close
  const rawBreaks = Array.isArray(parsed.breaks) ? parsed.breaks : [];
  const breaks = [];
  let lastOffset = 0;
  for (const b of rawBreaks) {
    if (!b || typeof b !== 'object') continue;
    const o = Math.floor(Number(b.offset));
    if (!Number.isFinite(o) || o <= 0 || o >= text.length) continue;
    if (o - lastOffset < 200) continue;
    // Snap the offset to the start of the nearest sentence/clause boundary
    // by scanning backwards for sentence-ending punctuation + whitespace
    const snapped = snapToSentenceStart(text, o);
    if (snapped - lastOffset < 200) continue;
    breaks.push({
      offset: snapped,
      label: String(b.label || '').slice(0, 80).trim(),
      why: String(b.why || '').slice(0, 200).trim(),
    });
    lastOffset = snapped;
    if (breaks.length >= 8) break;
  }

  return json(200, { breaks });
}

// Move backwards from offset to the start of the current sentence so
// the cue marker doesn't land mid-sentence. Looks for `[.!?]\s+[A-Z"]`
// or the start of text, whichever comes first. Falls back to original
// offset if nothing's found within 400 chars.
function snapToSentenceStart(text, offset) {
  const lo = Math.max(0, offset - 400);
  for (let i = offset; i >= lo; i--) {
    if (i === 0) return 0;
    const c = text[i - 1];
    if (/[.!?]/.test(c) && /\s/.test(text[i] || '') && /[A-Z"“'']/.test(text[i + 1] || '')) {
      // Skip the whitespace after the punctuation
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      return j;
    }
  }
  return offset;
}
