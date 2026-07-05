// Tests for api/_lib/walden-image-input.js — the Walden render/chat image
// front door. Imports the REAL shipped functions (no drift-prone mirror).
//
// Headline bug locked: a `data:image/jpg;base64,...` reference image used to
// emit mimeType "image/jpg", which Gemini's inlineData rejects with an opaque
// 400 — so a JPEG pasted with the "jpg" spelling silently broke the render.
// The fix normalizes the subtype to the canonical "image/jpeg".

import {
  parseImageInput,
  normalizeImageMime,
  attachInlineImages,
  MAX_INLINE_IMAGE_BASE64,
} from './walden-image-input.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`FAIL: ${msg}\n   expected: ${e}\n   actual:   ${a}`); }
}

// ── normalizeImageMime ──────────────────────────────────────────────────────
eq(normalizeImageMime('image/jpg'), 'image/jpeg', 'jpg -> jpeg (the fix)');
eq(normalizeImageMime('image/JPG'), 'image/jpeg', 'JPG (upper) -> jpeg');
eq(normalizeImageMime('IMAGE/JpG'), 'image/jpeg', 'mixed case -> jpeg');
eq(normalizeImageMime('image/jpeg'), 'image/jpeg', 'jpeg stays jpeg');
eq(normalizeImageMime('image/png'), 'image/png', 'png unchanged');
eq(normalizeImageMime('image/webp'), 'image/webp', 'webp unchanged');
eq(normalizeImageMime('image/JPEG'), 'image/jpeg', 'JPEG lowercased, unchanged subtype');
eq(normalizeImageMime(''), '', 'empty -> empty');
eq(normalizeImageMime(null), '', 'null -> empty string (no throw)');
eq(normalizeImageMime(undefined), '', 'undefined -> empty string');

// ── parseImageInput: the fix on data URLs ───────────────────────────────────
eq(parseImageInput('data:image/jpg;base64,QUJDREVG'),
   { mimeType: 'image/jpeg', dataBase64: 'QUJDREVG' },
   'data:image/jpg -> normalized image/jpeg (THE FIX)');
eq(parseImageInput('data:image/JPG;base64,QUJDREVG'),
   { mimeType: 'image/jpeg', dataBase64: 'QUJDREVG' },
   'data:image/JPG (upper) -> image/jpeg');
eq(parseImageInput('data:IMAGE/Jpg;base64,QUJD'),
   { mimeType: 'image/jpeg', dataBase64: 'QUJD' },
   'mixed-case data url scheme -> image/jpeg');

// ── parseImageInput: already-canonical data URLs unchanged ──────────────────
eq(parseImageInput('data:image/jpeg;base64,WFla'),
   { mimeType: 'image/jpeg', dataBase64: 'WFla' },
   'image/jpeg passes through');
eq(parseImageInput('data:image/png;base64,iVBORw0K'),
   { mimeType: 'image/png', dataBase64: 'iVBORw0K' },
   'image/png passes through');
eq(parseImageInput('data:image/webp;base64,UklGRg'),
   { mimeType: 'image/webp', dataBase64: 'UklGRg' },
   'image/webp passes through');
eq(parseImageInput('data:image/PNG;base64,iVBORw0K'),
   { mimeType: 'image/png', dataBase64: 'iVBORw0K' },
   'uppercase PNG lowercased to image/png');

// ── parseImageInput: payload preserved verbatim, only mime normalized ───────
eq(parseImageInput('data:image/jpg;base64,AAAA/BBB+CCC=='),
   { mimeType: 'image/jpeg', dataBase64: 'AAAA/BBB+CCC==' },
   'base64 payload (with +/=) kept byte-for-byte');

// ── parseImageInput: raw base64 branch (assumes png) ────────────────────────
const rawB64 = 'A'.repeat(40); // > 32, all base64-legal
eq(parseImageInput(rawB64),
   { mimeType: 'image/png', dataBase64: rawB64 },
   'long raw base64 -> image/png');
eq(parseImageInput('  ' + rawB64 + '  '),
   { mimeType: 'image/png', dataBase64: rawB64 },
   'raw base64 trimmed');
eq(parseImageInput('AAA\nBBB\nCCC' + 'D'.repeat(30)),
   { mimeType: 'image/png', dataBase64: 'AAABBBCCC' + 'D'.repeat(30) },
   'whitespace stripped from raw base64');

// ── parseImageInput: rejections ─────────────────────────────────────────────
eq(parseImageInput(''), null, 'empty string -> null');
eq(parseImageInput('   '), null, 'whitespace only -> null');
eq(parseImageInput(null), null, 'null -> null');
eq(parseImageInput(undefined), null, 'undefined -> null');
eq(parseImageInput(12345), null, 'number -> null');
eq(parseImageInput({}), null, 'object -> null');
eq(parseImageInput('short'), null, 'short non-data string -> null (<= 32)');
eq(parseImageInput('A'.repeat(32)), null, 'exactly 32 chars -> null (needs > 32)');
eq(parseImageInput('data:image/gif;base64,R0lGODlh'), null,
   'gif not in allow-list -> null');
eq(parseImageInput('data:text/plain;base64,aGVsbG8='), null,
   'non-image data url -> null');
eq(parseImageInput('hello world this is not base64 !!!'), null,
   'string with illegal base64 chars -> null');

