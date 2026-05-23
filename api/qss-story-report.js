// queen-scarlet-school: the "How's my story?" deep-critique endpoint.
//
// Distinct from /api/qss-touch-base. Touch-base is the conversational
// check-in with traffic-light brick statuses; that's mid-write coaching.
// THIS endpoint is the deeper structural report card — the kid asks
// "how's my story actually doing?" and gets a comprehensive grade plus
// specific issues to fix.
//
// Output shape:
//   power_score      — 0-100 overall strength
//   power_label      — kid-friendly ("almost ready" / "really strong" / etc.)
//   one_liner        — opening metaphor (same voice as touch-base)
//   scores           — per-dimension breakdown:
//                      [{ category, score(1-5), comment }]
//                      cohesion, surprise, intention, action, repetition,
//                      characters
//   gaps             — [{ from_block, to_block, issue }]   cohesion breaks
//   repetitions      — [{ pattern, count, where }]         redundancy hits
//   strengths        — [strings]                            what's working
//   recommendations  — [strings]                            prescriptive next moves
//
// Voice: same as touch-base. Plain. Henry-readable. No AI-essay tropes.

import { checkAccess } from './_lib/access.js';
import { canonOverlayForBody } from './_lib/qss-worlds.js';

export const config = { runtime: 'edge', maxDuration: 60 };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

