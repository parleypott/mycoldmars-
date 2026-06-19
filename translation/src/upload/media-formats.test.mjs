// Tests for the media-format upload gate + the gate↔transcode contract.
//
// Bug fixed: media-rules.js `needsTranscode` was taught (this week) to route
// unknown audio (AIFF, WMA) to the worker's playable-proxy path — but the
// upload GATE `isMediaFile` still rejected those formats, so the fix was
// unreachable through the real UI. AND a dropped .aiff with no browser
// file.type flowed through guessMimeFromExt → 'application/octet-stream',
// which is NOT audio/*, so needsTranscode returned not_needed → the file
// silently failed to play in Chrome. This locks both halves end-to-end.
//
// Run: bun translation/src/upload/media-formats.test.mjs

import {
  isMediaFile, sanitizeFilename, guessMimeFromExt, secondsToTimecode,
  SUPPORTED_MEDIA_MIMES, SUPPORTED_MEDIA_EXTS,
} from './media-formats.js';
import { needsTranscode } from '../media-rules.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

const f = (name, type = '') => ({ name, type });

// ──────────────────────────────────────────────────────────────────────
// RED PROOF — reconstruct the OLD gate + guessMime and show the bug.
// ──────────────────────────────────────────────────────────────────────
const OLD_MIMES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav',
  'audio/webm', 'audio/ogg', 'audio/flac',
]);
const OLD_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'mp3', 'm4a', 'wav', 'ogg', 'flac']);
function oldIsMediaFile(file) {
  if (!file) return false;
  if (OLD_MIMES.has(file.type)) return true;
  const ext = (file.name || '').split('.').pop().toLowerCase();
  return OLD_EXTS.has(ext);
}
function oldGuessMime(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const map = {
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  };
  return map[ext] || 'application/octet-stream';
}

// (1) old gate REJECTED Johnny's archival/field-recorder formats.
ok(oldIsMediaFile(f('interview.aiff')) === false, 'RED: old gate rejected .aiff');
ok(oldIsMediaFile(f('archive.wma')) === false, 'RED: old gate rejected .wma');
ok(oldIsMediaFile(f('x', 'audio/aiff')) === false, 'RED: old gate rejected audio/aiff mime');
// (2) old guessMime → octet-stream (NOT audio/*), so the whole chain broke:
eq(oldGuessMime('interview.aiff'), 'application/octet-stream', 'RED: old guessMime(.aiff) → octet-stream');
ok(
  needsTranscode({ mimeType: oldGuessMime('interview.aiff'), filename: 'interview.aiff' }) === false,
  'RED: old chain — AIFF marked not_needed → silent playback failure',
);
ok(
  needsTranscode({ mimeType: oldGuessMime('archive.wma'), filename: 'archive.wma' }) === false,
  'RED: old chain — WMA marked not_needed → silent playback failure',
);

// ──────────────────────────────────────────────────────────────────────
// THE FIX — gate accepts AIFF/WMA (by ext AND by mime).
// ──────────────────────────────────────────────────────────────────────
ok(isMediaFile(f('interview.aiff')), 'gate accepts .aiff by ext');
ok(isMediaFile(f('interview.aif')), 'gate accepts .aif by ext');
ok(isMediaFile(f('archive.wma')), 'gate accepts .wma by ext');
ok(isMediaFile(f('INTERVIEW.AIFF')), 'gate accepts .AIFF case-insensitively');
ok(isMediaFile(f('x', 'audio/aiff')), 'gate accepts audio/aiff mime');
ok(isMediaFile(f('x', 'audio/x-aiff')), 'gate accepts audio/x-aiff mime');
ok(isMediaFile(f('x', 'audio/x-ms-wma')), 'gate accepts audio/x-ms-wma mime');
ok(isMediaFile(f('x', 'audio/wma')), 'gate accepts audio/wma mime');
// a dropped .aiff with NO browser file.type still gets in (the common case):
ok(isMediaFile(f('interview.aiff', '')), 'gate accepts typeless .aiff (no browser mime)');

// guessMime resolves AIFF/WMA to an audio/* mime (the load-bearing property).
eq(guessMimeFromExt('interview.aiff'), 'audio/aiff', 'guessMime(.aiff) → audio/aiff');
eq(guessMimeFromExt('clip.aif'), 'audio/aiff', 'guessMime(.aif) → audio/aiff');
eq(guessMimeFromExt('archive.wma'), 'audio/x-ms-wma', 'guessMime(.wma) → audio/x-ms-wma');
ok(guessMimeFromExt('interview.aiff').startsWith('audio/'), 'guessMime(.aiff) is audio/*');
ok(guessMimeFromExt('archive.wma').startsWith('audio/'), 'guessMime(.wma) is audio/*');

