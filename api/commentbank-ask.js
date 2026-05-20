// Public, unauthenticated chatbot endpoint for /commentbank.
// Uses Anthropic prompt caching so the corpus (~500KB) only gets processed once
// per cache window (1 hour) instead of on every query — 5-10x faster, ~10% of cost.

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You're searching a corpus of YouTube comments for a documentary filmmaker.

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

  // Stable corpus block (cached) + dynamic question block (not cached)
  const corpusBlock = `CORPUS (${corpus.length} comments):\n${JSON.stringify(corpus)}`;
  const questionBlock = `QUESTION: ${question}`;

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
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: corpusBlock,
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
          {
            type: 'text',
            text: questionBlock,
          },
        ],
      }],
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

  // Cache usage telemetry (visible to caller — useful for tuning)
  const usage = data.usage || {};
  const cacheStats = {
    cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
    cache_read_input_tokens: usage.cache_read_input_tokens || 0,
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
  };

  try {
    const parsed = JSON.parse(cleaned);
    parsed._cache = cacheStats;
    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'claude returned non-JSON', raw: cleaned.slice(0, 400), _cache: cacheStats }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
