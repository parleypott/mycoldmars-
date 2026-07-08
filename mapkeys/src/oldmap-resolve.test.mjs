// Tests for the MapKeys old-map overlay input resolver — the pure function
// behind "paste an Allmaps link / map id / XYZ template and get raster tiles"
// (satellite skin + georeferenced old-map overlays, commit d5f0151). Imports
// the REAL shipped functions (no mirror, can't drift). No live bug — this is a
// verifier-layer LOCK.
//
// Runner note: every suite runs under `bun <file>` (see scripts/run-tests.mjs),
// where node:test's `test()` throws ("Cannot use test outside of the test
// runner"). So this suite uses the repo's standard inline pass/fail counter,
// like every other *.test.mjs — NOT node:test.

import {
  classifyOldMapInput, allmapsTiles, annotationBounds, annotationLabel,
} from './oldmap-resolve.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ── raw XYZ template — the universal escape hatch ──
{
  const r = classifyOldMapInput('https://maps.example.com/t/{z}/{x}/{y}.png?key=abc');
  eq(r.kind, 'xyz', 'xyz template classified as xyz');
  eq(r.tiles, 'https://maps.example.com/t/{z}/{x}/{y}.png?key=abc', 'xyz template passes through verbatim');
}

// ── annotation URL → proxied tiles ──
{
  const anno = 'https://annotations.allmaps.org/maps/393a52e3e3882bc6';
  const r = classifyOldMapInput(anno);
  eq(r.kind, 'allmaps', 'annotation URL classified as allmaps');
  eq(r.annotation, anno, 'annotation URL preserved');
  eq(r.tiles, allmapsTiles(anno), 'tiles derived from annotation via allmapsTiles');
  ok(r.tiles.startsWith('https://allmaps.xyz/{z}/{x}/{y}.png?url='), 'tiles use the allmaps proxy template');
}

// ── bare 16-hex map id expands to the annotation URL (case-folded) ──
{
  const r = classifyOldMapInput('393A52E3E3882BC6');
  eq(r.kind, 'allmaps', 'bare hex id classified as allmaps');
  eq(r.annotation, 'https://annotations.allmaps.org/maps/393a52e3e3882bc6', 'hex id expands + lowercases');
}

// ── viewer share link with ?url= param unwraps ──
{
  const anno = 'https://annotations.allmaps.org/maps/393a52e3e3882bc6';
  const r = classifyOldMapInput('https://viewer.allmaps.org/?url=' + encodeURIComponent(anno));
  eq(r.kind, 'allmaps', 'viewer link classified as allmaps');
  eq(r.annotation, anno, 'viewer ?url= param unwrapped');
}

// ── editor link carrying url inside the hash unwraps ──
{
  const anno = 'https://annotations.allmaps.org/maps/393a52e3e3882bc6';
  const r = classifyOldMapInput('https://editor.allmaps.org/#/mask?url=' + encodeURIComponent(anno));
  eq(r.kind, 'allmaps', 'editor hash link classified as allmaps');
  eq(r.annotation, anno, 'editor #…?url= param unwrapped');
}

// ── garbage input returns null ──
{
  eq(classifyOldMapInput(''), null, 'empty string → null');
  eq(classifyOldMapInput('   '), null, 'whitespace → null');
  eq(classifyOldMapInput('not a url at all'), null, 'non-URL text → null');
}

const FAKE_ANNO = {
  type: 'Annotation',
  motivation: 'georeferencing',
  target: {
    source: {
      partOf: [{ type: 'Canvas', label: { none: ['Europa : Geologie'] } }],
    },
  },
  body: {
    features: [
      { geometry: { type: 'Point', coordinates: [10, 40] } },
      { geometry: { type: 'Point', coordinates: [30, 60] } },
      { geometry: { type: 'Point', coordinates: [20, 50] } },
    ],
  },
};

// ── annotationBounds pads the GCP bbox outward ──
{
  const b = annotationBounds(FAKE_ANNO);
  ok(b[0][0] < 10 && b[1][0] > 30, 'bounds padded past the lng GCP extremes');
  ok(b[0][1] < 40 && b[1][1] > 60, 'bounds padded past the lat GCP extremes');
}

// ── annotationBounds handles an AnnotationPage wrapper ──
{
  const b = annotationBounds({ type: 'AnnotationPage', items: [FAKE_ANNO] });
  ok(b && b[0][0] < 10, 'AnnotationPage wrapper unwrapped to its items');
}

// ── annotationBounds returns null with no GCPs ──
eq(annotationBounds({ type: 'Annotation', body: { features: [] } }), null, 'no GCPs → null bounds');

// ── annotationLabel reads the IIIF canvas label ──
eq(annotationLabel(FAKE_ANNO), 'Europa : Geologie', 'reads IIIF canvas label');
eq(annotationLabel({}), null, 'no lineage → null label');

// ── annotationLabel tolerates a SINGLE-OBJECT partOf (not an array) ──
// External servers (David Rumsey / OldMapsOnline / arbitrary IIIF) often
// serialize a single-valued partOf as a bare object rather than a 1-element
// array. The old `for (const p of partOf)` threw "partOf is not iterable" on
// that shape, failing an otherwise-valid georeferenced map with a cryptic error
// (surfaced verbatim in the Add-Old-Map modal). LOAD-BEARING: neutering the
// array-coercion in annotationLabel makes this throw → the whole test file exits
// non-zero. The label must still READ (not just avoid the throw), proving the
// single object is wrapped, not skipped.
{
  const singleObjectPartOf = {
    type: 'Annotation',
    target: { source: { partOf: { type: 'Canvas', label: { none: ['Nile Delta 1801'] } } } },
  };
  eq(annotationLabel(singleObjectPartOf), 'Nile Delta 1801', 'single-object partOf still yields its label');
}

// ── annotationLabel degrades non-object partOf shapes to null (never throws) ──
{
  // A string partOf would iterate its CHARACTERS under the old code (no throw,
  // but p is a 1-char string → p?.label is undefined → null). A null/number
  // partOf hit the `|| []` fallback. All must return null without throwing.
  eq(annotationLabel({ target: { source: { partOf: 'https://example.org/manifest' } } }), null, 'string partOf → null');
  eq(annotationLabel({ target: { source: { partOf: 42 } } }), null, 'numeric partOf → null');
  eq(annotationLabel({ target: { source: { partOf: null } } }), null, 'null partOf → null');
}

// ── inline RED proof: assertions have teeth ──
// A resolver that ignored the hex-id branch would classify a bare id as a
// bare annotation URL (kind stays allmaps, but annotation === the raw id, not
// the expanded URL) — the hex-id assertion above would fail on that. And a
// bounds fn with no padding would return exactly the GCP extremes, failing the
// strict `< 10` / `> 30` pads. Both are exercised above.

console.log(`oldmap-resolve: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
