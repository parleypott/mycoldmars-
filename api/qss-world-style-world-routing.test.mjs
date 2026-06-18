// Locks the world-slug routing in api/qss-world-style.js — the World Style Hub
// editor that drives /universe/<world>/style/.
//
// History: a hardcoded `if (s === 'burgundy') return 'burgundy'; return
// 'queen-scarlet';` allowlist landmine was killed in FOUR sibling endpoints
// (qss-worlds.js, qss-explorer.js, qss-cast.js, qss-stories.js) — each time the
// backlog claimed the divergent-copy class was "closed." A FIFTH copy survived
// HERE, missed by every prior audit. It is load-bearing in both directions: the
// resolved slug routes the GET (which world's art_style/canon you READ) AND the
// PUT (which world's qss_worlds row you OVERWRITE). With a 3rd world live, the
// old allowlist would silently read+write queen-scarlet's row for it — worst
// case clobbering queen-scarlet's style + canon with the 3rd world's edits.
// This test pins the fix: route through the SHARED registry-driven sanitizeSlug.
//
// Honest on RED: with only 2 worlds registered today the old hardcoded copy and
// the shared resolver are EXTENSIONALLY EQUAL on every real input — so the
// behavioral RED is shown against a SIMULATED 3rd world, exactly as the
// qss-worlds / qss-explorer / qss-cast / qss-stories locks did. A source-binding
// assert catches any regression to a divergent local copy directly.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sanitizeSlug, WORLDS, DEFAULT_WORLD } from './_lib/qss-worlds.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'qss-world-style.js'), 'utf8');

let pass = 0;
const fails = [];
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fails.push(`${name}: ${e.message}`); }
}

// The old, divergent, hardcoded copy that used to live in qss-world-style.js.
// Kept here ONLY to prove the behavioral divergence on a 3rd world + to drive
// the mutation RED proof.
function oldHardcodedCopy(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'burgundy') return 'burgundy';
  return 'queen-scarlet';
}

// ---- 1. Regression locks: behavior-preserving for every input that exists today.
// For all currently-real inputs the shared resolver must AGREE with the old copy,
// so swapping it in changed NOTHING for the live 2-world site.
const realInputs = [
  'burgundy', 'BURGUNDY', '  Burgundy  ', 'burgundy ',
  'queen-scarlet', 'Queen-Scarlet', 'QUEEN-SCARLET', '  queen-scarlet ',
  'unknown', 'nonsense', 'queenscarlet', 'burgund', 'scarlet',
  '', '   ', null, undefined, 123, {},
];
for (const input of realInputs) {
  check(`real input preserved: ${JSON.stringify(input)}`, () => {
    assert.strictEqual(sanitizeSlug(input), oldHardcodedCopy(input),
      `shared resolver diverged from old behavior on a CURRENT input`);
  });
}

// ---- 2. The two registered worlds resolve to themselves.
check('burgundy -> burgundy', () => assert.strictEqual(sanitizeSlug('burgundy'), 'burgundy'));
check('queen-scarlet -> queen-scarlet', () => assert.strictEqual(sanitizeSlug('queen-scarlet'), 'queen-scarlet'));

// ---- 3. Unknown / malformed slugs fall back to the default (the row read/written
// can never be an unregistered world).
check('unknown -> default', () => assert.strictEqual(sanitizeSlug('emerald-not-registered'), DEFAULT_WORLD));
check('null -> default', () => assert.strictEqual(sanitizeSlug(null), DEFAULT_WORLD));
check('substring near-miss blocked', () => assert.strictEqual(sanitizeSlug('burgundyx'), DEFAULT_WORLD));
check('default is queen-scarlet', () => assert.strictEqual(DEFAULT_WORLD, 'queen-scarlet'));

// ---- 4. THE FIX (RED proof, simulated 3rd world):
// If/when a 3rd world ('emerald') is registered, the shared resolver routes a
// GET/PUT for it to 'emerald' (correct row). The OLD hardcoded copy collapses it
// to queen-scarlet — so editing the 3rd world's style would READ queen-scarlet's
// art_style/canon and a PUT would OVERWRITE queen-scarlet's row. Silent clobber.
check('3rd world: old copy mis-routes, shared resolver honors it', () => {
  const SIM = 'emerald';
  // The old copy ALWAYS mis-routes any non-burgundy world (proves the latent bug):
  assert.strictEqual(oldHardcodedCopy(SIM), 'queen-scarlet',
    'old hardcoded copy should collapse a 3rd world to queen-scarlet (the bug)');

  // The shared resolver is registry-driven, so WITH the world registered it honors it.
  const had = Object.prototype.hasOwnProperty.call(WORLDS, SIM);
  const saved = WORLDS[SIM];
  WORLDS[SIM] = { slug: SIM, name: 'Emerald (sim)' };
  try {
    assert.strictEqual(sanitizeSlug(SIM), SIM,
      'shared resolver must route a registered 3rd world to itself, not queen-scarlet');
  } finally {
    if (had) WORLDS[SIM] = saved; else delete WORLDS[SIM];
  }
  // And once unregistered again it correctly falls back (no leakage):
  assert.strictEqual(sanitizeSlug(SIM), DEFAULT_WORLD);
});

// ---- 5. Source-binding: the divergent local allowlist must be GONE and the shared
// import wired. This is the assert that fails if anyone reintroduces a local copy.
const srcNoComments = SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('source: imports shared sanitizeSlug from qss-worlds', () => {
  assert.ok(/import\s*\{[^}]*\bsanitizeSlug\b[^}]*\}\s*from\s*['"]\.\/_lib\/qss-worlds\.js['"]/.test(srcNoComments),
    'qss-world-style.js must import sanitizeSlug from ./_lib/qss-worlds.js');
});
check('source: no hardcoded burgundy-only allowlist remains', () => {
  // The landmine signature: a literal `=== 'burgundy'` comparison returning the slug.
  assert.ok(!/===\s*['"]burgundy['"]/.test(srcNoComments),
    'a hardcoded burgundy allowlist is back — route through the shared resolver instead');
});
check('source: sanitizeWorldSlug aliases the shared resolver', () => {
  assert.ok(/sanitizeWorldSlug\s*=\s*sanitizeSlug/.test(srcNoComments),
    'sanitizeWorldSlug must alias the shared sanitizeSlug');
});

if (fails.length) {
  console.error(`\nqss-world-style-world-routing: ${fails.length} FAILED`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`qss-world-style-world-routing: ${pass}/${pass} passed`);
