import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 30 };

const SYSTEM = `You are a deep-research analyst.
Produce a thorough markdown report. Structure: TL;DR, Background, Key Findings (with citations), Disagreements/Open Questions, Sources.
Use the web_search tool extensively. Pursue specifics over generalities. Inline citations as [n] keyed to a numbered Sources list.`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const denied = checkAccess(req);
  if (denied) return denied;

  const { prompt, model } = await req.json();
  if (!prompt) return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const MODEL = model || 'o4-mini-deep-research';

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: SYSTEM }] },
        { role: 'user', content: [{ type: 'input_text', text: prompt }] },
      ],
      reasoning: { summary: 'auto' },
      tools: [{ type: 'web_search_preview' }],
      background: true,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    return new Response(JSON.stringify({ error: `openai start ${res.status}: ${t.slice(0, 400)}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const job = await res.json();
  return new Response(JSON.stringify({ id: job.id, status: job.status }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
