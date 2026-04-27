import { createClient } from '@supabase/supabase-js';

let supabase = null;
try {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    supabase = createClient(url, key);
  }
} catch (err) {
  console.warn('Supabase init failed:', err.message);
}

// Once a Supabase call fails, skip it for the rest of the session
let supabaseFailed = false;

export function supabaseAvailable() {
  return true; // localStorage is always available as fallback
}

export function getStorageInfo() {
  if (supabase && !supabaseFailed) return 'remote';
  return 'local';
}

const db = () => {
  if (!supabase || supabaseFailed) throw new Error('Database not configured');
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
    if (supabase && !supabaseFailed) { supabaseFailed = true; console.warn('Supabase failed, using localStorage:', err.message); }
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
    if (!supabase || supabaseFailed) throw new Error('skip');
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, description, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    if (supabase && !supabaseFailed) { supabaseFailed = true; console.warn('Supabase failed, using localStorage:', err.message); }
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
    if (supabase && !supabaseFailed) { supabaseFailed = true; console.warn('Supabase failed, using localStorage:', err.message); }
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
  if (!supabase || supabaseFailed) return [];
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
  if (!supabase || supabaseFailed) return [];
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
  if (!supabase || supabaseFailed) return [];
  const { data, error } = await supabase
    .from('ai_threads')
    .select('*')
    .eq('transcript_id', transcriptId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

// ── Transcripts ──

export async function saveTranscript({ name, step, segments, analysis, translations, srtContent, speakerColors, annotations, metadata, projectId, speakerMap, hiddenSpeakers, editorState }) {
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
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    if (supabase && !supabaseFailed) { supabaseFailed = true; console.warn('Supabase failed, using localStorage:', err.message); }
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

  try {
    const { data, error } = await db()
      .from('transcripts')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    if (supabase && !supabaseFailed) { supabaseFailed = true; console.warn('Supabase failed, using localStorage:', err.message); }
    const existing = lsGet(`transcript_${id}`) || {};
    const merged = { ...existing, ...update };
    lsSet(`transcript_${id}`, merged);
    return merged;
  }
}

export async function listTranscripts(projectId) {
  try {
    if (!supabase || supabaseFailed) throw new Error('skip');
    let query = supabase
      .from('transcripts')
      .select('id, name, step, created_at, updated_at, project_id, metadata')
      .order('updated_at', { ascending: false });

    if (projectId) query = query.eq('project_id', projectId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    if (supabase && !supabaseFailed) { supabaseFailed = true; console.warn('Supabase failed, using localStorage:', err.message); }
    const index = lsGetIndex('transcripts');
    let items = index.map(id => lsGet(`transcript_${id}`)).filter(Boolean);
    if (projectId) items = items.filter(t => t.project_id === projectId);
    // Return only list-level fields, sorted by updated_at desc
    return items
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      .map(t => ({ id: t.id, name: t.name, step: t.step, created_at: t.created_at, updated_at: t.updated_at, project_id: t.project_id, metadata: t.metadata }));
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
    return data;
  } catch (err) {
    if (supabase && !supabaseFailed) { supabaseFailed = true; console.warn('Supabase failed, using localStorage:', err.message); }
    const record = lsGet(`transcript_${id}`);
    if (!record) throw new Error('Transcript not found in local storage');
    return record;
  }
}

export async function deleteTranscript(id) {
  try {
    const { error } = await db()
      .from('transcripts')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  } catch (err) {
    if (supabase && !supabaseFailed) { supabaseFailed = true; console.warn('Supabase failed, using localStorage:', err.message); }
    lsDelete(`transcript_${id}`);
    const index = lsGetIndex('transcripts').filter(i => i !== id);
    lsSaveIndex('transcripts', index);
  }
}
