// Transcript field mapping (camelCase app fields → snake_case DB columns).
//
// Load-bearing: every transcript create/update flows through here. The
// `!== undefined` guard on every field is the contract that lets a PARTIAL
// update (e.g. `{ name }`) touch only that column and leave every other
// column untouched — drop the guard and a partial save blows away segments,
// analysis, translations, etc. with undefined/null.
//
// Extracted from db.js so it's a pure, testable unit. The only environment
// dependency was `flag('hasSlug')`; that boolean is now passed in as the
// second argument so callers stay in control of the schema gate.
//
// @param {object} fields   app-shaped partial fields (camelCase)
// @param {boolean} hasSlug  whether the DB schema has the slug column
// @returns {object} DB-shaped row (snake_case), only defined fields present
export function fieldsToRow(fields, hasSlug) {
  const row = {};
  if (fields.name !== undefined) row.name = fields.name;
  if (fields.step !== undefined) row.step = fields.step;
  if (fields.segments !== undefined) row.segments = fields.segments;
  if (fields.analysis !== undefined) row.analysis = fields.analysis;
  if (fields.translations !== undefined) row.translations = fields.translations;
  if (fields.srtContent !== undefined) row.srt_content = fields.srtContent;
  if (fields.speakerColors !== undefined) row.speaker_colors = fields.speakerColors;
  if (fields.annotations !== undefined) row.annotations = fields.annotations;
  if (fields.metadata !== undefined) row.metadata = fields.metadata;
  if (fields.projectId !== undefined) row.project_id = fields.projectId;
  if (fields.speakerMap !== undefined) row.speaker_map = fields.speakerMap;
  if (fields.hiddenSpeakers !== undefined) row.hidden_speakers = fields.hiddenSpeakers;
  if (fields.editorState !== undefined) row.editor_state = fields.editorState;
  if (fields.customSequenceName !== undefined) row.custom_sequence_name = fields.customSequenceName;
  if (fields.hideUnintelligible !== undefined) row.hide_unintelligible = fields.hideUnintelligible;
  if (fields.wordTimings !== undefined) row.word_timings = fields.wordTimings;
  if (fields.slug !== undefined && hasSlug) row.slug = fields.slug || null;
  // Phase 3: link to media_uploads + new flow fields
  if (fields.mediaUploadId !== undefined)     row.media_upload_id = fields.mediaUploadId;
  if (fields.source !== undefined)             row.source = fields.source;
  if (fields.targetLanguage !== undefined)     row.target_language = fields.targetLanguage;
  if (fields.translationEnabled !== undefined) row.translation_enabled = fields.translationEnabled;
  // Multi-user attribution. Nullable on the schema so pre-auth rows stay
  // valid; new inserts/updates write the current auth user.
  if (fields.createdBy !== undefined)    row.created_by = fields.createdBy;
  if (fields.lastEditedBy !== undefined) row.last_edited_by = fields.lastEditedBy;
  return row;
}
