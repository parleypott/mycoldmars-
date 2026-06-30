// Coverage for the media-upload pure rules extracted from db.js.
// Imports the REAL shipped functions (no byte-copy mirror, can't drift).
//
// Two real bugs are locked here with RED proofs:
//   1. needsTranscode: an AIFF/WMA interview (Chrome can't decode either)
//      returned not_needed → silently failed to play AND skipped transcode,
//      violating the function's own documented conservative intent.
//   2. guessExtFromMime: a JPEG with the non-canonical "image/jpg" mime (or
//      uppercase "image/JPEG") returned 'png' → the stored path got the wrong
//      suffix. Same image/jpg MIME class fixed across the Gemini endpoints.

import { needsTranscode, guessExtFromMime, mediaFieldsToRow } from './media-rules.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(Object.is(a, b), `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// ───────────────────────────────────────────────────────────────────────────
// RED PROOF — reconstruct the OLD needsTranscode and prove it mislabeled audio.
// ───────────────────────────────────────────────────────────────────────────
function oldNeedsTranscode({ mimeType, filename }) {
  const ext = (filename || '').split('.').pop()?.toLowerCase() || '';
  const m = (mimeType || '').toLowerCase();
  if (m === 'video/mp4' || m === 'video/webm') return false;
  if (m.startsWith('audio/') && (m.includes('mp3') || m.includes('mpeg') || m.includes('mp4') || m.includes('aac') || m.includes('wav'))) return false;
  if (['mp4', 'm4a', 'mp3', 'wav', 'webm'].includes(ext)) return false;
  if (['mov', 'mxf', 'mkv', 'avi', 'flv', 'mts', 'm2ts', 'wmv', 'prores'].includes(ext)) return true;
  if (m.startsWith('video/quicktime')) return true;
  if (m.startsWith('video/')) return true;
  return false;
}
// The old code returns false (not_needed) for AIFF/WMA — the bug.
eq(oldNeedsTranscode({ mimeType: 'audio/aiff', filename: 'interview.aiff' }), false, 'RED proof: old code skips AIFF transcode');
eq(oldNeedsTranscode({ mimeType: 'audio/x-ms-wma', filename: 'archive.wma' }), false, 'RED proof: old code skips WMA transcode');
// The fixed code transcodes them.
eq(needsTranscode({ mimeType: 'audio/aiff', filename: 'interview.aiff' }), true, 'FIX: AIFF → transcode');
eq(needsTranscode({ mimeType: 'audio/x-ms-wma', filename: 'archive.wma' }), true, 'FIX: WMA → transcode');

// ── The fix: unknown / Chrome-unplayable audio codecs → transcode ──
for (const [f, m] of [
  ['interview.aiff', 'audio/aiff'],
  ['interview.aif', 'audio/x-aiff'],
  ['archive.wma', 'audio/x-ms-wma'],
  ['field.amr', 'audio/amr'],
  ['weird.ape', 'audio/x-ape'],
  ['mystery', 'audio/x-unknown-codec'],
]) {
  eq(needsTranscode({ mimeType: m, filename: f }), true, `unknown audio ${m} → transcode`);
}

// ── Web-friendly audio Chrome plays natively → skip (no wasteful transcode) ──
for (const [f, m] of [
  ['take.mp3', 'audio/mpeg'],
  ['take.mp3', 'audio/mp3'],
  ['take.m4a', 'audio/mp4'],
  ['take.m4a', 'audio/x-m4a'],   // mime not in includes() set, but ext m4a → skip
  ['take.aac', 'audio/aac'],
  ['take.wav', 'audio/wav'],
  ['take.wav', 'audio/x-wav'],
  ['take.ogg', 'audio/ogg'],
  ['take.opus', 'audio/opus'],
  ['take.flac', 'audio/flac'],
  ['take.weba', 'audio/webm'],
]) {
  eq(needsTranscode({ mimeType: m, filename: f }), false, `web audio ${m} → skip`);
}
// Web audio recognized by EXTENSION alone (no/odd mime).
for (const ext of ['mp3', 'm4a', 'wav', 'mp4', 'webm', 'ogg', 'oga', 'opus', 'flac', 'weba']) {
  eq(needsTranscode({ mimeType: '', filename: `clip.${ext}` }), false, `web audio ext .${ext} → skip`);
}

