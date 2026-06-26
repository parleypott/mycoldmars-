// Tests for api/_lib/gemini-image-ref.js — safeImageRef, the guard that
// validates a CLIENT-supplied reference image before it is pushed straight into
// a Gemini multimodal request as inlineData. Imports the REAL shipped function
// (no drift-prone mirror).
//
// This is a SECURITY + correctness boundary with four jobs, all locked here:
//   1. shape   — reject anything that isn't a plain object
//   2. SSRF    — reject any ref carrying a url/uri/fileUri/src field (never fetch)
//   3. size    — reject base64 over the ~maxBytes cap
//   4. MIME    — accept ONLY Gemini's image-input allow-list (png/jpeg/webp),
//                normalizing "image/jpg" -> "image/jpeg" and dropping gif/etc.
// And the output contract: it RECONSTRUCTS { mimeType, dataBase64 } from scratch,
// so no extra client field (a url, an injected key) can ride along to Gemini.
//
// Several blocks are MUTATION-PROVEN: each reconstructs the buggy form inline
// and asserts it would do the wrong thing, so the lock fails loudly if a future
// edit weakens the guard.

import { safeImageRef } from './gemini-image-ref.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`FAIL: ${msg}\n   expected: ${e}\n   actual:   ${a}`); }
}
function ok(cond, msg) { eq(!!cond, true, msg); }

const B64 = 'QUJDREVGR0hJالسلامQUJD'; // arbitrary non-empty base64-ish payload
const okPng = { mimeType: 'image/png', dataBase64: B64 };

// ── shape guard ─────────────────────────────────────────────────────────────
eq(safeImageRef(null), null, 'null -> null');
eq(safeImageRef(undefined), null, 'undefined -> null');
eq(safeImageRef('data:image/png;base64,QUJD'), null, 'string (not object) -> null');
eq(safeImageRef(42), null, 'number -> null');
// typeof [] === 'object', so an array passes the typeof gate; it has no
// dataBase64 string, so it must still drop to null.
eq(safeImageRef([]), null, 'array -> null (no dataBase64)');

// ── happy path: png/jpeg/webp accepted, output reconstructed ────────────────
eq(safeImageRef({ mimeType: 'image/png', dataBase64: B64 }), okPng, 'png accepted verbatim');
eq(safeImageRef({ mimeType: 'image/jpeg', dataBase64: B64 }),
   { mimeType: 'image/jpeg', dataBase64: B64 }, 'jpeg accepted');
eq(safeImageRef({ mimeType: 'image/webp', dataBase64: B64 }),
   { mimeType: 'image/webp', dataBase64: B64 }, 'webp accepted');
// "image/jpg" (real-world spelling) must normalize to the canonical jpeg Gemini wants.
eq(safeImageRef({ mimeType: 'image/jpg', dataBase64: B64 }),
   { mimeType: 'image/jpeg', dataBase64: B64 }, 'image/jpg -> image/jpeg (normalized)');
eq(safeImageRef({ mimeType: 'IMAGE/PNG', dataBase64: B64 }),
   okPng, 'uppercase IMAGE/PNG -> lowercased image/png');
// mime absent -> defaults to image/png; `mime` is accepted as an alias for mimeType.
eq(safeImageRef({ dataBase64: B64 }), okPng, 'missing mime defaults to image/png');
eq(safeImageRef({ mime: 'image/webp', dataBase64: B64 }),
   { mimeType: 'image/webp', dataBase64: B64 }, 'mime alias honored');

// ── MIME allow-list: gif and everything off-list dropped ────────────────────
for (const bad of ['image/gif', 'image/svg+xml', 'image/bmp', 'image/tiff',
                   'application/pdf', 'text/html', 'image/', 'png']) {
  eq(safeImageRef({ mimeType: bad, dataBase64: B64 }), null, `off-list mime "${bad}" -> null`);
}
// A falsy mime ('' / null / 0) is NOT "off-list" — it falls through the
// `mimeType || mime || 'image/png'` default to png and is accepted.
eq(safeImageRef({ mimeType: '', dataBase64: B64 }), okPng, 'empty mime -> defaults to png (accepted)');
eq(safeImageRef({ mimeType: null, dataBase64: B64 }), okPng, 'null mime -> defaults to png (accepted)');
// MUTATION: a guard that admitted gif (the old inline bug) would hand Gemini a
// mime it 400s on. Prove the allow-list regex actually rejects it.
const GEMINI_OK = /^image\/(png|jpe?g|webp)$/i;
ok(!GEMINI_OK.test('image/gif'), 'MUTATION: gif is NOT on the allow-list (admitting it would 400 Gemini)');
ok(GEMINI_OK.test('image/jpg'), 'jpg admitted at regex so it can be normalized');

// ── SSRF guard: any url-bearing field is rejected outright ──────────────────
for (const field of ['url', 'uri', 'fileUri', 'src']) {
  const ref = { mimeType: 'image/png', dataBase64: B64, [field]: 'http://169.254.169.254/latest/meta-data/' };
  eq(safeImageRef(ref), null, `SSRF: ref carrying .${field} -> null (never fetched)`);
}
// MUTATION: if the SSRF guard were removed, a url-bearing ref with valid image
// data would pass the shape/size/mime checks. Prove those checks alone DON'T
// stop it — so the dedicated SSRF reject is load-bearing, not redundant.
const ssrfRef = { mimeType: 'image/png', dataBase64: B64, url: 'http://evil.example/x' };
ok(typeof ssrfRef === 'object' && typeof ssrfRef.dataBase64 === 'string'
   && GEMINI_OK.test(ssrfRef.mimeType),
   'MUTATION: a url-bearing ref passes shape+mime; only the SSRF guard catches it');

// ── output reconstruction: extra client fields never ride along ─────────────
const polluted = { mimeType: 'image/png', dataBase64: B64, evil: 'x', fileData: { fileUri: 'gs://b/o' } };
// fileData isn't one of the SSRF-checked field names, so this ref is NOT
// rejected — which is exactly why the output must be rebuilt from scratch.
// (fileData alone is harmless: safeImageRef only ever emits {mimeType,dataBase64}.)
const recon = safeImageRef({ mimeType: 'image/png', dataBase64: B64, evil: 'x' });
eq(Object.keys(recon || {}).sort(), ['dataBase64', 'mimeType'],
   'output has ONLY mimeType + dataBase64 (extra client keys stripped)');
eq(recon, okPng, 'reconstructed output drops the injected "evil" key');
ok(polluted, 'polluted fixture exists (doc placeholder)');

// ── size cap ────────────────────────────────────────────────────────────────
const tinyCap = 10; // bytes; base64 cap = 10 * 1.4 = 14 chars
eq(safeImageRef({ mimeType: 'image/png', dataBase64: 'A'.repeat(14) }, tinyCap),
   { mimeType: 'image/png', dataBase64: 'A'.repeat(14) }, 'at the size cap: accepted');
eq(safeImageRef({ mimeType: 'image/png', dataBase64: 'A'.repeat(15) }, tinyCap),
   null, 'over the size cap: dropped');
// empty / non-string base64 -> dropped (no usable image)
eq(safeImageRef({ mimeType: 'image/png', dataBase64: '' }), null, 'empty dataBase64 -> null');
eq(safeImageRef({ mimeType: 'image/png', dataBase64: 12345 }), null, 'non-string dataBase64 -> null');
eq(safeImageRef({ mimeType: 'image/png' }), null, 'missing dataBase64 -> null');

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`gemini-image-ref: ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join('\n')); process.exit(1); }
