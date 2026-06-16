/**
 * Tests for the QSS worlds registry (api/_lib/qss-worlds.js).
 *
 * Run: node qss-worlds.test.mjs   (from api/_lib/)  — or via `bun run test`.
 *
 * This is the first coverage of a load-bearing core: ~11 QSS endpoints
 * (qss-character-card, qss-scene-illustrate, qss-arc-extract, ...) import
 * resolveWorld / canonOverlayForBody / artStyleForBody / loadWorldStyle to
 * inject the right world's canon + art register into image-gen and prompt
 * paths. The slug a story carries (qss_stories.world_slug) flows straight
 * into these — so slug resolution is security-of-correctness for which
 * world's art rules a portrait obeys.
 *
 * Hardened here: sanitizeSlug() (used by loadWorldStyle, the live DB-merge
 * art-style path) was a hardcoded `if (s === 'burgundy') return 'burgundy'`
 * allowlist that ignored the WORLDS registry. Correct for the two worlds
 * that exist today, but the moment a third world's stories carry a new
 * world_slug, every portrait would silently render in queen-scarlet's art
 * register — the file's own header says "both files MUST stay in sync."
 * Now it's registry-driven (`WORLDS[s] ? s : DEFAULT_WORLD`), matching
 * resolveWorld, so adding a world to WORLDS is the only edit ever needed.
 * The third-world mis-route is reproduced below against a simulated WORLDS
 * (the RED proof — the old allowlist demonstrably mis-routes; the new
 * registry-driven logic does not).
 */
import {
  WORLDS,
  DEFAULT_WORLD,
  resolveWorld,
  canonOverlayForBody,
  artStyleForBody,
  sanitizeSlug,
  invalidateWorldStyleCache,
} from './qss-worlds.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${label}`); }
}

// ── registry shape ──────────────────────────────────────────────────────────
ok(typeof WORLDS === 'object' && WORLDS !== null, 'WORLDS is an object');
ok(WORLDS[DEFAULT_WORLD], 'DEFAULT_WORLD points at a real registry entry');
ok(DEFAULT_WORLD === 'queen-scarlet', 'DEFAULT_WORLD is queen-scarlet');
ok(!!WORLDS['burgundy'], 'burgundy world is registered');
for (const [key, w] of Object.entries(WORLDS)) {
  ok(w.slug === key, `${key}: slug field matches its registry key`);
  ok(typeof w.name === 'string' && w.name.length > 0, `${key}: has a name`);
  ok(typeof w.canonText === 'string' && w.canonText.length > 0, `${key}: has canonText`);
  ok(w.artStyle && typeof w.artStyle.styleBlock === 'string' && w.artStyle.styleBlock.length > 0,
    `${key}: has an artStyle.styleBlock`);
}

// ── resolveWorld — robust, never-throws resolution ──────────────────────────
ok(resolveWorld('queen-scarlet').slug === 'queen-scarlet', 'resolveWorld exact queen-scarlet');
ok(resolveWorld('burgundy').slug === 'burgundy', 'resolveWorld exact burgundy');
ok(resolveWorld('BURGUNDY').slug === 'burgundy', 'resolveWorld is case-insensitive');
ok(resolveWorld('  burgundy  ').slug === 'burgundy', 'resolveWorld trims whitespace');
ok(resolveWorld('nope').slug === DEFAULT_WORLD, 'resolveWorld unknown -> default');
ok(resolveWorld('').slug === DEFAULT_WORLD, 'resolveWorld empty -> default');
ok(resolveWorld(null).slug === DEFAULT_WORLD, 'resolveWorld null -> default (no throw)');
ok(resolveWorld(undefined).slug === DEFAULT_WORLD, 'resolveWorld undefined -> default');
ok(resolveWorld(42).slug === DEFAULT_WORLD, 'resolveWorld non-string -> default (no throw)');

// ── sanitizeSlug — now registry-driven, agrees with resolveWorld ────────────
for (const key of Object.keys(WORLDS)) {
  ok(sanitizeSlug(key) === key, `sanitizeSlug keeps known world ${key} intact`);
  ok(sanitizeSlug(key) === resolveWorld(key).slug, `sanitizeSlug agrees with resolveWorld for ${key}`);
}
ok(sanitizeSlug('Burgundy') === 'burgundy', 'sanitizeSlug lowercases');
ok(sanitizeSlug('  queen-scarlet ') === 'queen-scarlet', 'sanitizeSlug trims');
ok(sanitizeSlug('unknown-world') === DEFAULT_WORLD, 'sanitizeSlug unknown -> default');
ok(sanitizeSlug('') === DEFAULT_WORLD, 'sanitizeSlug empty -> default');
ok(sanitizeSlug(null) === DEFAULT_WORLD, 'sanitizeSlug null -> default');
ok(sanitizeSlug(undefined) === DEFAULT_WORLD, 'sanitizeSlug undefined -> default');
// The contract: for EVERY registered world, both resolvers agree. A future
// world added to WORLDS automatically satisfies this — no allowlist to forget.
for (const key of Object.keys(WORLDS)) {
  ok(sanitizeSlug(key) === resolveWorld(key).slug,
    `contract: sanitizeSlug and resolveWorld agree on registered world ${key}`);
}

