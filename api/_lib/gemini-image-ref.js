// ============================================================================
// /api/_lib/gemini-image-ref.js
//
// Validate a client-supplied REFERENCE image (the {mimeType, dataBase64} shape,
// NOT a data URL) before it is pushed straight into a Gemini multimodal request
// as inlineData:
//   parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.dataBase64 } })
//
// Guards, in order:
//   1. shape — must be a plain object
//   2. SSRF — reject anything carrying a url/uri/fileUri/src field (never fetch)
//   3. size — base64 string-length cap (≈ maxBytes of real bytes after expansion)
//   4. MIME — must be on Gemini's ACTUAL image-input allow-list
//
// IMPORTANT (same class as walden-image-input.js): Gemini's inlineData image
// allow-list is image/png, image/jpeg, image/webp (+ heic/heif). It does NOT
// accept "image/jpg" (a real-world spelling some tools emit) and does NOT accept
// "image/gif". The old inline guards in qss-character-card.js and
// qss-character-compare.js admitted both jpg and gif and then handed the mime to
// Gemini verbatim — so a single jpg- or gif-tagged reference image 400'd the
// ENTIRE portrait / compare request with an opaque "Unsupported MIME type".
//
// This consolidated guard fixes that: it normalizes "image/jpg" → "image/jpeg",
// lowercases the mime, and rejects "image/gif" (and anything else) BEFORE it can
// reach Gemini — so an unusable reference is cleanly dropped (the draw still
// happens without it) instead of crashing the whole call.
// ============================================================================

import { normalizeImageMime } from './walden-image-input.js';

const DEFAULT_MAX_REF_BYTES = 6 * 1024 * 1024;

// Gemini inlineData image-input allow-list. "jpg" is admitted at the regex
// (so we can normalize it) but never EMITTED — normalizeImageMime maps it to
// the canonical "image/jpeg". GIF is deliberately absent: Gemini rejects it.
const GEMINI_IMAGE_MIME = /^image\/(png|jpe?g|webp)$/i;

// Validate one reference image. Returns { mimeType, dataBase64 } with a
// canonical, Gemini-accepted mimeType, or null if the ref is unusable.
export function safeImageRef(raw, maxBytes = DEFAULT_MAX_REF_BYTES) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.url || raw.uri || raw.fileUri || raw.src) return null; // SSRF guard
  const dataBase64 = typeof raw.dataBase64 === 'string' ? raw.dataBase64 : '';
  if (!dataBase64 || dataBase64.length > maxBytes * 1.4) return null;
  const declared = String(raw.mimeType || raw.mime || 'image/png');
  if (!GEMINI_IMAGE_MIME.test(declared)) return null; // drops gif + everything off-list
  return { mimeType: normalizeImageMime(declared), dataBase64 };
}
