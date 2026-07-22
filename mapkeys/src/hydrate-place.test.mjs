// Lock the PLACE branch of hydrateShape — the persistence crash-safety contract
// in main.js for the fresh place-search feature (commit 713776b). hydrateShape
// is the single funnel every saved shape passes through on load: it's called as
// `snap.shapes.map(hydrateShape).filter(Boolean)` in THREE load paths (project
// load @528, hydrateSnapshotIntoState @2491, applyProjectSnapshot @4015). Its
// job for a place is to (a) NORMALIZE a saved center into a fresh 2-element
// array, and (b) REJECT (return null → filtered out) any place whose center is
// missing/malformed, so a corrupt/legacy row never enters state.shapes.
//
// Why it's load-bearing: a place that survives hydration is later fed to
// placePosition() → `shape.center[0]` and to ensureShapeOnMap/redrawShapeImpl
// with NO per-shape try/catch around the render. If the `if (base.type ===
// 'place' && !base.center) return null` guard is dropped, a place with a missing
// center hydrates with center:null, enters state, and the first render throws a
// TypeError on `null[0]` — bricking the WHOLE project load. Exactly the
// corrupt-store crash class the loop locks everywhere else. Fresh code, zero
// coverage.
//
// hydrateShape is module-scoped inside main.js, so we source-extract it VERBATIM
// (can't drift from the shipped code) and eval it with faithful stubs for the
// symbols it closes over (clampSides / SHAPE_DEFAULTS / defaultShapePreview /
// resolveCountryGeometry) — none of which the place path depends on for its
// guard. Each assertion below goes RED if the corresponding guard regresses.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'main.js'), 'utf8');

const fnMatch = src.match(/function hydrateShape\(raw\) \{[\s\S]*?\n\}/);
if (!fnMatch) throw new Error('could not extract hydrateShape from main.js');

// Eval with faithful stubs for the closed-over symbols. The place path never
// reaches clampSides' real logic / country resolution, so stubs are safe.
// eslint-disable-next-line no-eval
const hydrateShape = (0, eval)(
  `(function(){
     const SHAPE_DEFAULTS = { stroke: '#b85c3c', fill: '#b85c3c', strokeWidth: 1.5, fillOpacity: 0 };
     const clampSides = (n) => (typeof n === 'number' ? n : 8);
     const defaultShapePreview = (type) => ({ offsetLng: 0, offsetLat: 0, scale: 1, drawProgress: 1 });
     const resolveCountryGeometry = () => {};
     ${fnMatch[0]}
     return hydrateShape;
   })()`,
);

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }

const goodPlace = () => ({
  id: 'shp_1', type: 'place', name: 'Panama City',
  center: [-79.5199, 8.9824], dotSize: 8, labelSize: 16,
});

// ── Well-formed place hydrates with a normalized center ──
const good = hydrateShape(goodPlace());
ok(good !== null, 'well-formed place is not rejected');
ok(good && good.type === 'place', 'type preserved');
ok(good && Array.isArray(good.center) && good.center.length === 2, 'center is a 2-element array');
ok(good && good.center[0] === -79.5199 && good.center[1] === 8.9824, 'center values preserved');
ok(good && good.dotSize === 8, 'numeric dotSize preserved');
ok(good && good.labelSize === 16, 'numeric labelSize preserved');

// center must be a FRESH copy, not aliased to the raw array (autosave safety).
const rawAlias = goodPlace();
const hAlias = hydrateShape(rawAlias);
ok(hAlias.center !== rawAlias.center, 'center is a fresh copy, not aliased to raw');

// ── LOAD-BEARING: a place with a missing/malformed center is REJECTED ──
ok(hydrateShape({ id: 'p', type: 'place', name: 'x' }) === null,
   'place with MISSING center → null (the crash-safety guard)');
ok(hydrateShape({ id: 'p', type: 'place', center: null }) === null,
   'place with null center → null');
ok(hydrateShape({ id: 'p', type: 'place', center: 'somewhere' }) === null,
   'place with STRING center → null');
ok(hydrateShape({ id: 'p', type: 'place', center: { lng: 1, lat: 2 } }) === null,
   'place with OBJECT center → null');
ok(hydrateShape({ id: 'p', type: 'place', center: 5 }) === null,
   'place with NUMBER center → null');

// ── length guard: only a 2-element array counts (a stray-length array is bad) ──
ok(hydrateShape({ id: 'p', type: 'place', center: [1] }) === null,
   'place with 1-element center → null');
ok(hydrateShape({ id: 'p', type: 'place', center: [1, 2, 3] }) === null,
   'place with 3-element center → null');

// ── dot/label size defaults when non-numeric ──
const noSizes = hydrateShape({ id: 'p', type: 'place', center: [1, 2] });
ok(noSizes && noSizes.dotSize === 6, 'missing dotSize defaults to 6');
ok(noSizes && noSizes.labelSize === 14, 'missing labelSize defaults to 14');
const badSizes = hydrateShape({ id: 'p', type: 'place', center: [1, 2], dotSize: 'big', labelSize: null });
ok(badSizes && badSizes.dotSize === 6, 'non-numeric dotSize defaults to 6');
ok(badSizes && badSizes.labelSize === 14, 'non-numeric labelSize defaults to 14');

// ── regression guard: the place guard does NOT reject other shape types ──
const poly = hydrateShape({ id: 'poly', type: 'polygon', sides: 8 });
ok(poly !== null && poly.type === 'polygon', 'polygon still hydrates (place guard is place-only)');
const line = hydrateShape({ id: 'ln', type: 'line', baseCoords: [[0, 0], [1, 1]] });
ok(line !== null && line.type === 'line', 'valid line still hydrates');
// a place-less shape (no center) of a non-place type is unaffected by the guard
const lineNoCenter = hydrateShape({ id: 'ln2', type: 'line', baseCoords: [[0, 0], [1, 1]] });
ok(lineNoCenter !== null, 'a non-place shape with no center is NOT rejected');

// ── null/garbage raw ──
ok(hydrateShape(null) === null, 'null raw → null');
ok(hydrateShape({ type: 'place', center: [1, 2] }) === null, 'raw with no id → null');

console.log(`hydrate-place: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
