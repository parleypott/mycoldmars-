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

export const config = { runtime: 'edge' };

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
  const denied = checkAccess(req);
  if (denied) return withCors(denied);

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

  const synopsisUser = [
    `Character: ${name}`,
    currentState ? `Where they are right now: ${currentState}` : '',
    introBlock ? `Introduced around block ${introBlock}.` : '',
    arcSynopsis ? `Story so far: ${arcSynopsis}` : '',
    themes.length ? `Themes in play: ${themes.join(', ')}.` : '',
    tones.length ? `Tone of the story: ${tones.join(', ')}.` : '',
    recentText ? `Most recent story blocks for voice/tone:\n${recentText}` : '',
    '',
    'Write the back-of-the-card synopsis for this character in 3-4 short sentences. Match the voice of the story.',
  ].filter(Boolean).join('\n');

  // Image prompt is locally composed so we can fire both upstream calls in parallel.
  const portraitPrompt = buildPortraitPrompt({ name, currentState, themes, tones, recentBlocks });

  const synopsisPromise = callClaude(anthropicKey, synopsisUser);
  const imagePromise = callNanoBanana(geminiKey, portraitPrompt);

  const [synR, imgR] = await Promise.allSettled([synopsisPromise, imagePromise]);

  let synopsis = '';
  if (synR.status === 'fulfilled') synopsis = synR.value;
  else {
    // soft-fail synopsis; the card still has the portrait
    synopsis = `(couldn't write the card right now — try regenerating)`;
    console.warn('[character-card] synopsis failed:', synR.reason);
  }

  if (imgR.status !== 'fulfilled') {
    return json(502, { error: 'portrait failed', detail: String(imgR.reason).slice(0, 400) });
  }

  return json(200, {
    synopsis: cleanSynopsis(synopsis),
    image: imgR.value,
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

function buildPortraitPrompt({ name, currentState, themes, tones, recentBlocks }) {
  // Style anchor — keep it consistent across cards so the gallery feels like a set.
  const style = [
    'Vintage trading-card portrait illustration, head-and-shoulders framing, painted in a cracked-marker / risograph storybook style.',
    'Warm cream background paper with light foxing and a thin hand-drawn ink border. Slight off-register print.',
    'Look: a single absurd character from a 13-year-old\'s dark-satirical magical-school story.',
    'Mood: deadpan, sincere, weirdly specific. Not Pixar. Not anime. Closer to early-1900s yearbook portrait drawn by a sleepy goblin.',
  ].join(' ');

  const recentSnippet = recentBlocks
    .map(b => (b.text || '').trim())
    .filter(Boolean)
    .slice(-3)
    .join(' ')
    .slice(0, 400);

  const traits = currentState ? `Their current state in the story: "${currentState}".` : '';
  const tone = tones.length ? `Tone keywords: ${tones.join(', ')}.` : '';
  const story = recentSnippet ? `For visual hints, here is a snippet of the recent story: "${recentSnippet}".` : '';
  const themeLine = themes.length ? `Themes that should subtly inform the portrait: ${themes.join(', ')}.` : '';

  return [
    `Subject: ${name}.`,
    traits,
    'Render only this one character. Single subject. No text, no name labels, no captions, no title cards, no logos.',
    style,
    tone,
    themeLine,
    story,
    'Aspect ratio 2:3 (taller than wide), like a playing card portrait. Subject centered.',
  ].filter(Boolean).join('\n');
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

async function callNanoBanana(apiKey, prompt) {
  const modelId = 'gemini-3.1-flash-image-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`gemini ${res.status}: ${t.slice(0, 200)}`);
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
  throw new Error('no image returned');
}

// access guard — matches the rest of the qss endpoints
function checkAccess(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return null;
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
