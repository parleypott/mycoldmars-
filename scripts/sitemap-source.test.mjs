/**
 * Mutation-lock for the sitemap route -> source-path resolver.
 *
 * Guards the truthful-lastmod feature: every sitemap route must resolve to the
 * git path whose commit date becomes its <lastmod>. The load-bearing cases:
 *   - a page blames its DIRECTORY (JS/CSS-only changes still move lastmod),
 *   - the root hub blames index.html ALONE (never '.' — that bumps on every commit),
 *   - a public/ page blames its public/ dir (not a phantom dist route),
 *   - a canonical-redirect route resolves via its ORIGINAL path (the Vite-built
 *     destination has no tracked source), and
 *   - an unbacked route returns null so the caller falls back to the build date.
 *
 * Run: bun scripts/sitemap-source.test.mjs
 */
import assert from 'node:assert';
import { fileToRoute, buildRouteToFile, routeToSourcePath } from './sitemap-source.mjs';

const TRACKED = [
  'index.html',
  'animatedcrazy/index.html',
  'public/walden/index.html',
  'public/lauterbrunnen/index.html',
  'queen-scarlet-school/index.html',
];
const m = buildRouteToFile(TRACKED);

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

ok('fileToRoute maps files to served routes', () => {
  assert.equal(fileToRoute('index.html'), '/');
  assert.equal(fileToRoute('animatedcrazy/index.html'), '/animatedcrazy/');
  assert.equal(fileToRoute('public/walden/index.html'), '/walden/'); // public/ stripped
});

ok('root hub blames index.html alone, NOT the repo root', () => {
  const src = routeToSourcePath('/', m);
  assert.equal(src, 'index.html');
  assert.notEqual(src, '.'); // '.' would bump the homepage on literally every commit
});

ok('a page blames its whole directory (JS/CSS changes count)', () => {
  assert.equal(routeToSourcePath('/animatedcrazy/', m), 'animatedcrazy/');
});

ok('a public/ page blames its public/ source dir', () => {
  assert.equal(routeToSourcePath('/walden/', m), 'public/walden/');
  assert.equal(routeToSourcePath('/lauterbrunnen/', m), 'public/lauterbrunnen/');
});

ok('canonical-redirect route resolves via its ORIGINAL path', () => {
  // /queen-scarlet-school/ 302s to /universe/queen-scarlet/write/. The lastmod must
  // come from the ORIGINAL route's tracked source, since the canonical destination
  // is a Vite build with no index.html of its own.
  assert.equal(routeToSourcePath('/queen-scarlet-school/', m), 'queen-scarlet-school/');
  assert.equal(routeToSourcePath('/universe/queen-scarlet/write/', m), null);
});

ok('unbacked route returns null (caller uses build date)', () => {
  assert.equal(routeToSourcePath('/glossary/', m), null);
  assert.equal(routeToSourcePath('/does-not-exist/', m), null);
});

ok('buildRouteToFile ignores blank entries', () => {
  const m2 = buildRouteToFile(['index.html', '', '  ', 'mapkeys/index.html']);
  assert.equal(m2.size, 2);
  assert.equal(routeToSourcePath('/mapkeys/', m2), 'mapkeys/');
});

console.log(failed === 0
  ? `PASS — all ${passed} sitemap-source cases correct`
  : `\n${failed} FAILED, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