// ── The mirror gap: Chrome-undecodable audio by EXTENSION ALONE (empty mime) ──
// Chrome supplies file.type='' for exactly these uncommon codecs, so the
// extension path is the ONLY signal. The mime catch-all couldn't fire (no mime),
// and the ext path had no unknown-audio entry → fell through to not_needed →
// silent playback failure. Reconstruct the OLD (no audio-ext list) form to prove
// the gap was real, then lock the fix.
function oldNoAudioExt({ mimeType, filename }) {
  const ext = (filename || '').split('.').pop()?.toLowerCase() || '';
  const m = (mimeType || '').toLowerCase();
  if (m === 'video/mp4' || m === 'video/webm') return false;
  if (m.startsWith('audio/') && (m.includes('mp3') || m.includes('mpeg') || m.includes('mp4') || m.includes('aac') || m.includes('wav') || m.includes('ogg') || m.includes('opus') || m.includes('flac') || m.includes('webm'))) return false;
  if (['mp4', 'm4a', 'mp3', 'wav', 'webm', 'ogg', 'oga', 'opus', 'flac', 'weba'].includes(ext)) return false;
  if (['mov', 'mxf', 'mkv', 'avi', 'flv', 'mts', 'm2ts', 'wmv', 'prores'].includes(ext)) return true;
  if (m.startsWith('video/quicktime')) return true;
  if (m.startsWith('video/')) return true;
  if (m.startsWith('audio/')) return true;
  return false; // ← the gap: unknown-audio extension with empty mime
}
for (const ext of ['aiff', 'aif', 'aifc', 'wma', 'amr', 'ape', 'ac3', 'dts', 'caf', 'wv', 'm4b', 'ra']) {
  // RED proof: old form mislabels the mime-less file as playable.
  eq(oldNoAudioExt({ mimeType: '', filename: `interview.${ext}` }), false, `RED proof: old code skips mime-less .${ext}`);
  // Fixed: now transcodes regardless of an absent mime.
  eq(needsTranscode({ mimeType: '', filename: `interview.${ext}` }), true, `mime-less .${ext} → transcode`);
}
// Web-friendly audio extensions still short-circuit to skip BEFORE the new list,
// so the fix never wastefully transcodes a Chrome-playable file (no regression).
for (const ext of ['mp3', 'm4a', 'wav', 'ogg', 'opus', 'flac', 'weba']) {
  eq(needsTranscode({ mimeType: '', filename: `take.${ext}` }), false, `web audio ext .${ext} still skips (post-fix)`);
}

// ── Video behavior UNCHANGED — locks the no-regression guarantee ──
// Web-friendly video.
eq(needsTranscode({ mimeType: 'video/mp4', filename: 'a.mp4' }), false, 'video/mp4 → skip');
eq(needsTranscode({ mimeType: 'video/webm', filename: 'a.webm' }), false, 'video/webm → skip');
eq(needsTranscode({ mimeType: '', filename: 'a.mp4' }), false, 'ext mp4 → skip');
// Premiere/Avid containers + every other video → transcode.
for (const ext of ['mov', 'mxf', 'mkv', 'avi', 'flv', 'mts', 'm2ts', 'wmv', 'prores']) {
  eq(needsTranscode({ mimeType: 'application/octet-stream', filename: `proxy.${ext}` }), true, `${ext} container → transcode`);
}
eq(needsTranscode({ mimeType: 'video/quicktime', filename: 'a.mov' }), true, 'video/quicktime → transcode');
eq(needsTranscode({ mimeType: 'video/x-matroska', filename: 'noext' }), true, 'unknown video mime → transcode');
eq(needsTranscode({ mimeType: 'video/mp2t', filename: 'cam.mts' }), true, '.mts → transcode');
// Behavior-preserving vs old code for the video + web-audio inputs that already worked.
for (const sample of [
  { mimeType: 'video/mp4', filename: 'a.mp4' },
  { mimeType: 'video/webm', filename: 'a.webm' },
  { mimeType: 'video/quicktime', filename: 'a.mov' },
  { mimeType: 'application/octet-stream', filename: 'b.mxf' },
  { mimeType: 'audio/mpeg', filename: 'c.mp3' },
  { mimeType: 'audio/wav', filename: 'd.wav' },
  { mimeType: 'video/x-msvideo', filename: 'e.avi' },
]) {
  eq(needsTranscode(sample), oldNeedsTranscode(sample), `unchanged vs old: ${sample.filename}`);
}
// Non-media / empty → not_needed (unchanged).
eq(needsTranscode({ mimeType: 'application/pdf', filename: 'doc.pdf' }), false, 'pdf → not_needed');
eq(needsTranscode({}), false, 'empty input → not_needed (no throw)');
eq(needsTranscode(), false, 'no arg → not_needed (no throw)');

