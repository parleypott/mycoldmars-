// ============================================================================
// /api/_lib/walden-image-input.js
//
// Parse a user-supplied reference image (a data URL or raw base64) into the
// { mimeType, dataBase64 } shape Gemini's inlineData expects. Used by the
// Walden landscape studio's render + chat handlers, which push the returned
// mimeType STRAIGHT into the Gemini request:
//   userParts.push({ inlineData: { mimeType: p.mimeType, data: p.dataBase64 } })
//
// IMPORTANT: the data-URL regex deliberately accepts the "jpg" spelling
// (jpe?g) because real-world tools emit `data:image/jpg;base64,...` — but
// "image/jpg" is NOT a MIME type Gemini's inlineData accepts. Its image
// allow-list is image/png, image/jpeg, image/webp (+ heic/heif). Passing
// "image/jpg" verbatim makes Gemini reject the whole render with an opaque
// 400 "Unsupported MIME type". So the accept-side (regex) and the emit-side
// (mimeType) MUST agree: normalize the subtype to the canonical MIME type.
// ============================================================================

// Map the captured/declared subtype to the canonical MIME type Gemini accepts.
// Only "image/jpg" is non-canonical among the shapes the regex admits.
export function normalizeImageMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m === 'image/jpg') return 'image/jpeg';
  return m;
}

export function parseImageInput(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const s = input.trim();
  const dataUrl = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(s);
  if (dataUrl) {
    return { mimeType: normalizeImageMime(dataUrl[1]), dataBase64: dataUrl[2] };
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 32) {
    return { mimeType: 'image/png', dataBase64: s.replace(/\s/g, '') };
  }
  return null;
}

// Gemini's practical inline-image cap: ~8MB of source bytes, which is ~1.4× as
// many base64 chars. Kept as one constant so the chat + render handlers agree.
export const MAX_INLINE_IMAGE_BASE64 = Math.floor(8 * 1024 * 1024 * 1.4);

// Turn a list of user-attached reference images into the Gemini `inlineData`
// parts, dropping any that are too large to send inline. Returns the parts AND
// a COUNT of how many were dropped for being oversized.
//
// Why the count matters: the render handler answers an oversized image with a
// hard 413, but the chat handler keeps talking — so if we silently drop the
// photo, the model answers "blind," as if the homeowner never attached anything
// ("I don't see a reference image"). Returning `dropped` lets the caller tell
// the model to surface it instead. An unparseable / non-image entry is skipped
// silently (it's malformed input, not a too-large photo) and is NOT counted.
//
// Boundary matches the former inline check exactly. The old code kept an image
// when `length < 8*1024*1024*1.4` (11744051.2); for an integer base64 length
// that is `length <= 11744051`, i.e. drop when `length > 11744051` — which is
// exactly `length > MAX_INLINE_IMAGE_BASE64` (the floored constant).
export function attachInlineImages(images, maxBase64Len = MAX_INLINE_IMAGE_BASE64) {
  const parts = [];
  let dropped = 0;
  const list = Array.isArray(images) ? images : [];
  for (const im of list) {
    const p = parseImageInput(im);
    if (!p) continue;
    if (p.dataBase64.length > maxBase64Len) { dropped++; continue; }
    parts.push({ inlineData: { mimeType: p.mimeType, data: p.dataBase64 } });
  }
  return { parts, dropped };
}
