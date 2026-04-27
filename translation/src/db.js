import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Projects ──

export async function createProject({ name, description }) {
  const { data, error } = await supabase
    .from('projects')
    .insert({ name, description: description || null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteProject(id) {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Tags ──

export async function createTag({ projectId, name, color }) {
  const { data, error } = await supabase
    .from('tags')
    .insert({ project_id: projectId, name, color: color || '#DD2C1E' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listTags(projectId) {
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteTag(id) {
  const { error } = await supabase
    .from('tags')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Highlights ──

export async function saveHighlights(transcriptId, highlights) {
  // Delete existing highlights for transcript then re-insert
  await supabase.from('highlights').delete().eq('transcript_id', transcriptId);
  if (!highlights || highlights.length === 0) return;
  const rows = highlights.map(h => ({
    transcript_id: transcriptId,
    tag_id: h.tagId || null,
    segment_numbers: h.segmentNumbers || [],
    text_preview: h.textPreview || '',
    original_text_preview: h.originalTextPreview || '',
    note: h.note || null,
  }));
  const { error } = await supabase.from('highlights').insert(rows);
  if (error) throw new Error(error.message);
}

export async function searchHighlights({ projectId, tagId }) {
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
  const { data, error } = await supabase
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
  const { data, error } = await supabase
    .from('ai_threads')
    .update({ messages, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listAiThreads(transcriptId) {
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
  const { data, error } = await supabase
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

  const { data, error } = await supabase
    .from('transcripts')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function listTranscripts(projectId) {
  let query = supabase
    .from('transcripts')
    .select('id, name, step, created_at, updated_at, project_id')
    .order('updated_at', { ascending: false });

  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function loadTranscript(id) {
  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteTranscript(id) {
  const { error } = await supabase
    .from('transcripts')
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
}
