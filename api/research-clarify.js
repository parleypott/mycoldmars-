import { readJsonBody } from './_lib/read-json-body.js';

export const config = { runtime: 'edge', maxDuration: 30 };

/**
 * Pull the clarifier's JSON object out of a model reply. The model is asked for
 * strict JSON but sometimes wraps it in a ```json fence (possibly with prose
 * before it), so we match a fenced block ANYWHERE in the text first, then fall
 * back to parsing the whole reply.
 *
 * Closes the null-parse class follow-up: JSON.parse('null') SUCCEEDS and returns
 * null, and a number/string/array reply parses to a non-object too — none of
 * which is the { questions, summary } shape the caller needs. The old inline
 * code passed those straight through, so the backend returned a bare "null" /
 * "5" / "[…]" body from a public endpoint. We now treat any non-object result
 * as a failed clarify (ok:false) so the handler 502s and the frontend cleanly
 * SKIPS clarification (hides the panel, dispatches the original prompt) instead
 * of rendering an empty panel — the same graceful path a genuinely-invalid JSON
 * reply already takes.
 *
 * @returns {{ ok: boolean, value: object|null }} ok:true → value is a plain object.
 */
export function parseClarifyJson(text) {
  const raw = String(text ?? '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  let value;
  try {
    value = JSON.parse(fenced ? fenced[1] : raw);
  } catch {
    return { ok: false, value: null };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, value: null };
  }
  return { ok: true, value };
}

const SYSTEM = `You are a deep-research planner. Given a user's research question, your job is to surface what would be MOST USEFUL to know about their intent before dispatching the actual research.

Generate 3 to 5 clarifying questions that, if answered, would significantly improve the depth, scope, and specificity of the research that follows. Focus on:
- Scope (timeframe, geography, depth level)
- Intent (the underlying decision or output this research feeds into)
- Perspective (which stakeholders, sources, frameworks matter most)
- Specificity (named entities, edge cases, contrarian angles)
- Output format (length, audience, structure)

Return STRICT JSON only, no prose. Shape:
{
  "questions": [
    { "id": "q1", "question": "...", "examples": ["...", "..."] },
    ...
  ],
  "summary": "one sentence describing what you understood the question to be about"
}

Each question must be specific to THIS prompt — never generic. Each must include 2-3 short example answers in plain language to make it easy for the user to pick or modify.`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return new Response(JSON.stringify({ error: parsed.error }), {
    status: parsed.status, headers: { 'Content-Type': 'application/json' },
  });
  const { prompt } = parsed.body;
  if (!prompt) return new Response(JSON.stringify({ error: 'prompt required' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
  if (typeof prompt !== 'string' || prompt.length > 3000) {
    return new Response(JSON.stringify({ error: 'prompt too long (max 3000 chars)' }), {
      status: 413, headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Research question: "${prompt}"\n\nGenerate clarifying questions as strict JSON.` }],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    return new Response(JSON.stringify({ error: `clarify ${res.status}: ${t.slice(0, 300)}` }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  // Pull out the JSON block (model sometimes wraps in markdown despite instructions).
  // A null / primitive / array reply is not the { questions, summary } object we
  // need, so it's treated as a failed clarify (frontend cleanly skips).
  const clarified = parseClarifyJson(text);
  if (!clarified.ok) {
    return new Response(JSON.stringify({ error: 'clarify produced invalid json', raw: text.slice(0, 800) }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(clarified.value), {
    headers: { 'Content-Type': 'application/json' },
  });
}
