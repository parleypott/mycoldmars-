// Locks the parseImageInput consolidation across the Gemini image endpoints.
//
// History: last iteration fixed a real bug in the Walden render path —
// parseImageInput's data-URL regex deliberately accepts the "jpg" spelling
// (jpe?g, because real export tools emit `data:image/jpg;base64,...`) but then
// emitted "image/jpg" VERBATIM into Gemini's inlineData. Gemini's image
// allow-list is image/png, image/jpeg, image/webp — "image/jpg" is NOT in it,
// so a JPEG pasted that way 400s the whole request. The fix lived in the shared
// api/_lib/walden-image-input.js (normalize image/jpg -> image/jpeg), and
// walden-design.js was routed through it.
//
// But TWO more divergent copies survived — both Johnny-facing landscape tools
// that push the parsed mimeType straight into Gemini inlineData:
//   • api/generate-plan.js   ("drop a photo, get a plan fitted to your lot")
//   • api/analyze-render.js  (photo -> to-scale plan vision survey)
// Each had its own inline parseImageInput with the SAME image/jpg bug. Same
// divergent-copy class as the five world-routing allowlists. This test pins the
// fix: both now import parseImageInput from the shared lib (single source of
// truth) and the buggy inline copies are GONE.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseImageInput, normalizeImageMime } from './_lib/walden-image-input.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENPLAN_SRC = readFileSync(join(__dirname, 'generate-plan.js'), 'utf8');
const ANALYZE_SRC = readFileSync(join(__dirname, 'analyze-render.js'), 'utf8');

let pass = 0;
const fails = [];
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fails.push(`${name}: ${e.message}`); }
}

// The OLD, divergent inline copy that used to live in BOTH endpoints. Kept here
// ONLY to prove the behavioral divergence on the jpg case + drive the RED proof.
function oldInlineCopy(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const s = input.trim();
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(s);
  if (m) return { mimeType: m[1].toLowerCase(), dataBase64: m[2] };
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 32) return { mimeType: 'image/png', dataBase64: s.replace(/\s/g, '') };
  return null;
}

// Gemini's inlineData image allow-list (what the endpoints feed it).
const GEMINI_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// ---- 1. THE FIX (RED proof): a JPEG pasted with the "jpg" spelling.
// The old inline copy emits the invalid "image/jpg"; the shared parser (now used
// by both endpoints) normalizes it to the canonical "image/jpeg".
const JPG_URL = 'data:image/jpg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBD';
check('RED proof: old inline copy emitted invalid image/jpg', () => {
  assert.strictEqual(oldInlineCopy(JPG_URL).mimeType, 'image/jpg',
    'the old inline parser should emit the bad MIME (this is the bug)');
  assert.ok(!GEMINI_IMAGE_MIMES.has(oldInlineCopy(JPG_URL).mimeType),
    'the old MIME is rejected by Gemini — proving the 400');
});
check('FIX: shared parser normalizes jpg -> image/jpeg', () => {
  assert.strictEqual(parseImageInput(JPG_URL).mimeType, 'image/jpeg');
  assert.ok(GEMINI_IMAGE_MIMES.has(parseImageInput(JPG_URL).mimeType));
});
check('FIX: uppercase JPG spelling also normalized', () => {
  assert.strictEqual(parseImageInput('data:image/JPG;base64,/9j/abcdefgh').mimeType, 'image/jpeg');
});
check('normalizeImageMime maps jpg, leaves others', () => {
  assert.strictEqual(normalizeImageMime('image/jpg'), 'image/jpeg');
  assert.strictEqual(normalizeImageMime('IMAGE/JPG'), 'image/jpeg');
  assert.strictEqual(normalizeImageMime('image/png'), 'image/png');
  assert.strictEqual(normalizeImageMime('image/jpeg'), 'image/jpeg');
  assert.strictEqual(normalizeImageMime('image/webp'), 'image/webp');
});

