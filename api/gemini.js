export const config = { runtime: 'edge', maxDuration: 60 };

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

  if (action === 'scene_insights') {
    return handleSceneInsights(body, apiKey);
  }

  if (action === 'narrative_insights') {
    return handleNarrativeInsights(body, apiKey);
  }

  if (action === 'chat') {
    return handleChat(body, apiKey);
  }

  if (action === 'tier_comparison') {
    return handleTierComparison(body, apiKey);
  }

  if (action === 'get_corpus_context') {
    return handleGetCorpusContext(body);
  }

  if (action === 'run_script_pass') {
    return handleRunScriptPass(body, apiKey);
  }

  if (action === 'get_script_passes') {
    return handleGetScriptPasses(body);
  }

  if (action === 'get_script_snapshot') {
    return handleGetScriptSnapshot(body);
  }

  if (action === 'script_copilot_chat') {
    return handleScriptCopilotChat(body, apiKey);
  }

  if (action === 'fetch_parse_doc') {
    return handleFetchParseDoc(body);
  }

  if (action === 'run_global_training') {
    return handleRunGlobalTraining(body, apiKey);
  }

  if (action === 'get_global_training') {
    return handleGetGlobalTraining();
  }

  if (action === 'persist_editorial_decisions') {
    return handlePersistEditorialDecisions(body);
  }

  if (action === 'run_taste_training') {
    return handleRunTasteTraining(apiKey);
  }

  if (action === 'get_taste_profile') {
    return handleGetTasteProfile();
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

  // Fetch analyses for this project's corpus units (capped to avoid timeout)
  const MAX_ANALYSES = 200;
  let analysesUrl = `${supabaseUrl}/rest/v1/analyses?select=output_text,corpus_unit_id,corpus_units!inner(media_asset_id,media_assets!inner(project_id))&limit=${MAX_ANALYSES}`;
  if (projectId) {
    analysesUrl += `&corpus_units.media_assets.project_id=eq.${projectId}`;
  }

  const analysesRes = await fetch(analysesUrl, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });

  let analysesSource = analysesRes;

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
      return new Response(JSON.stringify({ error: 'Failed to fetch analyses', detail: await rpcRes.text() }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    analysesSource = rpcRes;
  }

  let analyses = [];
  try {
    analyses = await analysesSource.json();
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

  // Build corpus text — truncate each analysis to keep total size manageable
  const MAX_PER_UNIT = 600;
  const sampled = analyses.length > 150
    ? analyses.filter((_, i) => i % Math.ceil(analyses.length / 150) === 0).slice(0, 150)
    : analyses;

  const corpus = sampled.map((a, i) => {
    const text = (a.output_text || '').slice(0, MAX_PER_UNIT);
    return `[Unit ${i + 1}]\n${text}`;
  }).join('\n\n---\n\n');

  // Send to Gemini Flash for synthesis (Pro times out on Vercel Edge)
  const model = 'gemini-2.5-flash';
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

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  };

  // Try server-side pgvector RPC first (instant), fall back to client-side
  const rpcResult = await tryRpcSearch(supabaseUrl, headers, queryEmbedding, { limit, tier, projectId });
  if (rpcResult) {
    return jsonResponse({ matches: rpcResult, total: rpcResult.length, query, method: 'rpc' });
  }

  // Fallback: client-side cosine similarity
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

  const results = [];
  for (const row of allEmbeddings) {
    const emb = parseEmbedding(row.embedding);
    if (!emb) continue;
    const sim = cosineSim(queryEmbedding, emb);
    results.push({ corpus_unit_id: row.corpus_unit_id, similarity: sim });
  }

  results.sort((a, b) => b.similarity - a.similarity);
  const topIds = results.slice(0, Math.min(limit * 3, 100));

  const unitIds = topIds.map(r => r.corpus_unit_id);
  const simMap = new Map(topIds.map(r => [r.corpus_unit_id, r.similarity]));

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

  let filtered = units;
  if (tier) filtered = filtered.filter(u => u.media_assets?.tier === tier);
  if (projectId) filtered = filtered.filter(u => u.media_assets?.project_id === projectId);

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

  const matches = filtered
    .map(u => ({
      id: u.id,
      clipName: u.source_clip_name,
      startSeconds: u.start_seconds,
      endSeconds: u.end_seconds,
      tier: u.media_assets?.tier,
      projectName: u.media_assets?.hunter_projects?.name,
      projectId: u.media_assets?.project_id,
      similarity: simMap.get(u.id) || 0,
      analysisPreview: (analysisMap.get(u.id) || '').slice(0, 400),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return jsonResponse({ matches, total: allEmbeddings.length, query, method: 'client' });
}

async function tryRpcSearch(supabaseUrl, headers, queryEmbedding, { limit, tier, projectId }) {
  try {
    const rpcUrl = `${supabaseUrl}/rest/v1/rpc/search_corpus_embeddings`;
    const rpcBody = {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      match_count: limit,
      match_threshold: 0.3,
    };
    if (tier) rpcBody.filter_tier = tier;
    if (projectId) rpcBody.filter_project_id = projectId;

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcBody),
    });

    if (!res.ok) return null; // RPC not available, fall back

    const data = await res.json();
    if (!Array.isArray(data)) return null;

    return data.map(r => ({
      id: r.corpus_unit_id,
      clipName: r.clip_name,
      startSeconds: r.start_seconds,
      endSeconds: r.end_seconds,
      tier: r.tier,
      projectName: r.project_name,
      projectId: r.project_id,
      similarity: r.similarity,
      analysisPreview: r.analysis_preview || '',
    }));
  } catch {
    return null; // Any error = fall back to client-side
  }
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

// ── Scene Insights ──

async function handleSceneInsights(body, apiKey) {
  const { scenes } = body;
  if (!scenes?.length) return jsonResponse({ error: 'scenes array is required' }, 400);

  const capped = scenes.slice(0, 20).map(scene => {
    const clips = (scene.clips || []).slice(0, 8).map(c => {
      const text = (c.analysisText || '').slice(0, 200);
      return `  - ${c.clipName || 'clip'} (${c.startSeconds || 0}s–${c.endSeconds || 0}s): ${text}`;
    }).join('\n');
    return `SCENE: ${scene.label || 'Untitled'} (${scene.day || ''} ${scene.time || ''}, ${scene.clipCount || 0} clips)\n${clips}`;
  });

  const prompt = `You are Hunter's editorial intelligence — a perceptive documentary editor's assistant.

Below are ${capped.length} detected scenes from a filmmaker's project, each with clip analyses. For each scene, provide:

1. scene_description: A vivid 2-3 sentence editorial description of what this scene captures
2. editorial_potential: Rate LOW / MEDIUM / HIGH and explain why in one sentence
3. key_moments: Array of 1-3 specific moments worth noting (clip name + what makes it special)
4. emotional_arc: One sentence describing the emotional movement across the scene's clips
5. connections: Any thematic links to other scenes (reference by scene number)

Return JSON array of objects, one per scene, with fields: scene_index (0-based), scene_description, editorial_potential, key_moments, emotional_arc, connections.

SCENES:
${capped.join('\n\n---\n\n')}`;

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8000, responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) {
    return jsonResponse({ error: 'Gemini scene insights failed', detail: (await res.text()).slice(0, 500) }, 502);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let insights = [];
  try { insights = JSON.parse(text); } catch {
    insights = [{ scene_description: text, editorial_potential: 'UNKNOWN', key_moments: [], emotional_arc: '', connections: '' }];
  }

  return jsonResponse({ insights });
}

// ── Chat ──

async function handleChat(body, apiKey) {
  const { message, conversationHistory, projectContext, relevantClips } = body;
  if (!message) return jsonResponse({ error: 'message is required' }, 400);

  // Build context from relevant clips
  let clipsContext = '';
  if (relevantClips?.length) {
    clipsContext = '\n\nRELEVANT CLIPS (found via semantic search):\n' +
      relevantClips.slice(0, 10).map((c, i) => {
        return `[${i + 1}] ${c.clipName || 'clip'} (${c.tier || ''}, ${formatSeconds(c.startSeconds)}–${formatSeconds(c.endSeconds)}, similarity: ${((c.similarity || 0) * 100).toFixed(0)}%)\n${(c.analysisPreview || '').slice(0, 300)}`;
      }).join('\n\n');
  }

  // Build conversation history
  const historyParts = (conversationHistory || []).slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const systemText = `You are Hunter's editorial intelligence — a perceptive documentary editor's assistant who has deep familiarity with the filmmaker's footage archive.

When you reference footage, always cite the clip name and timecode. Be specific, editorial, and insightful. Write as a creative collaborator, not a database.

${projectContext || ''}${clipsContext}`;

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = [
    ...historyParts,
    { role: 'user', parts: [{ text: message }] },
  ];

  const geminiPayload = {
    contents,
    systemInstruction: { parts: [{ text: systemText }] },
    generationConfig: { maxOutputTokens: 2000 },
  };

  // Retry with backoff for 429/503
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    });
    if (res.ok || (res.status !== 429 && res.status !== 503)) break;
    if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
  }

  if (!res.ok) {
    const errBody = await res.text();
    const isQuota = errBody.includes('RESOURCE_EXHAUSTED') || errBody.includes('429');
    const errMsg = isQuota ? 'Gemini API quota exhausted — wait a few minutes and try again' : 'Chat failed';
    return jsonResponse({ error: errMsg, detail: errBody.slice(0, 500) }, isQuota ? 429 : 502);
  }

  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';

  // Extract cited clips from the response
  const citedClips = (relevantClips || []).filter(c =>
    reply.includes(c.clipName) || reply.includes(c.clipName?.replace(/_Proxy\.MP4$/i, ''))
  );

  return jsonResponse({ reply, citedClips });
}

