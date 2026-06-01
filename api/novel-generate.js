// /api/novel-generate.js
//
// The single AI endpoint for the novel tool. Receives a directive (the
// contents of a [[ bracket ]] the user wants turned into prose) plus the
// full novel context, returns prose.
//
// Strategy: prompt caching on the long stable parts (novel + codex +
// outline + voice samples). First call of a session pays full price;
// every subsequent call within the cache TTL pays ~10% on the cached
// blocks. Cache TTL refreshes on every read.
//
// Runtime: Node (NOT Edge) — we need the Anthropic SDK and long-running
// streaming. Vercel Node functions have a 4.5MB request cap which is
// fine; we never send images here.

import Anthropic from '@anthropic-ai/sdk';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const MODEL_SONNET = 'claude-sonnet-4-6';
const MODEL_OPUS = 'claude-opus-4-7';

// ── pricing per 1M tokens (USD) ──
const PRICING = {
  'claude-sonnet-4-6': { in: 3.00, in_cache_write: 3.75, in_cache_read: 0.30, out: 15.00 },
  'claude-opus-4-7':   { in: 15.00, in_cache_write: 18.75, in_cache_read: 1.50, out: 75.00 },
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function costUSD(model, usage) {
  const p = PRICING[model] || PRICING[MODEL_SONNET];
  const inTok = usage.input_tokens || 0;
  const writeTok = usage.cache_creation_input_tokens || 0;
  const readTok = usage.cache_read_input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  return (
    (inTok / 1e6) * p.in +
    (writeTok / 1e6) * p.in_cache_write +
    (readTok / 1e6) * p.in_cache_read +
    (outTok / 1e6) * p.out
  );
}

function buildPrompt(payload) {
  const {
    novel_title = 'Untitled',
    novel_blurb = '',
    voice_sample = '',
    outline_text = '',
    codex_text = '',
    full_novel_text = '',
    surrounding_prose = '',
    directive = '',
    kind = 'bracket',
    strict_mode = true,
  } = payload;

  // ── SYSTEM (cached) ──
  // The system prompt is stable across a session. Cache it.
  const system = [
    {
      type: 'text',
      text: `You are a novel-writing collaborator embedded in a writer's editorial tool. The writer is composing a literary novel. They have given you the entire novel-in-progress, a story bible (codex), an outline, and a voice sample. Your job is to take a directive — usually a [[ bracketed instruction ]] inside the prose — and write the prose that fulfills it, ready to be inserted directly into the manuscript.

OPERATING RULES:
1. Match the voice. The voice sample is the law. Mirror cadence, vocabulary, sentence-length variance, and emotional restraint. If the prior writing is spare, do not turn florid. If the prior writing trusts the reader, do not over-explain.
2. Stay consistent with the codex. Characters, places, objects, and lore in the codex are canon. Use them. If the directive introduces a NEW proper noun (a name, place, or object) that is not in the codex, ${strict_mode ? 'STOP and ASK before inventing — return a short clarifying question instead of prose' : 'invent carefully and flag it at the end so the writer can add it to the codex'}.
3. Honor scale and intimacy together. This writer believes the best stories hold both. Avoid both pure abstraction and pure interiority — anchor in sensory detail and consequence.
4. No AI tropes. Banned phrases: "weaving threads", "tipping into", "delve", "intricate dance", "tapestry", meta-narration about arcs ("this chapter pulls together..."), portentous one-line paragraphs, hollow rhetorical questions. Do not write "the air was thick with..." anything.
5. Output only the prose. No preamble, no quotation marks around it, no "Here's the scene:". Just the words that go into the manuscript.
6. Length: match the directive. If the directive says "three short sentences," obey. If it says "draft a scene," default to 200-600 words. If unsure, lean shorter — the writer can ask for more.
7. Never break the fourth wall to the writer inside the prose itself. Any meta-comment goes after a line of three em-dashes (— — —) at the very end.`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  // ── USER (cached body + fresh tail) ──
  // The first big block is the cached context. The fresh tail is the
  // specific directive + nearby prose. Anthropic supports up to 4
  // cache_control breakpoints; we use 3: voice/outline/codex, novel,
  // and the system above.
  const userBlocks = [];

  if (voice_sample.trim() || outline_text.trim() || codex_text.trim() || novel_blurb.trim()) {
    userBlocks.push({
      type: 'text',
      text: `# THE NOVEL · "${novel_title}"

${novel_blurb ? `## Blurb\n\n${novel_blurb}\n\n` : ''}${voice_sample ? `## Voice sample — write like THIS\n\n${voice_sample}\n\n` : ''}${outline_text ? `## Outline\n\n${outline_text}\n\n` : ''}${codex_text ? `## Codex (story bible)\n\n${codex_text}\n` : ''}`,
      cache_control: { type: 'ephemeral' },
    });
  }

  if (full_novel_text.trim()) {
    userBlocks.push({
      type: 'text',
      text: `## Full manuscript so far\n\nEverything written below is the existing novel, in order. Match its voice exactly.\n\n${full_novel_text}\n`,
      cache_control: { type: 'ephemeral' },
    });
  }

  // ── fresh tail ──
  const surroundingBlock = surrounding_prose.trim()
    ? `## Surrounding prose (where the directive sits in context)\n\nIMMEDIATELY BEFORE the directive:\n\n${surrounding_prose}\n\n`
    : '';

  const directiveLabel = {
    bracket: 'Expand this bracketed directive into prose. The directive lives inside [[ ]] in the manuscript and your prose will replace it.',
    highlight: 'Rewrite the following passage. Return ONLY the rewritten prose.',
    'outline-prompt': 'Draft a full scene from this directive. The scene will be inserted into the manuscript at the location specified.',
  }[kind] || 'Expand this directive into prose.';

  userBlocks.push({
    type: 'text',
    text: `${surroundingBlock}## YOUR TASK\n\n${directiveLabel}\n\n### Directive\n\n${directive}\n\n---\n\nWrite the prose now. No preamble. Just the words.`,
  });

  return { system, userBlocks };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' }); return; }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    res.status(400).json({ error: 'invalid JSON body' });
    return;
  }

  const directive = (payload.directive || '').trim();
  if (!directive) { res.status(400).json({ error: 'directive is required' }); return; }
  if (directive.length > 8000) { res.status(400).json({ error: 'directive too long (max 8000 chars)' }); return; }

  const model = payload.model === 'opus' ? MODEL_OPUS : MODEL_SONNET;

  const { system, userBlocks } = buildPrompt(payload);

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: payload.max_tokens || 2000,
      system,
      messages: [{ role: 'user', content: userBlocks }],
    });

    const prose = (response.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    const usage = response.usage || {};
    const cost_usd = costUSD(model, usage);

    res.status(200).json({
      prose,
      model,
      usage: {
        input_tokens: usage.input_tokens || 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
      },
      cost_usd,
      stop_reason: response.stop_reason,
    });
  } catch (err) {
    console.error('[novel-generate] error', err);
    res.status(500).json({
      error: 'generation failed',
      detail: err?.message || String(err),
    });
  }
}
