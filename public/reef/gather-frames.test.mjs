// Verifier-layer test for the reef EXPORTER's frame-assembly core (export.js
// `gatherFrames`). Every export path — image sequence, MP4 (WebCodecs), and GIF —
// starts by calling gatherFrames(), whose pure transform decides, for each manifest
// entry: (a) is it EXCLUDED because the user killed it, (b) what saved zoom/pan gets
// baked into the export, and (c) what source dimensions to assume. If this transform
// regresses, the export silently ships the WRONG frames — a killed reef leaks back
// in, a corrupt zoom over-crops every frame, or a NaN scale feeds drawCrop garbage.
// It is load-bearing precisely because its consumers can't defend themselves:
//   • the kill-filter is the ONLY gate — drawCrop draws whatever it's handed.
//   • `s` flows straight into drawCrop's `sw = W0 / s` (a NaN/0 s => a blank/garbage
//     source rect, an out-of-range s => an over-zoomed export the player never shows).
//   • `w`/`h` are the fallback source dims when the manifest omits them.
//
// gatherFrames also does an async fetch of the manifest, so this test extracts just
// its PURE transform (the .filter().map() chain) VERBATIM from export.js — same
// regex + new Function technique the sibling reef locks use — so the lock can't
// drift from a hand-copy. Mutation proofs at the bottom verify the test has teeth.
//
// NOTE ON A DELIBERATE, INERT DIVERGENCE: the player (index.html) validates framing
// all-or-nothing — if ANY of s/x/y is non-finite it drops the whole entry and falls
// back to {S_DEF,0,0}. This exporter instead falls back PER FIELD. The outcomes are
// identical on all real data because persistFraming only ever writes all-finite
// triples (commit clamps all three), so a mixed finite/non-finite entry never reaches
// disk. Recorded here so a future reader doesn't "fix" a phantom bug.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('./export.js', import.meta.url), 'utf8');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); passed++; };
const near = (a, b, msg) => { assert.ok(Math.abs(a - b) < 1e-9, `${msg} (got ${a}, want ${b})`); passed++; };

// --- extract the shared clamp primitive + scale constants (the chain leans on both) ---
const clampSrc = src.match(/const clamp = .*/);
assert.ok(clampSrc, 'could not find clamp in reef/export.js');
const clamp = new Function(`${clampSrc[0]}\nreturn clamp;`)();

const sConst = src.match(/const S_MIN = ([\d.]+), S_DEF = ([\d.]+), S_MAX = ([\d.]+);/);
assert.ok(sConst, 'could not find S_MIN/S_DEF/S_MAX in export.js');
const S_MIN = +sConst[1], S_DEF = +sConst[2], S_MAX = +sConst[3];
eq(S_MIN, 1.0, 'S_MIN is 1.0 (no zoom)');
eq(S_MAX, 3.0, 'S_MAX is 3.0 (max zoom)');
ok(S_DEF > S_MIN && S_DEF < S_MAX, 'S_DEF sits strictly inside [S_MIN, S_MAX]');

