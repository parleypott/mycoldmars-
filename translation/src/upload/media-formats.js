// Pure, DOM-free media-format rules for the upload gate.
//
// Extracted from media-flow.js so they're unit-testable headlessly (the
// flow module pulls in db.js/auth.js, which read import.meta.env at load
// and can't be imported in a bun test).
//
// IMPORTANT — keep this in lock-step with media-rules.js `needsTranscode`.
// The upload gate (isMediaFile) and the transcode decision are two halves
// of one contract: a format the gate ADMITS but Chrome can't decode (AIFF,
// WMA from field recorders / Windows / archival sources) must reach the
// worker's playable-proxy path. needsTranscode's unknown-audio branch keys
// ENTIRELY on an `audio/*` mime, so guessMimeFromExt below MUST resolve
// those extensions to an audio/* mime — otherwise a dropped .aiff with no
// browser-supplied file.type resolves to application/octet-stream, slips
// past the audio catch-all, and silently fails to play.

// Mimes the upload gate accepts directly. AIFF + WMA added so Johnny's
// archival / field-recorder interviews are uploadable (they then transcode
// to a playable proxy via needsTranscode → 'pending').
export const SUPPORTED_MEDIA_MIMES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav',
  'audio/webm', 'audio/ogg', 'audio/flac',
  'audio/aiff', 'audio/x-aiff', 'audio/x-ms-wma', 'audio/wma',
]);

// Extension fallback when the browser supplies no file.type.
export const SUPPORTED_MEDIA_EXTS = new Set([
  'mp4', 'mov', 'webm', 'mkv',
  'mp3', 'm4a', 'wav', 'ogg', 'flac',
  'aiff', 'aif', 'wma',
]);

export function isMediaFile(file) {
  if (!file) return false;
  if (SUPPORTED_MEDIA_MIMES.has(file.type)) return true;
  const ext = (file.name || '').split('.').pop().toLowerCase();
  return SUPPORTED_MEDIA_EXTS.has(ext);
}

export function sanitizeFilename(name) {
  return (name || 'media')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-180); // keep storage path manageable
}

// Resolve an extension to a mime. AIFF/WMA map to an audio/* mime (NOT the
// generic octet-stream) so the needsTranscode audio catch-all fires and the
// file gets a playable proxy instead of silently failing to play in Chrome.
export function guessMimeFromExt(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const map = {
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
    aiff: 'audio/aiff', aif: 'audio/aiff', wma: 'audio/x-ms-wma',
  };
  return map[ext] || 'application/octet-stream';
}

export function secondsToTimecode(secs) {
  if (typeof secs !== 'number' || !isFinite(secs)) return '00:00:00.000';
  const total = Math.max(0, secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.floor((total - Math.floor(total)) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }
