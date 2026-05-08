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