// ───────────────────────────────────────────────────────────────────────────
// guessExtFromMime — image/jpg blind spot + case.
// ───────────────────────────────────────────────────────────────────────────
function oldGuessExt(mime) {
  if (!mime) return 'png';
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'png';
}
// RED proof: old code mis-named jpg / uppercase JPEG as png.
eq(oldGuessExt('image/jpg'), 'png', 'RED proof: old code → image/jpg becomes png');
eq(oldGuessExt('image/JPEG'), 'png', 'RED proof: old code → uppercase JPEG becomes png');
// Fixed.
eq(guessExtFromMime('image/jpg'), 'jpg', 'FIX: image/jpg → jpg');
eq(guessExtFromMime('image/JPG'), 'jpg', 'FIX: uppercase image/JPG → jpg');
eq(guessExtFromMime('image/JPEG'), 'jpg', 'FIX: uppercase image/JPEG → jpg');
eq(guessExtFromMime('image/jpeg'), 'jpg', 'canonical jpeg → jpg');
eq(guessExtFromMime('image/webp'), 'webp', 'webp → webp');
eq(guessExtFromMime('image/WEBP'), 'webp', 'uppercase WEBP → webp');
eq(guessExtFromMime('image/gif'), 'gif', 'gif → gif');
eq(guessExtFromMime('image/png'), 'png', 'png → png');
eq(guessExtFromMime('image/svg+xml'), 'png', 'svg → png fallback (unchanged)');
eq(guessExtFromMime(''), 'png', 'empty → png');
eq(guessExtFromMime(null), 'png', 'null → png');
eq(guessExtFromMime(undefined), 'png', 'undefined → png');

// ───────────────────────────────────────────────────────────────────────────
// mediaFieldsToRow — camelCase → snake_case, only provided keys (lock against
// a column-name typo silently dropping a write field).
// ───────────────────────────────────────────────────────────────────────────
const full = mediaFieldsToRow({
  projectId: 'p1', filename: 'a.mov', displayName: 'A', mimeType: 'video/quicktime',
  sizeBytes: 123, durationSeconds: 9.5, storageBucket: 'media', storagePath: 'p1/a.mov',
  width: 1920, height: 1080, fps: 23.976, audioChannels: 2, audioSampleRate: 48000,
  waveform: [0, 1], transcriptionStatus: 'pending', transcriptionProvider: 'deepgram',
  transcriptionError: null, transcriptionStartedAt: 't0', transcriptionCompletedAt: 't1',
  transcriptionProgress: 50, sourceLanguage: 'en', transcodeStatus: 'pending',
  transcodePath: 'p1/a.mp4', uploadedBy: 'u1',
});
const expectKeys = [
  'project_id', 'filename', 'display_name', 'mime_type', 'size_bytes', 'duration_seconds',
  'storage_bucket', 'storage_path', 'width', 'height', 'fps', 'audio_channels',
  'audio_sample_rate', 'waveform', 'transcription_status', 'transcription_provider',
  'transcription_error', 'transcription_started_at', 'transcription_completed_at',
  'transcription_progress', 'source_language', 'transcode_status', 'transcode_path', 'uploaded_by',
];
for (const k of expectKeys) ok(k in full, `mediaFieldsToRow maps → ${k}`);
eq(full.project_id, 'p1', 'project_id value');
eq(full.fps, 23.976, 'fps value preserved');
eq(full.transcode_status, 'pending', 'transcode_status value');
// Only provided keys appear (partial update doesn't clobber).
const partial = mediaFieldsToRow({ transcriptionStatus: 'done' });
eq(Object.keys(partial).length, 1, 'partial → single key');
eq(partial.transcription_status, 'done', 'partial → correct key/value');
// transcriptionError: null IS a provided key (explicit clear) — must be kept.
ok('transcription_error' in mediaFieldsToRow({ transcriptionError: null }), 'explicit null error kept');
// Empty / no-arg → empty row, no throw.
eq(Object.keys(mediaFieldsToRow({})).length, 0, 'empty fields → empty row');
eq(Object.keys(mediaFieldsToRow()).length, 0, 'no arg → empty row (no throw)');

console.log(`media-rules: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of fails) console.log('  ✗', m); process.exit(1); }
