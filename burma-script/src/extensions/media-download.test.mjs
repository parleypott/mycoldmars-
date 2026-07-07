// Locks the pure DECISIONS behind the media-lightbox download button — Johnny's
// "⇩ DOWNLOAD MP4" feature that pulls a rack still/video/gif out of the script and into
// his edit suite (blocks.js downloadMediaFromLightbox, shipped 2026-07-07). The download
// itself is DOM+fetch (can't run headless), but three pure string decisions drive it and
// were shipping untested:
//   1. isMotionSrc      — button label: "⇩ DOWNLOAD MP4" (motion) vs "⇩ DOWNLOAD" (still)
//   2. mediaDownloadBase — the sanitized filename stem from the caption
//   3. mediaDownloadExt  — the file extension (path first, MIME fallback, never a bare .bin
//                          when the type is actually known)
//
// Each guard below is mutation-proven: a reconstructed "buggy" variant is asserted to
// produce a DIFFERENT (wrong) result, so if someone loosens the real code to match the
// buggy form, the paired assertion flips RED.
//
// Runner note: runs under `bun <file>` (scripts/run-tests.mjs); inline pass/fail counter.

import assert from 'node:assert/strict';
import { isMotionSrc, mediaDownloadBase, mediaDownloadExt } from './blocks.js';

let pass = 0, fail = 0;
function ok(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } }

// ── 1: isMotionSrc — the button-label fork ──────────────────────────────────────────────
ok('isMotionSrc: mp4 and gif are motion; stills are not; query/hash tolerant', () => {
  assert.equal(isMotionSrc('https://cdn/clip.mp4'), true, 'mp4 → motion');
  assert.equal(isMotionSrc('https://cdn/loop.gif'), true, 'gif → motion (transcodes on the way down)');
  assert.equal(isMotionSrc('https://cdn/CLIP.MP4'), true, 'case-insensitive mp4');
  assert.equal(isMotionSrc('https://cdn/LOOP.GIF'), true, 'case-insensitive gif');
  assert.equal(isMotionSrc('https://cdn/clip.mp4?token=abc#t=1'), true, 'query+hash tolerant');
  assert.equal(isMotionSrc('https://cdn/loop.gif?v=2'), true, 'gif with query');
  assert.equal(isMotionSrc('https://cdn/shot.png'), false, 'png → still');
  assert.equal(isMotionSrc('https://cdn/shot.jpg'), false, 'jpg → still');
  assert.equal(isMotionSrc(''), false, 'empty → still');
  assert.equal(isMotionSrc(null), false, 'null → still, no throw');
  // A src that merely CONTAINS "gif"/"mp4" mid-path is NOT motion — the marker must be the
  // real path extension, not a substring of the filename.
  assert.equal(isMotionSrc('https://cdn/gifford.png'), false, '"gif" in the stem ≠ a gif');
  assert.equal(isMotionSrc('https://cdn/mp4-guide.png'), false, '"mp4" in the stem ≠ a video');
});

// ── 2: mediaDownloadBase — the filename stem ────────────────────────────────────────────
ok('mediaDownloadBase: caption → filesystem-safe slug, capped, never empty', () => {
  assert.equal(mediaDownloadBase('Border crossing, dawn'), 'Border-crossing-dawn', 'spaces+comma → single dashes');
  assert.equal(mediaDownloadBase('  spaced  '), 'spaced', 'outer whitespace trimmed away');
  assert.equal(mediaDownloadBase('!!!'), 'script-media', 'all-punctuation → fallback, not ""');
  assert.equal(mediaDownloadBase(''), 'script-media', 'empty caption → fallback');
  assert.equal(mediaDownloadBase(null), 'script-media', 'null → fallback, no throw');
  assert.equal(mediaDownloadBase('a/b\\c:d'), 'a-b-c-d', 'path separators sanitized (no dir traversal)');
  assert.equal(mediaDownloadBase('__keep_word_chars__'), '__keep_word_chars__', 'underscores are word chars — kept, incl. at edges (only dashes are edge-stripped)');
  assert.equal(mediaDownloadBase('-dashy-'), 'dashy', 'edge dashes (not underscores) are stripped');
});