// ── RED PROOF: the old hardcoded allowlist mis-routes a third world ─────────
// Simulate a registry that has gained a third world ('emerald'). The OLD
// sanitizeSlug ignored the registry; the NEW one consults it. We reproduce
// both against the simulated registry to show the bug was real and is fixed.
{
  const SIM = { 'queen-scarlet': {}, 'burgundy': {}, 'emerald': {} };
  const oldSanitize = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'burgundy') return 'burgundy';   // the old hardcoded allowlist
    return 'queen-scarlet';
  };
  const newSanitize = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    return SIM[s] ? s : 'queen-scarlet';        // registry-driven (the fix)
  };
  // The bug: a real 'emerald' story silently renders in queen-scarlet's register.
  ok(oldSanitize('emerald') === 'queen-scarlet', 'RED: old allowlist mis-routes emerald -> queen-scarlet');
  ok(newSanitize('emerald') === 'emerald', 'GREEN: registry-driven keeps emerald intact');
  // Both still agree on the two worlds that exist today (why it was never caught).
  ok(oldSanitize('burgundy') === newSanitize('burgundy'), 'old and new agree on burgundy (latent until 3rd world)');
  ok(oldSanitize('queen-scarlet') === newSanitize('queen-scarlet'), 'old and new agree on queen-scarlet');
}

// ── canonOverlayForBody — always a non-empty overlay block ──────────────────
const csOverlay = canonOverlayForBody({ world_slug: 'queen-scarlet' });
ok(csOverlay.includes("Queen Scarlet's Apocalypse School"), 'canonOverlay queen-scarlet pulls its canon');
ok(csOverlay.includes('WORLD CANON'), 'canonOverlay wraps with a WORLD CANON header');
const bgOverlay = canonOverlayForBody({ world_slug: 'burgundy' });
ok(bgOverlay.includes('Puppy Town'), 'canonOverlay burgundy pulls its canon');
ok(bgOverlay !== csOverlay, 'canonOverlay differs by world');
ok(canonOverlayForBody({ world: 'burgundy' }).includes('Puppy Town'), 'canonOverlay accepts body.world too');
ok(canonOverlayForBody({}).includes("Queen Scarlet"), 'canonOverlay empty body -> default world');
ok(canonOverlayForBody(null).includes("Queen Scarlet"), 'canonOverlay null body -> default (no throw)');
ok(canonOverlayForBody({ world_slug: 'nope' }).includes("Queen Scarlet"), 'canonOverlay unknown slug -> default');

// ── artStyleForBody — returns the right world's art register ─────────────────
const csArt = artStyleForBody({ world_slug: 'queen-scarlet' });
ok(csArt.styleBlock.includes('storybook'), 'artStyle queen-scarlet is the storybook register');
const bgArt = artStyleForBody({ world_slug: 'burgundy' });
ok(bgArt.styleBlock.includes('cinematic') || bgArt.styleBlock.includes('Ghibli'), 'artStyle burgundy is the painterly/cinematic register');
ok(csArt.styleBlock !== bgArt.styleBlock, 'artStyle differs by world (no register bleed)');
ok(artStyleForBody({}).styleBlock === csArt.styleBlock, 'artStyle empty body -> default register');
ok(artStyleForBody(null).styleBlock === csArt.styleBlock, 'artStyle null body -> default (no throw)');
ok(artStyleForBody({ world_slug: 'nope' }).styleBlock === csArt.styleBlock, 'artStyle unknown slug -> default register');

// ── invalidateWorldStyleCache — never throws on any input ───────────────────
let threw = false;
try {
  invalidateWorldStyleCache('burgundy');
  invalidateWorldStyleCache('emerald');   // unknown -> sanitized to default, still safe
  invalidateWorldStyleCache(null);        // clears all
  invalidateWorldStyleCache();            // clears all
} catch { threw = true; }
ok(!threw, 'invalidateWorldStyleCache never throws (known, unknown, null, none)');

// ── report ────────────────────────────────────────────────────────────────
console.log(fails.join('\n'));
console.log(`\nqss-worlds: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
