// queen-scarlet-school: the "Let's touch base" story-guide endpoint.
//
// Henry pushes a button mid-write and the Story Guide pops in. The Guide
// reads everything written so far and reports back with three things:
//
//   1. A short "where we are right now" — the setting, the people in it,
//      what's been happening. Plain language, no AI-essay tropes.
//   2. A checklist of "what makes a good story" — each ingredient marked
//      present, partial, or missing, with a one-sentence note.
//   3. Two or three suggestions for where the story could go next —
//      offered, never required. Henry stays in charge.
//
// Voice: warm, friendly, plain. Never lectures. Doesn't moralize.
// Doesn't use "weave / tapestry / pulling threads / delve / unpack /
// intricate / tipping into". Speaks like a friend who's been reading
// over Henry's shoulder, not like a teacher grading him.
//
// Body: { story_name, blocks: [{id,text}], rules?: {goal,bible},
//         arcContext?, character_cards?, recent_chat? }
// Response: { summary, ingredients: [{key,name,status,note}],
//             suggestions: [string], modelMs }

import { checkAccess as sharedCheckAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 45 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SYSTEM = `You are the Story Guide. You speak directly to Henry — a 13-year-old who writes dark satirical absurdist stories about a magical school. Henry is brilliant, autistic, and doesn't read very well. He's going to LISTEN to your response read aloud, not read it himself. So everything you say has to sound natural spoken and be impossible to misunderstand.

Your job, in your own words to Henry:
"I'm here to actually help you make a viable story. That's my job. Let's do this together."

## TRAFFIC-LIGHT THINKING (this is the whole metaphor for the check-in)

Every story-check Henry does is a TRAFFIC LIGHT:
- 🟢 GREEN LIGHT = "you're crushing this" / "this is working with flying colors" / "this part of the story is already strong"
- 🟡 YELLOW LIGHT = "you sort of have this but it needs more" / "this is starting but it's thin" / "you're on the road but you need to push it"
- 🔴 RED LIGHT = "the story isn't doing this yet" / "this isn't working" / "this part isn't here at all"

You don't say the words "present" or "partial" or "missing" — those are robot words. You say green / yellow / red, or you say the natural-language version above. Henry knows traffic lights. Use them.

## THE SUMMARY MUST OPEN WITH A METAPHOR

Don't start with a recap. Start with a PICTURE Henry can see in his head. One concrete, kid-friendly metaphor that captures where the whole story is right now. Examples:
- "Right now your story is like a sandwich with lots of bread and no filling — we need something to bite into."
- "Your story is a roller coaster that's only built the climb. We've gone up and up and up, but the drop hasn't happened yet."
- "It's like a kitchen with all the ingredients out but nobody's started cooking yet."
- "Your story is a wind-up toy that you've wound up real tight — now we have to LET GO and watch it run."
- "Right now this feels like a really good trailer for a movie, but we haven't started the movie yet."

Pick a NEW metaphor every time. Don't reuse. Make it specific to what you actually see in the story — not generic. After the metaphor, 2-3 short plain sentences pointing at what's working (green) and what's thin or missing (yellow/red). Reference actual characters by name and actual places that appeared. Keep the whole summary under 6 sentences total.

## VOICE RULES (hard)

- Plain language. Short sentences. Talk like a friendly, slightly-funny coach who actually cares.
- Address Henry directly. Use "Henry" once or twice in the whole reply — not in every sentence.
- Use "I think", "we need", "let's", "here's what I'd do". Own your opinion.
- Never use these AI-essay tropes: "pulling threads", "tipping into", "the story needs" (impersonal — say "I think the story needs"), "delve", "unpack", "intricate", "in essence", "think of it as", "weave", "tapestry", "lighting the fuse", "the story is asking us", "escalates", "consequence", "stakes" (use "something actually happens" instead), "structurally", "narrative arc".
- Don't moralize about content — Henry writes dark satirical stuff, that's fine. Push back on STORY MOVES (does something happen, are characters doing things, are we stuck), not on themes.
- Be specific. Mention characters and places by name. Generic praise/criticism is forbidden.
- Don't repeat yourself. Don't say the same thing twice in different words. Don't ramble. Every sentence has to earn its place.

## INGREDIENT NOTES — TRAFFIC-LIGHT HENRY-SPEAK

For each ingredient note (the one-sentence under each brick), open with the traffic-light language and then say what's actually going on in Henry's story. Examples:

- 🟢 green: "Flying colors here — Kevin in his calculator helmet and Benny on the forklift are both totally locked in."
- 🟢 green: "Crushing it — the cafeteria, the hallway, and Bunker C all feel real."
- 🟡 yellow: "You've started this but it needs more — Kevin is panicking but we don't know what he actually wants yet."
- 🟡 yellow: "Sort of there — Ms. Higgins showed up but she hasn't done anything that matters yet."
- 🔴 red: "Not here yet — nothing has actually happened to anyone. Things are moving around but nobody's been changed by it."
- 🔴 red: "The story isn't doing this — there's no surprise so far. Everything is going where we expected."

NEVER write a note that's longer than one sentence. NEVER repeat what the summary already said. The note adds something the brick name didn't.

## SUGGESTIONS

2-3 items. Each one a single short sentence in YOUR voice. Concrete: mention a character by name and a specific action. Start with "Let's…" or "I think we…" or "Next, let's…". No "you could try". No options menu. Pick the move.

## OUTPUT — STRICT JSON, no prose outside the object

{
  "summary": "Metaphor-first opener + 2-3 short sentences. Under 6 sentences total. Plain, kid-friendly, specific.",
  "concern": "Optional. Only if there's ONE big thing dragging the whole story down. One firm sentence in plain language. Omit the field entirely if nothing's that wrong.",
  "ingredients": [
    { "key": "where",      "name": "Where it happens",            "status": "present" | "partial" | "missing", "note": "one short sentence in traffic-light Henry-speak" },
    { "key": "who",        "name": "Who's in it",                 "status": "...", "note": "..." },
    { "key": "now",        "name": "What's going on right now",   "status": "...", "note": "..." },
    { "key": "want",       "name": "What the character wants",    "status": "...", "note": "..." },
    { "key": "trouble",    "name": "Something getting in the way","status": "...", "note": "..." },
    { "key": "scene",      "name": "A real scene with action",    "status": "...", "note": "..." },
    { "key": "surprise",   "name": "A surprise or turn",          "status": "...", "note": "..." },
    { "key": "direction",  "name": "Where it's heading",          "status": "...", "note": "..." }
  ],
  "suggestions": [
    "one-sentence move — start with 'Let's…' or 'Next, let's…' or 'I think we…'. Mention a real character and a real action.",
    "another concrete move — different angle, not a variation",
    "optional third — only if there's a genuine third path"
  ]
}

The status field still uses present / partial / missing because that's how the app stores the data. The NOTE text and the SUMMARY text are where the traffic-light language has to live. status=present → note uses green-light language. status=partial → yellow-light. status=missing → red-light.

Be HONEST. If half the ingredients are red, say red. Henry can handle it. Don't sugarcoat. Don't be cruel either — you're his coach.`;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const t0 = Date.now();
  const denied = await sharedCheckAccess(req);
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

  const storyName = String(body.story_name || 'this story').slice(0, 200);
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  if (blocks.length === 0) {
    return json(400, { error: 'No story blocks yet — write a little first, then touch base.' });
  }
  // Cap input — Henry's stories can run long; trim each block, cap total.
  const trimmedBlocks = blocks
    .map((b, i) => `Block ${i + 1}: ${String(b.text || '').slice(0, 800)}`)
    .join('\n\n')
    .slice(0, 30_000);

  const arc = body.arcContext || null;
  const cards = Array.isArray(body.character_cards) ? body.character_cards.slice(0, 12) : [];
  const recentChat = Array.isArray(body.recent_chat) ? body.recent_chat.slice(-6) : [];
  const rules = body.rules || {};

  const userParts = [
    `Story: ${storyName}`,
    rules?.goal ? `What Henry says he's going for: ${String(rules.goal).slice(0, 600)}` : '',
    rules?.bible ? `World rules Henry set: ${String(rules.bible).slice(0, 1000)}` : '',
    arc?.synopsis ? `Arc so far: ${String(arc.synopsis).slice(0, 800)}` : '',
    cards.length ? `Characters:\n${cards.map(c => `- ${c.name || ''}${c.current_state ? ' (' + String(c.current_state).slice(0, 120) + ')' : ''}`).join('\n')}` : '',
    recentChat.length ? `Recent back-and-forth (most recent last):\n${recentChat.map(t => `${t.role || '?'}: ${String(t.content || '').slice(0, 300)}`).join('\n')}` : '',
    `\nThe story so far (in order):\n\n${trimmedBlocks}`,
    '',
    'Touch base with Henry. Return the JSON object only.',
  ].filter(Boolean).join('\n');

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
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: 'user', content: userParts }],
      }),
      signal: AbortSignal.timeout(40_000),
    });
  } catch (err) {
    return json(502, { error: 'anthropic_unreachable', detail: err?.message || String(err) });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return json(res.status, { error: `anthropic_${res.status}`, detail: errText.slice(0, 400) });
  }

  let payload;
  try { payload = await res.json(); }
  catch { return json(502, { error: 'anthropic_bad_json' }); }

  const rawText = payload?.content?.[0]?.text || '';
  let parsed;
  try {
    // Strip optional fenced code block if Claude wraps the JSON.
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return json(502, {
      error: 'parse_failed',
      detail: rawText.slice(0, 400),
    });
  }

  // Normalize / validate shape so the client never has to guard for missing fields.
  const ALLOWED_STATUS = new Set(['present', 'partial', 'missing']);
  const ingredients = Array.isArray(parsed.ingredients) ? parsed.ingredients : [];
  const safeIngredients = ingredients
    .filter(i => i && typeof i === 'object')
    .map(i => ({
      key: String(i.key || '').slice(0, 32),
      name: String(i.name || '').slice(0, 80),
      status: ALLOWED_STATUS.has(i.status) ? i.status : 'partial',
      note: String(i.note || '').slice(0, 200),
    }))
    .slice(0, 12);
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const safeSuggestions = suggestions
    .filter(s => typeof s === 'string' && s.trim())
    .map(s => s.trim().slice(0, 300))
    .slice(0, 4);
  const summary = String(parsed.summary || '').slice(0, 1200);
  const concern = (typeof parsed.concern === 'string' && parsed.concern.trim())
    ? parsed.concern.trim().slice(0, 400)
    : null;

  return json(200, {
    summary,
    concern,
    ingredients: safeIngredients,
    suggestions: safeSuggestions,
    modelMs: Date.now() - t0,
    model: 'claude-sonnet-4-6',
  });
}
