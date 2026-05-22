// queen-scarlet-school: per-character "playing card" generator.
// Given a character {name, current_state, intro_block} and surrounding story
// context, returns:
//   - synopsis: jokey/absurdist 3-4 sentences (Claude Haiku 4.5)
//   - portrait image: dataBase64 from nano-banana (gemini flash image preview)
//   - portraitPrompt: the prompt used (debug)
//
// Body: {
//   character: { name, current_state, intro_block },
//   arc: { synopsis, characters[], themes[], tones[] } | null,
//   recentBlocks: [{ text }],  // for tone matching
//   rules: { goal, bible }     // optional
// }
//
// Response: { synopsis, image: { mime, dataBase64 }, portraitPrompt, ms, model }
//
// Notes
//  - Two upstream calls in parallel when possible (Claude + Gemini); the
//    portrait prompt is derived locally from the character's name + state so
//    we don't need to wait for the synopsis to start the image.
//  - Cached client-side per (story_id, character_name); regeneration is opt-in.
//  - Voice / tone matches the rest of the WRITING_DISCIPLINE preamble — no
//    AI-thesaurus tropes, no "weaving threads", no overproduction.

import { checkAccess as sharedCheckAccess } from './_lib/access.js';
import { canonForName, canonContextBlock } from './_lib/qss-canon.js';