// ── RED proof: reconstruct the OLD inline parser and show it leaked image/jpg
function oldParseImageInput(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const s = input.trim();
  const dataUrl = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(s);
  if (dataUrl) {
    return { mimeType: dataUrl[1].toLowerCase(), dataBase64: dataUrl[2] };
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 32) {
    return { mimeType: 'image/png', dataBase64: s.replace(/\s/g, '') };
  }
  return null;
}
eq(oldParseImageInput('data:image/jpg;base64,QUJD').mimeType, 'image/jpg',
   'RED PROOF: old parser emitted the invalid image/jpg');
eq(parseImageInput('data:image/jpg;base64,QUJD').mimeType, 'image/jpeg',
   'GREEN: new parser emits canonical image/jpeg for the same input');
// And the canonical-MIME guarantee that matters to Gemini: parseImageInput
// must NEVER return a mimeType outside Gemini's image allow-list.
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);
for (const url of [
  'data:image/jpg;base64,QUJD', 'data:image/JPG;base64,QUJD',
  'data:image/jpeg;base64,QUJD', 'data:image/png;base64,QUJD',
  'data:image/webp;base64,QUJD',
]) {
  const r = parseImageInput(url);
  eq(ALLOWED.has(r.mimeType), true, `mimeType in allow-list for ${url.split(';')[0]}`);
}

// ── attachInlineImages: the oversized-image "answers blind" bug ─────────────
// The chat handler kept talking after silently dropping an oversized reference
// photo, so the model answered as if none were attached. attachInlineImages now
// reports the drop count so the caller can tell the model to surface it.
const dataUrl = (b64) => `data:image/png;base64,${b64}`;
const small = 'A'.repeat(100);                                   // well under cap
const oversized = 'B'.repeat(MAX_INLINE_IMAGE_BASE64 + 1);       // 1 char over cap → dropped
const atCap = 'C'.repeat(MAX_INLINE_IMAGE_BASE64);               // exactly cap → kept (boundary)

// happy path: every image fits → all parts, zero dropped (byte-identical shape)
{
  const r = attachInlineImages([dataUrl(small), dataUrl(small)]);
  eq(r.dropped, 0, 'two small images: nothing dropped');
  eq(r.parts.length, 2, 'two small images: two inlineData parts');
  eq(r.parts[0], { inlineData: { mimeType: 'image/png', data: small } },
     'part shape matches the former inline push exactly');
}

// THE BUG, LOCKED: an oversized image is counted as dropped, not silently lost
{
  const r = attachInlineImages([dataUrl(small), dataUrl(oversized)]);
  eq(r.dropped, 1, 'BUG LOCK: oversized image is counted as dropped (not silent)');
  eq(r.parts.length, 1, 'oversized image is NOT sent inline; the small one is');
  eq(r.parts[0].inlineData.data, small, 'the surviving part is the small image');
}

// boundary: exactly at the cap is KEPT (matches old `length < cap` → drop when >)
{
  const r = attachInlineImages([dataUrl(atCap)]);
  eq(r.dropped, 0, 'image exactly at the cap is kept (boundary matches old check)');
  eq(r.parts.length, 1, 'at-cap image produces a part');
}

// unparseable / non-image entries are skipped SILENTLY — not counted as oversized
{
  const r = attachInlineImages(['', null, 'short', 'data:image/gif;base64,R0lGODlh', 12345, dataUrl(small)]);
  eq(r.dropped, 0, 'malformed entries are skipped, NOT counted as too-large');
  eq(r.parts.length, 1, 'only the one valid small image survives');
}

// all oversized → no parts, full count (this is the "answers blind" case)
{
  const r = attachInlineImages([dataUrl(oversized), dataUrl(oversized)]);
  eq(r.dropped, 2, 'both oversized → dropped count is 2');
  eq(r.parts.length, 0, 'both oversized → no inlineData parts');
}

// non-array / empty inputs degrade cleanly
eq(attachInlineImages(null), { parts: [], dropped: 0 }, 'null images → empty result');
eq(attachInlineImages(undefined), { parts: [], dropped: 0 }, 'undefined images → empty result');
eq(attachInlineImages([]), { parts: [], dropped: 0 }, 'empty array → empty result');

// RED proof: the OLD inline loop silently dropped the oversized image with no
// signal at all — the caller had no way to know a photo went missing.
{
  function oldAttach(images) {
    const parts = [];
    const imgs = Array.isArray(images) ? images.slice(0, 4) : [];
    for (const im of imgs) {
      const p = parseImageInput(im);
      if (p && p.dataBase64.length < 8 * 1024 * 1024 * 1.4) {
        parts.push({ inlineData: { mimeType: p.mimeType, data: p.dataBase64 } });
      }
    }
    return parts; // <-- no dropped count: the bug
  }
  const oldParts = oldAttach([dataUrl(small), dataUrl(oversized)]);
  eq(oldParts.length, 1, 'RED PROOF: old loop dropped the oversized image…');
  eq(typeof oldParts.dropped, 'undefined', '…and reported NOTHING about the drop (the bug)');
  // GREEN: new helper keeps the exact same parts but ALSO reports the drop.
  const nu = attachInlineImages([dataUrl(small), dataUrl(oversized)]);
  eq(nu.parts.length, oldParts.length, 'GREEN: same surviving parts as the old loop');
  eq(nu.dropped, 1, 'GREEN: and now the drop is reported');
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`walden-image-input: ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join('\n')); process.exit(1); }