const SYSTEM = `You are the Story Report Card. You speak directly to Henry — a 13-year-old who writes dark satirical absurdist stories. Henry is brilliant and autistic. He doesn't read very well; everything you write will be read aloud to him. So every sentence has to sound natural spoken AND be specific to his actual story.

Your job is HONEST structural critique. Not cheerleading. Not crushing. Treat Henry as a serious writer who can handle real notes about HIS specific story.

## WHAT YOU GRADE

Read the story (the blocks in order) and grade it on six dimensions, score 1-5 each:

1. COHESION — does each block follow logically from the one before? When the camera cuts from block N to block N+1, does it make sense? Score down for jarring jumps, missing connective tissue, or scene-skips that lose the reader.

2. SURPRISE — does the story take turns the reader can't predict? Or is every beat the most obvious next beat? Score down for predictable-everything; score up for moments where the kid set up an expectation and then broke it.

3. INTENTION — does each character want something? Is there a goal anywhere — even a small one — that's actually driving action? Score down for "things just happening to people"; score up for clear character desire.

4. ACTION — do things actually HAPPEN? Or is it all setup, all dialogue, all description? Score down for talky-no-action; score up for blocks where someone DID something with consequence.

5. REPETITION — does the same image / situation / character beat keep recurring? Score 5 if every block adds something new; score lower the more the story repeats itself. (Yes, low repetition = high score on this axis. Don't flip it.)

6. CHARACTERS — are the people in the story doing distinct things? Are they recognizable, with their own voices? Score down for characters that blur together or do nothing.

## ALSO FIND

After scoring, surface SPECIFIC ISSUES:

- GAPS: places where block N → block N+1 doesn't follow. Reference the actual block numbers. "Block 3 ends in the cafeteria, block 4 is suddenly underground with no transition." Real, story-specific.
- REPETITIONS: patterns that recur too often. "The PA crackling appears in blocks 1, 4, 7." Or: "Kevin says 'sigh' three times in five blocks." Be SPECIFIC — name the pattern.
- STRENGTHS: 2-3 things the kid is doing really well. Be specific to the story — "Block 5 ends on a perfect beat" is worth more than "your pacing is good".

## POWER SCORE

Calculate an overall 0-100. Weight cohesion + intention + action highest (these are the load-bearing ones). Repetition + surprise next. Characters as a multiplier.

Map to a kid-friendly label:
- 85-100 — "really strong"
- 70-84  — "almost ready"
- 55-69  — "getting there"
- 40-54  — "needs work"
- 0-39   — "needs a redo"

NEVER write "you got a C-". Use the labels. Henry is dyslexic and sensitive — letter grades trigger school-stress. Power Score + label is the right frame.

## VOICE

- Plain. Short sentences. Talk like a real editor who likes their writer.
- Address Henry directly. Say "Henry" once or twice across the whole reply.
- Use "I think", "this part", "your block 4". Own opinions.
- Banned AI-essay tropes: "pulling threads", "tipping into", "the story needs", "delve", "unpack", "intricate", "in essence", "weave", "tapestry", "structurally", "narrative arc", "tension", "stakes" (say "what's at risk" or "what happens if they fail").
- Banned crushing phrases: "this is bad", "needs major work", "I can't follow this". Even when honest, frame as "I'm not following block X → block Y" — specific, fixable.

## OPEN WITH A METAPHOR

The one_liner field opens the whole report with ONE concrete kid-friendly metaphor that captures the state of the story right now. Like touch-base. Examples:

- "Your story is like a house with the framing up but no walls — the bones are there but I can see through it."
- "Right now this feels like a really good first half of a movie — the second half hasn't happened yet."
- "Your story is a paint set where you've only used three colors so far."
- "This reads like a song that keeps coming back to the chorus before it's earned a verse."

New metaphor every time. Specific to what you actually see.

## OUTPUT — STRICT JSON, no prose outside the object

{
  "power_score": <0-100 integer>,
  "power_label": "<one of: really strong | almost ready | getting there | needs work | needs a redo>",
  "one_liner": "<metaphor + 1 short sentence, 25 words max>",
  "scores": [
    { "category": "cohesion",    "score": <1-5>, "comment": "<one short sentence, specific to story>" },
    { "category": "surprise",    "score": <1-5>, "comment": "<one short sentence>" },
    { "category": "intention",   "score": <1-5>, "comment": "<one short sentence>" },
    { "category": "action",      "score": <1-5>, "comment": "<one short sentence>" },
    { "category": "repetition",  "score": <1-5>, "comment": "<one short sentence>" },
    { "category": "characters",  "score": <1-5>, "comment": "<one short sentence>" }
  ],
  "gaps": [
    { "from_block": <int>, "to_block": <int>, "issue": "<short specific>" }
  ],
  "repetitions": [
    { "pattern": "<short specific>", "count": <int>, "where": "blocks <list>" }
  ],
  "strengths": [
    "<one short specific thing that's working>",
    "<another>",
    "<optional third>"
  ],
  "recommendations": [
    "<one concrete next-move, prescriptive — start with 'Let's' or 'I think we'>",
    "<another>",
    "<optional third or fourth>"
  ]
}

If there are no gaps, return an empty array. Same for repetitions and strengths. Don't pad. Be specific.`;

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

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
  if (denied) return withCors(denied);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'invalid JSON' }); }

  const storyName = String(body.story_name || 'this story').slice(0, 200);
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  if (blocks.length < 2) {
    return json(400, { error: 'Write at least 2 blocks first — I need more to read before I can grade.' });
  }
  const trimmedBlocks = blocks
    .map((b, i) => `Block ${i + 1}: ${String(b.text || '').slice(0, 1000)}`)
    .join('\n\n')
    .slice(0, 36_000);

  const cards = Array.isArray(body.character_cards) ? body.character_cards.slice(0, 12) : [];
  const rules = body.rules || {};
  const arc = body.arcContext || null;

  const userParts = [
    `Story: ${storyName}`,
    rules?.goal ? `What Henry's going for: ${String(rules.goal).slice(0, 600)}` : '',
    rules?.bible ? `World rules Henry set: ${String(rules.bible).slice(0, 1000)}` : '',
    arc?.synopsis ? `Arc so far: ${String(arc.synopsis).slice(0, 800)}` : '',
    cards.length ? `Characters in play:\n${cards.map(c => `- ${c.name || ''}${c.current_state ? ' (' + String(c.current_state).slice(0, 120) + ')' : ''}`).join('\n')}` : '',
    `\nThe story so far (every block, in order):\n\n${trimmedBlocks}`,
    '',
    'Grade this story. Return the JSON object only.',
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
        max_tokens: 2400,
        system: SYSTEM + canonOverlayForBody(body),
        messages: [{ role: 'user', content: userParts }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    return json(502, { error: 'anthropic_unreachable', detail: (err?.message || '').slice(0, 200) });
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return json(res.status, { error: `anthropic_${res.status}`, detail: t.slice(0, 400) });
  }

  const payload = await res.json().catch(() => ({}));
  const rawText = payload?.content?.[0]?.text || '';
  let parsed;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return json(502, {
      error: 'parse_failed',
      detail: 'model returned non-JSON output. snippet: ' + rawText.slice(0, 120),
    });
  }

  // Sanitize + validate the report shape so the client never has to
  // guard for missing fields.
  const ALLOWED_LABEL = new Set(['really strong', 'almost ready', 'getting there', 'needs work', 'needs a redo']);
  const ALLOWED_CATEGORIES = new Set(['cohesion', 'surprise', 'intention', 'action', 'repetition', 'characters']);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  const power_score = clamp(Number(parsed.power_score) || 0, 0, 100);
  const power_label = ALLOWED_LABEL.has(String(parsed.power_label).toLowerCase().trim())
    ? String(parsed.power_label).toLowerCase().trim()
    : (power_score >= 85 ? 'really strong'
      : power_score >= 70 ? 'almost ready'
      : power_score >= 55 ? 'getting there'
      : power_score >= 40 ? 'needs work'
      : 'needs a redo');

  const scores = (Array.isArray(parsed.scores) ? parsed.scores : [])
    .filter(s => s && typeof s === 'object' && ALLOWED_CATEGORIES.has(String(s.category).toLowerCase().trim()))
    .map(s => ({
      category: String(s.category).toLowerCase().trim(),
      score: clamp(Number(s.score) || 1, 1, 5),
      comment: String(s.comment || '').slice(0, 220),
    }))
    .slice(0, 6);

  const gaps = (Array.isArray(parsed.gaps) ? parsed.gaps : [])
    .filter(g => g && typeof g === 'object')
    .map(g => ({
      from_block: Number(g.from_block) || 0,
      to_block: Number(g.to_block) || 0,
      issue: String(g.issue || '').slice(0, 220),
    }))
    .slice(0, 8);

  const repetitions = (Array.isArray(parsed.repetitions) ? parsed.repetitions : [])
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      pattern: String(r.pattern || '').slice(0, 180),
      count: Number(r.count) || 0,
      where: String(r.where || '').slice(0, 120),
    }))
    .slice(0, 6);

  const strengths = (Array.isArray(parsed.strengths) ? parsed.strengths : [])
    .filter(s => typeof s === 'string' && s.trim())
    .map(s => s.trim().slice(0, 240))
    .slice(0, 4);

  const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
    .filter(s => typeof s === 'string' && s.trim())
    .map(s => s.trim().slice(0, 240))
    .slice(0, 5);

  const one_liner = String(parsed.one_liner || '').slice(0, 280);

  return json(200, {
    power_score,
    power_label,
    one_liner,
    scores,
    gaps,
    repetitions,
    strengths,
    recommendations,
    model: 'claude-sonnet-4-6',
  });
}
