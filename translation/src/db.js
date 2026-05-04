import { createClient } from '@supabase/supabase-js';

let supabase = null;
try {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  // TEMPORARY DIAGNOSTIC — remove once cloud sync works
  console.info('[supabase init] URL is:', url ? `set (${url.slice(0, 30)}...)` : 'MISSING');
  console.info('[supabase init] KEY is:', key ? `set (length ${key.length})` : 'MISSING');
  if (url && key) {
    supabase = createClient(url, key);
    console.info('[supabase init] client created');
  } else {
    console.warn('[supabase init] missing env vars — falling back to localStorage');
  }
} catch (err) {
  console.warn('Supabase init failed:', err.message);
}

// Track consecutive Supabase failures — retry after cooldown instead of permanent kill
let supabaseFailCount = 0;
let supabaseFailedAt = 0;
const SUPABASE_RETRY_COOLDOWN = 10000; // 10 seconds before retrying after failure

// Schema feature detection. The `deleted_at` column was added in a later
// migration (supabase-add-soft-delete.sql); if a Supabase project hasn't run
// it yet, every query that filters on `deleted_at` returns 42703 and the
// library appears empty. We probe once and remember the answer so the rest
// of the app can degrade gracefully instead of throwing.
//   true  → column confirmed present, soft-delete works
//   false → column confirmed missing, treat all rows as "not deleted"
//   null  → not yet probed
let softDeleteSupported = null;

function isMissingColumnError(err) {
  if (!err) return false;
  // supabase-js surfaces { code, message }; some paths only have message
  if (err.code === '42703') return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('deleted_at') && msg.includes('does not exist');
}

function markSoftDeleteUnsupported() {
  if (softDeleteSupported !== false) {
    softDeleteSupported = false;
    console.warn('[schema] transcripts.deleted_at column missing — soft-delete disabled. Run supabase-add-soft-delete.sql to enable.');
  }
}

function markSoftDeleteSupported() {
  if (softDeleteSupported === null) softDeleteSupported = true;
}

export function isSoftDeleteSupported() {
  return softDeleteSupported === true;
}

function markSupabaseFailed(err) {
  supabaseFailCount++;
  supabaseFailedAt = Date.now();
  console.warn(`Supabase failed (attempt ${supabaseFailCount}), using localStorage:`, err.message);
}

function markSupabaseSuccess() {
  if (supabaseFailCount > 0) {
    supabaseFailCount = 0;
    console.info('Supabase connection restored');
  }
}

function isSupabaseAvailable() {
  if (!supabase) return false;
  if (supabaseFailCount === 0) return true;
  // Retry after cooldown
  if (Date.now() - supabaseFailedAt > SUPABASE_RETRY_COOLDOWN) return true;
  return false;
}

// Keep old export name for compat
export function supabaseAvailable() {
  return true; // localStorage is always available as fallback
}

export function getStorageInfo() {
  if (isSupabaseAvailable()) return 'remote';
  return 'local';
}

const db = () => {
  if (!isSupabaseAvailable()) throw new Error('Database not configured');
  return supabase;
};

// ── localStorage helpers ──

const LS_PREFIX = 'mcm_';

function generateId() {
  return 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      console.warn('localStorage quota exceeded — data may not persist.');
    }
    throw err;
  }
}

function lsDelete(key) {
  localStorage.removeItem(LS_PREFIX + key);
}

function lsGetIndex(collection) {
  return lsGet(`index_${collection}`) || [];
}

function lsSaveIndex(collection, index) {
  lsSet(`index_${collection}`, index);
}

// ── Projects ──

