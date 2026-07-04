// Twin-lock: the scripts-library reserved-slug invariant lives in TWO hand-maintained
// copies on opposite sides of the wire —
//   • api/script-projects.js         RESERVED_SLUGS  (SERVER: rejects a create whose slug shadows a route)
//   • scripts-library/src/project-store.js RESERVED_SLUGS (CLIENT: generateSlug/ensureUnique avoids them)
// They MUST agree. If they drift (someone adds a reserved route on one side and forgets the other), the
// failure is silent and nasty: the client happily mints a slug the server accepts that shadows a real
// route, OR the server rejects a slug the client thought was fine, stranding a create. This is the exact
// divergent-copy-of-a-routing-constant class the loop has fixed ~5x for QSS sanitizeWorldSlug. No test
// cross-checked the two until now — each side only tested its OWN copy.
//
// Also locks the load-bearing cross-boundary invariant: EVERY slug generateSlug() can produce must pass
// the server's SLUG_RE — because the client round-trips its generated slug through this endpoint.
//
// Run: bun scripts-library/src/reserved-slug-parity.test.mjs
import assert from 'node:assert';

const server = await import('../../api/script-projects.js');
const client = await import('./project-store.js');
const { generateSlug } = await import('./slug.js');

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

const srvReserved = [...server.RESERVED_SLUGS].sort();
const cliReserved = [...client.RESERVED_SLUGS].sort();

// ── the twin-lock ──────────────────────────────────────────────────────────────
ok('server & client RESERVED_SLUGS are byte-identical sets', () => {
  assert.deepEqual(cliReserved, srvReserved,
    `client ${JSON.stringify(cliReserved)} !== server ${JSON.stringify(srvReserved)} — the two reserved-slug copies drifted`);
});

ok('reserved set is exactly {home, library, new, trash} (pins the current contract)', () => {
  assert.deepEqual(srvReserved, ['home', 'library', 'new', 'trash']);
});

// ── every reserved slug is itself a well-shaped slug (self-consistency) ──────────
ok('every reserved slug matches the server SLUG_RE shape', () => {
  for (const s of srvReserved) {
    assert.ok(server.SLUG_RE.test(s), `reserved slug ${JSON.stringify(s)} is not a valid slug shape`);
  }
});

// ── client-produces → server-accepts: the round-trip invariant ───────────────────
// generateSlug is the ONLY producer of new slugs; the server SLUG_RE is the gate they hit. If a name
// exists that generateSlug turns into a string SLUG_RE rejects, a create silently 400s. Battery of
// realistic + adversarial file names (curly apostrophes, punctuation runs, leading/trailing junk,
// CJK/emoji collapsing to nothing → 'untitled', over-60-char, all-symbols).
ok('every generateSlug output passes the server SLUG_RE', () => {
  const names = [
    "Mehdi's Interview.mp4", 'Johnny’s B‑roll take 2', '  --leading and trailing--  ',
    'Multiple   spaces___and---dashes', 'UPPER CASE NAME', 'a', '123', 'ẞ 汉字 🎬 emoji only',
    '....', '!!!???', 'x'.repeat(200), 'burma s2e04 — final cut (v3)', '', null, undefined,
    'file.name.with.dots.mov', 'tab\tand\nnewline', 'café münchen señor',
  ];
  for (const n of names) {
    const slug = generateSlug(n);
    assert.ok(server.SLUG_RE.test(slug),
      `generateSlug(${JSON.stringify(n)}) = ${JSON.stringify(slug)} — rejected by server SLUG_RE`);
  }
});

console.log(failed === 0
  ? `PASS — all ${passed} reserved-slug-parity cases correct`
  : `\n${failed} FAILED, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
