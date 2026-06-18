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
