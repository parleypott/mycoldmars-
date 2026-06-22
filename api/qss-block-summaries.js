// queen-scarlet-school: batch "what happens" summaries for story blocks.
//
// The story panel shows numbered bricks for each block. Showing the raw
// first sentence makes the panel feel scatterbrained — it's whatever
// the block opens with, not what HAPPENS in it. This endpoint takes the
// blocks in order and returns a short action-verb summary for each one
// so the panel reads like a real story spine.
//
// Called when blocks are added or backfilled. Client caches summaries on
// the block (b.summary) so we only call when missing.
//
// Body: { blocks: [{ id, text }], world?: 'queen-scarlet'|'burgundy' }
// Response: { summaries: [{ id, summary }] }
//
// Edge runtime, fast haiku-class model. Each summary is 3-9 words,
// action-led ("Kevin straps on calculator helmet"), kid-readable.

import { checkAccess } from './_lib/access.js';
import { canonOverlayForBody } from './_lib/qss-worlds.js';
import { parseModelObject } from './_lib/model-json.js';
import { selectSummarizableBlocks, zipSummaries } from './_lib/block-summaries.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

const SYSTEM = `You read the blocks of a kid's story and write a SHORT action-led summary for each one — what actually HAPPENS in that block, not the first sentence.

Rules (hard):
- 3 to 9 words per summary. NO commas. NO semicolons. ONE clause.
- Lead with a person/character or a concrete thing doing the action. "Kevin signs the sign-up sheet." "The drone showers students with whistles."
- PRESENT tense. Active voice.
- Use the actual character names that appear (Kevin, Benny, Wordy, Burgundy, etc.). If the block has no named character, use "the students" / "the dragon" / "the legal lady" — whatever the block actually contains.
- NEVER repeat the block's first sentence verbatim. SUMMARIZE the event.
- NEVER moralize, never editorialize, never use words like "explores", "introduces", "establishes", "depicts", "shows", "tries to", "begins". Just say what happens.
- If two things happen in a block, pick the BIGGER one.
- If a block is just description with no action, say what the thing IS or DOES. ("The cafeteria glows green." "Kevin's helmet beeps faster.")
- Lowercase except for names.

OUTPUT — strict JSON, no prose outside the object:

{
  "summaries": [
    { "id": "<block-id-1>", "summary": "kevin signs the midnight drill sheet" },
    { "id": "<block-id-2>", "summary": "a glowing barrel rolls in" }
  ]
}

Return one entry per input block, in the same order. If you genuinely cannot summarize a block (empty / nonsense), return summary "" for that id and move on.`;

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

  // Only summarize blocks with usable text; cap count + each block's text so
  // the prompt doesn't blow up. (Pure core in _lib/block-summaries.js.)
  const blocks = selectSummarizableBlocks(body.blocks);

  if (!blocks.length) return json(200, { summaries: [] });

  const userParts = blocks
    .map((b, i) => `BLOCK ${i + 1} — id=${b.id}\n${b.text}`)
    .join('\n\n---\n\n');

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
        max_tokens: 1400,
        system: SYSTEM + canonOverlayForBody(body),
        messages: [{ role: 'user', content: `Summarize each block. Return the JSON object only.\n\n${userParts}` }],
      }),
      signal: AbortSignal.timeout(22_000),
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
  const { ok, value: parsed } = parseModelObject(rawText);
  if (!ok) {
    return json(502, { error: 'parse_failed', detail: 'model returned non-JSON. snippet: ' + rawText.slice(0, 120) });
  }

  // Validate + normalize: map id → summary, drop malformed, and build the
  // response IN INPUT-BLOCK ORDER so the client can zip them by position.
  // (Pure core in _lib/block-summaries.js.)
  const summaries = zipSummaries(blocks, parsed);

  return json(200, { summaries, modelMs: Date.now() - t0, model: 'claude-haiku-4-5-20251001' });
}
