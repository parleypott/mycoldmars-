// Tests for api/_lib/image-storage.js — imageStorageMeta(), the SECURITY +
// CONSISTENCY boundary that decides the { mime, ext } pair for every image we
// PUT into a PUBLIC Supabase Storage bucket and serve from the CDN. Shared by
// qss-image-upload, qss-cast, qss-scene-illustrate, qss-explorer.
//
// Why this is load-bearing (the bucket is public — anyone with the URL reads it):
//   1. SECURITY: qss-image-upload passes a client-supplied mimeType through to
//      the stored object's Content-Type. If a client sends `text/html` (or
//      `image/svg+xml`) plus matching bytes, the file renders as a DOCUMENT off
//      the public CDN (stored content-type injection → XSS). imageStorageMeta
//      MUST coerce anything outside the tight image allow-list to a safe default.
//   2. CONSISTENCY: the storage-path extension and the served Content-Type are
//      both derived from the SAME normalized mime here, so they can never
//      disagree — the old `.includes('jpeg')` ext derivation missed the
//      non-canonical "image/jpg" spelling and could file a JPEG at a .png path.
//
// Run: node api/_lib/image-storage.test.mjs   (or `bun run test`)
import { imageStorageMeta } from './image-storage.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, `${msg}\n    expected: ${e}\n    actual:   ${a}`);
}

// ─────────────────────────────────────────────────────────────
// The three allowed image types round-trip with a matching ext
// ─────────────────────────────────────────────────────────────
eq(imageStorageMeta('image/png'),  { mime: 'image/png',  ext: 'png'  }, 'png allowed');
eq(imageStorageMeta('image/jpeg'), { mime: 'image/jpeg', ext: 'jpg'  }, 'jpeg allowed → jpg ext');
eq(imageStorageMeta('image/webp'), { mime: 'image/webp', ext: 'webp' }, 'webp allowed');

// ── CONSISTENCY: the non-canonical "image/jpg" spelling normalizes to the
//    image/jpeg CONTENT-TYPE but keeps the jpg extension. This is the exact
//    case the old `.includes('jpeg')` ext derivation got wrong. ──
eq(imageStorageMeta('image/jpg'), { mime: 'image/jpeg', ext: 'jpg' },
  'image/jpg spelling → image/jpeg mime + jpg ext (ext↔mime never disagree)');

// ── Normalization: trim + uppercase from a sloppy client still resolves ──
eq(imageStorageMeta(' image/png '), { mime: 'image/png', ext: 'png' }, 'leading/trailing space trimmed');
eq(imageStorageMeta('IMAGE/PNG'),   { mime: 'image/png', ext: 'png' }, 'uppercase lowercased');
eq(imageStorageMeta(' Image/JPG '), { mime: 'image/jpeg', ext: 'jpg' }, 'trim+case+jpg-spelling together');

// ─────────────────────────────────────────────────────────────
// SECURITY: everything outside the allow-list coerces to the safe png default.
// A stored text/html or SVG served off a PUBLIC CDN with that Content-Type is
// a rendered-document XSS. The mutation target: widen ALLOWED or drop the
// default and these go RED.
// ─────────────────────────────────────────────────────────────
for (const dangerous of [
  'text/html',
  'image/svg+xml',
  'application/javascript',
  'text/xml',
  'application/xhtml+xml',
]) {
  eq(imageStorageMeta(dangerous), { mime: 'image/png', ext: 'png' },
    `SECURITY: dangerous mime "${dangerous}" coerced to safe image/png`);
}

// ── image/gif is a real image but NOT on the store allow-list → coerced ──
eq(imageStorageMeta('image/gif'), { mime: 'image/png', ext: 'png' }, 'gif not allow-listed → default png');

// ── Empty / missing / non-string all resolve to the safe default (never throw) ──
for (const junk of ['', '   ', null, undefined, 0, {}, [], NaN, 'garbage']) {
  const r = imageStorageMeta(junk);
  eq(r, { mime: 'image/png', ext: 'png' }, `junk input ${JSON.stringify(junk)} → safe default`);
}

// ─────────────────────────────────────────────────────────────
// RED proofs: two divergent-weaker implementations this core replaced both
// mis-handle cases the current code gets right.
// ─────────────────────────────────────────────────────────────
{
  // OLD ext derivation via substring `.includes('jpeg')` on the RAW mime:
  // misses the "image/jpg" spelling entirely → would file a JPEG at a png path.
  function oldExt(raw) {
    const m = String(raw || '');
    if (m.includes('jpeg')) return 'jpg';
    if (m.includes('webp')) return 'webp';
    return 'png';
  }
  ok(oldExt('image/jpg') === 'png', 'RED proof: old .includes("jpeg") mis-derives image/jpg as png ext');
  ok(imageStorageMeta('image/jpg').ext === 'jpg', 'GREEN: current core files image/jpg at jpg');
}
{
  // OLD passthrough (no allow-list): a client mimeType went straight to the
  // stored Content-Type, so text/html would be SERVED as html off the CDN.
  const passthrough = (raw) => String(raw || '');
  ok(passthrough('text/html') === 'text/html', 'RED proof: raw passthrough leaks text/html Content-Type');
  ok(imageStorageMeta('text/html').mime === 'image/png', 'GREEN: current core coerces text/html to image/png');
}

// ─────────────────────────────────────────────────────────────
console.log(`\nimage-storage.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) { console.error('\nFAILURES:\n' + fails.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
