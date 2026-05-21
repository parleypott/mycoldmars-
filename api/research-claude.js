import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 300 };

const SYSTEM = `You are a deep-research analyst. Given a question, produce a comprehensive, well-structured markdown report.

Requirements:
- Use the web_search tool aggressively — at least 6-10 distinct searches, exploring different angles, dates, and sources.
- Pursue specifics: names, dates, numbers, primary sources, contradictory accounts.
- Structure the final report as:
  # <Topic title>
  ## TL;DR
  (5-8 bullets of the most important findings)
  ## Background
  ## Key Findings
  (each finding gets a subheading with evidence and sources)
  ## Disagreements / Open Questions
  ## Sources
  (numbered list of every URL cited)
- Inline citations as [n] keyed to the Sources list.
- No hedging filler. Write like a senior journalist.`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const denied = checkAccess(req);
  if (denied) return denied;

  const { prompt } = await req.json();
  if (!prompt) return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 16000,
      system: SYSTEM,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 12 }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    return new Response(JSON.stringify({ error: `anthropic ${res.status}: ${t.slice(0, 400)}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await res.json();
  const parts = [];
  let searchCount = 0;
  for (const block of data.content ?? []) {
    if (block.type === 'text' && block.text) parts.push(block.text);
    if (block.type === 'server_tool_use' && block.name === 'web_search') searchCount++;
  }
  const report = parts.join('\n\n').trim();

  return new Response(JSON.stringify({ report, searches: searchCount }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
