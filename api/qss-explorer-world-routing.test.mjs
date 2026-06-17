/**
 * Tests for QSS world-explorer slug routing (api/qss-explorer.js).
 *
 * Run: node qss-explorer-world-routing.test.mjs  (from api/)  — or `bun run test`.
 *
 * THE FIX: qss-explorer.js routes every explorer action by world slug —
 *   • list     → GET  qss_world_explorer?world_slug=eq.<slug>   (which atlas is shown)
 *   • generate → POST world_slug:<slug>                          (which world new items store under)
 *   • reset    → DELETE qss_world_explorer?world_slug=eq.<slug>  (which world's atlas is WIPED)
 * It used to resolve that slug with its OWN hardcoded copy:
 *       if (s === 'burgundy') return 'burgundy'; return 'queen-scarlet';
 * — extensionally identical to the shared registry resolver for the two
 * worlds that exist today, but a latent landmine: the moment a 3rd world
 * ships, the local copy silently routes its slug to queen-scarlet — showing
 * the WRONG world's atlas, storing items under the wrong world, and (worst)
 * wiping the WRONG world's atlas on reset. A prior iteration fixed exactly
 * this class in qss-worlds.js's sanitizeSlug but MISSED this second copy.
 *
 * qss-explorer.js now delegates to the shared registry-driven sanitizeSlug
 * (single source of truth). This test (1) regression-locks that the swap is
 * behavior-preserving for every input that exists today, and (2) reproduces
 * the 3rd-world landmine the old hardcoded copy carried (the RED proof),
 * showing a registry-driven resolver routes a registered 3rd world correctly
 * while the old allowlist mis-routes it.
 */

import { sanitizeSlug, WORLDS, DEFAULT_WORLD } from './_lib/qss-worlds.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${label}`); }
}

// The OLD hardcoded local resolver that lived in qss-explorer.js (the bug).
function oldSanitizeWorldSlug(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'burgundy') return 'burgundy';
  return 'queen-scarlet';
}

// A registry-driven resolver of the SAME SHAPE as qss-worlds.sanitizeSlug,
// but parameterized by the registry so we can simulate a 3rd world without
// mutating the real WORLDS. Tied to the real function below.
function registrySanitize(raw, registry, dflt) {
  const s = String(raw || '').trim().toLowerCase();
  return registry[s] ? s : dflt;
}

// ── (1) regression lock: the swap is behavior-preserving TODAY ──────────────
// Every input that can occur against the current 2-world registry must
// resolve identically under the old hardcoded copy and the shared resolver.
const currentInputs = [
  'queen-scarlet', 'burgundy',
  'QUEEN-SCARLET', 'Burgundy', '  burgundy  ', 'QuEeN-ScArLeT',
  'emerald', 'nope', 'queen', 'scarlet', 'burg',
  '', '   ', null, undefined, 0, 123, {}, [],
];
for (const inp of currentInputs) {
  const a = oldSanitizeWorldSlug(inp);
  const b = sanitizeSlug(inp);
  ok(a === b, `swap behavior-preserving for ${JSON.stringify(inp)} (old=${a} new=${b})`);
}

// Spot-check the actual resolved values (not just equality).
ok(sanitizeSlug('queen-scarlet') === 'queen-scarlet', 'queen-scarlet resolves to itself');
ok(sanitizeSlug('burgundy') === 'burgundy', 'burgundy resolves to itself');
ok(sanitizeSlug('Burgundy') === 'burgundy', 'casing normalized');
ok(sanitizeSlug('  burgundy ') === 'burgundy', 'whitespace trimmed');
ok(sanitizeSlug('emerald') === DEFAULT_WORLD, 'unknown slug -> default (no crash)');
ok(sanitizeSlug(null) === DEFAULT_WORLD, 'null -> default (no throw)');
ok(sanitizeSlug('') === DEFAULT_WORLD, 'empty -> default');

// ── tie the parameterized mirror to the REAL shared resolver ────────────────
// registrySanitize against the REAL 2-world registry must match sanitizeSlug,
// proving the mirror faithfully models the shipped function.
for (const inp of currentInputs) {
  const mirror = registrySanitize(inp, WORLDS, DEFAULT_WORLD);
  ok(mirror === sanitizeSlug(inp),
    `mirror matches real sanitizeSlug for ${JSON.stringify(inp)}`);
}

// ── (2) RED proof: the 3rd-world landmine the old copy carried ──────────────
// Simulate the day a 3rd world ('emerald') is registered. A registry-driven
// resolver routes it correctly; the old hardcoded allowlist mis-routes it to
// queen-scarlet — which is exactly how `list` would show the wrong atlas and
// `reset` would WIPE the wrong world.
const SIM_WORLDS = { 'queen-scarlet': {}, 'burgundy': {}, 'emerald': {} };

ok(oldSanitizeWorldSlug('emerald') === 'queen-scarlet',
  'RED: old hardcoded copy mis-routes a 3rd world to queen-scarlet');
ok(registrySanitize('emerald', SIM_WORLDS, DEFAULT_WORLD) === 'emerald',
  'GREEN: registry-driven resolver routes a registered 3rd world to itself');
ok(oldSanitizeWorldSlug('emerald') !== registrySanitize('emerald', SIM_WORLDS, DEFAULT_WORLD),
  'the old copy and the registry resolver DIVERGE on a 3rd world (the bug)');

// And the danger is asymmetric: reset/delete on a mis-routed slug would target
// queen-scarlet's rows, not the intended world's — data loss on the wrong world.
ok(oldSanitizeWorldSlug('emerald') === 'queen-scarlet'
   && registrySanitize('emerald', SIM_WORLDS, DEFAULT_WORLD) === 'emerald',
  'reset would wipe queen-scarlet under old copy, emerald under the fix');

// A still-unregistered slug correctly defaults under both (no over-permissive route).
ok(registrySanitize('sapphire', SIM_WORLDS, DEFAULT_WORLD) === DEFAULT_WORLD,
  'truly-unknown slug still defaults (registry not over-permissive)');

// ── report ──────────────────────────────────────────────────────────────────
console.log(fails.join('\n'));
console.log(`\nqss-explorer-world-routing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
