// Pure, framework-free rules for the media-upload pipeline (video/audio
// source files for in-house transcription). Extracted from db.js so they can
// be unit-tested headlessly — db.js itself reads import.meta.env at module
// load (Vite-only) and so can't be imported in a plain test runner.

/**
 * Decide whether a freshly-uploaded file needs server-side transcode to be
 * playable in the browser. ProRes/DNxHR/MXF and other Premiere/Avid export
 * codecs typically don't decode in Chrome. mp4/webm video and the common web
 * audio codecs (mp3, aac/m4a, wav, ogg/vorbis, opus, flac) are fine.
 *
 * The policy is conservative: anything we KNOW Chrome plays gets
 * 'not_needed', everything else gets handed to the worker ('pending'). That
 * intent is honored for unknown video (caught by the `video/*` rule) AND for
 * unknown audio (the `audio/*` catch-all) — an AIFF or WMA interview that
 * Chrome can't decode must transcode, not silently fail to play.
 *
 * @param {{ mimeType?: string, filename?: string }} file
 * @returns {boolean} true = transcode ('pending'), false = playable ('not_needed')
 */
export function needsTranscode({ mimeType, filename } = {}) {
  const ext = (filename || '').split('.').pop()?.toLowerCase() || '';
  const m = (mimeType || '').toLowerCase();

  // Web-friendly video containers Chrome decodes directly.
  if (m === 'video/mp4' || m === 'video/webm') return false;

  // Web-friendly audio: Chrome plays mp3, aac/m4a, wav (PCM), ogg/vorbis,
  // opus, flac, and webm-audio natively — skip transcoding those. (Listed
  // explicitly so the unknown-audio catch-all below doesn't grab them.)
  if (m.startsWith('audio/') && (
    m.includes('mp3') || m.includes('mpeg') || m.includes('mp4') ||
    m.includes('aac') || m.includes('wav') || m.includes('ogg') ||
    m.includes('opus') || m.includes('flac') || m.includes('webm')
  )) return false;
  if (['mp4', 'm4a', 'mp3', 'wav', 'webm', 'ogg', 'oga', 'opus', 'flac', 'weba'].includes(ext)) return false;

  // Premiere/Avid proxies + every other video container → transcode.
  if (['mov', 'mxf', 'mkv', 'avi', 'flv', 'mts', 'm2ts', 'wmv', 'prores'].includes(ext)) return true;
  if (m.startsWith('video/quicktime')) return true;
  if (m.startsWith('video/')) return true;

  // Unknown AUDIO codec (aiff, wma, amr, ape, …) Chrome can't decode → hand
  // to the worker, matching the conservative intent above. Previously these
  // fell through to `not_needed` and silently failed to play.
  if (m.startsWith('audio/')) return true;

  return false;
}

/**
 * Fallback storage-file extension for an image with no usable filename
 * (pasted/dragged blob). Driven by mime so the stored path carries a
 * sensible suffix. Lowercases first and accepts the non-canonical "jpg"
 * mime spelling so a JPEG never lands as a ".png" path.
 */
export function guessExtFromMime(mime) {
  if (!mime) return 'png';
  const m = mime.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'png';
}

/**
 * Map a camelCase media-asset fields object to the snake_case DB row,
 * including only the keys that were actually provided (so partial updates
 * don't clobber unrelated columns with undefined).
 */
export function mediaFieldsToRow(fields = {}) {
  const row = {};
  if (fields.projectId !== undefined)        row.project_id = fields.projectId;
  if (fields.filename !== undefined)          row.filename = fields.filename;
  if (fields.displayName !== undefined)       row.display_name = fields.displayName;
  if (fields.mimeType !== undefined)          row.mime_type = fields.mimeType;
  if (fields.sizeBytes !== undefined)         row.size_bytes = fields.sizeBytes;
  if (fields.durationSeconds !== undefined)   row.duration_seconds = fields.durationSeconds;
  if (fields.storageBucket !== undefined)     row.storage_bucket = fields.storageBucket;
  if (fields.storagePath !== undefined)       row.storage_path = fields.storagePath;
  if (fields.width !== undefined)             row.width = fields.width;
  if (fields.height !== undefined)            row.height = fields.height;
  if (fields.fps !== undefined)               row.fps = fields.fps;
  if (fields.audioChannels !== undefined)     row.audio_channels = fields.audioChannels;
  if (fields.audioSampleRate !== undefined)   row.audio_sample_rate = fields.audioSampleRate;
  if (fields.waveform !== undefined)          row.waveform = fields.waveform;
  if (fields.transcriptionStatus !== undefined)       row.transcription_status = fields.transcriptionStatus;
  if (fields.transcriptionProvider !== undefined)     row.transcription_provider = fields.transcriptionProvider;
  if (fields.transcriptionError !== undefined)        row.transcription_error = fields.transcriptionError;
  if (fields.transcriptionStartedAt !== undefined)    row.transcription_started_at = fields.transcriptionStartedAt;
  if (fields.transcriptionCompletedAt !== undefined)  row.transcription_completed_at = fields.transcriptionCompletedAt;
  if (fields.transcriptionProgress !== undefined)     row.transcription_progress = fields.transcriptionProgress;
  if (fields.sourceLanguage !== undefined)            row.source_language = fields.sourceLanguage;
  if (fields.transcodeStatus !== undefined)           row.transcode_status = fields.transcodeStatus;
  if (fields.transcodePath !== undefined)             row.transcode_path = fields.transcodePath;
  if (fields.uploadedBy !== undefined)                row.uploaded_by = fields.uploadedBy;
  return row;
}
