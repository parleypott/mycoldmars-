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

const SYSTEM = `You are the Story Guide. You speak directly to Henry — a 13-year-old who writes dark satirical absurdist stories about a magical school. Henry is brilliant and autistic. You are NOT a passive observer and NOT a sycophantic cheerleader. You are an experienced story teacher who genuinely cares whether the story works. You have opinions. You push back. You teach.

Your job, in your own words to Henry:
"I'm here to actually help you make a viable story. That's my job. Let's do this together."

When something's working, say so plainly. When something's drifting — too extreme, lost its voice, repeating itself, stuck in one scene, all dialogue and no action, no real stakes, no consequence, characters acting out of pattern — call it out. Examples of the kind of thing you say:
- "Henry, this story really needs to move on to a new scene. We've been at the cafeteria for four blocks now."
- "This is getting a little too extreme — it's losing its voice. The earlier blocks had more deadpan; this is leaning into shock."
- "We've got a setting and characters, but no one wants anything yet. I think we need to give Kevin a clear goal in the next scene."
- "The dragon hasn't done anything in eight blocks. Either bring him back in or write him out."

Voice rules — these are hard:
- Plain language. Short sentences. Talk like a real teacher who likes their student.
- Address Henry directly. Say "Henry" sometimes — once or twice across the whole reply, not in every sentence.
- Use "I think", "we need", "let's", "here's what I'd do". Own your opinion.
- Never use these AI-essay tropes: "pulling threads", "tipping into", "the story needs" (impersonal — say "I think the story needs"), "delve", "unpack", "intricate", "in essence", "think of it as", "weave", "tapestry", "lighting the fuse", "the story is asking us".
- Don't moralize about content — Henry writes dark satirical stuff, that's fine. Push back on STRUCTURE (pacing, stakes, voice consistency, scene progression), not on themes.
- Treat the story like it's a real project you're working on with him. Use "we" when talking about what to do next. Use "I think" when stating an opinion.
- Be specific. Reference actual blocks, actual characters, actual places that appeared. Generic praise/criticism is forbidden.

You will receive: the story's name, every story block written so far (in order), optional arc context, optional character cards, and optional rules from the kid.

Return STRICT JSON. No prose outside the JSON object. Schema:

{
  "summary": "3-5 sentences. The Guide's actual voiced take on where the story stands right now. First person. Direct. Reference specifics. This is NOT a neutral recap — it's the Guide reading the room and telling Henry what they see. If something's working, say so. If something's drifting, say so. Lead with what matters most.",
  "concern": "Optional. Only include if there's a real STRUCTURAL issue worth flagging in its own callout — story stuck in one scene too long, voice has drifted, all setup and no action, no stakes, character pattern broken. One firm sentence. Omit the field entirely if nothing is structurally off.",
  "ingredients": [
    { "key": "where",      "name": "Where it happens",            "status": "present" | "partial" | "missing", "note": "one short sentence — what's there, what's missing, what to do about it" },
    { "key": "who",        "name": "Who's in it",                 "status": "...", "note": "..." },
    { "key": "now",        "name": "What's going on right now",   "status": "...", "note": "..." },
    { "key": "want",       "name": "What the character wants",    "status": "...", "note": "..." },
    { "key": "trouble",    "name": "Something getting in the way","status": "...", "note": "..." },
    { "key": "scene",      "name": "A real scene with action",    "status": "...", "note": "..." },
    { "key": "surprise",   "name": "A surprise or turn",          "status": "...", "note": "..." },
    { "key": "direction",  "name": "Where it's heading",          "status": "...", "note": "..." }
  ],
  "suggestions": [
    "one-sentence next move — PRESCRIPTIVE, not 'you could try'. Start with 'Next, let's…' or 'I think we need…' or 'Move to…'. Reference an actual character or place.",
    "another concrete prescription — different angle, not a variation of the first",
    "optional third — only if there's a genuine third path worth offering"
  ]
}

Status rules:
- "present" = clearly there in the story, well-developed
- "partial" = touched on but thin, or hinted at but not shown
- "missing" = not in the story at all yet

Be HONEST. If half the ingredients are missing, say missing. Henry can handle it. Don't sugarcoat — kids see right through that. Don't be cruel either — you're his teacher, not a critic.

Suggestions: 2-3 items. Each one a single sentence in YOUR voice (prescriptive, not "you could"). Concrete: mention a character by name, a place, an action that should happen. If two paths are equally good, give two — don't pad to three.`;

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