// ── Tier Comparison ──

async function handleTierComparison(body, apiKey) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return jsonResponse({ error: 'Supabase not configured' }, 500);
  }

  const { projectId } = body;
  if (!projectId) return jsonResponse({ error: 'projectId is required' }, 400);

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  // Fetch analyses per tier
  const tiers = ['raw', 'selects', 'finished'];
  const tierData = {};

  for (const tier of tiers) {
    const url = `${supabaseUrl}/rest/v1/analyses?select=output_text,corpus_units!inner(media_asset_id,media_assets!inner(tier,project_id))&corpus_units.media_assets.project_id=eq.${projectId}&corpus_units.media_assets.tier=eq.${tier}&limit=50`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      tierData[tier] = data.map(a => (a.output_text || '').slice(0, 300));
    } else {
      tierData[tier] = [];
    }
  }

  const totalAnalyses = Object.values(tierData).reduce((s, arr) => s + arr.length, 0);
  if (totalAnalyses === 0) {
    return jsonResponse({ error: 'No analyses found across tiers. Ingest footage first.' }, 404);
  }

  // Build corpus for comparison
  const corpus = tiers.map(tier => {
    if (!tierData[tier].length) return `[${tier.toUpperCase()}]: No footage in this tier.`;
    const sampled = tierData[tier].slice(0, 30);
    return `[${tier.toUpperCase()}] (${tierData[tier].length} clips sampled):\n${sampled.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}`;
  }).join('\n\n---\n\n');

  const prompt = `You are a perceptive documentary editor comparing the editorial evolution from raw footage → selects → finished cut.

Analyze these three tiers of a filmmaker's project and return JSON with:
- raw_character: string (2-3 sentences describing the raw footage's character — what the camera was drawn to, instinctive patterns)
- selects_philosophy: string (2-3 sentences on what the editor chose to keep and why — what survived the first filter)
- finished_focus: string (2-3 sentences on the finished cut's thesis — what story emerged from the material)
- editorial_drift: string (2-3 sentences on what changed from raw → finished — what was gained, what was lost, what surprised you)
- hidden_gems: string[] (3-5 specific clips from raw/selects that didn't make the cut but deserve another look, with reasons)
- recommendations: string[] (2-4 editorial recommendations based on the comparison)

CORPUS:
${corpus}`;

  const model = 'gemini-2.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4000, responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) {
    return jsonResponse({ error: 'Tier comparison failed', detail: (await res.text()).slice(0, 500) }, 502);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let comparison = {};
  try { comparison = JSON.parse(text); } catch {
    comparison = { raw_character: text, selects_philosophy: '', finished_focus: '', editorial_drift: '', hidden_gems: [], recommendations: [] };
  }

  return jsonResponse({ comparison, tierCounts: { raw: tierData.raw.length, selects: tierData.selects.length, finished: tierData.finished.length } });
}

// ── Narrative Insights (Master Arc + Scene Breakdowns) ──