// --- extract the REAL filter+map assembly chain VERBATIM from gatherFrames ---
const chainSrc = src.match(/\.filter\(\(m\) => !killed\.has\(m\.file\)\)[\s\S]*?\n {4}\}\);/);
assert.ok(chainSrc, 'could not find the gatherFrames .filter().map() chain in export.js');
// sanity: the slice is exactly the assembly, not an over-greedy grab
ok(/\.map\(\(m\) => \{/.test(chainSrc[0]), 'extracted chain contains the per-frame map');
ok(/w: m\.w \|\| 2560, h: m\.h \|\| 1440/.test(chainSrc[0]), 'extracted chain contains the source-dimension fallback');

const assemble = new Function(
  'manifest', 'killed', 'framing', 'clamp', 'S_DEF', 'S_MIN', 'S_MAX',
  `return manifest\n    ${chainSrc[0]}`
);
const run = (manifest, killedArr, framing) =>
  assemble(manifest, new Set(killedArr || []), framing || {}, clamp, S_DEF, S_MIN, S_MAX);

// a small realistic manifest
const MAN = [
  { file: 'a.jpg', name: 'Alpha', w: 2560, h: 1440 },
  { file: 'b.jpg', name: 'Bravo', w: 2560, h: 1440 },
  { file: 'c.jpg', name: 'Charlie', w: 2560, h: 1440 },
];

// --- 1. KILL FILTER: killed frames are excluded, the rest survive in order ---
{
  const out = run(MAN, ['b.jpg'], {});
  eq(out.length, 2, 'one killed frame drops the export from 3 to 2');
  eq(out.map((f) => f.file).join(','), 'a.jpg,c.jpg', 'killed frame removed, order preserved');
  ok(!out.some((f) => f.file === 'b.jpg'), 'the killed reef never reaches the exporter');
}
eq(run(MAN, [], {}).length, 3, 'no kills -> every frame exports');
eq(run(MAN, ['a.jpg', 'b.jpg', 'c.jpg'], {}).length, 0, 'all killed -> nothing to export (run() guards this upstream)');

// --- 2. DEFAULT FRAMING: a frame with no saved crop gets the neutral default ---
{
  const [f] = run([MAN[0]], [], {});
  near(f.s, S_DEF, 'unframed frame defaults to S_DEF scale');
  eq(f.x, 0, 'unframed frame defaults to x=0');
  eq(f.y, 0, 'unframed frame defaults to y=0');
}

// --- 3. SAVED FRAMING is honored, and CLAMPED into legal range ---
{
  const [f] = run([MAN[0]], [], { 'a.jpg': { s: 2.2, x: 0.4, y: -0.3 } });
  near(f.s, 2.2, 'in-range saved scale kept');
  near(f.x, 0.4, 'in-range saved x kept');
  near(f.y, -0.3, 'in-range saved y kept');
}
{
  // a corrupt/legacy over-range crop must NOT bake an over-zoom the player never shows
  const [f] = run([MAN[0]], [], { 'a.jpg': { s: 9, x: 5, y: -5 } });
  near(f.s, S_MAX, 'over-max saved scale clamped to S_MAX (no runaway zoom in export)');
  near(f.x, 1, 'over-1 x clamped to 1');
  near(f.y, -1, 'under -1 y clamped to -1');
  const [g] = run([MAN[0]], [], { 'a.jpg': { s: 0.1, x: 0, y: 0 } });
  near(g.s, S_MIN, 'sub-min saved scale clamped to S_MIN (never <1 -> no upscale-hole)');
}

// --- 4. NON-FINITE / MISSING fields fall back to default, never NaN into drawCrop ---
for (const bad of [NaN, Infinity, -Infinity, undefined, '2', null]) {
  const [f] = run([MAN[0]], [], { 'a.jpg': { s: bad, x: bad, y: bad } });
  ok(Number.isFinite(f.s) && Number.isFinite(f.x) && Number.isFinite(f.y),
    `a ${String(bad)} field yields finite framing (drawCrop's sw=W0/s can't blow up)`);
  near(f.s, S_DEF, `${String(bad)} scale falls back to S_DEF`);
  eq(f.x, 0, `${String(bad)} x falls back to 0`);
}
{
  // a partial entry (finite s, missing x/y) keeps s, defaults the rest
  const [f] = run([MAN[0]], [], { 'a.jpg': { s: 2.0 } });
  near(f.s, 2.0, 'partial entry keeps its finite scale');
  eq(f.x, 0, 'partial entry defaults missing x to 0');
  eq(f.y, 0, 'partial entry defaults missing y to 0');
}

// --- 5. SOURCE DIMENSIONS: manifest w/h honored, else fall back to 2560x1440 ---
{
  const [f] = run([{ file: 'z.jpg', name: 'Zed' }], [], {});   // no w/h in manifest
  eq(f.w, 2560, 'missing manifest width falls back to 2560');
  eq(f.h, 1440, 'missing manifest height falls back to 1440');
  const [g] = run([{ file: 'z.jpg', name: 'Zed', w: 3840, h: 2160 }], [], {});
  eq(g.w, 3840, 'explicit manifest width honored');
  eq(g.h, 2160, 'explicit manifest height honored');
}

// --- 6. PASSTHROUGH: file + name carried through unchanged (export filenames need it) ---
{
  const [f] = run([{ file: 'reef-42.jpg', name: 'Great Astrolabe' }], [], {});
  eq(f.file, 'reef-42.jpg', 'file id passed through for frames/<file> load');
  eq(f.name, 'Great Astrolabe', 'name passed through for the progress label');
}

// --- mutation proofs: the lock must FAIL if the load-bearing logic regresses ---
function mustThrow(fn, label) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(threw, `MUTATION CAUGHT: ${label}`);
}

// (a) drop the kill filter -> a killed reef leaks into the export
mustThrow(() => {
  const noFilter = new Function(
    'manifest', 'killed', 'framing', 'clamp', 'S_DEF', 'S_MIN', 'S_MAX',
    `return manifest\n    ${chainSrc[0].replace('.filter((m) => !killed.has(m.file))', '')}`
  );
  const out = noFilter(MAN, new Set(['b.jpg']), {}, clamp, S_DEF, S_MIN, S_MAX);
  assert.equal(out.length, 2, 'a filterless assembly must NOT drop the killed frame');
}, 'removing the kill filter leaks a killed frame into the export');

// (b) drop the finite guard on s -> a NaN scale survives and feeds drawCrop
mustThrow(() => {
  const laxChain = chainSrc[0].replace('Number.isFinite(f.s) ? f.s : S_DEF', 'f.s');
  const lax = new Function(
    'manifest', 'killed', 'framing', 'clamp', 'S_DEF', 'S_MIN', 'S_MAX',
    `return manifest\n    ${laxChain}`
  );
  const [f] = lax([MAN[0]], new Set(), { 'a.jpg': { s: NaN, x: 0, y: 0 } }, clamp, S_DEF, S_MIN, S_MAX);
  assert.ok(Number.isFinite(f.s), 'a guardless assembly must NOT keep the scale finite');
}, 'removing the Number.isFinite(f.s) guard lets a NaN scale reach drawCrop');

// (c) drop the clamp on s -> an out-of-range zoom survives into the export
mustThrow(() => {
  const laxChain = chainSrc[0].replace(
    'const s = clamp(Number.isFinite(f.s) ? f.s : S_DEF, S_MIN, S_MAX);',
    'const s = Number.isFinite(f.s) ? f.s : S_DEF;'
  );
  const lax = new Function(
    'manifest', 'killed', 'framing', 'clamp', 'S_DEF', 'S_MIN', 'S_MAX',
    `return manifest\n    ${laxChain}`
  );
  const [f] = lax([MAN[0]], new Set(), { 'a.jpg': { s: 9, x: 0, y: 0 } }, clamp, S_DEF, S_MIN, S_MAX);
  assert.equal(f.s, S_MAX, 'a clampless assembly must NOT clamp s=9 down to S_MAX');
}, 'removing the s clamp bakes an out-of-range zoom into the export');

console.log(`reef gather-frames: ${passed} assertions passed`);
