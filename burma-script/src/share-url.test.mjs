/*
 * share-url.test.mjs — the canonical READ-ONLY share link builder (Johnny 2026-07-09; door-aware
 * 2026-07-22).
 *
 * buildShareUrl is the ONE place a shareable link is minted (full-script + bookmark deep-links). It
 * must ALWAYS force `?read`, minted FROM THE CURRENT DOOR so the link serves THIS script:
 *   • a legacy episode (burma/palau/…) → its standalone directory (/burma-script/?read), which
 *     serves read shares logged-out;
 *   • a library-native project (e.g. NILE RIVER, which has no standalone directory) → the library
 *     door carrying its slug: /scripts-library/#<slug>?read.
 * If this drifts a library bookmark hands out /burma-script/?read — the WRONG script (the bug this
 * fixes) — or a share 404s / leaks an edit surface.
 *
 * The `?read` and `&bm=` flags must round-trip back through the REAL parsers on BOTH doors, so the
 * second half of this file feeds the emitted URL into read-mode.js (isReadOnly) and
 * bookmark-target.js (bookmarkTargetFromUrl) — never a restated regex.
 */
import assert from 'node:assert/strict';
import { buildShareUrl } from './extensions/table.js';
import { bookmarkTargetFromUrl } from './bookmark-target.js';
import { __setReadOnlyForTest } from './read-mode.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };
const loc = (origin, extra = {}) => ({ origin, ...extra });

// ── DOOR-AWARE SHAPE ─────────────────────────────────────────────────────────────────────────
// A legacy episode standalone door keeps the burma/palau directory it was copied from.
ok('standalone door: full-script link forces <current-path>?read', () => {
  assert.equal(
    buildShareUrl({}, loc('https://newpress.press', { pathname: '/burma-script/' })),
    'https://newpress.press/burma-script/?read',
  );
});

ok('standalone door: a NON-burma episode hands out ITS OWN path, never burma', () => {
  assert.equal(
    buildShareUrl({ bm: 'bm_p1' }, loc('https://newpress.press', { pathname: '/palau-script/' })),
    'https://newpress.press/palau-script/?read&bm=bm_p1',
  );
});

ok('standalone door: bookmark link appends &bm=<id> after ?read', () => {
  assert.equal(
    buildShareUrl({ bm: 'bm_abc' }, loc('https://newpress.press', { pathname: '/burma-script/' })),
    'https://newpress.press/burma-script/?read&bm=bm_abc',
  );
});

ok('standalone door: a trailing index.html normalizes back to the directory', () => {
  assert.equal(
    buildShareUrl({}, loc('https://x.dev', { pathname: '/burma-script/index.html' })),
    'https://x.dev/burma-script/?read',
  );
});

ok('no path at all → defensive /burma-script/ default (a real browser always has a path)', () => {
  assert.equal(buildShareUrl({}, loc('https://x.dev')), 'https://x.dev/burma-script/?read');
});

// A library-native project mints on the LIBRARY door, carrying its slug (THE bug fix).
ok('library door: bookmark link is /scripts-library/#<slug>?read&bm=<id>, NOT /burma-script/', () => {
  const url = buildShareUrl(
    { bm: 'bm_mrwdngqs_1_uolkv' },
    loc('https://www.newpress.press', { pathname: '/scripts-library/', hash: '#nile-river' }),
  );
  assert.equal(url, 'https://www.newpress.press/scripts-library/#nile-river?read&bm=bm_mrwdngqs_1_uolkv');
  assert.ok(!url.includes('/burma-script/'), 'never the burma standalone door');
});

ok('library door: full-script link carries the slug + ?read (no bm)', () => {
  assert.equal(
    buildShareUrl({}, loc('https://x.dev', { pathname: '/scripts-library/', hash: '#nile-river' })),
    'https://x.dev/scripts-library/#nile-river?read',
  );
});

ok('library door: an existing hash-query (e.g. #slug?backups) is dropped — the share is ?read', () => {
  assert.equal(
    buildShareUrl({ bm: 'z' }, loc('https://x.dev', { pathname: '/scripts-library/', hash: '#nile-river?backups' })),
    'https://x.dev/scripts-library/#nile-river?read&bm=z',
  );
});

ok('library door: copying from an EDITABLE library url still forces ?read', () => {
  const url = buildShareUrl({}, loc('https://x.dev', { pathname: '/scripts-library/', hash: '#nile-river', search: '?x=1' }));
  assert.equal(url, 'https://x.dev/scripts-library/#nile-river?read');
});

// ── FLAG INVARIANTS (both doors) ──────────────────────────────────────────────────────────────
ok('bm value is URL-encoded (never breaks the query on odd ids)', () => {
  assert.equal(
    buildShareUrl({ bm: 'a b/c' }, loc('https://x.dev', { pathname: '/burma-script/' })),
    'https://x.dev/burma-script/?read&bm=a%20b%2Fc',
  );
  assert.equal(
    buildShareUrl({ bm: 'a b/c' }, loc('https://x.dev', { pathname: '/scripts-library/', hash: '#s' })),
    'https://x.dev/scripts-library/#s?read&bm=a%20b%2Fc',
  );
});

