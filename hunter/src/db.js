import { createClient } from '@supabase/supabase-js';

let supabase = null;
let initError = null;

try {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    supabase = createClient(url, key);
  } else {
    initError = 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY';
    console.warn('[hunter-db] ' + initError);
  }
} catch (err) {
  initError = err.message || String(err);
  console.error('[hunter-db] init failed:', initError);
}

function db() {
  if (!supabase) {
    const e = new Error(initError || 'Supabase not configured');
    e.code = 'NO_DB';
    throw e;
  }
  return supabase;
}

export function isConfigured() { return !!supabase; }

function normalizeError(err, context) {
  if (!err) return new Error('Unknown error');
  if (err.code === '23505') {
    const e = new Error(`Already exists: ${err.message || err.details || ''}`);
    e.code = 'CONSTRAINT';
    e.context = context;
    return e;
  }
  if (err.code === 'PGRST116') {
    const e = new Error(context ? `${context}: not found` : 'Not found');
    e.code = 'NOT_FOUND';
    return e;
  }
  const e = new Error(err.message || String(err));
  e.code = err.code;
  return e;
}

// ── Projects ──

export async function createProject({ name, slug, metadata }) {
  const { data, error } = await db().from('hunter_projects')
    .insert({ name, slug: slug || name.toLowerCase().replace(/\s+/g, '-'), metadata: metadata || {} })
    .select().single();
  if (error) throw normalizeError(error, 'createProject');
  return data;
}

export async function listProjects() {
  if (!supabase) return [];
  const { data, error } = await db().from('hunter_projects')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw normalizeError(error, 'listProjects');
  return data;
}

export async function getProject(id) {
  const { data, error } = await db().from('hunter_projects')
    .select('*').eq('id', id).single();
  if (error) throw normalizeError(error, 'getProject');
  return data;
}

export async function deleteProject(id) {
  const { error } = await db().from('hunter_projects').delete().eq('id', id);
  if (error) throw normalizeError(error, 'deleteProject');
}

// ── Media Assets ──

export async function createMediaAsset({ projectId, tier, sourceKind, sourceRef, format, metadata }) {
  const { data, error } = await db().from('media_assets')
    .insert({
      project_id: projectId,
      tier,
      source_kind: sourceKind,
      source_ref: sourceRef,
      format: format || 'mp4',
      metadata: metadata || {},
      queue_status: 'pending',
    })
    .select().single();
  if (error) throw normalizeError(error, 'createMediaAsset');
  return data;
}

export async function listMediaAssets(projectId) {
  if (!supabase) return [];
  const { data, error } = await db().from('media_assets')
    .select('*').eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw normalizeError(error, 'listMediaAssets');
  return data;
}

export async function updateMediaAsset(id, fields) {
  const row = {};
  if (fields.cachePath !== undefined) row.cache_path = fields.cachePath;
  if (fields.durationSeconds !== undefined) row.duration_seconds = fields.durationSeconds;
  if (fields.queueStatus !== undefined) row.queue_status = fields.queueStatus;
  if (fields.metadata !== undefined) row.metadata = fields.metadata;
  row.updated_at = new Date().toISOString();
  const { data, error } = await db().from('media_assets')
    .update(row).eq('id', id).select().single();
  if (error) throw normalizeError(error, 'updateMediaAsset');
  return data;
}

// ── Corpus Units ──

export async function createCorpusUnits(units) {
  const rows = units.map(u => ({
    media_asset_id: u.mediaAssetId,
    start_seconds: u.startSeconds,
    end_seconds: u.endSeconds,
    source_clip_name: u.sourceClipName || null,
    track_label: u.trackLabel || null,
  }));
  const { data, error } = await db().from('corpus_units')
    .insert(rows).select();
  if (error) throw normalizeError(error, 'createCorpusUnits');
  return data;
}

export async function listCorpusUnits(mediaAssetId) {
  if (!supabase) return [];
  const { data, error } = await db().from('corpus_units')
    .select('*, analyses(*)')
    .eq('media_asset_id', mediaAssetId)
    .order('start_seconds', { ascending: true });
  if (error) throw normalizeError(error, 'listCorpusUnits');
  return data;
}

