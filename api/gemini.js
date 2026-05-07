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

  if (action === 'semantic_search') {
    return handleSemanticSearch(body, apiKey);
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

// ── Semantic Search ──

async function handleSemanticSearch(body, apiKey) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return jsonResponse({ error: 'Supabase not configured' }, 500);
  }

  const { query, projectId, limit = 20, tier } = body;
  if (!query) return jsonResponse({ error: 'query is required' }, 400);

  // 1. Generate query embedding via Gemini
  const embUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  const embRes = await fetch(embUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text: query }] },
      outputDimensionality: 768,
    }),
  });

  if (!embRes.ok) {
    return jsonResponse({ error: 'Embedding generation failed' }, 502);
  }

  const embData = await embRes.json();
  const queryEmbedding = embData.embedding?.values;
  if (!queryEmbedding) return jsonResponse({ error: 'No embedding returned' }, 502);

  // 2. Fetch all embeddings from Supabase (paginated)
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  let allEmbeddings = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const url = `${supabaseUrl}/rest/v1/embeddings?select=corpus_unit_id,embedding&order=created_at.asc&offset=${offset}&limit=${PAGE}`;
    const res = await fetch(url, { headers });
    if (!res.ok) break;
    const data = await res.json();
    if (!data?.length) break;
    allEmbeddings = allEmbeddings.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // 3. Compute cosine similarity
  const results = [];
  for (const row of allEmbeddings) {
    const emb = parseEmbedding(row.embedding);
    if (!emb) continue;
    const sim = cosineSim(queryEmbedding, emb);
    results.push({ corpus_unit_id: row.corpus_unit_id, similarity: sim });
  }

  results.sort((a, b) => b.similarity - a.similarity);
  const topIds = results.slice(0, Math.min(limit * 3, 100)); // Fetch extra for filtering

  // 4. Fetch corpus unit details + analysis text for top matches
  const unitIds = topIds.map(r => r.corpus_unit_id);
  const simMap = new Map(topIds.map(r => [r.corpus_unit_id, r.similarity]));

  // Fetch in batches of 50 to avoid URL length limits
  let units = [];
  for (let i = 0; i < unitIds.length; i += 50) {
    const batch = unitIds.slice(i, i + 50);
    const idsParam = `in.(${batch.join(',')})`;
    const url = `${supabaseUrl}/rest/v1/corpus_units?select=id,source_clip_name,start_seconds,end_seconds,media_asset_id,media_assets!inner(tier,project_id,hunter_projects!inner(name))&id=${idsParam}`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      units = units.concat(data);
    }
  }

  // Filter by tier/project if specified
  let filtered = units;
  if (tier) filtered = filtered.filter(u => u.media_assets?.tier === tier);
  if (projectId) filtered = filtered.filter(u => u.media_assets?.project_id === projectId);

  // Fetch analyses for filtered units
  const filteredIds = filtered.map(u => u.id);
  let analyses = [];
  for (let i = 0; i < filteredIds.length; i += 50) {
    const batch = filteredIds.slice(i, i + 50);
    const idsParam = `in.(${batch.join(',')})`;
    const url = `${supabaseUrl}/rest/v1/analyses?select=corpus_unit_id,output_text&corpus_unit_id=${idsParam}&limit=100`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      analyses = analyses.concat(data);
    }
  }
  const analysisMap = new Map(analyses.map(a => [a.corpus_unit_id, a.output_text]));

  // Build response
  const matches = filtered
    .map(u => ({
      id: u.id,
      clipName: u.source_clip_name,
      startSeconds: u.start_seconds,
      endSeconds: u.end_seconds,
      tier: u.media_assets?.tier,
      projectName: u.media_assets?.hunter_projects?.name,
      similarity: simMap.get(u.id) || 0,
      analysisPreview: (analysisMap.get(u.id) || '').slice(0, 400),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return jsonResponse({ matches, total: allEmbeddings.length, query });
}

function parseEmbedding(emb) {
  if (Array.isArray(emb)) return emb;
  if (typeof emb === 'string') {
    try { return JSON.parse(emb); } catch {}
    return emb.replace(/[[\]()]/g, '').split(',').map(Number);
  }
  return null;
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d > 0 ? dot / d : 0;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
