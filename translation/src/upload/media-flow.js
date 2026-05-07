// Upload + transcribe flow for video/audio files.
//
// Wired into main.js handleFile() — when the dropped/picked file is a
// recognized media type, we route here instead of the CSV/JSON/Trint
// parsing path.
//
// Steps:
//   1. Validate mime type and size (Whisper API has a 25MB hard limit
//      until task #8 ships large-file support)
//   2. Upload to Supabase Storage via supabase-js
//   3. Create media_uploads row
//   4. Generate signed URL
//   5. POST to /api/transcribe (Whisper proxy)
//   6. Normalize the response into segments + wordTimings shape
//   7. Hand back to caller (which calls finishUploadParse)

import { uploadMediaFile, createMediaUpload, updateMediaUpload, getMediaSignedUrl } from '../db.js';
import { transcribeMedia } from '../api-client.js';

const WHISPER_LIMIT_BYTES = 25 * 1024 * 1024;

const SUPPORTED_MIMES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav',
  'audio/webm', 'audio/ogg', 'audio/flac',
]);

const SUPPORTED_EXTS = new Set([
  'mp4', 'mov', 'webm', 'mkv',
  'mp3', 'm4a', 'wav', 'ogg', 'flac',
]);

export function isMediaFile(file) {
  if (!file) return false;
  if (SUPPORTED_MIMES.has(file.type)) return true;
  const ext = (file.name || '').split('.').pop().toLowerCase();
  return SUPPORTED_EXTS.has(ext);
}

/**
 * Run the upload + transcribe flow.
 *
 * @param {File} file
 * @param {object} opts
 * @param {string} [opts.language] — ISO 639-1 source language hint
 * @param {string} [opts.prompt] — names/jargon hints for Whisper
 * @param {string} [opts.projectId] — attach upload to project
 * @param {function} [opts.onProgress] — (stage, percent) => void
 *   stages: 'upload' | 'transcribe' | 'normalize'
 * @returns {Promise<{ segments, wordTimings, mediaUploadId, sourceLanguage, durationSeconds, displayName }>}
 */
export async function uploadAndTranscribe(file, opts = {}) {
  const { language, prompt, projectId, onProgress = () => {} } = opts;

  if (!file) throw new Error('No file');
  if (!isMediaFile(file)) {
    throw new Error('Unsupported media type. Use mp4, mov, webm, mkv, mp3, m4a, wav, ogg, or flac.');
  }
  if (file.size > WHISPER_LIMIT_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(
      `File is ${mb} MB — over the current 25 MB transcription limit. ` +
      `Large-file support (audio extraction + chunking) is on the roadmap. ` +
      `For now, extract the audio and trim/compress to under 25 MB.`
    );
  }

  // Build a deterministic but unique storage path: {projectOrUnattached}/{timestamp}-{filename}
  const safeName = sanitizeFilename(file.name);
  const folder = projectId || 'unattached';
  const stamp = Date.now().toString(36);
  const storagePath = `${folder}/${stamp}-${safeName}`;

  // Stage 1: upload to Supabase Storage
  onProgress('upload', 0);
  await uploadMediaFile({
    file,
    bucket: 'media',
    path: storagePath,
    onProgress: (p) => onProgress('upload', p),
  });
  onProgress('upload', 1);

  // Stage 1b: probe duration on the client (cheap, fills in a useful field)
  let durationSeconds = null;
  try { durationSeconds = await probeDurationSeconds(file); } catch {}

  // Stage 2: create the media_uploads row
  const upload = await createMediaUpload({
    projectId: projectId || null,
    filename: file.name,
    displayName: file.name,
    mimeType: file.type || guessMimeFromExt(file.name),
    sizeBytes: file.size,
    durationSeconds,
    storageBucket: 'media',
    storagePath,
    transcriptionStatus: 'in_progress',
    transcriptionProvider: 'whisper',
    transcriptionStartedAt: new Date().toISOString(),
  });

  // Stage 3: generate a short-lived signed URL for the transcription endpoint
  const signedUrl = await getMediaSignedUrl(storagePath, { bucket: 'media', expiresInSeconds: 1800 });
  if (!signedUrl) throw new Error('Could not generate signed URL for transcription');

  // Stage 4: call Whisper. This is sync from the client's perspective —
  // a 25MB audio file at Whisper's typical throughput takes ~30-90s.
  onProgress('transcribe', 0);
  let whisper;
  try {
    whisper = await transcribeMedia({
      mediaUrl: signedUrl,
      mediaSizeBytes: file.size,
      language,
      prompt,
    });
  } catch (err) {
    await updateMediaUpload(upload.id, {
      transcriptionStatus: 'error',
      transcriptionError: err.message || String(err),
    }).catch(() => {});
    throw err;
  }
  onProgress('transcribe', 1);

  // Stage 5: normalize Whisper segments into the Interpreter's shape.
  onProgress('normalize', 0);
  const segments = (whisper.segments || []).map((s, i) => ({
    number: i + 1,
    speaker: s.speaker || 'Speaker 1',
    start: secondsToTimecode(s.start),
    end: secondsToTimecode(s.end),
    startSec: s.start,
    endSec: s.end,
    text: s.original || '',
  }));

  const wordTimings = (whisper.word_timings || []).map(w => ({
    word: w.word,
    start: w.start,
    end: w.end,
  }));

  await updateMediaUpload(upload.id, {
    transcriptionStatus: 'done',
    transcriptionCompletedAt: new Date().toISOString(),
    sourceLanguage: whisper.language || null,
    durationSeconds: whisper.duration_seconds || durationSeconds,
  }).catch(() => {});
  onProgress('normalize', 1);

  return {
    segments,
    wordTimings,
    mediaUploadId: upload.id,
    sourceLanguage: whisper.language || language || null,
    durationSeconds: whisper.duration_seconds || durationSeconds,
    displayName: file.name,
  };
}

// ── helpers ───────────────────────────────────────────────────────────

function sanitizeFilename(name) {
  return (name || 'media')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-180); // keep storage path manageable
}

function guessMimeFromExt(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const map = {
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  };
  return map[ext] || 'application/octet-stream';
}

function secondsToTimecode(secs) {
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

/**
 * Get duration in seconds via a hidden HTMLMediaElement. Cheap, runs
 * in O(1) wall time once metadata loads. Returns null if it fails.
 */
function probeDurationSeconds(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const isVideo = (file.type || '').startsWith('video/');
    const el = document.createElement(isVideo ? 'video' : 'audio');
    el.preload = 'metadata';
    el.muted = true;
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      try { URL.revokeObjectURL(url); } catch {}
    };
    el.addEventListener('loadedmetadata', () => {
      const d = el.duration;
      cleanup();
      resolve(typeof d === 'number' && isFinite(d) ? d : null);
    });
    el.addEventListener('error', () => { cleanup(); reject(new Error('media probe failed')); });
    setTimeout(() => { cleanup(); resolve(null); }, 5000);
    el.src = url;
  });
}
