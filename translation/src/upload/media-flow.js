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

// Soft warning threshold — over this we tell the user "this'll take a few minutes"
// because Deepgram is fast but a 1hr file still takes ~5–10 min end-to-end.
// Hard size enforcement is now server-side: if Deepgram isn't configured AND
// file is over 25 MB, the /api/transcribe endpoint returns 413 with a clear
// message that DEEPGRAM_API_KEY needs to be set.
const LARGE_FILE_THRESHOLD = 25 * 1024 * 1024;
// Absolute ceiling — Deepgram supports up to 2 GB.
const HARD_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

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
 * STEP 1 — Upload a media file to Supabase Storage and create the
 * media_uploads row. Returns the row + a freshly-generated signed URL
 * the caller can use for previewing/probing/transcription.
 *
 * Does NOT trigger transcription. The caller is expected to show the
 * pre-transcribe dialog (file stats, language picker) and only then
 * call runTranscription() with the user's choices.
 */
export async function uploadMedia(file, opts = {}) {
  const { projectId, onProgress = () => {} } = opts;

  if (!file) throw new Error('No file');
  if (!isMediaFile(file)) {
    throw new Error('Unsupported media type. Use mp4, mov, webm, mkv, mp3, m4a, wav, ogg, or flac.');
  }
  if (file.size > HARD_LIMIT_BYTES) {
    const gb = (file.size / 1024 / 1024 / 1024).toFixed(2);
    throw new Error(`File is ${gb} GB — over the 2 GB hard limit. Trim or compress before uploading.`);
  }

  // Storage path: {projectOrUnattached}/{timestamp}-{filename}
  const safeName = sanitizeFilename(file.name);
  const folder = projectId || 'unattached';
  const stamp = Date.now().toString(36);
  const storagePath = `${folder}/${stamp}-${safeName}`;

  onProgress(0);
  await uploadMediaFile({
    file,
    bucket: 'media',
    path: storagePath,
    onProgress,
  });
  onProgress(1);

  // Probe duration via a hidden HTMLMediaElement (cheap, useful in the
  // pre-transcribe dialog so the user sees actual file duration).
  let durationSeconds = null;
  try { durationSeconds = await probeDurationSeconds(file); } catch {}

  // Insert media_uploads row in 'pending' state — transcription_status
  // moves to 'in_progress' when the user actually clicks TRANSCRIBE.
  const upload = await createMediaUpload({
    projectId: projectId || null,
    filename: file.name,
    displayName: file.name,
    mimeType: file.type || guessMimeFromExt(file.name),
    sizeBytes: file.size,
    durationSeconds,
    storageBucket: 'media',
    storagePath,
    transcriptionStatus: 'pending',
  });

  // Long-lived signed URL so the same one can power preview, the
  // transcription request, and the speaker-sample player without
  // having to refresh mid-flow.
  const signedUrl = await getMediaSignedUrl(storagePath, {
    bucket: 'media',
    expiresInSeconds: 4 * 60 * 60,
  });

  return {
    mediaUploadId: upload.id,
    storagePath,
    durationSeconds,
    sizeBytes: file.size,
    mimeType: file.type || guessMimeFromExt(file.name),
    filename: file.name,
    signedUrl,
  };
}

/**
 * STEP 2 — Run transcription against an already-uploaded media_uploads
 * row. Returns the normalized segments + word_timings so the caller can
 * stash them in editor state.
 *
 * The signed URL passed in should be the long-lived one returned by
 * uploadMedia() so we don't have to mint a new one here.
 */
export async function runTranscription({ mediaUploadId, signedUrl, sizeBytes, language, prompt }) {
  if (!mediaUploadId) throw new Error('mediaUploadId required');
  if (!signedUrl)     throw new Error('signedUrl required');

  // Mark in_progress so the row reflects pipeline state if the page is closed.
  await updateMediaUpload(mediaUploadId, {
    transcriptionStatus: 'in_progress',
    transcriptionProvider: 'auto',
    transcriptionStartedAt: new Date().toISOString(),
  }).catch(() => {});

  let whisper;
  try {
    whisper = await transcribeMedia({
      mediaUrl: signedUrl,
      mediaSizeBytes: sizeBytes,
      language,
      prompt,
    });
  } catch (err) {
    await updateMediaUpload(mediaUploadId, {
      transcriptionStatus: 'error',
      transcriptionError: err.message || String(err),
    }).catch(() => {});
    throw err;
  }

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

  await updateMediaUpload(mediaUploadId, {
    transcriptionStatus: 'done',
    transcriptionCompletedAt: new Date().toISOString(),
    transcriptionProvider: whisper.provider || 'auto',
    sourceLanguage: whisper.language || null,
    durationSeconds: whisper.duration_seconds || undefined,
  }).catch(() => {});

  return {
    segments,
    wordTimings,
    sourceLanguage: whisper.language || language || null,
    durationSeconds: whisper.duration_seconds || null,
    provider: whisper.provider || null,
  };
}

// Back-compat shim: the old combined helper still works for any caller
// that hasn't been updated to the two-step flow.
export async function uploadAndTranscribe(file, opts = {}) {
  const { language, prompt, projectId, onProgress = () => {} } = opts;
  const up = await uploadMedia(file, {
    projectId,
    onProgress: (p) => onProgress('upload', p),
  });
  onProgress('transcribe', 0);
  const result = await runTranscription({
    mediaUploadId: up.mediaUploadId,
    signedUrl: up.signedUrl,
    sizeBytes: up.sizeBytes,
    language, prompt,
  });
  onProgress('transcribe', 1);
  onProgress('normalize', 1);
  return {
    ...result,
    mediaUploadId: up.mediaUploadId,
    durationSeconds: result.durationSeconds || up.durationSeconds,
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