ok('mediaDownloadBase: MUTATION — the 60-char cap is load-bearing', () => {
  const long = 'x'.repeat(200);
  assert.equal(mediaDownloadBase(long).length, 60, 'capped to 60 chars');
  // buggy variant with no slice() would keep all 200 — proves the cap matters
  const buggy = (String(long || '').trim() || 'script-media').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'script-media';
  assert.notEqual(buggy.length, mediaDownloadBase(long).length, 'uncapped form differs (200 ≠ 60)');
});

ok('mediaDownloadBase: MUTATION — the leading/trailing-dash strip is load-bearing', () => {
  assert.equal(mediaDownloadBase('— dash edges —'), 'dash-edges', 'edge dashes stripped');
  // buggy variant without the ^-+|-+$ strip keeps the edge dashes
  const buggy = (String('— dash edges —').trim() || 'script-media').replace(/[^\w-]+/g, '-').slice(0, 60) || 'script-media';
  assert.notEqual(buggy, mediaDownloadBase('— dash edges —'), 'unstripped form differs (has edge dashes)');
});

// ── 3: mediaDownloadExt — path first, MIME fallback, bin last ────────────────────────────
ok('mediaDownloadExt: prefers the src path extension, case-insensitive, query/hash tolerant', () => {
  assert.equal(mediaDownloadExt('https://cdn/clip.mp4', 'video/mp4'), 'mp4');
  assert.equal(mediaDownloadExt('https://cdn/shot.PNG', 'image/png'), 'png', 'lowercased');
  assert.equal(mediaDownloadExt('https://cdn/pic.jpeg?token=abc', 'image/jpeg'), 'jpeg', 'query stripped before ext read');
  assert.equal(mediaDownloadExt('https://cdn/pic.webp#x', 'image/webp'), 'webp', 'hash stripped');
  // path ALWAYS wins over MIME — even a mismatched declared type can't override the real name
  assert.equal(mediaDownloadExt('https://cdn/real.png', 'application/octet-stream'), 'png', 'path beats a junk MIME');
});

ok('mediaDownloadExt: MUTATION — MIME fallback saves an extensionless CDN src from ".bin"', () => {
  // A signed/extensionless URL: the path carries no extension, but the served MIME is known.
  assert.equal(mediaDownloadExt('https://cdn/storage/object/abc123', 'image/png'), 'png', 'png from MIME');
  assert.equal(mediaDownloadExt('https://cdn/storage/object/abc123?token=x', 'image/jpeg'), 'jpg', 'jpeg MIME → jpg');
  assert.equal(mediaDownloadExt('https://cdn/storage/object/abc123', 'video/mp4'), 'mp4', 'mp4 from MIME');
  assert.equal(mediaDownloadExt('https://cdn/storage/object/abc123', 'image/gif'), 'gif', 'gif from MIME');
  assert.equal(mediaDownloadExt('https://cdn/storage/object/abc123', 'image/webp; charset=x'), 'webp', 'MIME params ignored');
  // the OLD inline form (no MIME fallback) would hand this ".bin" — the whole point of the fix
  const oldForm = (String('https://cdn/storage/object/abc123').split(/[?#]/, 1)[0].match(/\.(\w{2,4})$/) || [, 'bin'])[1].toLowerCase();
  assert.equal(oldForm, 'bin', 'old inline form yields the useless .bin');
  assert.notEqual(mediaDownloadExt('https://cdn/storage/object/abc123', 'image/png'), oldForm, 'new form recovers a real ext');
});

ok('mediaDownloadExt: bin only when BOTH path and MIME are absent/unknown', () => {
  assert.equal(mediaDownloadExt('https://cdn/storage/object/abc123', ''), 'bin', 'no ext, no MIME → bin');
  assert.equal(mediaDownloadExt('https://cdn/storage/object/abc123', 'application/x-weird'), 'bin', 'unknown MIME → bin');
  assert.equal(mediaDownloadExt('', ''), 'bin', 'empty everything → bin, no throw');
  assert.equal(mediaDownloadExt(null, null), 'bin', 'null everything → bin, no throw');
});

if (fail) { console.error(`media-download.test.mjs: ${fail} FAILED, ${pass} passed`); process.exit(1); }
console.log(`media-download.test.mjs: ${pass} assertions passed`);