async function handleNarrativeInsights(body, apiKey) {
  const { scenes, projectName } = body;
  if (!scenes?.length) return jsonResponse({ error: 'scenes array is required' }, 400);

  // Build a rich chronological scene corpus
  // Each scene has: day, time, clips with analysis text, emotional register, shot type
  const sceneSummaries = scenes.slice(0, 30).map((scene, i) => {
    const clipDetails = (scene.clips || []).slice(0, 10).map(c => {
      const text = (c.analysisText || '').slice(0, 250);
      return `    - ${c.clipName || 'clip'} (${c.startSeconds || 0}s–${c.endSeconds || 0}s): ${text}`;
    }).join('\n');

    return `SCENE ${i + 1}: Day ${scene.day || '?'}, ${scene.time || '?'} — "${scene.label || 'Untitled'}"
  ${scene.clipCount || 0} clips, ${scene.durationStr || '?'} total
  Dominant emotion: ${scene.topEmotion || 'unknown'} | Shot type: ${scene.topShot || 'mixed'} | Keep: ${scene.avgKeep != null ? scene.avgKeep.toFixed(1) : '?'}/10
  Cameras: ${scene.cameras || '?'}
${clipDetails}`;
  });

  const prompt = `You are Hunter — a brilliant documentary editor's AI assistant who can read footage at a glance. You've watched every clip. Now synthesize what you've seen.

PROJECT: "${projectName || 'Untitled'}"
${sceneSummaries.length} scenes detected chronologically from filenames (date + time of day).

${sceneSummaries.join('\n\n---\n\n')}

Now produce a comprehensive editorial intelligence report. Return JSON with these fields:

1. "master_narrative" — object with:
   - "title": string — A bold, evocative headline for this project's story (not the project name, the STORY you see)
   - "lede": string — One provocative, insight-laden sentence that captures the whole thing (28-32px pull-quote energy)
   - "arc": string — 3-5 paragraphs describing the complete arc of the trip/shoot. Tell it chronologically. What happened on day 1 vs day 5 vs the last day? What shifted? What obsession emerged? What got abandoned? Write like a filmmaker's trusted editorial advisor, not a database.
   - "themes": array of { "name": string, "count": number, "description": string } — 3-6 thematic threads running through the footage. Not shot types — NARRATIVE threads. "Hospitality as time", "Hands as protagonists", "Thresholds between worlds", etc.

2. "scene_breakdowns" — array of objects (one per scene), each with:
   - "scene_index": number (0-based)
   - "title": string — A cinematic scene title (not the filename)
   - "time_of_day": string — "dawn", "morning", "midday", "afternoon", "golden hour", "evening", "night" (infer from the timestamp)
   - "narrative_description": string — 2-3 sentences: what happens in this scene, what makes it editorially interesting, how it connects to the larger story
   - "editorial_verdict": "ESSENTIAL" | "STRONG" | "USEFUL" | "CUT" — honest editorial assessment
   - "connections": string — How this scene connects to other scenes (reference by scene number)
   - "key_clip": string — The single most important clip name in this scene and why

Be specific. Cite clip names. Surprise the filmmaker. Be opinionated. If the footage is mediocre, say so. If something is extraordinary, champion it.`;

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 12000, responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) {
    return jsonResponse({ error: 'Narrative insights failed', detail: (await res.text()).slice(0, 500) }, 502);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let result = {};
  try { result = JSON.parse(text); } catch {
    result = { master_narrative: { title: 'Analysis', lede: '', arc: text, themes: [] }, scene_breakdowns: [] };
  }

  return jsonResponse(result);
}

// ── Corpus Context (pre-computed, DB reads only) ──

async function handleGetCorpusContext(body) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return jsonResponse({ error: 'Supabase not configured' }, 500);
  }

  const { projectId } = body;
  if (!projectId) return jsonResponse({ error: 'projectId is required' }, 400);

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  // Fetch project-level arc summary
  const arcUrl = `${supabaseUrl}/rest/v1/arc_summaries?project_id=eq.${projectId}&level=eq.project&limit=1`;
  const arcRes = await fetch(arcUrl, { headers });
  let masterNarrative = null;
  if (arcRes.ok) {
    const arcs = await arcRes.json();
    if (arcs?.[0]) {
      try { masterNarrative = JSON.parse(arcs[0].summary_text); } catch {
        masterNarrative = { raw: arcs[0].summary_text };
      }
    }
  }

  // Fetch day summaries
  const dayUrl = `${supabaseUrl}/rest/v1/arc_summaries?project_id=eq.${projectId}&level=eq.day&order=scope_ref.asc`;
  const dayRes = await fetch(dayUrl, { headers });
  let daySummaries = [];
  if (dayRes.ok) {
    const days = await dayRes.json();
    daySummaries = (days || []).map(d => {
      let parsed = {};
      try { parsed = JSON.parse(d.summary_text); } catch {}
      return { dayLabel: d.scope_ref, ...parsed };
    });
  }

  // Fetch scenes with arc summaries
  const scenesUrl = `${supabaseUrl}/rest/v1/scenes?project_id=eq.${projectId}&order=chronological_order.asc&select=id,name,scene_type,shoot_day,location,time_of_day,chronological_order,arc_summary,emotional_curve,editorial_notes,clip_count,total_duration_seconds,status`;
  const scenesRes = await fetch(scenesUrl, { headers });
  let scenes = [];
  if (scenesRes.ok) {
    scenes = await scenesRes.json() || [];
  }

  return jsonResponse({
    hasData: !!masterNarrative,
    masterNarrative,
    daySummaries,
    scenes,
  });
}

// ── Script Copilot Handlers ──

