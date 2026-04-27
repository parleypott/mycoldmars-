import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export async function saveTranscript({ name, step, segments, analysis, translations, srtContent, speakerColors, annotations, metadata }) {
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

  const { data, error } = await supabase
    .from('transcripts')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function listTranscripts() {
  const { data, error } = await supabase
    .from('transcripts')
    .select('id, name, step, created_at, updated_at')
    .order('updated_at', { ascending: false });

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
