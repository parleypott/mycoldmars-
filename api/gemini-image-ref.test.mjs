// Tests for the shared Gemini-image-ref guard (api/_lib/gemini-image-ref.js).
//
// The bug being locked: the old inline guards in qss-character-card.js and
// qss-character-compare.js admitted "image/jpg" and "image/gif" and then handed
// the mime to Gemini's inlineData VERBATIM. Gemini's image-input allow-list is
// png/jpeg/webp — so a jpg- or gif-tagged reference image 400'd the WHOLE
// portrait / compare request. The shared guard normalizes jpg→jpeg and drops
// gif before it can reach Gemini.
//
// Run: node api/gemini-image-ref.test.mjs   (or via `bun run test`)

import { safeImageRef } from './_lib/gemini-image-ref.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

const B64 = 'aGVsbG93b3JsZGRhdGE='.repeat(4); // a comfortably-valid base64 blob

// ── The fix: jpg is normalized to canonical jpeg ───────────────────────────
{
  const r = safeImageRef({ mimeType: 'image/jpg', dataBase64: B64 });
  ok(r !== null, 'jpg ref is accepted (not dropped)');
  eq(r && r.mimeType, 'image/jpeg', 'image/jpg normalized to image/jpeg');
}
{
  const r = safeImageRef({ mimeType: 'image/JPG', dataBase64: B64 });
  eq(r && r.mimeType, 'image/jpeg', 'image/JPG (uppercase) normalized to image/jpeg');
}
{
  const r = safeImageRef({ mimeType: 'image/jpeg', dataBase64: B64 });
  eq(r && r.mimeType, 'image/jpeg', 'image/jpeg passes through unchanged');
}

// ── The fix: gif is Gemini-unsupported → dropped, not fatal ─────────────────
{
  const r = safeImageRef({ mimeType: 'image/gif', dataBase64: B64 });
  eq(r, null, 'image/gif is dropped (Gemini does not accept it)');
}

// ── Hard guarantee: NEVER emit a mime outside Gemini's image-input set ──────
{
  const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const probes = [
    'image/png', 'image/PNG', 'image/jpg', 'image/JPG', 'image/jpeg',
    'image/webp', 'image/WEBP', 'image/gif', 'image/svg+xml', 'image/heic',
    'image/heif', 'image/bmp', 'image/tiff', 'text/plain', 'application/json',
    '', 'png', 'jpeg',
  ];
  let allOk = true;
  for (const m of probes) {
    const r = safeImageRef({ mimeType: m, dataBase64: B64 });
    if (r !== null && !ALLOWED.has(r.mimeType)) allOk = false;
  }
  ok(allOk, 'guarantee: safeImageRef never emits a mime outside {png,jpeg,webp}');
}

// ── Common path: png passes, canonical + lowercased ─────────────────────────
{
  const r = safeImageRef({ mimeType: 'image/png', dataBase64: B64 });
  ok(r !== null, 'png ref accepted');
  eq(r && r.mimeType, 'image/png', 'png mime preserved');
  eq(r && r.dataBase64, B64, 'png base64 preserved byte-for-byte');
}
{
  const r = safeImageRef({ mimeType: 'image/PNG', dataBase64: B64 });
  eq(r && r.mimeType, 'image/png', 'image/PNG lowercased to image/png');
}
{
  const r = safeImageRef({ mimeType: 'image/webp', dataBase64: B64 });
  eq(r && r.mimeType, 'image/webp', 'webp passes through');
}

// ── Default mime when none declared ─────────────────────────────────────────
{
  const r = safeImageRef({ dataBase64: B64 });
  eq(r && r.mimeType, 'image/png', 'missing mime defaults to image/png');
}
{
  const r = safeImageRef({ mime: 'image/webp', dataBase64: B64 });
  eq(r && r.mimeType, 'image/webp', 'reads the alternate `mime` field');
}

// ── SSRF guard: any url-like field → null ───────────────────────────────────
for (const field of ['url', 'uri', 'fileUri', 'src']) {
  const r = safeImageRef({ [field]: 'http://169.254.169.254/', dataBase64: B64, mimeType: 'image/png' });
  eq(r, null, `SSRF guard rejects ref carrying a ${field} field`);
}

// ── Shape guard ─────────────────────────────────────────────────────────────
eq(safeImageRef(null), null, 'null → null');
eq(safeImageRef(undefined), null, 'undefined → null');
eq(safeImageRef('a string'), null, 'string → null');
eq(safeImageRef(42), null, 'number → null');
eq(safeImageRef({}), null, 'empty object (no dataBase64) → null');
eq(safeImageRef({ dataBase64: '' }), null, 'empty dataBase64 → null');
eq(safeImageRef({ dataBase64: 123 }), null, 'non-string dataBase64 → null');

// ── Size cap ────────────────────────────────────────────────────────────────
{
  const small = 'A'.repeat(10);
  const cap = 100;
  ok(safeImageRef({ dataBase64: small, mimeType: 'image/png' }, cap) !== null, 'under cap accepted');
  const tooBig = 'A'.repeat(Math.floor(cap * 1.4) + 1);
  eq(safeImageRef({ dataBase64: tooBig, mimeType: 'image/png' }, cap), null, 'over cap (×1.4) rejected');
}

// ── INLINE RED PROOF: reconstruct the OLD inline guard and show its defects ──
// The old guard's mime regex admitted jpg + gif and returned the mime verbatim.
{
  const OLD_MIME = /^image\/(png|jpe?g|webp|gif)$/i;
  function oldSafeRef(raw, maxBytes = 6 * 1024 * 1024) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.url || raw.uri || raw.fileUri || raw.src) return null;
    const dataBase64 = typeof raw.dataBase64 === 'string' ? raw.dataBase64 : '';
    if (!dataBase64 || dataBase64.length > maxBytes * 1.4) return null;
    const mimeType = String(raw.mimeType || raw.mime || 'image/png');
    if (!OLD_MIME.test(mimeType)) return null;
    return { mimeType, dataBase64 };
  }
  const oldJpg = oldSafeRef({ mimeType: 'image/jpg', dataBase64: B64 });
  ok(oldJpg && oldJpg.mimeType === 'image/jpg',
    'RED PROOF: old guard emitted the Gemini-rejected "image/jpg" verbatim');
  const oldGif = oldSafeRef({ mimeType: 'image/gif', dataBase64: B64 });
  ok(oldGif && oldGif.mimeType === 'image/gif',
    'RED PROOF: old guard accepted "image/gif" (Gemini-unsupported → would 400)');

  // Behavior-preserving lock: for every input Gemini WOULD have accepted
  // (png/webp + the common png-default), old and new agree.
  const safeInputs = [
    { mimeType: 'image/png', dataBase64: B64 },
    { mimeType: 'image/webp', dataBase64: B64 },
    { dataBase64: B64 },
  ];
  let preserved = true;
  for (const inp of safeInputs) {
    const a = oldSafeRef(inp), b = safeImageRef(inp);
    if (JSON.stringify(a) !== JSON.stringify(b)) preserved = false;
  }
  ok(preserved, 'behavior-preserving: png/webp/default identical old vs new');
}

console.log(`\ngemini-image-ref: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of fails) console.error('  ✗', m); process.exit(1); }