export async function createProject({ name, description }) {
  try {
    const { data, error } = await db()
      .from('projects')
      .insert({ name, description: description || null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    const id = generateId();
    const now = new Date().toISOString();
    const project = { id, name, description: description || null, created_at: now };
    lsSet(`project_${id}`, project);
    const index = lsGetIndex('projects');
    index.unshift(id);
    lsSaveIndex('projects', index);
    return project;
  }
}

export async function listProjects() {
  try {
    if (!isSupabaseAvailable()) throw new Error('skip');
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, description, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    const index = lsGetIndex('projects');
    return index.map(id => lsGet(`project_${id}`)).filter(Boolean);
  }
}

export async function deleteProject(id) {
  try {
    const { error } = await db()
      .from('projects')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    lsDelete(`project_${id}`);
    const index = lsGetIndex('projects').filter(i => i !== id);
    lsSaveIndex('projects', index);
  }
}

// ── Tags ──

export async function createTag({ projectId, name, color }) {
  const { data, error } = await db()
    .from('tags')
    .insert({ project_id: projectId, name, color: color || '#DD2C1E' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listTags(projectId) {
  if (!isSupabaseAvailable()) return [];
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteTag(id) {
  const { error } = await db()
    .from('tags')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Highlights ──

export async function saveHighlights(transcriptId, highlights) {
  await db().from('highlights').delete().eq('transcript_id', transcriptId);
  if (!highlights || highlights.length === 0) return;
  const rows = highlights.map(h => ({
    transcript_id: transcriptId,
    tag_id: h.tagId || null,
    segment_numbers: h.segmentNumbers || [],
    text_preview: h.textPreview || '',
    original_text_preview: h.originalTextPreview || '',
    note: h.note || null,
  }));
  const { error } = await db().from('highlights').insert(rows);
  if (error) throw new Error(error.message);
}

export async function searchHighlights({ projectId, tagId }) {
  if (!isSupabaseAvailable()) return [];
  let query = supabase
    .from('highlights')
    .select('*, transcripts!inner(id, name, project_id), tags(id, name, color)')
    .order('created_at', { ascending: false });

  if (projectId) query = query.eq('transcripts.project_id', projectId);
  if (tagId) query = query.eq('tag_id', tagId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// ── AI Threads ──

export async function saveAiThread({ transcriptId, anchorText, anchorOriginalText, messages }) {
  const { data, error } = await db()
    .from('ai_threads')
    .insert({
      transcript_id: transcriptId,
      anchor_text: anchorText,
      anchor_original_text: anchorOriginalText,
      messages: messages || [],
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateAiThread(id, messages) {
  const { data, error } = await db()
    .from('ai_threads')
    .update({ messages, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listAiThreads(transcriptId) {
  if (!isSupabaseAvailable()) return [];
  const { data, error } = await supabase
    .from('ai_threads')
    .select('*')
    .eq('transcript_id', transcriptId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

// ── Transcripts ──

export async function saveTranscript({ name, step, segments, analysis, translations, srtContent, speakerColors, annotations, metadata, projectId, speakerMap, hiddenSpeakers, editorState, customSequenceName, hideUnintelligible, wordTimings, slug }) {
  try {
    const { data, error } = await db()
      .from('transcripts')
      .insert({
        name,
        step,
        segments,
        analysis,
        translations,
        srt_content: srtContent,
        speaker_colors: speakerColors || {},
        annotations: annotations || {},
        metadata: metadata || {},
        project_id: projectId || null,
        speaker_map: speakerMap || {},
        hidden_speakers: hiddenSpeakers || [],
        editor_state: editorState || null,
        custom_sequence_name: customSequenceName || '',
        hide_unintelligible: hideUnintelligible ?? true,
        word_timings: wordTimings || null,
        slug: slug || null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    markSupabaseSuccess();
    return data;
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    const id = generateId();
    const now = new Date().toISOString();
    const record = {
      id, name, step, segments, analysis, translations,
      srt_content: srtContent,
      speaker_colors: speakerColors || {},
      annotations: annotations || {},
      metadata: metadata || {},
      project_id: projectId || null,
      speaker_map: speakerMap || {},
      hidden_speakers: hiddenSpeakers || [],
      editor_state: editorState || null,
      custom_sequence_name: customSequenceName || '',
      hide_unintelligible: hideUnintelligible ?? true,
      word_timings: wordTimings || null,
      slug: slug || null,
      created_at: now,
      updated_at: now,
    };
    lsSet(`transcript_${id}`, record);
    const index = lsGetIndex('transcripts');
    index.unshift(id);
    lsSaveIndex('transcripts', index);
    return record;
  }
}

export async function updateTranscript(id, fields) {
  const update = { updated_at: new Date().toISOString() };

  if (fields.name !== undefined) update.name = fields.name;
  if (fields.step !== undefined) update.step = fields.step;
  if (fields.segments !== undefined) update.segments = fields.segments;
  if (fields.analysis !== undefined) update.analysis = fields.analysis;
  if (fields.translations !== undefined) update.translations = fields.translations;
  if (fields.srtContent !== undefined) update.srt_content = fields.srtContent;
  if (fields.speakerColors !== undefined) update.speaker_colors = fields.speakerColors;
  if (fields.annotations !== undefined) update.annotations = fields.annotations;
  if (fields.metadata !== undefined) update.metadata = fields.metadata;
  if (fields.projectId !== undefined) update.project_id = fields.projectId;
  if (fields.speakerMap !== undefined) update.speaker_map = fields.speakerMap;
  if (fields.hiddenSpeakers !== undefined) update.hidden_speakers = fields.hiddenSpeakers;
  if (fields.editorState !== undefined) update.editor_state = fields.editorState;
  if (fields.customSequenceName !== undefined) update.custom_sequence_name = fields.customSequenceName;
  if (fields.hideUnintelligible !== undefined) update.hide_unintelligible = fields.hideUnintelligible;
  if (fields.wordTimings !== undefined) update.word_timings = fields.wordTimings;
  if (fields.slug !== undefined) update.slug = fields.slug;

  try {
    const { data, error } = await db()
      .from('transcripts')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    markSupabaseSuccess();
    return data;
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    const existing = lsGet(`transcript_${id}`) || {};
    const merged = { ...existing, ...update };
    lsSet(`transcript_${id}`, merged);
    return merged;
  }
}

export async function listTranscripts(projectId) {
  try {
    if (!isSupabaseAvailable()) throw new Error('skip');
    // Intentionally omits `metadata` — it can be large (Workshop state, etc)
    // and the library only needs id/name/step/dates. Metadata is fetched
    // lazily by loadTranscript when the user opens a transcript.
    const cols = softDeleteSupported === false
      ? 'id, name, step, created_at, updated_at, project_id, slug'
      : 'id, name, step, created_at, updated_at, project_id, slug, deleted_at';
    let query = supabase
      .from('transcripts')
      .select(cols)
      .order('updated_at', { ascending: false });

    if (softDeleteSupported !== false) query = query.is('deleted_at', null);
    if (projectId) query = query.eq('project_id', projectId);

    let { data, error } = await query;
    if (error) {
      if (isMissingColumnError(error)) {
        // Schema doesn't have deleted_at yet — retry without that filter so
        // the user's data is visible. Mark the feature off so subsequent
        // calls skip the filter immediately.
        markSoftDeleteUnsupported();
        let retry = supabase
          .from('transcripts')
          .select('id, name, step, created_at, updated_at, project_id, slug')
          .order('updated_at', { ascending: false });
        if (projectId) retry = retry.eq('project_id', projectId);
        const r = await retry;
        if (r.error) throw new Error(r.error.message);
        data = r.data;
      } else {
        throw new Error(error.message);
      }
    } else {
      markSoftDeleteSupported();
    }
    markSupabaseSuccess();
    // Strip deleted_at from returned rows for caller consistency
    return (data || []).map(({ deleted_at, ...rest }) => rest);
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    const index = lsGetIndex('transcripts');
    let items = index.map(id => lsGet(`transcript_${id}`)).filter(t => t && !t.deleted_at);
    if (projectId) items = items.filter(t => t.project_id === projectId);
    return items
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      .map(t => ({ id: t.id, name: t.name, step: t.step, created_at: t.created_at, updated_at: t.updated_at, project_id: t.project_id, slug: t.slug }));
  }
}

export async function loadTranscript(id) {
  try {
    const { data, error } = await db()
      .from('transcripts')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    markSupabaseSuccess();
    return data;
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    const record = lsGet(`transcript_${id}`);
    if (!record) throw new Error('Transcript not found');
    return record;
  }
}

export async function loadTranscriptBySlug(slug) {
  try {
    let query = db()
      .from('transcripts')
      .select('*')
      .eq('slug', slug);
    if (softDeleteSupported !== false) query = query.is('deleted_at', null);
    let { data, error } = await query.single();

    if (error && isMissingColumnError(error)) {
      markSoftDeleteUnsupported();
      const r = await db().from('transcripts').select('*').eq('slug', slug).single();
      if (r.error) throw new Error(r.error.message);
      data = r.data;
    } else if (error) {
      throw new Error(error.message);
    } else {
      markSoftDeleteSupported();
    }
    markSupabaseSuccess();
    return data;
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    // Search localStorage
    const index = lsGetIndex('transcripts');
    for (const id of index) {
      const record = lsGet(`transcript_${id}`);
      if (record && record.slug === slug && !record.deleted_at) return record;
    }
    throw new Error('Transcript not found');
  }
}

export async function isSlugTaken(slug, excludeId) {
  try {
    if (!isSupabaseAvailable()) throw new Error('skip');
    let query = supabase
      .from('transcripts')
      .select('id')
      .eq('slug', slug);
    if (softDeleteSupported !== false) query = query.is('deleted_at', null);
    if (excludeId) query = query.neq('id', excludeId);
    let { data, error } = await query;
    if (error && isMissingColumnError(error)) {
      markSoftDeleteUnsupported();
      let retry = supabase.from('transcripts').select('id').eq('slug', slug);
      if (excludeId) retry = retry.neq('id', excludeId);
      const r = await retry;
      if (r.error) throw new Error(r.error.message);
      data = r.data;
    } else if (error) {
      throw new Error(error.message);
    } else {
      markSoftDeleteSupported();
    }
    return data && data.length > 0;
  } catch {
    const index = lsGetIndex('transcripts');
    for (const id of index) {
      if (id === excludeId) continue;
      const record = lsGet(`transcript_${id}`);
      if (record && record.slug === slug && !record.deleted_at) return true;
    }
    return false;
  }
}

export async function deleteTranscript(id) {
  // Soft-delete when supported, else fall back to hard delete so the row
  // disappears from the library (better than a silent no-op).
  try {
    if (softDeleteSupported === false) {
      const { error } = await db().from('transcripts').delete().eq('id', id);
      if (error) throw new Error(error.message);
      markSupabaseSuccess();
      return;
    }
    const { error } = await db()
      .from('transcripts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      if (isMissingColumnError(error)) {
        markSoftDeleteUnsupported();
        const r = await db().from('transcripts').delete().eq('id', id);
        if (r.error) throw new Error(r.error.message);
        markSupabaseSuccess();
        return;
      }
      throw new Error(error.message);
    }
    markSoftDeleteSupported();
    markSupabaseSuccess();
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    const existing = lsGet(`transcript_${id}`);
    if (existing) {
      existing.deleted_at = new Date().toISOString();
      lsSet(`transcript_${id}`, existing);
    }
  }
}

export async function restoreTranscript(id) {
  try {
    const { error } = await db()
      .from('transcripts')
      .update({ deleted_at: null })
      .eq('id', id);

    if (error) throw new Error(error.message);
    markSupabaseSuccess();
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    const existing = lsGet(`transcript_${id}`);
    if (existing) {
      delete existing.deleted_at;
      lsSet(`transcript_${id}`, existing);
    }
  }
}

export async function permanentlyDeleteTranscript(id) {
  try {
    const { error } = await db()
      .from('transcripts')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    lsDelete(`transcript_${id}`);
    const index = lsGetIndex('transcripts').filter(i => i !== id);
    lsSaveIndex('transcripts', index);
  }
}

export async function listDeletedTranscripts() {
  try {
    if (!isSupabaseAvailable()) throw new Error('skip');
    if (softDeleteSupported === false) return [];
    const { data, error } = await supabase
      .from('transcripts')
      .select('id, name, step, created_at, updated_at, deleted_at, project_id')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if (error) {
      if (isMissingColumnError(error)) {
        markSoftDeleteUnsupported();
        return [];
      }
      throw new Error(error.message);
    }
    markSoftDeleteSupported();
    return data;
  } catch (err) {
    if (supabase) markSupabaseFailed(err);
    const index = lsGetIndex('transcripts');
    return index.map(id => lsGet(`transcript_${id}`))
      .filter(t => t && t.deleted_at)
      .map(t => ({ id: t.id, name: t.name, step: t.step, created_at: t.created_at, updated_at: t.updated_at, deleted_at: t.deleted_at, project_id: t.project_id }));
  }
}

// ── Migration: localStorage → Supabase ──

const MIGRATION_KEY = LS_PREFIX + 'migrated_to_supabase';

export async function migrateLocalStorageToSupabase() {
  if (!supabase) return { migrated: false, reason: 'no supabase client' };
  if (localStorage.getItem(MIGRATION_KEY)) return { migrated: false, reason: 'already migrated' };

  // Nothing to migrate? Mark done immediately so we never check again.
  const projectIndex = lsGetIndex('projects');
  const transcriptIndex = lsGetIndex('transcripts');
  if (projectIndex.length === 0 && transcriptIndex.length === 0) {
    localStorage.setItem(MIGRATION_KEY, JSON.stringify({ at: new Date().toISOString(), skipped: true }));
    return { migrated: false, reason: 'nothing to migrate' };
  }

  // Quick check — can we reach Supabase at all?
  try {
    const { error } = await supabase.from('transcripts').select('id').limit(1);
    if (error) throw error;
  } catch (err) {
    return { migrated: false, reason: 'supabase not reachable: ' + err.message };
  }

  const results = { projects: 0, transcripts: 0, errors: [] };

  // Migrate projects first (transcripts may reference them)
  const projectIdMap = {}; // old local id → new uuid
  for (const oldId of projectIndex) {
    const p = lsGet(`project_${oldId}`);
    if (!p) continue;
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({ name: p.name, description: p.description || null })
        .select()
        .single();
      if (error) throw error;
      projectIdMap[oldId] = data.id;
      results.projects++;
    } catch (err) {
      results.errors.push(`project ${p.name}: ${err.message}`);
    }
  }

  // Migrate transcripts
  const transcriptIdMap = {}; // old local id → new uuid
  for (const oldId of transcriptIndex) {
    const t = lsGet(`transcript_${oldId}`);
    if (!t) continue;
    try {
      // Remap project_id if it was a local id
      let projectId = t.project_id || null;
      if (projectId && projectIdMap[projectId]) {
        projectId = projectIdMap[projectId];
      } else if (projectId && projectId.startsWith('local_')) {
        projectId = null; // orphaned local project ref
      }

      const { data, error } = await supabase
        .from('transcripts')
        .insert({
          name: t.name,
          step: t.step || 1,
          segments: t.segments || [],
          analysis: t.analysis || null,
          translations: t.translations || null,
          srt_content: t.srt_content || null,
          speaker_colors: t.speaker_colors || {},
          annotations: t.annotations || {},
          metadata: t.metadata || {},
          project_id: projectId,
          speaker_map: t.speaker_map || {},
          hidden_speakers: t.hidden_speakers || [],
          editor_state: t.editor_state || null,
          custom_sequence_name: t.custom_sequence_name || '',
          hide_unintelligible: t.hide_unintelligible ?? true,
          word_timings: t.word_timings || null,
        })
        .select()
        .single();
      if (error) throw error;
      transcriptIdMap[oldId] = data.id;
      results.transcripts++;
    } catch (err) {
      results.errors.push(`transcript ${t.name}: ${err.message}`);
    }
  }

  // Mark migration done (even if partial — don't re-run)
  if (results.projects > 0 || results.transcripts > 0) {
    localStorage.setItem(MIGRATION_KEY, JSON.stringify({
      at: new Date().toISOString(),
      ...results,
    }));

    // Clean up localStorage data now that it's in Supabase
    for (const oldId of projectIndex) {
      lsDelete(`project_${oldId}`);
    }
    lsDelete('index_projects');
    for (const oldId of transcriptIndex) {
      lsDelete(`transcript_${oldId}`);
    }
    lsDelete('index_transcripts');
  }

  console.info('Migration complete:', results);
  return { migrated: true, ...results, projectIdMap, transcriptIdMap };
}
