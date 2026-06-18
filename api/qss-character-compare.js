// queen-scarlet-school: compare two loved portraits and tell Henry
// (in Wordy's voice) when they're showing meaningfully different
// versions of the same character.
//
// Why: Henry can ♥ multiple portraits. The cast page uses ♥'d portraits
// as style anchors when redrawing. If he loves two portraits that look
// like totally different characters, the next "regen from loved" call
// gets confused style references. This endpoint catches that EARLY by
// having Gemini Vision actually LOOK at the two images and decide
// whether they're meaningfully different.
//
// Body: { character_name: string, images: [{ mimeType, dataBase64 }, ...] }
// Cap: up to 4 images per call.
//
// Response: {
//   incompatible: boolean,
//   reason: string,        // short kid-clear explanation if incompatible
//   wordy_message: string, // single chat-ready sentence in Wordy's voice
// }
//
// Edge runtime: a single Gemini multimodal call typically returns in
// 4-9s — well under the 25s edge cap.

import { checkAccess } from './_lib/access.js';
import { safeImageRef } from './_lib/gemini-image-ref.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

const COMPARE_PROMPT = `You are looking at multiple portraits that a kid has marked as "I love this version of this character." Your job is ONE thing: do these images show MEANINGFULLY DIFFERENT versions of the same character, or are they consistent enough to be the same character?

Examples of MEANINGFULLY DIFFERENT (flag it):
- Different head/face (one has a calculator helmet swallowing the head, another has a normal kid face)
- Different species (one is human, one is a beaver, one is a dragon)
- Different signature props that DEFINE the character (one carries a clipboard with all the equations, the other carries a tray of beans)
- Different hair color and skin tone with no shared visual feature

Examples of NOT meaningfully different (don't flag):
- Same character, different expressions (smile vs frown)
- Same character, slightly different outfit colors
- Same character, different framing or pose
- One holds a slightly different object — minor accessory swap

Return STRICT JSON. NO prose outside the object:

{
  "incompatible": true | false,
  "reason": "one short sentence in plain kid-level English. mention the specific visual things that are different. If not incompatible, leave as empty string.",
  "wordy_message": "if incompatible: one warm, friendly sentence Wordy would say to Henry — pointing out the difference and asking which direction he wants. 25 words max. Plain words, no jargon. If not incompatible: empty string."
}

Plain-language voice rules for wordy_message:
- Address Henry directly (not "the user")
- Friendly tone. Curious, not scolding. ("hey, i noticed..." / "wait, these two are kinda different..." / "quick check —")
- Don't say "incompatible" or "inconsistent" — say "kinda different" or "look like different kids" or "totally different vibes"
- Ask which one he wants to keep
- NEVER use these AI-essay words: weave, tapestry, delve, unpack, intricate, the story needs, tipping into
- One sentence. Period.`;

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const denied = await checkAccess(req);
  if (denied) return withCors(denied);

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return json(500, { error: 'GEMINI_API_KEY not configured' });

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'invalid JSON' }); }

  const characterName = String(body.character_name || 'this character').slice(0, 80);
  const rawImages = Array.isArray(body.images) ? body.images.slice(0, 4) : [];

  // Validate each image via the shared Gemini-image-ref guard (SSRF, size,
  // and a mime allow-list that matches Gemini's inlineData — jpg normalized
  // to jpeg, gif dropped, so an unusable image is skipped instead of 400ing
  // the whole compare call).
  const MAX_IMG_BYTES = 6 * 1024 * 1024;
  const images = [];
  for (const raw of rawImages) {
    const ref = safeImageRef(raw, MAX_IMG_BYTES);
    if (ref) images.push(ref);
  }
  if (images.length < 2) {
    return json(200, { incompatible: false, reason: '', wordy_message: '' });
  }

  // Build a multimodal Gemini request: images in order, then the prompt.
  const parts = [];
  for (const img of images) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.dataBase64 } });
  }
  parts.push({ text: `Character name: "${characterName}".\n\n${COMPARE_PROMPT}` });

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });
  } catch (err) {
    return json(502, { error: 'gemini_unreachable', detail: (err?.message || '').slice(0, 200) });
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return json(res.status, { error: `gemini_${res.status}`, detail: t.slice(0, 200) });
  }

  const data = await res.json().catch(() => ({}));
  const rawText = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
  let parsed;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return json(502, { error: 'parse_failed', detail: 'gemini returned non-JSON. snippet: ' + rawText.slice(0, 120) });
  }

  return json(200, {
    incompatible: !!parsed.incompatible,
    reason: String(parsed.reason || '').slice(0, 240),
    wordy_message: String(parsed.wordy_message || '').slice(0, 280),
  });
}
