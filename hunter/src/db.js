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
  const { data, error } = await db().from('corpus_units')
    .select('*, media_assets!inner(project_id, tier, hunter_projects!inner(name)), analyses(*)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw normalizeError(error, 'listAllCorpusUnits');
  return data;
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