export async function listCorpusUnitsForProject(projectId) {
  if (!supabase) return [];
  const { data, error } = await db().from('corpus_units')
    .select('*, media_assets!inner(project_id), analyses(*)')
    .eq('media_assets.project_id', projectId)
    .order('start_seconds', { ascending: true });
  if (error) throw normalizeError(error, 'listCorpusUnitsForProject');
  return data;
}

// ── Analyses ──

export async function saveAnalysis({ corpusUnitId, model, promptVersion, outputText, outputJson, costUsd }) {
  const { data, error } = await db().from('analyses')
    .insert({
      corpus_unit_id: corpusUnitId,
      model,
      prompt_version: promptVersion,
      output_text: outputText,
      output_json: outputJson || null,
      cost_usd: costUsd || 0,
    })
    .select().single();
  if (error) throw normalizeError(error, 'saveAnalysis');
  return data;
}

// ── Embeddings ──

export async function saveEmbedding({ corpusUnitId, model, embedding }) {
  const { data, error } = await db().from('embeddings')
    .insert({
      corpus_unit_id: corpusUnitId,
      model,
      embedding,
    })
    .select().single();
  if (error) throw normalizeError(error, 'saveEmbedding');
  return data;
}

// ── Subjects ──

export async function createSubject({ name, referenceStills, voiceSamplePath, description }) {
  const { data, error } = await db().from('subjects')
    .insert({
      name,
      reference_stills: referenceStills || [],
      voice_sample_path: voiceSamplePath || null,
      description: description || '',
    })
    .select().single();
  if (error) throw normalizeError(error, 'createSubject');
  return data;
}

export async function listSubjects() {
  if (!supabase) return [];
  const { data, error } = await db().from('subjects')
    .select('*').order('created_at', { ascending: true });
  if (error) throw normalizeError(error, 'listSubjects');
  return data;
}

// ── Pattern Observations ──

export async function savePatternObservation({ projectId, observationText, exampleUnitIds }) {
  const { data, error } = await db().from('pattern_observations')
    .insert({
      project_id: projectId || null,
      observation_text: observationText,
      example_unit_ids: exampleUnitIds || [],
      status: 'surfaced',
    })
    .select().single();
  if (error) throw normalizeError(error, 'savePatternObservation');
  return data;
}

export async function listPatternObservations(projectId) {
  if (!supabase) return [];
  let q = db().from('pattern_observations')
    .select('*')
    .order('created_at', { ascending: false });
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) throw normalizeError(error, 'listPatternObservations');
  return data;
}

export async function updatePatternStatus(id, status, userNotes) {
  const row = { status, updated_at: new Date().toISOString() };
  if (userNotes !== undefined) row.user_notes = userNotes;
  const { data, error } = await db().from('pattern_observations')
    .update(row).eq('id', id).select().single();
  if (error) throw normalizeError(error, 'updatePatternStatus');
  return data;
}

// ── All corpus units (for browser) ──

export async function listAllCorpusUnits(limit = 200) {
  if (!supabase) return [];
  // Paginate if limit > 1000 (Supabase max per request)
  if (limit <= 1000) {
    const { data, error } = await db().from('corpus_units')
      .select('*, media_assets!inner(project_id, tier, hunter_projects!inner(name)), analyses(output_text, output_json)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw normalizeError(error, 'listAllCorpusUnits');
    return data;
  }
  let all = [];
  let offset = 0;
  while (all.length < limit) {
    const batchSize = Math.min(1000, limit - all.length);
    const { data, error } = await db().from('corpus_units')
      .select('*, media_assets!inner(project_id, tier, hunter_projects!inner(name)), analyses(output_text, output_json)')
      .order('created_at', { ascending: false })
      .range(offset, offset + batchSize - 1);
    if (error) throw normalizeError(error, 'listAllCorpusUnits');
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < batchSize) break;
    offset += batchSize;
  }
  return all;
}

// ── Ingest status (for live status bar) ──