// ---- 2. Hard guarantee: the parser BOTH endpoints now use can NEVER emit a
// MIME outside Gemini's image allow-list (the property the bug violated).
const allDataUrls = [
  'data:image/png;base64,iVBORw0KGgoABCDEFGHIJKL',
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABCDEFGH',
  'data:image/jpg;base64,/9j/4AAQSkZJRgABCDEFGHI',
  'data:image/JPEG;base64,/9j/4AAQSkZABCDEFGHIJKL',
  'data:image/webp;base64,UklGRiQAAABXRUJQVlABCD',
];
for (const u of allDataUrls) {
  check(`allow-list guarantee: ${u.slice(0, 24)}…`, () => {
    const got = parseImageInput(u);
    assert.ok(got && GEMINI_IMAGE_MIMES.has(got.mimeType),
      `parseImageInput emitted a non-allow-list MIME: ${got && got.mimeType}`);
  });
}

// ---- 3. Behavior-preserving: for EVERY input that isn't the jpg case, the
// shared parser agrees with the old inline copy (so the swap changed nothing
// else). We compare mimeType + dataBase64 exactly.
const preserved = [
  'data:image/png;base64,iVBORw0KGgoABCDEFGHIJKLMNOP',
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABCDEFGHIJKL',
  'data:image/webp;base64,UklGRiQAAABXRUJQVlA4ICDEF',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCDEFGHIJKLMNOPQRSTUV', // raw base64 > 32 -> png
  'tooShort',
  '',
  '   ',
  null,
  undefined,
  123,
  {},
  'not a data url at all, has spaces!!!',
];
for (const input of preserved) {
  check(`preserved (non-jpg): ${JSON.stringify(input)?.slice(0, 30)}`, () => {
    assert.deepStrictEqual(parseImageInput(input), oldInlineCopy(input),
      'shared parser diverged from the old inline behavior on a non-jpg input');
  });
}

// ---- 4. Raw-base64 + null edges (the second branch of the parser).
check('raw base64 long -> image/png', () => {
  const out = parseImageInput('A'.repeat(40));
  assert.deepStrictEqual(out, { mimeType: 'image/png', dataBase64: 'A'.repeat(40) });
});
check('raw base64 strips whitespace', () => {
  const out = parseImageInput('AAAA BBBB\nCCCC DDDD EEEE FFFF GGGG HHHH IIII');
  assert.ok(out && !/\s/.test(out.dataBase64));
});
check('gif data url rejected (not in regex)', () => {
  assert.strictEqual(parseImageInput('data:image/gif;base64,R0lGODlhAQABAAD'), null);
});

// ---- 5. Source-binding: the divergent inline copies must be GONE and the shared
// import wired in BOTH endpoints. These asserts fail if anyone reintroduces a
// local copy — the regression guard for the divergent-copy class.
for (const [label, SRC] of [['generate-plan.js', GENPLAN_SRC], ['analyze-render.js', ANALYZE_SRC]]) {
  const noComments = SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check(`${label}: imports parseImageInput from shared lib`, () => {
    assert.ok(/import\s*\{[^}]*\bparseImageInput\b[^}]*\}\s*from\s*['"]\.\/_lib\/walden-image-input\.js['"]/.test(noComments),
      `${label} must import parseImageInput from ./_lib/walden-image-input.js`);
  });
  check(`${label}: no inline parseImageInput definition remains`, () => {
    assert.ok(!/function\s+parseImageInput\s*\(/.test(noComments),
      `${label} still defines an inline parseImageInput — route through the shared lib instead`);
  });
  check(`${label}: no raw "image/jpg" emit (the old subtype passthrough)`, () => {
    // The bug signature was `m[1].toLowerCase()` flowing a captured jpg subtype
    // straight out. With the inline copy gone there should be no jpg subtype
    // capture group lingering in source.
    assert.ok(!/jpe\?g[\s\S]{0,80}toLowerCase/.test(noComments),
      `${label} appears to still capture+emit a raw jpg subtype`);
  });
}

if (fails.length) {
  console.error(`\nimage-input-consolidation: ${fails.length} FAILED`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`image-input-consolidation: ${pass}/${pass} passed`);
