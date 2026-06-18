// ============================================================================
// /api/_lib/image-storage.js
//
// Derive a SAFE { mime, ext } pair for an image we are about to PUT into a
// PUBLIC Supabase Storage bucket and serve from the CDN. Shared by every
// public-bucket image upload: qss-image-upload (qss-scenes), qss-cast
// (qss-cast), qss-scene-illustrate (qss-scenes), qss-explorer (qss-explorer).
//
// Two jobs, both load-bearing because the bucket is public ("anyone with the
// URL can read"):
//
//   1. SECURITY — qss-image-upload accepts an arbitrary client-supplied
//      `mimeType` and previously passed it STRAIGHT into the upload's
//      Content-Type header. A client could send `mimeType: "text/html"` (or
//      `image/svg+xml`) plus matching bytes and get an HTML/SVG file served
//      from the public CDN with that Content-Type → it renders as a document
//      in the browser (stored content-type injection). Coercing anything
//      outside a tight image allow-list to a safe default closes that.
//
//   2. CONSISTENCY — the storage path's file extension and the served
//      Content-Type are derived from the SAME normalized mime here, so they
//      can never disagree (the old code derived ext via `.includes('jpeg')`,
//      which missed the non-canonical "image/jpg" spelling and uppercase mimes
//      and could file a JPEG at a `.png` path).
//
// Reuses normalizeImageMime (the single source of truth for the jpg -> jpeg +
// lowercase normalization, shared with the Gemini image-input path).
// ============================================================================

import { normalizeImageMime } from './walden-image-input.js';

// The ONLY image types we will store + serve from the public bucket, mapped to
// their canonical file extension. Anything else is coerced to the safe default.
const ALLOWED = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const DEFAULT_MIME = 'image/png';

export function imageStorageMeta(rawMime) {
  // Trim first so " image/png " from a sloppy client still resolves; then
  // normalizeImageMime lowercases + maps image/jpg -> image/jpeg.
  const mime = normalizeImageMime(String(rawMime ?? '').trim());
  if (ALLOWED[mime]) return { mime, ext: ALLOWED[mime] };
  return { mime: DEFAULT_MIME, ext: ALLOWED[DEFAULT_MIME] };
}