export async function getIngestStatus(projectId) {
  if (!supabase) return null;

  // Get media assets for this project to check queue status
  const { data: assets } = await db().from('media_assets')
    .select('id, queue_status, source_ref')
    .eq('project_id', projectId);

  const activeAsset = assets?.find(a => !['done', 'error'].includes(a.queue_status));
  if (!activeAsset && assets?.every(a => a.queue_status === 'done')) {
    return { active: false };
  }

  // Count analyzed corpus units
  const { count: analyzedCount } = await db().from('corpus_units')
    .select('id', { count: 'exact', head: true })
    .eq('media_asset_id', activeAsset?.id || assets?.[0]?.id);

  // Get the 5 most recent analyses
  const { data: recentAnalyses } = await db().from('analyses')
    .select('output_text, created_at, corpus_units!inner(source_clip_name, media_asset_id)')
    .order('created_at', { ascending: false })
    .limit(5);

  // Filter to just this project's analyses
  const projectAssetIds = new Set((assets || []).map(a => a.id));
  const relevant = (recentAnalyses || []).filter(a =>
    projectAssetIds.has(a.corpus_units?.media_asset_id)
  );

  return {
    active: !!activeAsset,
    queueStatus: activeAsset?.queue_status || 'done',
    analyzedCount: analyzedCount || 0,
    recentAnalyses: relevant.map(a => ({
      clipName: a.corpus_units?.source_clip_name || '',
      text: a.output_text,
      createdAt: a.created_at,
    })),
  };
}

// ── Cross-Tier Stats ──

export async function getCrossTierStats(projectId) {
  if (!supabase) return null;

  const { data: assets } = await db().from('media_assets')
    .select('id, tier')
    .eq('project_id', projectId);

  if (!assets?.length) return null;

  const stats = {};
  for (const a of assets) {
    const { count } = await db().from('corpus_units')
      .select('id', { count: 'exact', head: true })
      .eq('media_asset_id', a.id);
    stats[a.tier] = { unitCount: count || 0 };
  }

  return stats;
}

// ── Semantic Search ──

export async function semanticSearch({ query, projectId, limit = 20, tier }) {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'semantic_search', query, projectId, limit, tier }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Search failed');
  }
  return res.json();
}

// ── Find Similar Clips ──

export async function findSimilarClips(corpusUnitId, limit = 10) {
  // 1. Get the embedding for this unit
  const { data: embRow, error: embErr } = await db().from('embeddings')
    .select('embedding')
    .eq('corpus_unit_id', corpusUnitId)
    .limit(1)
    .single();

  if (embErr || !embRow?.embedding) {
    throw new Error('No embedding found for this clip');
  }

  // 2. Call the search RPC with this embedding
  const { data, error } = await db().rpc('search_corpus_embeddings', {
    query_embedding: embRow.embedding,
    match_threshold: 0.3,
    match_count: limit + 1, // +1 because the clip itself will be in results
  });

  if (error) throw new Error(error.message);

  // Filter out the source clip itself
  return (data || []).filter(r => r.corpus_unit_id !== corpusUnitId).slice(0, limit);
}

// ── Insights Hub API ──

export async function fetchSceneInsights(scenes) {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'scene_insights', scenes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.detail ? `${err.error}: ${err.detail}` : (err.error || 'Scene insights failed'));
  }
  return res.json();
}

export async function chatWithFootage({ message, conversationHistory, projectContext, relevantClips }) {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'chat', message, conversationHistory, projectContext, relevantClips }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Chat failed');
  }
  return res.json();
}

export async function fetchNarrativeInsights(scenes, projectName) {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'narrative_insights', scenes, projectName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.detail ? `${err.error}: ${err.detail}` : (err.error || 'Narrative insights failed'));
  }
  return res.json();
}

export async function fetchTierComparison(projectId) {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'tier_comparison', projectId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Tier comparison failed');
  }
  return res.json();
}

// ── Pending queue (used by worker) ──

export async function getPendingAssets(limit = 10) {
  if (!supabase) return [];
  const { data, error } = await db().from('media_assets')
    .select('*')
    .eq('queue_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw normalizeError(error, 'getPendingAssets');
  return data;
}
