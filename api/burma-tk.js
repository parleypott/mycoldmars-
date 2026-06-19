// WP-01 Burma Script — the {TK} writing helper + fact-check backend.
// MIRRORS api/research-claude.js: an Edge handler that POSTs straight to the Anthropic
// Messages API with x-api-key / anthropic-version 2023-06-01 / claude-sonnet-4-5. No SDK.
//
// Two modes, picked by the `mode` field on the request:
//   mode:'tk'  → return FIVE distinct, ready-to-drop alternatives for a {TK} gap, each
//                tone/length/rhythm-matched to the surrounding script, with a brief source
//                line for any factual claim. Output replaces the {TK} marker in the doc.
//   mode:'fc'  → fact-check a claim: a verdict (true/false/unclear), a one-line finding,
//                a suggested corrected edit, and sources. Web search ON for fc.
//
// The {TK}/{fc} marker text + the block it sits in + nearby script come in as context so
// the model writes in Johnny's voice and at the right altitude — not generic filler.

import { readJsonBody } from './_lib/read-json-body.js';

export const config = { runtime: 'edge', maxDuration: 120 };

const MODEL = 'claude-sonnet-4-5-20250929';

// Force structured JSON out of the model via a single tool the model MUST call. This is
// far more reliable than asking it to "return JSON" in prose and then regex-scraping.
const TK_TOOL = {
  name: 'emit_options',
  description: 'Return exactly five distinct written alternatives for the {TK} gap.',
  input_schema: {
    type: 'object',
    properties: {
      options: {
        type: 'array',
        minItems: 5,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The ready-to-drop line(s) that REPLACE the {TK} marker. No braces, no label — just the prose, in the script\'s voice.' },
            angle: { type: 'string', description: '2-4 word label for how this option differs (e.g. "tight + factual", "lyrical", "punchy one-liner").' },
            source: { type: 'string', description: 'Brief source for any factual claim ("est. ~20 EAOs, Council on Foreign Relations 2023"). Empty string if purely stylistic.' },
          },
          required: ['text', 'angle', 'source'],
        },
      },
    },
    required: ['options'],
  },
};

const FC_TOOL = {
  name: 'emit_verdict',
  description: 'Return a fact-check verdict for the claim, with a corrected edit and sources.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['true', 'false', 'partly', 'unclear'], description: 'Overall verdict on the claim.' },
      finding: { type: 'string', description: 'One or two sentences stating what the evidence says.' },
      suggestedEdit: { type: 'string', description: 'A corrected, ready-to-drop line that REPLACES the {fc} marker — the verified fact written in the script\'s voice. No braces.' },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, url: { type: 'string' } },
          required: ['label'],
        },
      },
    },
    required: ['verdict', 'finding', 'suggestedEdit', 'sources'],
  },
};

export function tkPrompt({ marker, block, context }) {
  return `You are a writing partner for Johnny Harris's documentary about Burma/Myanmar (The Human Element). The script is voice-over for a cinematic explainer — plain, vivid, emotionally grounded, never academic or marketing-shouty. One idea per line. Lowercase-friendly, declarative.

A {TK} marker is a GAP the writer left for you to fill. The marker text describes what's needed:

  GAP NEEDED: ${marker}

It sits inside this block of the script:

  BLOCK: ${block || '(no surrounding block)'}

Nearby script for tone/rhythm/voice:

  CONTEXT: ${context || '(no extra context)'}

Write FIVE genuinely DISTINCT alternatives that could REPLACE the {TK} marker in place. Match the surrounding sentence so the line reads continuously — if the gap is mid-sentence, write a fragment that completes it; if it's a whole line, write a whole line. Vary the five across: length (one tight, one fuller), rhythm, and angle (factual / lyrical / punchy). For any factual claim, put a brief real source in the source field. Do NOT include the curly braces. Call emit_options exactly once.`;
}

export function fcPrompt({ marker, block, context }) {
  return `You are fact-checking a claim in Johnny Harris's Burma/Myanmar documentary script. Use web_search aggressively to verify. The {fc} marker states the claim or the fact to nail down:

  CLAIM / FACT NEEDED: ${marker}

Surrounding block: ${block || '(none)'}
Nearby script: ${context || '(none)'}

Verify against primary/reputable sources. Then call emit_verdict exactly once with: a verdict, a one-line finding, a suggestedEdit (the corrected fact written as a ready-to-drop line in the script's plain VO voice, no braces — this replaces the {fc} marker), and sources.`;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  // Shared safe body read: malformed JSON OR a non-object body (a JSON literal
  // `null`, number, string, array) is a clean 400, never an unhandled 500 — the
  // null-body crash class fixed across the research-* endpoints (was: `body.mode`
  // on a null body threw a TypeError -> 500).
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;

  const mode = body.mode === 'fc' ? 'fc' : 'tk';
  const marker = typeof body.marker === 'string' ? body.marker.trim() : '';
  const block = typeof body.block === 'string' ? body.block.slice(0, 2000) : '';
  const context = typeof body.context === 'string' ? body.context.slice(0, 3000) : '';

  if (!marker) return json({ error: 'marker required' }, 400);
  // Cost guard — mirror research-claude.js. Cap the marker length too.
  if (marker.length > 1200) return json({ error: 'marker too long' }, 413);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not set on server' }, 500);

  const isFc = mode === 'fc';
  const tool = isFc ? FC_TOOL : TK_TOOL;
  const prompt = isFc ? fcPrompt({ marker, block, context }) : tkPrompt({ marker, block, context });

  const payload = {
    model: MODEL,
    max_tokens: 2000,
    tools: isFc
      ? [tool, { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]
      : [tool],
    tool_choice: isFc ? { type: 'auto' } : { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: prompt }],
  };

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return json({ error: `anthropic unreachable: ${err?.message || err}` }, 502);
  }

  if (!res.ok) {
    const t = await res.text();
    return json({ error: `anthropic ${res.status}: ${t.slice(0, 400)}` }, 502);
  }

  const data = await res.json();
  // Pull the tool_use block (the structured output). For fc the model may emit text +
  // server_tool_use (web_search) blocks too — find the one matching our tool name.
  let toolInput = null;
  for (const b of data.content ?? []) {
    if (b.type === 'tool_use' && b.name === tool.name) { toolInput = b.input; break; }
  }

  if (!toolInput) {
    // Fallback: the model answered in prose instead of calling the tool. Surface the text
    // so the client can at least show SOMETHING rather than a blank panel.
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return json({ error: 'model did not return structured output', raw: text.slice(0, 600) }, 502);
  }

  if (isFc) {
    return json({ mode: 'fc', ...toolInput });
  }
  // Defensive: ensure 5 options, each with the expected shape.
  const options = Array.isArray(toolInput.options) ? toolInput.options.slice(0, 5) : [];
  return json({ mode: 'tk', options });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
