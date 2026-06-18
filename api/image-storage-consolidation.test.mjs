// Locks the imageStorageMeta consolidation across the public-bucket image uploads.
//
// History: a prior iteration found a REAL stored-content-type hole in
// qss-image-upload — it passed an arbitrary CLIENT-supplied mimeType straight
// into the public bucket's Content-Type header, so a client could POST
// mimeType:'text/html' (+ matching bytes) and get an HTML doc served from the
// public CDN (stored content-type injection / mild stored-XSS). The fix lived
// in the shared api/_lib/image-storage.js → imageStorageMeta(rawMime), which
// coerces anything outside the image allow-list to image/png and derives the
// path ext + served mime from ONE normalize (so they can never disagree, and
// the non-canonical "image/jpg" spelling can't file a JPEG at a .png path).
//
// But THREE more divergent copies survived, each deriving ext ad-hoc via
// `mime.includes('jpeg') ? 'jpg' : ...` and echoing a raw mime into a PUBLIC
// bucket's Content-Type:
//   • api/qss-cast.js            — uploadPendingPortraitsToStorage: the mime is
//                                  CLIENT-supplied (p.mime) → the SAME reachable
//                                  text/html / svg stored-content-type hole.
//   • api/qss-scene-illustrate.js — Book View scene art (mime from Gemini → latent).
//   • api/qss-explorer.js         — world-explorer art (mime from Gemini → latent),
//                                   PLUS a serve-path Content-Type echo of the
//                                   stored image_mime.
// Same divergent-copy class as the five world-routing allowlists and the
// parseImageInput consolidation. This test pins the fix: all three now route
// through the shared imageStorageMeta (single source of truth) and the buggy
// ad-hoc derivations are GONE.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { imageStorageMeta } from './_lib/image-storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAST_SRC = readFileSync(join(__dirname, 'qss-cast.js'), 'utf8');
const SCENE_SRC = readFileSync(join(__dirname, 'qss-scene-illustrate.js'), 'utf8');
const EXPLORER_SRC = readFileSync(join(__dirname, 'qss-explorer.js'), 'utf8');

let pass = 0;
const fails = [];
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fails.push(`${name}: ${e.message}`); }
}

// The OLD, divergent inline behavior that used to live in all three endpoints:
// the served Content-Type was the raw mime, and ext was derived independently.
function oldServedMime(rawMime) {
  return rawMime || 'image/png'; // qss-cast: `p.mime || 'image/png'`
}
function oldExt(rawMime) {
  const m = rawMime || 'image/png';
  return m.includes('jpeg') ? 'jpg' : (m.includes('webp') ? 'webp' : 'png');
}

// The only mimes safe to serve from a public bucket (the allow-list the shared
// helper enforces). Anything else MUST be coerced.
const SAFE_BUCKET_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// ── 1. THE FIX (RED proof): qss-cast's client-supplied mime was a real hole ──
// A malicious/authed client could set a portrait's mime to text/html or
// image/svg+xml. The old code served it verbatim from the PUBLIC bucket; the
// shared helper coerces it to the safe default so the CDN can never render it.
check('RED proof: old served raw text/html from the public bucket', () => {
  assert.strictEqual(oldServedMime('text/html'), 'text/html',
    'old code echoed the client mime verbatim (this is the bug)');
  assert.ok(!SAFE_BUCKET_MIMES.has(oldServedMime('text/html')),
    'text/html is NOT a safe bucket mime — proving the stored-content-type hole');
});
check('FIX: imageStorageMeta coerces text/html -> image/png', () => {
  assert.strictEqual(imageStorageMeta('text/html').mime, 'image/png');
});
check('FIX: imageStorageMeta coerces image/svg+xml -> image/png', () => {
  assert.strictEqual(imageStorageMeta('image/svg+xml').mime, 'image/png');
});
check('FIX: imageStorageMeta coerces image/gif -> image/png', () => {
  assert.strictEqual(imageStorageMeta('image/gif').mime, 'image/png');
});
check('FIX: imageStorageMeta coerces application/javascript -> image/png', () => {
  assert.strictEqual(imageStorageMeta('application/javascript').mime, 'image/png');
});

