// queen-scarlet-school: auto-generate a literary title for a story.
//
// The Storybook reader shows a title at the top of the prose pane. The
// story already has a "name" field (the file-style identifier the kid
// picked, like "rober"), but that's not a real book title. This endpoint
// reads the actual story content and proposes a short evocative title
// the way a children's book would have one.
//
// Body: { blocks: [{ text }], existing_name?: string, world?: string }
// Response: { title: "The Apocalypse Box" }
//
// Cheap haiku call. Three to six words. Title case. No subtitle. The
// client treats this as a SUGGESTION — the kid can rename freely.

import { checkAccess } from './_lib/access.js';
import { canonOverlayForBody } from './_lib/qss-worlds.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

const SYSTEM = `You read the first few blocks of a kid's story and propose a SHORT literary title — the kind a children's book would have on its cover.

Rules (hard):
- 2 to 6 words. NEVER more.
- Title Case ("The Apocalypse Box", not "the apocalypse box").
- NO subtitle, no colon, no dash.
- NO quote marks around it.
- NO "A Story Of...", "The Adventures Of...", or other generic templates.
- Anchor on ONE specific thing from the story — a place, an object, a person, a moment — not a theme.
- Concrete beats abstract. "The Calculator Helmet" > "Lessons in Bravery".
- If the existing_name field is a real name (not a scaffold like "untitled" / "story-abc123"), prefer to ECHO or play off it — kids often want their name preserved.
- If you can't find anything specific, return "" — never fall back to a generic placeholder.

OUTPUT — strict JSON, no prose outside the object:

{ "title": "The Apocalypse Box" }`;

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

  const rawBlocks = Array.isArray(body.blocks) ? body.blocks : [];
  const blocks = rawBlocks
    .filter(b => b && (b.text || '').trim())
    .slice(0, 6)
    .map(b => String(b.text).slice(0, 800));

  if (!blocks.length) return json(200, { title: '' });

  const existing = String(body.existing_name || '').trim().slice(0, 80);
  const userParts = blocks.map((t, i) => `BLOCK ${i + 1}:\n${t}`).join('\n\n---\n\n');
  const user = (existing ? `EXISTING_NAME: ${existing}\n\n` : '') + userParts;

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
        max_tokens: 120,
        system: SYSTEM + canonOverlayForBody(body),
        messages: [{ role: 'user', content: `Read the story opening and propose a title. Return the JSON object only.\n\n${user}` }],
      }),
      signal: AbortSignal.timeout(15_000),
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

  let title = String(parsed.title || '').trim();
  // Strip surrounding quotes if the model still puts them in
  title = title.replace(/^["“”'']+|["“”'']+$/g, '').trim();
  if (title.length > 80) title = title.slice(0, 80).trim();

  return json(200, { title });
}