async function handleRunScriptPass(body, apiKey) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return jsonResponse({ error: 'Supabase not configured' }, 500);

  const { snapshotId, passType, projectId } = body;
  if (!snapshotId || !passType) return jsonResponse({ error: 'snapshotId and passType required' }, 400);

  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  // Fetch the snapshot
  const snapUrl = `${supabaseUrl}/rest/v1/script_snapshots?id=eq.${snapshotId}&select=*&limit=1`;
  const snapRes = await fetch(snapUrl, { headers });
  if (!snapRes.ok) return jsonResponse({ error: 'Snapshot not found' }, 404);
  const snapshots = await snapRes.json();
  if (!snapshots?.length) return jsonResponse({ error: 'Snapshot not found' }, 404);
  const snapshot = snapshots[0];

  // Fetch script context from project
  let scriptContext = '';
  if (projectId) {
    const projUrl = `${supabaseUrl}/rest/v1/hunter_projects?id=eq.${projectId}&select=metadata&limit=1`;
    const projRes = await fetch(projUrl, { headers });
    if (projRes.ok) {
      const projects = await projRes.json();
      scriptContext = projects?.[0]?.metadata?.script_context || '';
    }
  }

  // Build annotated text from parsed_doc for the LLM prompt
  const parsedDoc = snapshot.parsed_doc;
  const elements = parsedDoc?.elements || [];
  const annotatedText = elements.map(el => {
    if (el.type === 'heading') return `\n## ${el.text}\n`;
    if (el.type === 'beat') {
      let out = '---BEAT---\n';
      if (el.voice?.text) out += `VOICE: ${el.voice.text}\n`;
      if (el.visual?.text) out += `VISUAL: ${el.visual.text}\n`;
      return out;
    }
    if (el.type === 'paragraph') return el.text;
    return '';
  }).join('\n');

  // Build the pass-specific prompt
  const passPrompts = {
    animation_audit: buildAnimationAuditPrompt(annotatedText, scriptContext, snapshot.color_profile),
    archive_audit: buildArchiveAuditPrompt(annotatedText, scriptContext, snapshot.color_profile),
    fact_check: buildFactCheckPrompt(annotatedText, scriptContext),
    pacing_analysis: buildPacingPrompt(annotatedText, snapshot),
    coherence_check: buildCoherencePrompt(annotatedText, scriptContext),
  };

  const prompt = passPrompts[passType];
  if (!prompt) return jsonResponse({ error: `Unknown pass type: ${passType}` }, 400);

  // Call Gemini
  const model = 'gemini-2.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const geminiRes = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8000, responseMimeType: 'application/json' },
    }),
  });

  if (!geminiRes.ok) {
    return jsonResponse({ error: 'Gemini analysis failed', detail: (await geminiRes.text()).slice(0, 500) }, 502);
  }

  const geminiData = await geminiRes.json();
  const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let outputJson = {};
  try { outputJson = JSON.parse(responseText); }
  catch { outputJson = { raw_text: responseText, parse_error: true }; }

  // Save the pass result
  const saveRes = await fetch(`${supabaseUrl}/rest/v1/script_passes`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      snapshot_id: snapshotId,
      pass_type: passType,
      output_json: outputJson,
      output_text: responseText,
      model,
    }),
  });

  if (!saveRes.ok) {
    return jsonResponse({ error: 'Failed to save pass result', detail: (await saveRes.text()).slice(0, 200) }, 500);
  }

  const saved = await saveRes.json();
  return jsonResponse({ success: true, pass: saved[0] || saved });
}

function buildAnimationAuditPrompt(text, context, colorProfile) {
  const ctx = context ? `SCRIPT CONTEXT:\n${context}\n\n` : '';
  const colors = colorProfile ? `COLOR PROFILE:\n${JSON.stringify(colorProfile)}\n\n` : '';
  return `${ctx}${colors}Audit this documentary script for ANIMATION REQUIREMENTS. Identify every element requiring animation/motion graphics.

SCRIPT:
${text}

Return JSON: { "animation_items": [{ "beat_context", "description", "source_text", "complexity": "simple|moderate|complex|hero", "estimated_hours", "style_notes", "priority": "essential|important|nice-to-have" }], "summary": { "total_items", "total_estimated_hours", "complexity_breakdown", "style_recommendations" } }`;
}

function buildArchiveAuditPrompt(text, context, colorProfile) {
  const ctx = context ? `SCRIPT CONTEXT:\n${context}\n\n` : '';
  const colors = colorProfile ? `COLOR PROFILE:\n${JSON.stringify(colorProfile)}\n\n` : '';
  return `${ctx}${colors}Audit this documentary script for ARCHIVE/STOCK FOOTAGE requirements.

SCRIPT:
${text}

Return JSON: { "archive_items": [{ "beat_context", "description", "source_text", "type": "archive|stock|historical|news|photo", "search_terms": [], "source_suggestions": [], "rights_notes", "priority" }], "summary": { "total_items", "type_breakdown", "major_research_tasks": [] } }`;
}

function buildFactCheckPrompt(text, context) {
  const ctx = context ? `SCRIPT CONTEXT:\n${context}\n\n` : '';
  return `${ctx}Fact-check this documentary script. Identify every factual claim.

SCRIPT:
${text}

Return JSON: { "claims": [{ "claim_text", "category": "date|statistic|historical|scientific|geographic|biographical", "status": "verified|likely_correct|needs_verification|likely_incorrect", "verification_notes", "correction" }], "summary": { "total_claims", "verified", "needs_verification", "flagged", "high_priority_checks": [] } }`;
}

function buildPacingPrompt(text, snapshot) {
  return `Analyze PACING of this documentary script. Voice narration ~150 wpm, typical visual beat 5-10s.

Stats: ${snapshot.beat_count || '?'} beats, ${snapshot.word_count || '?'} words.

SCRIPT:
${text}

Return JSON: { "sections": [{ "title", "beat_count", "voice_word_count", "estimated_duration_seconds", "voice_density": "voice-heavy|balanced|visual-heavy", "pacing_notes" }], "overall": { "total_beats", "estimated_total_minutes", "pacing_curve", "bloat_warnings": [], "thin_spots": [], "recommended_cuts": [] } }`;
}

function buildCoherencePrompt(text, context) {
  const ctx = context ? `SCRIPT CONTEXT:\n${context}\n\n` : '';
  return `${ctx}Check VOICE/VISUAL COHERENCE for each beat in this documentary script.

SCRIPT:
${text}

Return JSON: { "beats": [{ "beat_index", "voice_summary", "visual_summary", "relationship": "illustration|counterpoint|complementary|disconnected|missing_pair", "coherence_score": 0.0-1.0 }], "summary": { "total_beats", "coherent_beats", "disconnected_beats", "strongest_pairings": [], "weakest_pairings": [], "overall_assessment" } }`;
}

async function handleGetScriptPasses(body) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return jsonResponse({ error: 'Supabase not configured' }, 500);

  const { snapshotId, passType } = body;
  if (!snapshotId) return jsonResponse({ error: 'snapshotId required' }, 400);

  let url = `${supabaseUrl}/rest/v1/script_passes?snapshot_id=eq.${snapshotId}&order=created_at.desc`;
  if (passType) url += `&pass_type=eq.${passType}`;

  const res = await fetch(url, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });

  if (!res.ok) return jsonResponse({ error: 'Failed to fetch passes' }, 500);
  const passes = await res.json();
  return jsonResponse({ passes });
}