// ── 2. HARD GUARANTEE: served mime is ALWAYS an allow-list image type, and ──
//     the ext ALWAYS pairs canonically with it (no .png-path-with-jpeg-body).
const CANON_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
for (const raw of ['text/html', 'image/svg+xml', 'image/gif', 'application/octet-stream',
  'image/jpg', 'IMAGE/JPEG', ' image/png ', '', null, undefined, 'garbage', 123, {}]) {
  check(`guarantee: ${JSON.stringify(raw)} -> safe mime + canonical ext pair`, () => {
    const { mime, ext } = imageStorageMeta(raw);
    assert.ok(SAFE_BUCKET_MIMES.has(mime), `served mime ${mime} must be an allow-list image type`);
    assert.strictEqual(ext, CANON_EXT[mime], `ext ${ext} must pair canonically with ${mime}`);
  });
}

// ── 3. The non-canonical "image/jpg" spelling: old code filed a JPEG at .png ──
check('RED proof: old ext derivation mismatched image/jpg', () => {
  // old served mime would be 'image/jpg' (echoed) but old ext -> 'png' (no 'jpeg')
  assert.strictEqual(oldServedMime('image/jpg'), 'image/jpg');
  assert.strictEqual(oldExt('image/jpg'), 'png',
    'old ext derivation missed the jpg spelling — .png path for a JPEG body');
});
check('FIX: image/jpg -> { mime image/jpeg, ext jpg } (consistent)', () => {
  assert.deepStrictEqual(imageStorageMeta('image/jpg'), { mime: 'image/jpeg', ext: 'jpg' });
});

// ── 4. Behavior-preserving lock: for the COMMON Gemini path (png/jpeg/webp) ──
//     the shared helper agrees with the old ad-hoc derivation, so consolidating
//     is zero-regression on every input that already worked.
for (const raw of ['image/png', 'image/jpeg', 'image/webp']) {
  check(`no-regression: ${raw} mime + ext unchanged vs old`, () => {
    const { mime, ext } = imageStorageMeta(raw);
    assert.strictEqual(mime, oldServedMime(raw), `${raw} served mime should be unchanged`);
    assert.strictEqual(ext, oldExt(raw), `${raw} ext should be unchanged`);
  });
}

// ── 5. Source-binding: the divergent ad-hoc derivations must be GONE and the ──
//     shared import wired in all three endpoints. These fail if anyone
//     reintroduces a local copy — the regression guard for the divergent class.
for (const [label, SRC] of [
  ['qss-cast.js', CAST_SRC],
  ['qss-scene-illustrate.js', SCENE_SRC],
  ['qss-explorer.js', EXPLORER_SRC],
]) {
  const noComments = SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check(`${label}: imports imageStorageMeta from shared lib`, () => {
    assert.ok(/import\s*\{[^}]*\bimageStorageMeta\b[^}]*\}\s*from\s*['"]\.\/_lib\/image-storage\.js['"]/.test(noComments),
      `${label} must import imageStorageMeta from ./_lib/image-storage.js`);
  });
  check(`${label}: no ad-hoc includes('jpeg') ext derivation remains`, () => {
    assert.ok(!/includes\(['"]jpeg['"]\)\s*\?/.test(noComments),
      `${label} still derives ext via includes('jpeg') — route through imageStorageMeta instead`);
  });
  check(`${label}: actually calls imageStorageMeta`, () => {
    assert.ok(/imageStorageMeta\s*\(/.test(noComments),
      `${label} imports but never calls imageStorageMeta`);
  });
}

if (fails.length) {
  console.error(`\nimage-storage-consolidation: ${fails.length} FAILED`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`image-storage-consolidation: ${pass}/${pass} passed`);
