// Verifier-layer test for the reef player's FRAME-IDENTITY contract.
//
// reef/index.html is a satellite coral-reef flicker loop with a pause-to-cull
// feature: deleting a frame persists across reloads via localStorage. Frames are
// baked stills in ./frames listed in manifest.json, and the persisted identity is
// `frameKey(f)` = `f.file` (the manifest filename). The load-bearing contract:
//
//   EVERY manifest entry must have a UNIQUE `file`.
//
// If two entries ever shared a filename, then deleting one frame would silently
// delete the OTHER too (and resurrecting one resurrects the other) — because the
// persisted kill-set is keyed by that string, and `isKilled` matches by it. A
// re-render of the frame catalog (`bun tools/reef-render.ts all`) regenerates the
// manifest, so a numbering/slug collision is a real, easy-to-introduce regression.
//
// This also locks two integrity properties that keep the page from showing a black
// frame: every manifest `file` exists on disk, and `frameKey` still returns `f.file`
// (so the in-memory identity matches the persisted kill-set keys — a divergence
// would orphan every deletion).
//
// `frameKey` is EXTRACTED live from index.html (regex + new Function) so it can't
// drift from a hand-copy. Mutation proofs at the bottom verify the test has teeth.

import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const here = (p) => new URL(p, import.meta.url);
const html = readFileSync(here('./index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(here('./frames/manifest.json'), 'utf8'));

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); passed++; };

// --- extract the real frameKey from index.html ---
const fkSrc = html.match(/const frameKey = .*/);
assert.ok(fkSrc, 'could not find frameKey in reef/index.html');
const frameKey = new Function(`${fkSrc[0]}\nreturn frameKey;`)();

// --- 1. manifest is a non-empty array of well-formed frames ---
ok(Array.isArray(manifest), 'manifest.json must be an array');
ok(manifest.length > 0, 'manifest is non-empty');
for (const f of manifest) {
  assert.ok(f && typeof f.file === 'string' && f.file.length > 0, `every entry needs a string file: ${JSON.stringify(f)}`);
  assert.ok(typeof f.name === 'string' && f.name.length > 0, `every entry needs a name: ${JSON.stringify(f)}`);
  assert.ok(typeof f.z === 'number', `every entry needs a numeric z: ${JSON.stringify(f)}`);
}
passed++; // the per-entry loop counts as one shape assertion

// --- 2. THE load-bearing contract: every file is unique ---
const files = manifest.map((f) => f.file);
eq(new Set(files).size, files.length,
  'manifest files must be unique — a duplicate makes deleting one frame cull another');

// --- 3. frameKey is the filename (matches what the kill-set persists) ---
const sample = manifest[Math.floor(manifest.length / 2)];
eq(frameKey(sample), sample.file,
  'frameKey must return f.file — the in-memory identity must match the persisted kill-set key');
eq(frameKey({ ...sample }), frameKey(sample), 'frameKey must be a pure function of frame content');

// --- 4. integrity: every manifest frame exists on disk (no black frames) ---
const missing = files.filter((file) => !existsSync(here(`./frames/${file}`)));
eq(missing.length, 0, `manifest references frames missing from disk: ${missing.slice(0, 5).join(', ')}`);

// --- 5. MUTATION PROOF: the uniqueness check has teeth ---
const dupd = [...files, files[0]];
ok(new Set(dupd).size < dupd.length,
  'sanity: a duplicated file must collapse the unique-set (proves the collision check is real)');

console.log(`frame-identity.test.mjs: ${passed} passed, 0 failed`);
