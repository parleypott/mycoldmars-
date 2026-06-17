/**
 * Tests for QSS cast slug routing (api/qss-cast.js).
 *
 * Run: node qss-cast-world-routing.test.mjs  (from api/)  — or `bun run test`.
 *
 * THE FIX: qss-cast.js (Henry's character-card persistence endpoint) routes
 * every cast operation by world slug —
 *   • read  → GET  qss_cast?world_slug=eq.<slug>   (which world's cast is shown)
 *   • write → POST world_slug:<slug>               (which world cards store under)
 * It used to resolve that slug with its OWN hardcoded copy:
 *       if (slug === 'burgundy') return 'burgundy'; return 'queen-scarlet';
 * — a THIRD divergent copy of the world-routing landmine already killed in
 * qss-worlds.js's sanitizeSlug and qss-explorer.js. Extensionally identical to
 * the shared registry resolver for the two worlds that exist today, but a
 * latent landmine: the moment a 3rd world ships, the local copy silently routes
 * its slug to queen-scarlet — showing the WRONG world's cast on read and
 * storing new character cards under the wrong world on write.
 *
 * qss-cast.js now delegates to the shared registry-driven sanitizeSlug
 * (single source of truth: `const sanitizeWorldSlug = sanitizeSlug`). This test
 * (1) regression-locks that the swap is behavior-preserving for every input
 * that exists today, (2) reproduces the 3rd-world landmine the old hardcoded
 * copy carried (the RED proof), and (3) asserts on the qss-cast.js SOURCE that
 * the divergent allowlist is actually gone and the shared import is wired.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sanitizeSlug, WORLDS, DEFAULT_WORLD } from './_lib/qss-worlds.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${label}`); }
}

// The OLD hardcoded local resolver that lived in qss-cast.js (the bug).
function oldSanitizeWorldSlug(raw) {
  const slug = String(raw || '').trim().toLowerCase();
  if (slug === 'burgundy') return 'burgundy';
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
  'emerald', 'nope', 'queen', 'scarlet', 'burg', 'burgundyx', 'xburgundy',
  '', '   ', null, undefined, 0, 123, {}, [], false, true,
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
ok(sanitizeSlug('burgundyx') === DEFAULT_WORLD, 'near-miss slug -> default (not substring-matched)');
ok(sanitizeSlug('emerald') === DEFAULT_WORLD, 'unknown slug -> default (no crash)');
ok(sanitizeSlug(null) === DEFAULT_WORLD, 'null -> default (no throw)');
ok(sanitizeSlug('') === DEFAULT_WORLD, 'empty -> default');

// ── tie the parameterized mirror to the REAL shared resolver ────────────────
for (const inp of currentInputs) {
  const mirror = registrySanitize(inp, WORLDS, DEFAULT_WORLD);
  ok(mirror === sanitizeSlug(inp),
    `mirror matches real sanitizeSlug for ${JSON.stringify(inp)}`);
}

// ── (2) RED proof: the 3rd-world landmine the old copy carried ──────────────
// Simulate the day a 3rd world ('emerald') is registered. A registry-driven
// resolver routes it correctly; the old hardcoded allowlist mis-routes it to
// queen-scarlet — which is exactly how a cast READ shows the wrong world's
// cards and a cast WRITE files new cards under the wrong world.
const SIM_WORLDS = { 'queen-scarlet': {}, 'burgundy': {}, 'emerald': {} };

ok(oldSanitizeWorldSlug('emerald') === 'queen-scarlet',
  'RED: old hardcoded copy mis-routes a 3rd world to queen-scarlet');
ok(registrySanitize('emerald', SIM_WORLDS, DEFAULT_WORLD) === 'emerald',
  'GREEN: registry-driven resolver routes a registered 3rd world to itself');
ok(oldSanitizeWorldSlug('emerald') !== registrySanitize('emerald', SIM_WORLDS, DEFAULT_WORLD),
  'the old copy and the registry resolver DIVERGE on a 3rd world (the bug)');
ok(oldSanitizeWorldSlug('emerald') === 'queen-scarlet'
   && registrySanitize('emerald', SIM_WORLDS, DEFAULT_WORLD) === 'emerald',
  'cast read/write would hit queen-scarlet under old copy, emerald under the fix');
ok(registrySanitize('sapphire', SIM_WORLDS, DEFAULT_WORLD) === DEFAULT_WORLD,
  'truly-unknown slug still defaults (registry not over-permissive)');

// ── (3) source binding: the divergent copy is actually GONE ─────────────────
// A behavior test alone can't prove qss-cast.js stopped using its own copy
// (it's extensionally identical today). Assert on the source that the shared
// import is wired and the hardcoded allowlist no longer exists.
const rawSrc = readFileSync(join(__dirname, 'qss-cast.js'), 'utf8');
// Strip comments so the explanatory prose (which quotes the OLD pattern) can't
// false-trigger the "allowlist is gone" check — we assert on real code only.
const src = rawSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (skip :// in urls)
ok(/import\s*\{[^}]*\bsanitizeSlug\b[^}]*\}\s*from\s*['"]\.\/_lib\/qss-worlds\.js['"]/.test(src),
  'qss-cast.js imports sanitizeSlug from the shared qss-worlds module');
ok(!/if\s*\(\s*slug\s*===\s*['"]burgundy['"]\s*\)/.test(src),
  'qss-cast.js no longer carries the hardcoded `if (slug === "burgundy")` allowlist (code, not comment)');
ok(/const\s+sanitizeWorldSlug\s*=\s*sanitizeSlug/.test(src),
  'qss-cast.js aliases its world-slug resolver to the shared sanitizeSlug');

// ── report ──────────────────────────────────────────────────────────────────
console.log(fails.join('\n'));
console.log(`\nqss-cast-world-routing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
