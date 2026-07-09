/*
 * share-url.test.mjs — the canonical READ-ONLY share link builder (Johnny 2026-07-09).
 *
 * buildShareUrl is the ONE place a shareable link is minted (full-script + bookmark deep-links). It
 * must ALWAYS point at the standalone read door (/burma-script/?read) regardless of where it's copied
 * from — never the login-gated library, never an editable URL — so a recipient always lands read-only
 * with no path to the library. If this drifts, Johnny hands out links that either 404, leak an edit
 * surface, or bounce a viewer into a login wall.
 */
import assert from 'node:assert/strict';
import { buildShareUrl } from './extensions/table.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };
const loc = (origin, extra = {}) => ({ origin, ...extra });

ok('full-script link forces the standalone read door', () => {
  assert.equal(buildShareUrl({}, loc('https://newpress.press')), 'https://newpress.press/burma-script/?read');
});

ok('bookmark link appends &bm=<id> after ?read', () => {
  assert.equal(buildShareUrl({ bm: 'bm_abc' }, loc('https://newpress.press')), 'https://newpress.press/burma-script/?read&bm=bm_abc');
});

ok('ALWAYS the read door, even when minted from the editable library route', () => {
  // copied while editing at /scripts-library/#burma?x=1 → still the read-only standalone door
  const url = buildShareUrl({}, loc('https://newpress.press', { pathname: '/scripts-library/', hash: '#burma', search: '?x=1' }));
  assert.equal(url, 'https://newpress.press/burma-script/?read');
});

ok('bm value is URL-encoded (never breaks the query on odd ids)', () => {
  assert.equal(buildShareUrl({ bm: 'a b/c' }, loc('https://x.dev')), 'https://x.dev/burma-script/?read&bm=a%20b%2Fc');
});

ok('no bookmark → no bm param at all', () => {
  assert.ok(!buildShareUrl({ bm: '' }, loc('https://x.dev')).includes('bm='));
  assert.ok(!buildShareUrl({}, loc('https://x.dev')).includes('bm='));
});

ok('every link carries ?read (the read-only share flag read-mode.js keys on)', () => {
  assert.match(buildShareUrl({}, loc('https://x.dev')), /[?&]read\b/);
  assert.match(buildShareUrl({ bm: 'z' }, loc('https://x.dev')), /[?&]read\b/);
});

console.log(`\nshare-url: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