ok('no bookmark → no bm param at all (either door)', () => {
  assert.ok(!buildShareUrl({ bm: '' }, loc('https://x.dev', { pathname: '/burma-script/' })).includes('bm='));
  assert.ok(!buildShareUrl({}, loc('https://x.dev', { pathname: '/scripts-library/', hash: '#s' })).includes('bm='));
});

ok('every link carries ?read (the read-only share flag read-mode.js keys on)', () => {
  assert.match(buildShareUrl({}, loc('https://x.dev', { pathname: '/burma-script/' })), /[?&]read\b/);
  assert.match(buildShareUrl({ bm: 'z' }, loc('https://x.dev', { pathname: '/scripts-library/', hash: '#s' })), /[?&]read\b/);
});

// ── THE TWO CALLERS ─────────────────────────────────────────────────────────────────────────────
// Both live share affordances funnel through buildShareUrl, so both must door-correct together. These
// cases mirror the EXACT invocation each makes, so a regression in either is named, not inferred:
//   (1) READ LINK pill   — ShareToggle.jsx copyRead()      → buildShareUrl({})
//   (2) bookmark ⚑ link  — table.js copyBookmarkLink(id)   → buildShareUrl({ bm: id })
const libLoc = (slug) => loc('https://www.newpress.press', { pathname: '/scripts-library/', hash: '#' + slug });
const stdLoc = (dir) => loc('https://www.newpress.press', { pathname: dir });

ok('CALLER 1 — READ LINK pill: library door → /scripts-library/#<slug>?read (no bm)', () => {
  assert.equal(buildShareUrl({}, libLoc('nile-river')), 'https://www.newpress.press/scripts-library/#nile-river?read');
});
ok('CALLER 1 — READ LINK pill: standalone door → <episode-path>?read (no bm)', () => {
  assert.equal(buildShareUrl({}, stdLoc('/burma-script/')), 'https://www.newpress.press/burma-script/?read');
  assert.equal(buildShareUrl({}, stdLoc('/palau-script/')), 'https://www.newpress.press/palau-script/?read');
});
ok('CALLER 2 — bookmark link: library door → /scripts-library/#<slug>?read&bm=<id>, never burma', () => {
  const url = buildShareUrl({ bm: 'bm_mrwdngqs_1_uolkv' }, libLoc('nile-river'));
  assert.equal(url, 'https://www.newpress.press/scripts-library/#nile-river?read&bm=bm_mrwdngqs_1_uolkv');
  assert.ok(!url.includes('/burma-script/'), 'the reported bug: must NOT be the burma standalone door');
});
ok('CALLER 2 — bookmark link: standalone door → <episode-path>?read&bm=<id>', () => {
  assert.equal(buildShareUrl({ bm: 'bm_p' }, stdLoc('/palau-script/')), 'https://www.newpress.press/palau-script/?read&bm=bm_p');
});

// ── ROUND TRIP THROUGH THE REAL PARSERS ─────────────────────────────────────────────────────────
// Feed the emitted URL back through read-mode.js (isReadOnly) and bookmark-target.js
// (bookmarkTargetFromUrl) — the ACTUAL parsers the app runs — so the flag composition is proven to
// resolve, not just string-matched. `new URL()` splits the emitted link exactly as the browser does.
const parse = (url) => { const u = new URL(url); return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash }; };

const roundTrip = (name, emittedLoc, expectBm) => ok(name, () => {
  const url = buildShareUrl(expectBm ? { bm: expectBm } : {}, emittedLoc);
  const parts = parse(url);
  // ?read resolves via the real read-mode scanner (recompute from a mocked window.location).
  const prevWindow = globalThis.window;
  try {
    globalThis.window = { location: { search: parts.search, hash: parts.hash } };
    assert.equal(__setReadOnlyForTest(), true, `${url} must resolve read-only`);
  } finally {
    globalThis.window = prevWindow;
    __setReadOnlyForTest(false); // leave the frozen module flag OFF for any later importer
  }
  // ?bm resolves via the real bookmark-target scanner (pure — pass the parsed loc directly).
  assert.equal(bookmarkTargetFromUrl(parts), expectBm || null, `${url} must resolve bm=${expectBm}`);
});

// CALLER 2 (bookmark) — read + bm must both resolve, on BOTH doors.
roundTrip('round-trip: bookmark link, standalone door — read+bm parses back', loc('https://newpress.press', { pathname: '/burma-script/' }), 'bm_std_1');
roundTrip('round-trip: bookmark link, library door — read+bm (hash-query) parses back', loc('https://www.newpress.press', { pathname: '/scripts-library/', hash: '#nile-river' }), 'bm_lib_1');
// CALLER 1 (READ LINK pill) — read must resolve with NO bm, on BOTH doors.
roundTrip('round-trip: READ LINK pill, standalone door — read resolves (no bm)', loc('https://newpress.press', { pathname: '/burma-script/' }), null);
roundTrip('round-trip: READ LINK pill, library door — read resolves (no bm)', loc('https://x.dev', { pathname: '/scripts-library/', hash: '#nile-river' }), null);

console.log(`\nshare-url: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