async function handleGetScriptSnapshot(body) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return jsonResponse({ error: 'Supabase not configured' }, 500);

  const { mediaAssetId, snapshotId } = body;
  if (!mediaAssetId && !snapshotId) return jsonResponse({ error: 'mediaAssetId or snapshotId required' }, 400);

  let url;
  if (snapshotId) {
    url = `${supabaseUrl}/rest/v1/script_snapshots?id=eq.${snapshotId}&limit=1`;
  } else {
    url = `${supabaseUrl}/rest/v1/script_snapshots?media_asset_id=eq.${mediaAssetId}&order=version_number.desc&limit=1`;
  }

  const res = await fetch(url, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });

  if (!res.ok) return jsonResponse({ error: 'Failed to fetch snapshot' }, 500);
  const snapshots = await res.json();
  if (!snapshots?.length) return jsonResponse({ error: 'No snapshot found' }, 404);
  return jsonResponse({ snapshot: snapshots[0] });
}

async function handleScriptCopilotChat(body, apiKey) {
  const { message, conversationHistory, snapshotId, projectId } = body;
  if (!message) return jsonResponse({ error: 'message is required' }, 400);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  // Fetch script context + snapshot
  let scriptContext = '';
  let snapshotContext = '';

  if (projectId) {
    const projUrl = `${supabaseUrl}/rest/v1/hunter_projects?id=eq.${projectId}&select=metadata&limit=1`;
    const projRes = await fetch(projUrl, { headers });
    if (projRes.ok) {
      const projects = await projRes.json();
      scriptContext = projects?.[0]?.metadata?.script_context || '';
    }
  }

  if (snapshotId) {
    const snapUrl = `${supabaseUrl}/rest/v1/script_snapshots?id=eq.${snapshotId}&select=parsed_doc,color_profile,beat_count,word_count&limit=1`;
    const snapRes = await fetch(snapUrl, { headers });
    if (snapRes.ok) {
      const snaps = await snapRes.json();
      if (snaps?.[0]) {
        const doc = snaps[0].parsed_doc;
        const title = doc?.title || 'Untitled';
        const beatCount = snaps[0].beat_count || 0;
        const wordCount = snaps[0].word_count || 0;
        snapshotContext = `\nCURRENT SCRIPT: "${title}" (${beatCount} beats, ${wordCount} words)\n`;
      }
    }
  }

  const historyParts = (conversationHistory || []).slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const systemText = `You are Hunter's Script Copilot — an intelligent editorial assistant with deep understanding of documentary scripts.

You understand two-column script format (voice + visual), color coding (highlight colors carry editorial meaning), and how scripts translate to finished films.

${scriptContext ? `SCRIPT TRAINING CONTEXT:\n${scriptContext}\n` : ''}${snapshotContext}

When discussing the script, reference specific beats, sections, and formatting. Be editorial and specific. Help the filmmaker think through their script like a trusted collaborator.`;

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = [...historyParts, { role: 'user', parts: [{ text: message }] }];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: systemText }] },
      generationConfig: { maxOutputTokens: 2000 },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    return jsonResponse({ error: 'Script chat failed', detail: errBody.slice(0, 500) }, 502);
  }

  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
  return jsonResponse({ reply });
}

// ── Global Script Training (projectless) ──

async function handleFetchParseDoc(body) {
  const { docUrl } = body;
  if (!docUrl) return jsonResponse({ error: 'docUrl is required' }, 400);

  // Extract doc ID
  let docId;
  if (docUrl.includes('/document/d/')) {
    const match = docUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) return jsonResponse({ error: 'Cannot extract doc ID from URL' }, 400);
    docId = match[1];
  } else if (docUrl.match(/^[a-zA-Z0-9_-]{20,}$/)) {
    docId = docUrl; // bare doc ID
  } else {
    return jsonResponse({ error: 'Invalid Google Doc URL or ID' }, 400);
  }

  // Get Google access token
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return jsonResponse({ error: 'Google OAuth not configured' }, 500);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    return jsonResponse({ error: 'Google token refresh failed' }, 502);
  }

  const { access_token } = await tokenRes.json();

  // Fetch the doc (all tabs)
  const docsRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}?includeTabsContent=true`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  if (!docsRes.ok) {
    const errText = await docsRes.text();
    return jsonResponse({ error: `Docs API error ${docsRes.status}`, detail: errText.slice(0, 200) }, 502);
  }

  const doc = await docsRes.json();
  const tabs = doc.tabs || [];

  // Parse tab 0 only (the script tab)
  const tab0 = tabs[0];
  if (!tab0) {
    return jsonResponse({ error: 'No tabs found in document' }, 400);
  }

  const tabBody = tab0.documentTab?.body?.content || [];
  const title = doc.title || docId;

  // Parse elements
  const elements = [];
  let totalBeats = 0;
  let wordCount = 0;
  let coloredRunCount = 0;
  const colorCounts = {};

  for (const el of tabBody) {
    if (el.paragraph) {
      const para = el.paragraph;
      const runs = [];
      let text = '';

      for (const pe of para.elements || []) {
        if (pe.textRun) {
          const t = pe.textRun.content || '';
          text += t;
          const bg = pe.textRun.textStyle?.backgroundColor?.color?.rgbColor;
          if (bg) {
            const r = Math.round((bg.red || 0) * 255);
            const g = Math.round((bg.green || 0) * 255);
            const b = Math.round((bg.blue || 0) * 255);
            const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
            colorCounts[hex] = (colorCounts[hex] || 0) + 1;
            coloredRunCount++;
            runs.push({ text: t.trim().slice(0, 80), highlight: hex, bold: !!pe.textRun.textStyle?.bold });
          } else if (pe.textRun.textStyle?.bold && t.trim()) {
            runs.push({ text: t.trim().slice(0, 80), bold: true });
          }
        }
      }

      if (text.trim()) {
        wordCount += text.trim().split(/\s+/).length;
        const namedStyle = para.paragraphStyle?.namedStyleType || '';
        if (namedStyle.match(/HEADING_/)) {
          elements.push({ type: 'heading', text: text.trim() });
        }
      }
    } else if (el.table) {
      const rows = el.table.tableRows || [];
      for (const row of rows) {
        const cells = row.tableCells || [];
        if (cells.length < 2) continue;

        // Extract cell text + colors
        const cellData = cells.map(cell => {
          let text = '';
          const runs = [];
          for (const ce of cell.content || []) {
            for (const pe of ce.paragraph?.elements || []) {
              if (pe.textRun) {
                const t = pe.textRun.content || '';
                text += t;
                const bg = pe.textRun.textStyle?.backgroundColor?.color?.rgbColor;
                if (bg) {
                  const r = Math.round((bg.red || 0) * 255);
                  const g = Math.round((bg.green || 0) * 255);
                  const b = Math.round((bg.blue || 0) * 255);
                  const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
                  colorCounts[hex] = (colorCounts[hex] || 0) + 1;
                  coloredRunCount++;
                  runs.push({ text: t.trim().slice(0, 80), highlight: hex });
                }
              }
            }
          }
          return { text: text.trim(), runs };
        });

        // Skip empty rows and likely header rows
        const hasContent = cellData.some(c => c.text.length > 5);
        if (!hasContent) continue;

        // Find the two columns with most content
        const sorted = cellData.map((c, i) => ({ ...c, idx: i })).sort((a, b) => b.text.length - a.text.length);
        const voice = sorted[0] || { text: '', runs: [] };
        const visual = sorted[1] || { text: '', runs: [] };

        totalBeats++;
        wordCount += voice.text.split(/\s+/).length + visual.text.split(/\s+/).length;
      }
    }
  }

  // Build color profile
  const colorProfile = {};
  for (const [hex, count] of Object.entries(colorCounts).sort((a, b) => b[1] - a[1])) {
    colorProfile[hex] = { count };
  }

  // Build sample beats for training (first 20 table rows with colored content)
  const sampleBeats = [];
  for (const el of tabBody) {
    if (sampleBeats.length >= 20) break;
    if (!el.table) continue;
    for (const row of el.table.tableRows || []) {
      if (sampleBeats.length >= 20) break;
      const cells = row.tableCells || [];
      if (cells.length < 2) continue;

      const cellTexts = cells.map(cell => {
        const runs = [];
        let text = '';
        for (const ce of cell.content || []) {
          for (const pe of ce.paragraph?.elements || []) {
            if (pe.textRun) {
              const t = pe.textRun.content || '';
              text += t;
              const bg = pe.textRun.textStyle?.backgroundColor?.color?.rgbColor;
              if (bg) {
                const r = Math.round((bg.red || 0) * 255);
                const g = Math.round((bg.green || 0) * 255);
                const b = Math.round((bg.blue || 0) * 255);
                const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
                runs.push(`[${hex}: ${t.trim().slice(0, 60)}]`);
              } else if (pe.textRun.textStyle?.bold && t.trim()) {
                runs.push(`[BOLD: ${t.trim().slice(0, 60)}]`);
              } else if (t.trim()) {
                runs.push(t.trim().slice(0, 60));
              }
            }
          }
        }
        return { text: text.trim(), annotated: runs.join(' ') };
      });

      if (cellTexts.some(c => c.text.length > 5)) {
        const sorted = cellTexts.sort((a, b) => b.text.length - a.text.length);
        sampleBeats.push({ voice: sorted[0]?.annotated || '', visual: sorted[1]?.annotated || '' });
      }
    }
  }

  return jsonResponse({
    docId,
    title,
    stats: { totalBeats, wordCount, coloredRunCount },
    colorProfile,
    headings: elements.filter(e => e.type === 'heading').map(e => e.text),
    sampleBeats,
  });
}

async function handleRunGlobalTraining(body, apiKey) {
  const { docs } = body;
  if (!docs?.length) return jsonResponse({ error: 'docs array is required' }, 400);

  // Build corpus from parsed doc summaries
  const corpus = docs.map((doc, i) => {
    const colorSummary = Object.entries(doc.colorProfile || {})
      .sort((a, b) => b[1].count - a[1].count)
      .map(([hex, data]) => `  ${hex}: ${data.count}x`)
      .join('\n');

    const headings = (doc.headings || []).join(' → ');

    const beats = (doc.sampleBeats || []).map((b, j) =>
      `  Beat ${j + 1}:\n    VOICE: ${b.voice || '(empty)'}\n    VISUAL: ${b.visual || '(empty)'}`
    ).join('\n');

    return `=== SCRIPT ${i + 1}: "${doc.title}" ===
