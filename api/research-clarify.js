export const config = { runtime: 'edge', maxDuration: 30 };

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

  const { prompt } = await req.json();
  if (!prompt) return new Response(JSON.stringify({ error: 'prompt required' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });

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

  // Pull out the JSON block (model sometimes wraps in markdown despite instructions)
  let json;
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    json = JSON.parse(m ? m[1] : text);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'clarify produced invalid json', raw: text.slice(0, 800) }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(json), {
    headers: { 'Content-Type': 'application/json' },
  });
}
