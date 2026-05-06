export const config = { runtime: 'edge' };

/**
 * Thin proxy to Google Gemini API. Adds the API key and pipes the
 * response to the browser. Parallels /api/claude.js for the Interpreter.
 */
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response('GEMINI_API_KEY not configured', { status: 500 });
  }

  const body = await req.json();
  const model = body.model || 'gemini-2.5-flash';
  const action = body.action;

  // For pattern surfacing, we need the full corpus context — this is handled
  // by the worker process on Orange Jacket, not the edge function.
  // The edge function only handles simple generate-content requests.
  if (action === 'pattern_surfacing') {
    return new Response(JSON.stringify({
      error: 'Pattern surfacing runs on the worker, not the edge function. Call the worker API instead.'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const geminiBody = {
    contents: body.contents || [{ parts: [{ text: body.prompt || '' }] }],
    generationConfig: body.generationConfig || {},
  };
  if (body.systemInstruction) {
    geminiBody.systemInstruction = body.systemInstruction;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiBody),
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
}