Stats: ${doc.stats?.totalBeats || 0} beats, ${doc.stats?.wordCount || 0} words, ${doc.stats?.coloredRunCount || 0} colored runs
Headings: ${headings || '(none)'}
Colors:
${colorSummary || '  (none)'}
Sample beats:
${beats || '  (none)'}`;
  }).join('\n\n' + '='.repeat(50) + '\n\n');

  // Run Gemini analysis
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{
          text: `You are analyzing ${docs.length} documentary scripts by the SAME FILMMAKER. All formatting has been preserved — highlight colors (as hex values in brackets), bold text, and the two-column voice/visual table structure.

Your job: learn this filmmaker's script conventions, habits, and style. Pay special attention to:
1. INCONSISTENCIES and SLOPPINESS — where do formatting rules break down?
2. INFERRED INTENT — when formatting is messy, what was likely intended?
3. PATTERNS that emerge ACROSS scripts, not just within one.

${corpus}

Return a JSON object:

{
  "color_rules": [
    {
      "color": "#HEX",
      "meaning": "what this color means",
      "confidence": 0.0-1.0,
      "consistency": "always/usually/sometimes/rarely",
      "exceptions": "notable exceptions"
    }
  ],
  "structural_patterns": {
    "typical_act_count": number or null,
    "avg_beats_per_section": number,
    "heading_conventions": "description",
    "beat_structure": "description"
  },
  "sloppiness_patterns": [
    {
      "pattern": "description",
      "frequency": "rare/occasional/common",
      "workaround": "how to handle it"
    }
  ],
  "voice_style": {
    "tone": "description",
    "person": "first/second/third",
    "typical_beat_length": "description",
    "distinctive_habits": "description"
  },
  "visual_direction_style": {
    "detail_level": "minimal/moderate/detailed",
    "common_shot_types": [],
    "animation_frequency": "description",
    "archive_frequency": "description"
  },
  "script_context": "3-4 DENSE paragraphs briefing a new editor on this filmmaker's script language. Cover color conventions (including inconsistencies), structural habits, voice/visual relationship, and editorial personality. Be specific — cite examples from the scripts. Write as if the reader will use this to correctly interpret any new script by this filmmaker.",
  "style_signature": "One bold sentence capturing this filmmaker's script personality"
}

