// queen-scarlet-school: Freestyle mode — a low-stakes brainstorm chat with
// Wordy. Different from the main "Write with Wordy" flow:
//   - NO choose-your-own-adventure structure
//   - NO block-options output
//   - NO commit-to-story side effects
//   - Just conversational riffing. Henry talks, Wordy responds.
//   - Server quietly notices themes/threads worth capturing and emits them
//     as a separate JSON payload — the client surfaces these as chips that
//     Henry can later choose to promote into the actual story.
//
// Body:
// {
//   message: string,                       // Henry's latest message
//   history: [{role, content}, ...],       // freestyle convo so far (recent)
//   story_context: {
//     name, blocks, rules: { goal, bible, style, ... },
//     arc_context, character_cards,        // (visible context only)
//   },
//   captured_so_far: [{label, ...}]        // themes already captured, so we don't dup
// }
//
// Response:
// {
//   reply: string,                         // Wordy's chat reply (plain prose)
//   new_themes: [{ id, label, note }],     // 0-3 soft theme captures
//   ms, model
// }

import { checkAccess } from './_lib/access.js';
import { normalizeAnthropicMessages } from './_lib/anthropic-messages.js';
import { findCanonCharactersInText, canonContextBlock, QSS_CANON } from './_lib/qss-canon.js';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

// ─── System prompt ───────────────────────────────────────────
//
// Freestyle Wordy is intentionally different from the main tutor. The kid
// is sketching ideas, not building canon. Wordy's job is to be a curious
// thinking partner — not a tutor, not a director, not a quiz host.

const WRITING_DISCIPLINE = `═══ WRITING DISCIPLINE — LAW ═══

Banned phrases (do not use, ever): "pulling threads", "tipping into", "the story needs", "light the fuse", "weave", "tapestry", "delve", "unpack", "intricate", "in essence", "think of it as", "lean into", "lands", "let's", "should we".

Banned moves:
- meta-narration about story arcs ("this gives us tension", "this raises stakes")
- editorializing about what the story is doing
- pushing toward outcomes ("so what if…", "should we…")
- summarizing what Henry just said back to him

Use instead: motion, named characters, named feelings, named open questions, plain causality ("because/so"), concrete world details.

End every reply with exactly ONE open, genuinely curious question — not a setup. Or end on a sincere statement and skip the question. Never two questions.`;

const FREESTYLE_SYSTEM = `${WRITING_DISCIPLINE}

═══ YOU ARE WORDY IN FREESTYLE MODE ═══

You're hanging out with a 13-year-old named Henry while he sketches story ideas. He is autistic, brilliant, dark-satirical, deadpan. This is not the writing room — this is the back patio. He's not committing anything yet. He's just thinking out loud.

Your job here is to:
- be a curious thinking partner. Listen specifically; build on the exact thing he just said.
- play with the absurd; treat his weird specifics as if they're real (the beans, the calculator helmet, Queen Scarlet's totally-not-safe academy).
- ask a real question, not a workshop prompt. "what does the legal department actually do all day" is good; "what are some directions this could go" is bad.
- keep replies short. 2-4 sentences max. Sometimes one sentence is right.
- match his deadpan voice. Don't be peppy. Don't be a teacher.

DO NOT:
- propose "options"
- offer "scenarios" or numbered choices
- structure your reply ("first, let's…")
- write story prose for him
- summarize his message back
- moralize about whether something is good for a kid's story
- pretend to be excited
- write more than ~80 words

WORLD CANON (true unless he contradicts it):
- Queen Scarlet is a FIERCE RED DRAGON who runs the (sarcastically-named) Totally Safe Academy. Not a human queen, not a mascot.
- Tone is dark, satirical, sincere-then-undercut. Bureaucratic safety language describes things that are absolutely not safe.

OUTPUT FORMAT (this is strict):

First, your reply — just the chat reply, prose only, no preamble. End with one open question OR a sincere statement.

Then a fenced block <themes>...</themes> containing JSON: an array of 0-3 new themes you noticed in his message + your reply that might be worth catching for later. ONLY emit themes you haven't been told are already captured. Schema:

<themes>
[
  { "label": "short title, max 8 words, lower-case", "note": "1-sentence why this might matter later" }
]
</themes>

If nothing new is worth catching, return an empty array: <themes>[]</themes>.

NEVER skip the <themes> block — emit empty if you have to.`;

