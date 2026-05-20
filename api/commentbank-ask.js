// Public, unauthenticated chatbot endpoint for /commentbank.
// Public YouTube comments — no auth needed.
// Takes { question, comments[] } and returns { summary, matches[{id, why}] }.

export const config = { runtime: 'edge' };

const ASK_PROMPT = `You're searching a corpus of YouTube comments for a documentary filmmaker.

Given the user's question and a JSON list of comments, return strict JSON with:
- "summary": one short sentence summarizing what the matches show (or null if no matches).
- "matches": an array of up to 12 matching comment objects, each with:
  - "id": the comment's id from the corpus
  - "why": one short sentence (≤20 words) on why this comment matches the question

Order matches by relevance. If nothing fits, return {"summary": null, "matches": []}.
Return only the JSON object, no prose, no code fences.`;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  let body;
  try { body = await req.json(); }
  catch { return new Response('bad json', { status: 400 }); }

  const { question, comments } = body || {};
  if (!question || !Array.isArray(comments)) {
    return new Response(JSON.stringify({ error: 'missing question or comments' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const corpus = comments.map(c => ({
    id: c.id,
    text: c.text,
    by: c.commenter,
    sentiment: c.sentiment,
    themes: c.themes,
    video: c.video_hint,
  }));
  const userContent = `QUESTION: ${question}\n\nCORPUS (${corpus.length} comments):\n${JSON.stringify(corpus)}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      temperature: 0.3,
      system: ASK_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    return new Response(JSON.stringify({ error: `anthropic ${resp.status}: ${errText.slice(0, 200)}` }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await resp.json();
  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    const parsed = JSON.parse(cleaned);
    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'claude returned non-JSON', raw: cleaned.slice(0, 400) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
