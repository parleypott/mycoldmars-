// Tests for api/_lib/image-storage.js (imageStorageMeta) + the safeSlug
// path-segment guard exported from api/qss-image-upload.js.
//
// imageStorageMeta is the SAFE { mime, ext } derivation for the public
// qss-scenes bucket: it (1) coerces any client mimeType outside a tight image
// allow-list to image/png so an attacker can't get text/html or image/svg+xml
// served from a public CDN URL, and (2) keeps the storage-path extension and
// the served Content-Type ALWAYS in agreement (both from one normalize).
//
// safeSlug strips a client-supplied id down to [A-Za-z0-9_-] before it is
// interpolated into the storage path — a path-traversal / injection guard.
//
// Run: node api/qss-image-upload.test.mjs   (or `bun run test`)

import assert from 'node:assert';
import { imageStorageMeta } from './_lib/image-storage.js';
import { safeSlug } from './qss-image-upload.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ── inline RED proof: the OLD inline derivation echoed an arbitrary
//    client Content-Type and mismatched ext on the jpg/uppercase spellings.
function oldDerive(mimeType) {
  const mt = String(mimeType || 'image/png');
  const ext = mt.includes('jpeg') ? 'jpg' : mt.includes('webp') ? 'webp' : 'png';
  return { mime: mt, ext }; // Content-Type was the RAW client mime
}
t('RED proof: old code served text/html as Content-Type from the public bucket', () => {
  const old = oldDerive('text/html');
  assert.strictEqual(old.mime, 'text/html', 'old code echoed the raw client mime');
  // The shipped helper neutralizes it to a safe image type.
  assert.strictEqual(imageStorageMeta('text/html').mime, 'image/png');
});
t('RED proof: old code echoed image/svg+xml (SVG XSS vector)', () => {
  assert.strictEqual(oldDerive('image/svg+xml').mime, 'image/svg+xml');
  assert.strictEqual(imageStorageMeta('image/svg+xml').mime, 'image/png');
});
t('RED proof: old ext mismatched for image/jpg (filed a JPEG at .png)', () => {
  assert.strictEqual(oldDerive('image/jpg').ext, 'png'); // wrong
  assert.strictEqual(imageStorageMeta('image/jpg').ext, 'jpg'); // fixed
});

// ── allow-list: the three real image types pass through, ext matches mime ──
t('image/png -> {image/png, png}', () => {
  assert.deepStrictEqual(imageStorageMeta('image/png'), { mime: 'image/png', ext: 'png' });
});
t('image/jpeg -> {image/jpeg, jpg}', () => {
  assert.deepStrictEqual(imageStorageMeta('image/jpeg'), { mime: 'image/jpeg', ext: 'jpg' });
});
t('image/webp -> {image/webp, webp}', () => {
  assert.deepStrictEqual(imageStorageMeta('image/webp'), { mime: 'image/webp', ext: 'webp' });
});

// ── normalization: jpg spelling + casing resolve to the canonical pair ──
t('image/jpg normalizes to image/jpeg + jpg', () => {
  assert.deepStrictEqual(imageStorageMeta('image/jpg'), { mime: 'image/jpeg', ext: 'jpg' });
});
t('uppercase IMAGE/JPEG -> image/jpeg + jpg', () => {
  assert.deepStrictEqual(imageStorageMeta('IMAGE/JPEG'), { mime: 'image/jpeg', ext: 'jpg' });
});
t('mixed-case Image/PNG -> image/png + png', () => {
  assert.deepStrictEqual(imageStorageMeta('Image/PNG'), { mime: 'image/png', ext: 'png' });
});
t('surrounding whitespace is trimmed', () => {
  assert.deepStrictEqual(imageStorageMeta('  image/webp  '), { mime: 'image/webp', ext: 'webp' });
});

// ── security: everything outside the allow-list coerces to the safe default ──
t('text/html -> safe image/png', () => {
  assert.deepStrictEqual(imageStorageMeta('text/html'), { mime: 'image/png', ext: 'png' });
});
t('image/svg+xml -> safe image/png (SVG is the real XSS vector)', () => {
  assert.deepStrictEqual(imageStorageMeta('image/svg+xml'), { mime: 'image/png', ext: 'png' });
});
t('image/gif -> safe image/png (gif not a storage target)', () => {
  assert.deepStrictEqual(imageStorageMeta('image/gif'), { mime: 'image/png', ext: 'png' });
});
t('application/javascript -> safe image/png', () => {
  assert.deepStrictEqual(imageStorageMeta('application/javascript'), { mime: 'image/png', ext: 'png' });
});
t('text/html with charset param -> safe image/png', () => {
  assert.deepStrictEqual(imageStorageMeta('text/html; charset=utf-8'), { mime: 'image/png', ext: 'png' });
});

// ── never throws; missing/garbage input -> safe default ──
for (const bad of ['', '   ', null, undefined, 0, 42, {}, [], 'png', 'jpeg', 'not-a-mime']) {
  t(`garbage input ${JSON.stringify(bad)} -> safe image/png, never throws`, () => {
    const r = imageStorageMeta(bad);
    assert.deepStrictEqual(r, { mime: 'image/png', ext: 'png' });
  });
}

// the result mime is ALWAYS one of exactly three safe values
t('output mime is always an allow-listed image type', () => {
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
  for (const m of ['image/png', 'image/jpeg', 'image/webp', 'image/jpg', 'text/html',
                    'image/svg+xml', 'image/gif', '', null, 'whatever']) {
    assert.ok(allowed.has(imageStorageMeta(m).mime), `leaked: ${m}`);
  }
});
t('output ext always pairs canonically with output mime', () => {
  const pair = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  for (const m of ['image/png', 'image/jpeg', 'image/webp', 'image/jpg', 'text/html', 'x', null]) {
    const r = imageStorageMeta(m);
    assert.strictEqual(r.ext, pair[r.mime], `ext/mime disagree for ${m}`);
  }
});

// ── safeSlug: path-segment guard ──
t('safeSlug strips path-traversal characters', () => {
  assert.strictEqual(safeSlug('../../etc/passwd'), 'etcpasswd');
});
t('safeSlug strips slashes and dots', () => {
  assert.strictEqual(safeSlug('a/b.c'), 'abc');
});
t('safeSlug keeps allowed [A-Za-z0-9_-]', () => {
  assert.strictEqual(safeSlug('Story_01-abc'), 'Story_01-abc');
});
t('safeSlug strips spaces and unicode', () => {
  assert.strictEqual(safeSlug('hello world 你好'), 'helloworld');
});
t('safeSlug caps at max length (default 80)', () => {
  assert.strictEqual(safeSlug('x'.repeat(200)).length, 80);
});
t('safeSlug honors custom max', () => {
  assert.strictEqual(safeSlug('x'.repeat(200), 40).length, 40);
});
t('safeSlug on null/undefined/number -> string, never throws', () => {
  assert.strictEqual(safeSlug(null), '');
  assert.strictEqual(safeSlug(undefined), '');
  assert.strictEqual(safeSlug(12345), '12345');
});

console.log(`\nqss-image-upload (image-storage + safeSlug): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