Return ONLY valid JSON.`
        }],
      }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 10000 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return jsonResponse({ error: 'Gemini training failed', detail: errText.slice(0, 500) }, 502);
  }

  const geminiData = await res.json();
  const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let analysis;
  try {
    analysis = JSON.parse(rawText);
  } catch {
    analysis = { script_context: rawText, color_rules: [], sloppiness_patterns: [] };
  }

  // Store in Supabase
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    const docTitles = docs.map(d => ({ docId: d.docId, title: d.title, beats: d.stats?.totalBeats, words: d.stats?.wordCount }));

    await fetch(`${supabaseUrl}/rest/v1/script_training`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        doc_count: docs.length,
        doc_titles: docTitles,
        color_rules: analysis.color_rules || [],
        sloppiness_patterns: analysis.sloppiness_patterns || [],
        structural_patterns: analysis.structural_patterns || null,
        voice_style: analysis.voice_style || null,
        visual_direction_style: analysis.visual_direction_style || null,
        script_context: analysis.script_context || '',
        style_signature: analysis.style_signature || '',
        model,
      }),
    });
  }

  return jsonResponse({ analysis });
}

async function handleGetGlobalTraining() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return jsonResponse({ error: 'Supabase not configured' }, 500);
  }

  const res = await fetch(
    `${supabaseUrl}/rest/v1/script_training?order=created_at.desc&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );

  if (!res.ok) {
    return jsonResponse({ error: 'Failed to fetch training' }, 502);
  }

  const data = await res.json();
  return jsonResponse({ training: data?.[0] || null });
}

// ── Editorial Taste Profile Handlers ──