// Gemini image-gen reliably takes 20-40s when the model's busy, and Vercel
// Edge defaults to a 25s function timeout. Bumping to 60s so we don't race
// the timeout on cold-cache draws.
export const config = { runtime: 'edge', maxDuration: 60 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SYNOPSIS_SYSTEM = `You write character cards for a 13-year-old's story-writing tool. The kid is autistic, brilliant, writes dark satirical absurdist stories about a magical school. You're writing the back of a trading-card-style playing card.

Voice: deadpan-absurd, sincere-then-undercut, specific. NEVER use these AI-essay tropes: "pulling threads", "tipping into", "the story needs", "delve", "unpack", "intricate", "in essence", "think of it as", "weave", "tapestry". Don't moralize. Don't summarize themes. Don't tell the reader what to feel.

What to write (3-4 short sentences, ~50-90 words total):
1. The single thing you'd say at a party to introduce this character — one specific detail, not a label
2. What they're doing in the story right now — a concrete action or position
3. One small absurd or sincere detail that makes them feel real — a habit, a fear, a possession, a misunderstanding
4. (optional) A one-liner of their voice or a thing they'd say

DON'T:
- start with "Meet [name]"
- end with anything that sounds like a tagline
- explain their arc
- repeat their name 5 times
- moralize about whether what they do is good

DO:
- match the dark satirical tone of the existing story
- treat the character like the kid wrote them — preserve absurd specifics
- name beans, calculators, helmets, paperwork, the specific real things in the story
- write the way Henry would describe his friend to another friend who hasn't read the story yet

Return ONLY the synopsis text. No JSON, no markup, no preamble.`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const t0 = Date.now();
  const denied = await checkAccess(req);
  if (denied) return withCors(denied);

  // NOTE: a whoAmI() Supabase-user check used to live here, blocking
  // anyone not signed into Supabase. QSS doesn't have user accounts —
  // clients pass through the gate password → x-access-code bootstrap.
  // The shared perimeter (checkAccess above) is the appropriate gate
  // for this app; requiring real Supabase auth broke every card.

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!anthropicKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });
  if (!geminiKey) return json(500, { error: 'GEMINI_API_KEY not configured' });

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'invalid JSON' }); }

  const ch = body.character || {};
  const name = String(ch.name || '').trim();
  if (!name) return json(400, { error: 'character.name required' });
  const currentState = String(ch.current_state || '').trim();
  const introBlock = Number(ch.intro_block) || null;

  const arc = body.arc || {};
  const themes = Array.isArray(arc.themes) ? arc.themes : [];
  const tones = Array.isArray(arc.tones) ? arc.tones : [];
  const arcSynopsis = String(arc.synopsis || '').trim();
  const recentBlocks = Array.isArray(body.recentBlocks) ? body.recentBlocks.slice(-6) : [];
  const recentText = recentBlocks.map((b, i) => `[${i + 1}] ${(b.text || '').trim()}`).join('\n\n');

  // World canon — non-negotiable facts about this character if they're canonical.
  // E.g. Queen Scarlet IS a red dragon; the model doesn't get to make her a human.
  const subjectCanon = canonForName(name);
  const canonBlock = canonContextBlock([name]);

  // ── Revise-mode inputs ───────────────────────────────────────────────
  // The cast page lets Henry chat with each character to refine their look.
  // When revise=true the server skips re-writing the synopsis (it's the
  // authored bio — only Claude writes it once) and instead:
  //  - rewrites visual_notes from chat + existing notes (Claude Haiku)
  //  - generates a NEW portrait honoring the visual notes + existing
  //    primary as a referenceImage so the new draw looks like a sibling
  //    of the existing one with the requested changes.
  const isRevise = !!body.revise;
  const incomingNotes = String(body.visual_notes || '').trim();
  const chatHistory = Array.isArray(body.chat) ? body.chat.slice(-12) : [];
  const newMessage = String(body.new_message || '').trim();
  const existingSynopsis = String(body.existing_synopsis || '').trim();
  const refPortrait = (body.primary_portrait && body.primary_portrait.dataBase64)
    ? { mimeType: String(body.primary_portrait.mimeType || 'image/png'), dataBase64: String(body.primary_portrait.dataBase64) }
    : null;
  // Loved portraits — Henry ♥'d these to mark them as "this is the
  // style I want, make more like this." Validate shape, cap at 3, cap
  // each base64 size, restrict mime to image/*.
  const MAX_REF_BYTES = 6 * 1024 * 1024;
  const loved = Array.isArray(body.referenceImages) ? body.referenceImages : [];
  const lovedRefs = loved
    .filter(r => r && typeof r.dataBase64 === 'string' && typeof r.mimeType === 'string')
    .filter(r => !r.url && !r.uri && !r.fileUri && !r.src) // no URL fields — SSRF guard
    .filter(r => r.dataBase64.length <= MAX_REF_BYTES * 1.4)
    .filter(r => /^image\/(png|jpe?g|webp|gif)$/i.test(r.mimeType))
    .slice(-3)
    .map(r => ({ mimeType: r.mimeType, dataBase64: r.dataBase64 }));

  // Compose chat transcript for the model
  const chatTranscript = [
    ...chatHistory.map(m => `${(m.role === 'wordy' ? 'wordy' : 'henry')}: ${String(m.content || '').slice(0, 600)}`),
    newMessage ? `henry: ${newMessage}` : '',
  ].filter(Boolean).join('\n');

  // ── Build the user message for the synopsis / notes call ─────────────
  let claudeUser;
  if (isRevise) {
    // Revise mode: update visual_notes + produce a short chat reply.
    claudeUser = [
      `Character: ${name}`,
      canonBlock ? canonBlock : '',
      existingSynopsis ? `Existing synopsis (keep as-is):\n${existingSynopsis}` : '',
      incomingNotes ? `Current visual notes (update these):\n${incomingNotes}` : 'No visual notes yet.',
      chatTranscript ? `Chat with henry (most recent at bottom):\n${chatTranscript}` : '',
      '',
      `Two outputs, in two fenced blocks. NO preamble.`,
      ``,
      `<chat_reply>`,
      `One short sentence (10-22 words) that ACKNOWLEDGES henry's latest change request in the voice of a friendly co-conspirator. Be specific to what he said. No "let's", no "I'll", no apologies. Just confirm what's about to be redrawn. End on a period.`,
      `</chat_reply>`,
      ``,
      `<visual_notes>`,
      `Updated visual notes — 2-4 short comma-separated phrases describing the character's look right now (incorporate henry's latest request into the existing notes). E.g.: "calculator helmet, blue button-down, slouched shoulders, perpetually resigned expression". No prose. No bullets. One line.`,
      `</visual_notes>`,
    ].filter(Boolean).join('\n');
  } else {
    // First-time generation: write the synopsis + initial visual notes.
    claudeUser = [
      `Character: ${name}`,
      canonBlock ? canonBlock : '',
      currentState ? `Where they are right now: ${currentState}` : '',
      introBlock ? `Introduced around block ${introBlock}.` : '',
      arcSynopsis ? `Story so far: ${arcSynopsis}` : '',
      themes.length ? `Themes in play: ${themes.join(', ')}.` : '',
      tones.length ? `Tone of the story: ${tones.join(', ')}.` : '',
      recentText ? `Most recent story blocks for voice/tone:\n${recentText}` : '',
      '',
      `Two outputs, in two fenced blocks. NO preamble.`,
      ``,
      `<synopsis>`,
      `Back-of-the-card synopsis. 3-4 short sentences. Match the voice of the story. If WORLD CANON is provided above, every detail in it is non-negotiably true.`,
      `</synopsis>`,
      ``,
      `<visual_notes>`,
      `Initial visual notes — 2-4 short comma-separated phrases describing the character's look. E.g.: "calculator helmet, blue button-down, slouched shoulders, perpetually resigned expression". No prose, no bullets, one line.`,
      `</visual_notes>`,
    ].filter(Boolean).join('\n');
  }

  // Image prompt — includes incoming visual_notes when present.
  const portraitPrompt = buildPortraitPrompt({
    name, currentState, themes, tones, recentBlocks, subjectCanon,
    visualNotes: incomingNotes,
    isRevise,
    newMessage,
  });

  const claudePromise = callClaude(anthropicKey, claudeUser);
  const imagePromise = callNanoBanana(geminiKey, portraitPrompt, refPortrait, lovedRefs);

  const [claudeR, imgR] = await Promise.allSettled([claudePromise, imagePromise]);

  // Parse the dual-fenced response
  let synopsis = existingSynopsis;
  let chatReply = '';
  let visualNotesOut = incomingNotes;
  if (claudeR.status === 'fulfilled') {
    const raw = claudeR.value || '';
    const synM = /<synopsis>\s*([\s\S]*?)\s*<\/synopsis>/i.exec(raw);
    const notesM = /<visual_notes>\s*([\s\S]*?)\s*<\/visual_notes>/i.exec(raw);
    const replyM = /<chat_reply>\s*([\s\S]*?)\s*<\/chat_reply>/i.exec(raw);
    if (synM) synopsis = cleanSynopsis(synM[1]);
    if (notesM) visualNotesOut = cleanSynopsis(notesM[1]).replace(/\n+/g, ' ').slice(0, 400);
    if (replyM) chatReply = cleanSynopsis(replyM[1]);
    // Fallback: if the model returned only plain prose, treat the whole thing
    // as the synopsis (legacy mode).
    if (!isRevise && !synM && raw.trim()) synopsis = cleanSynopsis(raw);
  } else {
    if (!isRevise) synopsis = `(couldn't write the card right now — try regenerating)`;
    console.warn('[character-card] claude failed:', claudeR.reason);
  }

  if (imgR.status !== 'fulfilled') {
    // Soft-fail: still return the chat reply + updated notes if available so
    // the chat doesn't leave Henry hanging.
    return json(502, {
      error: 'portrait failed',
      detail: String(imgR.reason).slice(0, 400),
      synopsis,
      visual_notes: visualNotesOut,
      chat_reply: chatReply,
    });
  }

  return json(200, {
    synopsis,
    image: imgR.value,
    visual_notes: visualNotesOut,
    chat_reply: chatReply,
    portraitPrompt,
    model: { synopsis: 'claude-haiku-4-5', portrait: 'gemini-3.1-flash-image-preview' },
    ms: Date.now() - t0,
  });
}

