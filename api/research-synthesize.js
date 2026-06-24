import { readJsonBody } from './_lib/read-json-body.js';
import { countWords } from './_lib/count-words.js';

export const config = { runtime: 'edge', maxDuration: 120 };

const SYSTEM_NARRATION = `You are a documentary narration writer. Given three research reports on the same topic (from Claude, ChatGPT/OpenAI, and Gemini), produce a single cohesive narration script suitable for audio.

Requirements:
- Lead with the most striking finding, not with a setup.
- Editorial tone: lowercase-friendly headers in your head only — output is pure spoken text, no markdown.
- Synthesize: agree where they agree, surface and attribute disagreements ("Claude's research surfaced X, but Gemini's grounding suggests Y").
- 800-1500 words, designed to be heard, not read. Short sentences. Specific. No bullet points. No "in conclusion".
- Do not invent facts that aren't in the three source reports.
- Open with a one-sentence hook. Close with the open question that matters most.
- Never read URLs aloud. Never say "according to source 3". Naturalize all attribution.`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return new Response(JSON.stringify({ error: parsed.error }), { status: parsed.status, headers: { 'Content-Type': 'application/json' } });
  const { prompt, claude, chatgpt, gemini } = parsed.body;
  if (!prompt) return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  // Cost guard. The three report fields can be large markdown — cap the
  // total combined body before forwarding to Sonnet 4.5 (8000-token max
  // output) so a malicious caller can't drive the bill.
  const totalChars = (typeof prompt === 'string' ? prompt.length : 0)
    + (typeof claude === 'string' ? claude.length : 0)
    + (typeof chatgpt === 'string' ? chatgpt.length : 0)
    + (typeof gemini === 'string' ? gemini.length : 0);
  if (totalChars > 80_000) {
    return new Response(JSON.stringify({ error: `input too large (max 80,000 chars total, got ${totalChars})` }), {
      status: 413, headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = `Original research question:\n${prompt}\n\n---\n# Claude's report\n${claude || '(none)'}\n\n---\n# ChatGPT's report\n${chatgpt || '(none)'}\n\n---\n# Gemini's report\n${gemini || '(none)'}\n\n---\nWrite the narration now.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: SYSTEM_NARRATION,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    return new Response(JSON.stringify({ error: `anthropic synth ${res.status}: ${t.slice(0, 300)}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n\n')
    .trim();

  const words = countWords(text);
  const minutes = Math.round((words / 150) * 10) / 10;

  return new Response(JSON.stringify({ text, words, minutes }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
