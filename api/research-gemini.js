import { readJsonBody } from './_lib/read-json-body.js';
import { buildGeminiReport } from './_lib/research-gemini-report.js';

export const config = { runtime: 'edge', maxDuration: 60 };

const SYSTEM = `You are a deep-research analyst with access to Google Search grounding.
Produce a thorough markdown report. Structure: TL;DR, Background, Key Findings (with citations), Disagreements/Open Questions, Sources.
Pursue specifics. Inline citations as [n] keyed to a numbered Sources list. Use the search tool as widely as the topic deserves.`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return new Response(JSON.stringify({ error: parsed.error }), { status: parsed.status, headers: { 'Content-Type': 'application/json' } });
  const { prompt } = parsed.body;
  if (!prompt) return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not set' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  const MODEL = 'gemini-2.5-pro';
  // Send the API key in the x-goog-api-key header rather than the URL.
  // The URL-query form lands the key in Vercel + Google access logs
  // verbatim; the header form is the documented secure path.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
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
  const { report, sources, queries } = buildGeminiReport(data);

  return new Response(JSON.stringify({ report, sources, queries }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