function cleanSynopsis(s) {
  return String(s || '')
    .replace(/^\s*synopsis\s*:\s*/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
}

function buildPortraitPrompt({ name, currentState, themes, tones, recentBlocks, subjectCanon, visualNotes = '', isRevise = false, newMessage = '' }) {
  // Style anchor — match the existing QSS sticker art (Kevin in calculator
  // helmet, Benny the beaver in a gas mask on a bean forklift, the cartoon
  // dragon). Modern children's-book sticker illustration: bold consistent
  // black ink outlines, flat saturated kid-book colors, no painterly /
  // vintage / photorealistic / anime drift.
  const style = [
    'STYLE: Modern children\'s-book character sticker illustration.',
    'Thick, confident, uniform black ink outlines (consistent line weight).',
    'Flat saturated cel-shaded colors — no gradients, no painterly textures, no photographic detail, no realistic skin rendering.',
    'Palette: tomato red, butter yellow, teal, ochre, sky blue, mossy green, warm cream — saturated but warm.',
    'Background: plain warm cream / off-white paper (#F4ECD8 ish). No scenery, no environment behind the character. Centered subject.',
    'Framing: 3/4 body OR head-and-shoulders, whichever best shows the character\'s defining prop or gag.',
    'Expression: deadpan, sincere, faintly satirical — the kind of look a 13-year-old gives a teacher who just said something stupid.',
    'Quality: clean enough to be a vinyl laptop sticker. Slightly dorky. Charmingly drawn, not slick.',
  ].join(' ');

  const refs = [
    'STYLE REFERENCES (match these exactly): cartoon stickers of (1) a calculator-headed boy in a blue shirt holding a notebook, looking resigned, with a "SIGH" speech bubble; (2) a beaver in an orange safety vest and gas mask driving a yellow forklift loaded with green BEANS cans; (3) a red cartoon dragon with yellow horns and teal-and-orange wings, in front of a "QUEEN SCARLET\'S TOTALLY SAFE ACADEMY" sticker outline. Same line weight, same flat-color treatment, same warm cream paper feel.',
  ].join(' ');

  const dontList = [
    'DO NOT use any of these: vintage yearbook portraiture, painterly brushwork, watercolor texture, risograph off-register effects, photorealism, manga/anime conventions, fantasy book cover polish, glitter, sparkles, lens flare, decorative scrolls, ornate frames, gradient backgrounds, scenery, ambient props beyond what the character is holding/wearing, text, labels, name tags, signage, logos, captions, or written words of any kind anywhere in the image.',
  ].join(' ');

  const recentSnippet = recentBlocks
    .map(b => (b.text || '').trim())
    .filter(Boolean)
    .slice(-3)
    .join(' ')
    .slice(0, 400);

  const traits = currentState ? `Where they are right now in the story: "${currentState}". Use that to pick props, clothing, and pose.` : '';
  const tone = tones.length ? `Story tone keywords (for facial expression / energy): ${tones.join(', ')}.` : '';
  const story = recentSnippet ? `Snippet of recent story for visual hooks (objects, items they\'re holding, situation): "${recentSnippet}".` : '';
  const themeLine = themes.length ? `Story themes (use only if they suggest a specific visual prop, not as mood): ${themes.join(', ')}.` : '';

  // Canonical override — for established characters like Queen Scarlet,
  // these traits are non-negotiable and must dominate the user's bible /
  // story context if they conflict.
  const canonBlock = subjectCanon ? [
    `CANONICAL SUBJECT (non-negotiable — these traits OVERRIDE any contradicting story context):`,
    subjectCanon.species ? `- species: ${subjectCanon.species}` : '',
    subjectCanon.look    ? `- look: ${subjectCanon.look}` : '',
    subjectCanon.role    ? `- role: ${subjectCanon.role}` : '',
    subjectCanon.donts   ? `- must NOT draw: ${subjectCanon.donts}` : '',
  ].filter(Boolean).join('\n') : '';

  // Visual notes Henry has built up across redraws. These are the single
  // most important input — they're what makes Kevin LOOK like Kevin every
  // time. Put them HIGH in the prompt and emphasize they're authored.
  const notesBlock = visualNotes
    ? `AUTHORED VISUAL TRAITS (Henry has been refining these — they win over canon and over story context if anything conflicts, except for species/role canon which is still non-negotiable):\n${visualNotes}`
    : '';

  // For revise calls, surface the latest change request explicitly so the
  // image model knows what's DIFFERENT this time. The reference image
  // passed alongside establishes character continuity; this string tells
  // the model what to ALTER in that reference.
  const reviseBlock = isRevise && newMessage
    ? `THIS DRAW IS A REVISION of an earlier portrait of the same character. The reference image attached shows the previous look. Keep the character recognizable as the same individual, but APPLY THIS SPECIFIC CHANGE: "${newMessage}". Don't redraw from scratch — adjust.`
    : (isRevise
        ? 'THIS DRAW IS A REVISION. Reference image attached. Keep the character recognizably the same individual; only tighten or align with the AUTHORED VISUAL TRAITS block above.'
        : '');

  return [
    `SUBJECT: A character named ${name}. Render exactly ONE character — no extras, no crowd, no audience, no shadowy figures in the background.`,
    canonBlock,
    notesBlock,
    reviseBlock,
    traits,
    story,
    tone,
    themeLine,
    style,
    refs,
    dontList,
    'OUTPUT: A single sticker-style character illustration on a warm cream background. Approximately 2:3 portrait aspect ratio. Character centered.',
  ].filter(Boolean).join('\n\n');
}

async function callClaude(apiKey, userMessage) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: SYNOPSIS_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.content?.map(c => (c.type === 'text' ? c.text : '')).join('') || '';
}

