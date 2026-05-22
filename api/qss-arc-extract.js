import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 30 };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

const ARC_SYSTEM = `You are a story editor reading a kid's work-in-progress and extracting a structured understanding of where the story currently is. The kid is autistic, 13, brilliant, dark/satirical voice. He's training to become a storyteller. Your output is going to feed back into another AI that proposes the next narrative directions, so your job is precision: name characters by their exact names, name threads by what they actually are, surface what's MISSING for arc shape.

Read carefully. Be specific. Don't generalize.

Schema (return ONLY this JSON, wrapped in <arc>...</arc> tags, no preamble):

{
  "synopsis": "2-3 sentences. running summary of what the story has been so far. specific, not generic.",
  "characters": [
    { "name": "Kevin", "intro_block": 1, "current_state": "wearing calculator helmet, has accepted his fate" }
  ],
  "threads": [
    { "description": "the legal department has barricaded in the library", "opened_at_block": 3, "status": "open", "suggested_resolution": "they break out / they radio a warning / they're forgotten" }
  ],
  "themes": ["beans are immortal", "scarlet ignores liability", "kevin's resignation"],
  "tones": ["satirical", "escalating-absurd", "deadpan", "sincerity-then-undercut"],
  "next_moves": "2-3 sentences naming what specifically would round out the arc. Which character needs more screen time? Which tonal beat is missing? Which thread is overdue for payoff?",
  "confidence": 0.0
}

Rules:
- characters: 10 max, most recently active first
- threads: 8 max, open ones first, closed ones tagged "status": "closed"
- themes: 6 max
- tones: 4 max
- confidence: 0.0 (story too short to interpret) up to 1.0 (clear arc shape). At 0-3 blocks → 0.2 max. At 4-6 → 0.5 max. At 7+ → up to 1.0.
- if a previous arc is supplied, EVOLVE it rather than rewrite from scratch. Carry forward established characters/threads, update state, mark resolved threads as closed.
- never moralize about the kid's content. dark/satirical is the voice — preserve it in the synopsis.`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });
  const denied = checkAccess(req);
  if (denied) return withCors(denied);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'invalid JSON' }); }

  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  if (!blocks.length) return json(400, { error: 'no blocks to analyze' });

  const rules = body.rules || {};
  const previousArc = body.currentArc || null;

  // Compose the user message — concise and structured so Haiku stays cheap
  const storyText = blocks.map((b, i) => `[${i + 1}] ${(b.text || '').trim()}`).join('\n\n');
  const bible = (rules.bible || '').trim();
  const goal = (rules.goal || '').trim();
  const style = (rules.style || '').trim();

  const userMsg = [
    goal ? `STORY GOAL: ${goal}` : '',
    style ? `STYLE: ${style}` : '',
    bible ? `BIBLE:\n${bible}` : '',
    previousArc && Object.keys(previousArc).length
      ? `PREVIOUS ARC (evolve, don't rewrite):\n${JSON.stringify(previousArc, null, 2)}`
      : '',
    `COMMITTED BLOCKS (${blocks.length} total):\n${storyText}`,
    `Now extract the current arc. Wrap your JSON in <arc>...</arc>.`,
  ].filter(Boolean).join('\n\n');

  const t0 = Date.now();
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
        max_tokens: 1500,
        temperature: 0.3,           // factual extraction, not creative
        system: ARC_SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
  } catch (e) {
    return json(502, { error: 'anthropic_unreachable', detail: e.message });
  }

  if (!res.ok) {
    const t = await res.text();
    return json(502, { error: `anthropic ${res.status}`, detail: t.slice(0, 400) });
  }

  const data = await res.json().catch(() => null);
  const reply = data?.content?.map(c => (c.type === 'text' ? c.text : '')).join('') || '';
  const arc = extractArc(reply);
  if (!arc) {
    return json(502, { error: 'arc_parse_failed', raw: reply.slice(0, 400) });
  }
  arc.updated_at = new Date().toISOString();
  arc.block_count_when_extracted = blocks.length;

  // Persist to Supabase if we have a story_id
  if (body.story_id && SUPABASE_URL && SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/qss_stories?id=eq.${encodeURIComponent(body.story_id)}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ arc_context: arc }),
      });
    } catch (e) {
      // non-fatal — return arc anyway so client cache stays warm
      console.warn('[arc] persist failed:', e.message);
    }
  }

  return json(200, { arc, model: 'claude-haiku-4-5', ms: Date.now() - t0 });
}

function extractArc(text) {
  if (!text) return null;
  // Prefer the <arc>...</arc> wrapper
  const tagMatch = text.match(/<arc>\s*([\s\S]*?)\s*<\/arc>/i);
  let raw = tagMatch ? tagMatch[1] : null;
  // Fallback: find a JSON object substring
  if (!raw) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) raw = text.slice(firstBrace, lastBrace + 1);
  }
  if (!raw) return null;
  // Strip code fences if Claude added them anyway
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(raw);
    return normalizeArc(parsed);
  } catch {
    // Tolerate a missing closing brace
    try {
      const repaired = balanceJson(raw);
      const parsed = JSON.parse(repaired);
      return normalizeArc(parsed);
    } catch {
      return null;
    }
  }
}

function balanceJson(s) {
  // Add closing braces/brackets if Claude truncated
  let opens = 0, closes = 0, openSq = 0, closeSq = 0, inStr = false, esc = false;
  for (const c of s) {
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') opens++;
    else if (c === '}') closes++;
    else if (c === '[') openSq++;
    else if (c === ']') closeSq++;
  }
  return s + ']'.repeat(Math.max(0, openSq - closeSq)) + '}'.repeat(Math.max(0, opens - closes));
}

function normalizeArc(a) {
  const out = {
    synopsis: String(a?.synopsis || '').trim(),
    characters: Array.isArray(a?.characters) ? a.characters.slice(0, 10).map(c => ({
      name: String(c?.name || '').trim(),
      intro_block: Number(c?.intro_block) || null,
      current_state: String(c?.current_state || '').trim(),
    })).filter(c => c.name) : [],
    threads: Array.isArray(a?.threads) ? a.threads.slice(0, 8).map(t => ({
      description: String(t?.description || '').trim(),
      opened_at_block: Number(t?.opened_at_block) || null,
      status: ['open', 'closed'].includes(t?.status) ? t.status : 'open',
      suggested_resolution: String(t?.suggested_resolution || '').trim(),
    })).filter(t => t.description) : [],
    themes: Array.isArray(a?.themes) ? a.themes.slice(0, 6).map(t => String(t).trim()).filter(Boolean) : [],
    tones: Array.isArray(a?.tones) ? a.tones.slice(0, 4).map(t => String(t).trim()).filter(Boolean) : [],
    next_moves: String(a?.next_moves || '').trim(),
    confidence: Math.max(0, Math.min(1, Number(a?.confidence) || 0)),
  };
  return out;
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