// END-TO-END: gate→mime→transcode now routes AIFF/WMA to the proxy worker.
ok(
  needsTranscode({ mimeType: guessMimeFromExt('interview.aiff'), filename: 'interview.aiff' }) === true,
  'chain: AIFF (typeless) → transcode (playable proxy)',
);
ok(
  needsTranscode({ mimeType: guessMimeFromExt('archive.wma'), filename: 'archive.wma' }) === true,
  'chain: WMA (typeless) → transcode (playable proxy)',
);
// and when the browser DOES supply the mime, the chain still transcodes.
ok(needsTranscode({ mimeType: 'audio/aiff', filename: 'x.aiff' }) === true, 'chain: audio/aiff mime → transcode');
ok(needsTranscode({ mimeType: 'audio/x-ms-wma', filename: 'x.wma' }) === true, 'chain: wma mime → transcode');

// ──────────────────────────────────────────────────────────────────────
// NO REGRESSION — every previously-accepted format still accepted.
// ──────────────────────────────────────────────────────────────────────
for (const ext of ['mp4', 'mov', 'webm', 'mkv', 'mp3', 'm4a', 'wav', 'ogg', 'flac']) {
  ok(isMediaFile(f(`clip.${ext}`)), `gate still accepts .${ext}`);
  ok(SUPPORTED_MEDIA_EXTS.has(ext), `ext set still has ${ext}`);
}
for (const m of [...OLD_MIMES]) {
  ok(isMediaFile(f('x', m)), `gate still accepts mime ${m}`);
  ok(SUPPORTED_MEDIA_MIMES.has(m), `mime set still has ${m}`);
}
// guessMime unchanged for every pre-existing ext.
eq(guessMimeFromExt('a.mp4'), 'video/mp4', 'guessMime(.mp4) unchanged');
eq(guessMimeFromExt('a.mov'), 'video/quicktime', 'guessMime(.mov) unchanged');
eq(guessMimeFromExt('a.mp3'), 'audio/mpeg', 'guessMime(.mp3) unchanged');
eq(guessMimeFromExt('a.m4a'), 'audio/mp4', 'guessMime(.m4a) unchanged');
eq(guessMimeFromExt('a.wav'), 'audio/wav', 'guessMime(.wav) unchanged');
eq(guessMimeFromExt('a.flac'), 'audio/flac', 'guessMime(.flac) unchanged');

// Non-media still rejected; junk inputs safe.
for (const ext of ['txt', 'csv', 'json', 'pdf', 'jpg', 'png', 'exe', 'zip', 'srt']) {
  ok(!isMediaFile(f(`x.${ext}`)), `gate still rejects .${ext}`);
}
ok(!isMediaFile(null), 'gate rejects null');
ok(!isMediaFile(undefined), 'gate rejects undefined');
ok(!isMediaFile(f('')), 'gate rejects empty name');
ok(!isMediaFile(f('noext')), 'gate rejects extensionless unknown');
eq(guessMimeFromExt('weird.xyz'), 'application/octet-stream', 'guessMime unknown → octet-stream');
eq(guessMimeFromExt(''), 'application/octet-stream', 'guessMime empty → octet-stream');

// ──────────────────────────────────────────────────────────────────────
// sanitizeFilename + secondsToTimecode (pure helpers, locked while here).
// ──────────────────────────────────────────────────────────────────────
eq(sanitizeFilename('my interview (final).mov'), 'my_interview_final_.mov', 'sanitize strips+collapses');
eq(sanitizeFilename('clé café 日本.wav'), 'cl_caf_.wav', 'sanitize unicode runs → single _');
eq(sanitizeFilename('a@@@b'), 'a_b', 'sanitize collapses run to one _');
eq(sanitizeFilename('keep.under_score-dash.mp4'), 'keep.under_score-dash.mp4', 'sanitize keeps . _ -');
eq(sanitizeFilename(''), 'media', 'sanitize empty → media');
eq(sanitizeFilename(null), 'media', 'sanitize null → media');
ok(sanitizeFilename('x'.repeat(300) + '.mp4').length <= 180, 'sanitize caps at 180 chars (keeps tail)');
ok(sanitizeFilename('x'.repeat(300) + '.mp4').endsWith('.mp4'), 'sanitize keeps the extension tail');

eq(secondsToTimecode(0), '00:00:00.000', 'tc 0');
eq(secondsToTimecode(61.5), '00:01:01.500', 'tc minute+frac');
eq(secondsToTimecode(3661.25), '01:01:01.250', 'tc hour carry');
eq(secondsToTimecode(7325), '02:02:05.000', 'tc multi-hour');
eq(secondsToTimecode(-5), '00:00:00.000', 'tc negative clamps to 0');
eq(secondsToTimecode(NaN), '00:00:00.000', 'tc NaN → default');
eq(secondsToTimecode(Infinity), '00:00:00.000', 'tc Infinity → default');
eq(secondsToTimecode('12'), '00:00:00.000', 'tc non-number → default');

console.log(`\nmedia-formats: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
