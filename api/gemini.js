export const config = { runtime: 'edge' };

/**
 * Gemini API proxy for Hunter + general use.
 * Handles pattern_surfacing by querying Supabase for analyses,
 * sending corpus to Gemini Pro, and saving observations back.
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
  const action = body.action;

  if (action === 'pattern_surfacing') {
    return handlePatternSurfacing(body, apiKey);
  }

  // Default: proxy to Gemini
  const model = body.model || 'gemini-2.5-flash';
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

async function handlePatternSurfacing(body, apiKey) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const projectId = body.projectId;

  // Fetch all analyses for this project's corpus units
  let analysesUrl = `${supabaseUrl}/rest/v1/analyses?select=output_text,corpus_unit_id,corpus_units!inner(media_asset_id,media_assets!inner(project_id))`;
  if (projectId) {
    analysesUrl += `&corpus_units.media_assets.project_id=eq.${projectId}`;
  }

  const analysesRes = await fetch(analysesUrl, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });

  if (!analysesRes.ok) {
    // Fallback: try a simpler query approach
    const simpleUrl = `${supabaseUrl}/rest/v1/rpc/get_project_analyses`;
    const rpcRes = await fetch(simpleUrl, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_project_id: projectId }),
    });

    if (!rpcRes.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch analyses', detail: await analysesRes.text() }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  let analyses = [];
  try {
    analyses = await analysesRes.json();
  } catch {
    return new Response(JSON.stringify({ error: 'No analyses found for this project' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!analyses.length) {
    return new Response(JSON.stringify({ error: 'No analyses found. Ingest some footage first.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build corpus text
  const corpus = analyses.map((a, i) =>
    `[Unit ${i + 1}]\n${a.output_text}`
  ).join('\n\n---\n\n');

  // Send to Gemini Pro for synthesis
  const model = 'gemini-2.5-pro';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const geminiRes = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `You are a perceptive documentary editor's assistant. Below is a corpus of shot-by-shot analysis from a filmmaker's footage archive.

Read the entire corpus carefully. Then write 5-8 prose observations about RECURRING PATTERNS you notice across the footage. Each observation should:

1. Name a specific pattern (visual motif, compositional habit, emotional rhythm, subject behavior, etc.)
2. Cite 2-4 specific units by number that exemplify it
3. Explain WHY this pattern is editorially interesting — what does it reveal about the filmmaker's instincts, or what storytelling opportunity does it create?

Write as a thoughtful collaborator, not a database. Use editorial language. Be specific. Surprise the filmmaker with things they might not have consciously noticed about their own work.

Return your response as a JSON array of objects, each with:
- "pattern_name": string (bold, concise name)
- "observation": string (the full prose observation)
- "example_units": number[] (unit indices cited)

CORPUS:
${corpus}`
        }],
      }],
      generationConfig: {
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    return new Response(JSON.stringify({ error: 'Gemini synthesis failed', detail: errText.slice(0, 500) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const geminiData = await geminiRes.json();
  const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Parse observations
  let observations = [];
  try {
    observations = JSON.parse(responseText);
  } catch {
    // If not valid JSON, treat as prose and split by paragraphs
    observations = responseText.split('\n\n').filter(p => p.trim()).map(p => ({
      pattern_name: p.slice(0, 60),
      observation: p,
      example_units: [],
    }));
  }

  // Save observations to Supabase
  for (const obs of observations) {
    await fetch(`${supabaseUrl}/rest/v1/pattern_observations`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        project_id: projectId || null,
        observation_text: obs.observation || obs.pattern_name,
        example_unit_ids: [],
        status: 'surfaced',
      }),
    });
  }

  return new Response(JSON.stringify({ success: true, count: observations.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