// ─── Handler ─────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const t0 = Date.now();
  const denied = await checkAccess(req);
  if (denied) return withCors(denied);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'invalid JSON' }); }

  const message = String(body?.message || '').trim();
  if (!message) return json(400, { error: 'message required' });

  const history = Array.isArray(body?.history) ? body.history.slice(-10) : [];
  const ctx = body?.story_context || {};
  const captured = Array.isArray(body?.captured_so_far) ? body.captured_so_far : [];

  const blocks = Array.isArray(ctx.blocks) ? ctx.blocks : [];
  const rules = ctx.rules || {};
  const arc = ctx.arc_context || null;
  const cards = Array.isArray(ctx.character_cards) ? ctx.character_cards : [];

  // Build a compact context block — Wordy needs to KNOW the world, but
  // we want short context so latency stays chatty.
  const blockSummary = buildBlockSummary(blocks);
  const arcLine = arc?.synopsis ? `Story so far (arc cache): ${arc.synopsis}` : '';
  const castLines = cards.slice(0, 8).map(c => {
    const name = String(c?.name || '').trim();
    if (!name) return '';
    const syn = String(c?.synopsis || '').replace(/\s+/g, ' ').slice(0, 200);
    return `- ${name}: ${syn}`;
  }).filter(Boolean).join('\n');

  // Canon overlay — scan recent message + history for canon names so the
  // model never confuses Queen Scarlet for a human queen mid-brainstorm.
  const scan = [message, ...history.map(h => h.content || '')].join(' ');
  const canonHits = findCanonCharactersInText(scan);
  const canonOverlay = canonHits.length
    ? '\n\n' + canonContextBlock(canonHits.map(c => c.name))
    : (QSS_CANON.world?.length ? '\n\n' + canonContextBlock([]) : '');

  const capturedLine = captured.length
    ? 'Themes already captured (DO NOT re-emit these): ' + captured.map(t => `"${String(t.label || '').slice(0, 60)}"`).join(', ')
    : '';

  const userPreamble = [
    rules.goal ? `Story goal Henry's parent set: ${rules.goal}` : '',
    rules.bible ? `Bible:\n${rules.bible}` : '',
    arcLine,
    castLines ? `Established cast:\n${castLines}` : '',
    blockSummary ? `Most recent committed blocks:\n${blockSummary}` : '',
    capturedLine,
    canonOverlay,
  ].filter(Boolean).join('\n\n');

  // Build messages: optional preamble as a system-like prefix on the first user msg
  const messages = [];
  if (userPreamble) {
    messages.push({ role: 'user', content: `Context for this freestyle session:\n\n${userPreamble}\n\n(Don't reply to the context. Henry's message follows.)` });
    messages.push({ role: 'assistant', content: 'Got it. Ready when you are.' });
  }
  for (const m of history) {
    if (!m || !m.content) continue;
    messages.push({ role: m.role === 'wordy' ? 'assistant' : 'user', content: String(m.content) });
  }
  messages.push({ role: 'user', content: message });

  // Guarantee the Anthropic contract: first turn is `user`, no consecutive
  // same-role turns. A seeded wordy greeting in `history` (with an empty
  // preamble) would otherwise lead with an `assistant` turn → 400; the
  // injected "Got it" preamble turn followed by a leading wordy turn would
  // otherwise emit two assistant turns in a row. Behavior-preserving for an
  // already-valid alternating history.
  const safeMessages = normalizeAnthropicMessages(messages);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 600,
        temperature: 0.85,
        system: FREESTYLE_SYSTEM,
        messages: safeMessages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return json(502, { error: `anthropic ${res.status}`, detail: errText.slice(0, 400) });
    }

    const data = await res.json();
    const raw = data?.content?.map(c => (c.type === 'text' ? c.text : '')).join('') || '';

    const { reply, themes } = splitReplyAndThemes(raw, captured);

    return json(200, {
      reply,
      new_themes: themes,
      ms: Date.now() - t0,
      model: 'claude-sonnet-4-5',
    });
  } catch (e) {
    return json(502, { error: 'request failed', detail: String(e?.message || e).slice(0, 400) });
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function splitReplyAndThemes(raw, alreadyCaptured) {
  if (!raw) return { reply: '', themes: [] };
  const match = raw.match(/<themes>\s*([\s\S]*?)\s*<\/themes>/i);
  let reply = raw;
  let themes = [];
  if (match) {
    reply = raw.slice(0, match.index).trim();
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) themes = parsed;
    } catch {
      // Try to repair: sometimes the model leaves trailing commas
      try {
        const repaired = match[1].replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
        const parsed = JSON.parse(repaired);
        if (Array.isArray(parsed)) themes = parsed;
      } catch {}
    }
  }
  // Normalize + dedupe against already-captured (case-insensitive).
  const seen = new Set(alreadyCaptured.map(t => String(t.label || '').toLowerCase().trim()));
  const cleaned = [];
  for (const t of themes) {
    if (!t || typeof t !== 'object') continue;
    const label = String(t.label || '').trim().slice(0, 80);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({
      id: cryptoId(),
      label,
      note: String(t.note || '').trim().slice(0, 240),
      captured_at: Date.now(),
    });
    if (cleaned.length >= 3) break;
  }
  return { reply: reply.trim(), themes: cleaned };
}

// Render the last (up to) 3 committed blocks as `[N] text` lines for Wordy's
// context, where N is each block's 1-based position in the full story. The
// 1-based label matters: Wordy references blocks by number when it brainstorms,
// so the number must match the block's actual place. Anchor the numbering on
// the slice's offset, NOT `length - 2`, which only happens to be 1-based for
// stories of 3+ blocks and emits `[0]` / `[-1]` at a story's 1-2-block opening.
export function buildBlockSummary(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const base = Math.max(0, list.length - 3); // 0-based index of the first shown block
  return list
    .slice(-3)
    .map((b, i) => `[${base + i + 1}] ${(b?.text || '').trim().slice(0, 320)}`)
    .join('\n\n');
}

function cryptoId() {
  // Best-effort short id without depending on Node crypto. Edge runtime has globalThis.crypto.
  try {
    const buf = new Uint8Array(8);
    globalThis.crypto.getRandomValues(buf);
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
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