async function handlePersistEditorialDecisions(body) {
  const { projectId } = body;
  if (!projectId) return jsonResponse({ error: 'projectId is required' }, 400);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return jsonResponse({ error: 'Supabase not configured' }, 500);

  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  // Fetch raw and selects assets for this project
  const assetsRes = await fetch(
    `${supabaseUrl}/rest/v1/media_assets?project_id=eq.${projectId}&tier=in.(raw,selects)&select=id,tier`,
    { headers }
  );
  const assets = await assetsRes.json();
  const rawAssetIds = assets.filter(a => a.tier === 'raw').map(a => a.id);
  const selectsAssetIds = assets.filter(a => a.tier === 'selects').map(a => a.id);

  if (!rawAssetIds.length || !selectsAssetIds.length) {
    return jsonResponse({ error: 'Need both raw and selects tiers', kept: 0, discarded: 0 });
  }

  // Fetch raw units
  let rawUnits = [];
  for (const id of rawAssetIds) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/corpus_units?media_asset_id=eq.${id}&select=id,source_clip_name&order=created_at.asc`,
      { headers }
    );
    rawUnits = rawUnits.concat(await res.json());
  }

  // Fetch selects units
  let selectsUnits = [];
  for (const id of selectsAssetIds) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/corpus_units?media_asset_id=eq.${id}&select=id,source_clip_name&order=created_at.asc`,
      { headers }
    );
    selectsUnits = selectsUnits.concat(await res.json());
  }

  // Cross-reference
  const selectsClipNames = new Set();
  for (const u of selectsUnits) {
    selectsClipNames.add(u.source_clip_name);
    selectsClipNames.add(u.source_clip_name.replace(/\.[^.]+$/, ''));
  }

  const kept = [];
  const discarded = [];
  for (const raw of rawUnits) {
    const name = raw.source_clip_name;
    const nameNoProxy = name.replace(/_Proxy/i, '');
    const nameNoExt = nameNoProxy.replace(/\.[^.]+$/, '');
    if (selectsClipNames.has(nameNoProxy) || selectsClipNames.has(nameNoExt)) {
      kept.push(raw);
    } else {
      discarded.push(raw);
    }
  }

  // Usage count
  const usageCount = {};
  for (const u of selectsUnits) {
    usageCount[u.source_clip_name] = (usageCount[u.source_clip_name] || 0) + 1;
  }

  // Fetch analyses for structured fields
  const allUnitIds = rawUnits.map(u => u.id);
  const analysisMap = {};
  for (let i = 0; i < allUnitIds.length; i += 200) {
    const batch = allUnitIds.slice(i, i + 200);
    const res = await fetch(
      `${supabaseUrl}/rest/v1/analyses?corpus_unit_id=in.(${batch.join(',')})&select=corpus_unit_id,output_json`,
      { headers }
    );
    const data = await res.json();
    for (const a of data) analysisMap[a.corpus_unit_id] = a;
  }

  // Build rows
  const rows = [];
  for (const unit of kept) {
    const json = analysisMap[unit.id]?.output_json;
    rows.push({
      project_id: projectId, corpus_unit_id: unit.id, kept: true,
      usage_count: usageCount[unit.source_clip_name] || usageCount[unit.source_clip_name?.replace(/\.[^.]+$/, '')] || 1,
      shot_type: json?.shot_type || null, camera_movement: json?.camera_movement || null,
      lighting: json?.lighting || null, audio_quality: json?.audio_quality || null,
      emotional_register: json?.emotional_register || null, editorial_function: json?.editorial_function || null,
      keepability_score: json?.keepability_score ?? null, keepability_reason: json?.keepability_reason || null,
      source_clip_name: unit.source_clip_name,
    });
  }
  for (const unit of discarded) {
    const json = analysisMap[unit.id]?.output_json;
    rows.push({
      project_id: projectId, corpus_unit_id: unit.id, kept: false, usage_count: 0,
      shot_type: json?.shot_type || null, camera_movement: json?.camera_movement || null,
      lighting: json?.lighting || null, audio_quality: json?.audio_quality || null,
      emotional_register: json?.emotional_register || null, editorial_function: json?.editorial_function || null,
      keepability_score: json?.keepability_score ?? null, keepability_reason: json?.keepability_reason || null,
      source_clip_name: unit.source_clip_name,
    });
  }

  // Upsert in batches
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    await fetch(`${supabaseUrl}/rest/v1/editorial_decisions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(batch),
    });
  }

  return jsonResponse({ kept: kept.length, discarded: discarded.length, total: rawUnits.length });
}

async function handleRunTasteTraining(apiKey) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return jsonResponse({ error: 'Supabase not configured' }, 500);

  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  // Fetch all editorial decisions
  const decRes = await fetch(
    `${supabaseUrl}/rest/v1/editorial_decisions?select=*&order=created_at.asc`,
    { headers }
  );
  const decisions = await decRes.json();

  if (!decisions?.length) {
    return jsonResponse({ error: 'No editorial decisions found. Persist decisions for at least one project first.' }, 400);
  }

  const projectIds = [...new Set(decisions.map(d => d.project_id))];

  // Aggregate stats
  const shotStats = {};
  const emotionStats = {};
  const functionStats = {};
  const mismatches = [];

  for (const d of decisions) {
    if (d.shot_type) {
      if (!shotStats[d.shot_type]) shotStats[d.shot_type] = { kept: 0, total: 0 };
      shotStats[d.shot_type].total++;
      if (d.kept) shotStats[d.shot_type].kept++;
    }
    if (d.emotional_register) {
      if (!emotionStats[d.emotional_register]) emotionStats[d.emotional_register] = { kept: 0, total: 0 };
      emotionStats[d.emotional_register].total++;
      if (d.kept) emotionStats[d.emotional_register].kept++;
    }
    if (d.editorial_function) {
      if (!functionStats[d.editorial_function]) functionStats[d.editorial_function] = { kept: 0, total: 0 };
      functionStats[d.editorial_function].total++;
      if (d.kept) functionStats[d.editorial_function].kept++;
    }
    if (d.keepability_score != null) {
      if (d.keepability_score > 0.7 && !d.kept) mismatches.push({ type: 'high_score_discarded', d });
      else if (d.keepability_score < 0.4 && d.kept) mismatches.push({ type: 'low_score_kept', d });
    }
  }

  const keptScores = decisions.filter(d => d.kept && d.keepability_score != null).map(d => d.keepability_score);
  const discardedScores = decisions.filter(d => !d.kept && d.keepability_score != null).map(d => d.keepability_score);
  const avgKeptScore = keptScores.length > 0 ? keptScores.reduce((a, b) => a + b, 0) / keptScores.length : null;
  const avgDiscardedScore = discardedScores.length > 0 ? discardedScores.reduce((a, b) => a + b, 0) / discardedScores.length : null;
  const highScoreClips = decisions.filter(d => d.keepability_score != null && d.keepability_score > 0.7);
  const correlation = highScoreClips.length > 0 ? highScoreClips.filter(d => d.kept).length / highScoreClips.length : null;
  const overallKeptRate = decisions.filter(d => d.kept).length / decisions.length;

  // Format for Gemini prompt
  const shotSummary = Object.entries(shotStats)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([type, s]) => `  ${type}: ${s.kept}/${s.total} kept (${Math.round(s.kept / s.total * 100)}%)`)
    .join('\n');
  const emotionSummary = Object.entries(emotionStats)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([reg, s]) => `  ${reg}: ${s.kept}/${s.total} kept (${Math.round(s.kept / s.total * 100)}%)`)
    .join('\n');
  const functionSummary = Object.entries(functionStats)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([fn, s]) => `  ${fn}: ${s.kept}/${s.total} kept (${Math.round(s.kept / s.total * 100)}%)`)
    .join('\n');
  const mismatchExamples = mismatches.slice(0, 30).map(m => {
    const d = m.d;
    return `[${m.type}] "${d.source_clip_name}" — score: ${d.keepability_score}, kept: ${d.kept}\n  shot: ${d.shot_type}, emotion: ${d.emotional_register}, function: ${d.editorial_function}\n  reason: ${d.keepability_reason || '(none)'}`;
  }).join('\n\n');

  const prompt = `You are analyzing the editorial decisions of a documentary filmmaker across ${projectIds.length} project(s) and ${decisions.length} clips. Your job: extract rules specific enough to calibrate future keepability scoring for THIS editor's taste.

=== OVERALL STATS ===
Keep rate: ${(overallKeptRate * 100).toFixed(1)}%

=== KEEPABILITY SCORE CALIBRATION ===
Avg keepability score for KEPT clips: ${avgKeptScore?.toFixed(3) ?? 'N/A'}
Avg keepability score for DISCARDED clips: ${avgDiscardedScore?.toFixed(3) ?? 'N/A'}
High-score (>0.7) clips that were actually kept: ${correlation != null ? (correlation * 100).toFixed(0) + '%' : 'N/A'}

=== SHOT TYPE PREFERENCES ===
${shotSummary || '(no data)'}

=== EMOTIONAL REGISTER PREFERENCES ===
${emotionSummary || '(no data)'}

=== EDITORIAL FUNCTION PREFERENCES ===
${functionSummary || '(no data)'}

=== MISMATCHES ===
${mismatchExamples || '(none)'}

Return a JSON object:

{
  "editorial_rules": [
    { "rule": "description of a specific editorial preference", "confidence": 0.0-1.0, "evidence_count": number }
  ],
  "negative_patterns": [
    { "pattern": "what this editor consistently discards", "keep_rate": 0.0-1.0, "sample_count": number }
  ],
  "mismatch_insights": [
    { "type": "high_score_discarded|low_score_kept", "description": "what the AI scoring missed about this editor's taste", "count": number }
  ],
  "taste_context": "3-4 DENSE paragraphs briefing a future AI on this editor's footage taste. Cover shot types, emotional registers, where generic keepability scores fail, and calibration rules. Be specific — cite numbers.",
  "taste_signature": "One bold sentence capturing this editor's footage taste personality"
}

Return ONLY valid JSON.`;

  // Run Gemini (try Pro, fallback to Flash)
  let model = 'gemini-2.5-pro';
  let url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 10000 },
    }),
  });

  if (!res.ok) {
    model = 'gemini-2.5-flash';
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 10000 },
      }),
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    return jsonResponse({ error: 'Gemini taste training failed', detail: errText.slice(0, 500) }, 502);
  }

  const geminiData = await res.json();
  const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let analysis;
  try {
    analysis = JSON.parse(rawText);
  } catch {
    analysis = { taste_context: rawText, editorial_rules: [], negative_patterns: [], mismatch_insights: [] };
  }

  // Build shot preferences
  const shotPreferences = {};
  for (const [type, s] of Object.entries(shotStats)) {
    shotPreferences[type] = s.total > 0 ? s.kept / s.total : 0;
  }

  // Store in taste_profile
  const profileRow = {
    project_count: projectIds.length,
    clip_count: decisions.length,
    project_ids: projectIds,
    shot_preferences: shotPreferences,
    keepability_calibration: { avg_kept_score: avgKeptScore, avg_discarded_score: avgDiscardedScore, correlation },
    editorial_rules: analysis.editorial_rules || [],
    negative_patterns: analysis.negative_patterns || [],
    mismatch_insights: analysis.mismatch_insights || [],
    taste_context: analysis.taste_context || '',
    taste_signature: analysis.taste_signature || '',
    model,
  };

  await fetch(`${supabaseUrl}/rest/v1/taste_profile`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(profileRow),
  });

  return jsonResponse({ profile: profileRow });
}

async function handleGetTasteProfile() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return jsonResponse({ error: 'Supabase not configured' }, 500);

  const res = await fetch(
    `${supabaseUrl}/rest/v1/taste_profile?order=created_at.desc&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!res.ok) return jsonResponse({ error: 'Failed to fetch taste profile' }, 502);
  const data = await res.json();
  return jsonResponse({ profile: data?.[0] || null });
}

function formatSeconds(s) {
  if (s == null) return '--:--';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
