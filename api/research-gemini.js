import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 60 };

const SYSTEM = `You are a deep-research analyst with access to Google Search grounding.
Produce a thorough markdown report. Structure: TL;DR, Background, Key Findings (with citations), Disagreements/Open Questions, Sources.
Pursue specifics. Inline citations as [n] keyed to a numbered Sources list. Use the search tool as widely as the topic deserves.`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const denied = checkAccess(req);
  if (denied) return denied;

  const { prompt } = await req.json();
  if (!prompt) return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const MODEL = 'gemini-2.5-pro';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 16000 },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    return new Response(JSON.stringify({ error: `gemini ${res.status}: ${t.slice(0, 400)}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map(p => p.text ?? '').join('\n').trim() ?? '(empty)';
  const sources = [];
  for (const ch of cand?.groundingMetadata?.groundingChunks ?? []) {
    if (ch.web?.uri) sources.push(ch.web.uri);
  }
  const queries = cand?.groundingMetadata?.webSearchQueries ?? [];
  const report = text +
    (sources.length ? `\n\n## Sources\n${[...new Set(sources)].map((u, i) => `${i + 1}. ${u}`).join('\n')}` : '') +
    (queries.length ? `\n\n_Search queries used: ${queries.map(q => `\`${q}\``).join(', ')}_` : '');

  return new Response(JSON.stringify({ report, sources: sources.length, queries: queries.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