async function callNanoBanana(apiKey, prompt, refImage = null, lovedRefs = []) {
  // gemini-3.1-flash-image-preview is higher quality but routinely takes
  // 25-40s — which races Vercel's 25s Edge cap on Hobby plans and the
  // request 504s before Gemini returns. gemini-2.5-flash-image renders
  // in ~8-15s with comparable quality for sticker-style portraits, so
  // we use it as the primary. If it returns no image (content filter
  // trip), the retry logic below falls back to 3.1 as a slower
  // last-resort.
  const PRIMARY_MODEL = 'gemini-2.5-flash-image';
  const FALLBACK_MODEL = 'gemini-3.1-flash-image-preview';
  let modelId = PRIMARY_MODEL;
  let url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  // Reference images go BEFORE the text so Gemini anchors the new
  // portrait to them. Order: loved style anchors first (Henry's
  // approved style direction), then the most recent primary portrait
  // as the "this is the same character" anchor. Text prompt last.
  const parts = [];
  for (const ref of (lovedRefs || [])) {
    if (ref?.dataBase64 && ref?.mimeType) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.dataBase64 } });
    }
  }
  if (refImage && refImage.dataBase64) {
    parts.push({
      inlineData: {
        mimeType: refImage.mimeType || 'image/png',
        data: refImage.dataBase64,
      },
    });
  }
  parts.push({ text: prompt });
  const payload = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };

  // Retry up to 3x on transient failures. Gemini image-gen is flaky
  // under load — 429 / 500 / 503 / 504 all happen routinely. Exponential
  // backoff between attempts. Attempts 1+2 use the fast 2.5-flash model;
  // attempt 3 falls back to the slower 3.1 in case 2.5 hits a content
  // filter or quality issue.
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, attempt * 800));
    if (attempt === 3) {
      modelId = FALLBACK_MODEL;
      url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        const transient = res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
        lastErr = new Error(`gemini ${res.status}: ${t.slice(0, 200)}`);
        if (transient && attempt < 3) continue;
        throw lastErr;
      }
      const data = await res.json();
      const candidates = data?.candidates || [];
      for (const c of candidates) {
        for (const p of (c?.content?.parts || [])) {
          if (p.inlineData?.data) {
            return {
              mime: p.inlineData.mimeType || 'image/png',
              dataBase64: p.inlineData.data,
            };
          }
        }
      }
      // No image but the call returned 200 — model produced text only, e.g.
      // refusal or content-filter trip. Retry once with the same prompt.
      lastErr = new Error('no image returned');
      if (attempt < 3) continue;
      throw lastErr;
    } catch (e) {
      // Network errors / aborts — retry on the first two attempts.
      lastErr = e;
      if (attempt < 3) continue;
      throw lastErr;
    }
  }
  throw lastErr || new Error('gemini failed after 3 attempts');
}

// access guard — delegates to the shared perimeter check at the top
// of this file. The previous local implementation accepted ANY
// `Authorization: Bearer ...` string, which meant `curl -H
// 'Authorization: Bearer x'` could call this endpoint and burn Haiku
// + Gemini image-gen credits with no rate limit.
function checkAccess(req) {
  return sharedCheckAccess(req);
}

// Verify the Bearer JWT resolves to a real user in OUR Supabase
// project (not just any project — same threat model as admin-users.js
// whoAmI). Returns the user payload or null.
async function whoAmI(req) {
  const auth = (typeof req.headers.get === 'function')
    ? (req.headers.get('authorization') || '')
    : (req.headers.authorization || req.headers.Authorization || '');
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supaUrl || !anon) return null;
  try {
    const r = await fetch(`${supaUrl}/auth/v1/user`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${m[1]}`, apikey: anon },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

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
