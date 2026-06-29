// Verifier-layer test for the Lauterbrunnen menu's link helpers.
//
// CONTRACT (two distinct helpers — keep them distinct):
//   gmaps(q)            -> '/maps/search/?api=1&query=' + encodeURIComponent(q)
//   place(label, q)     -> <a href="${gmaps(q)}" ...>  — q is a PLAIN place name, search-wrapped.
//   placeUrl(label, url)-> <a href="${url}" ...>        — url is a FULL curated Maps URL, used directly.
//   trail(label, url)   -> <a href="${url}" ...>        — AllTrails URL, used directly.
//
// THE BUG CLASS this guards: a full Google Maps place URL (e.g. the Pension Gimmelwald
// deep-link with photos + place-id) must NOT be fed through gmaps()/search-wrapping —
// that produces /maps/search/?api=1&query=https%3A%2F%2F... so Maps searches for the
// literal URL string instead of opening the place. The page keeps two helpers precisely
// so a plain name search-wraps and a curated URL passes through untouched. This test
// locks BOTH halves so neither helper can quietly drift into the other's behavior.
//
// It EXTRACTS the real shipped gmaps/place/placeUrl/trail lines from index.html at runtime
// (regex + new Function) so it can't fall out of sync with a hand-mirrored copy.
// Mutation-proven: making place() use its arg directly turns the search-wrap assertions
// RED; making placeUrl()/trail() search-wrap turns the pass-through assertions RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function grabLine(src, marker) {
  const i = src.indexOf(marker);
  assert.notEqual(i, -1, `could not find "${marker}" in index.html`);
  const end = src.indexOf('\n', i);
  return src.slice(i, end === -1 ? src.length : end).trim();
}

function loadHelpers(source = html) {
  const lines = ['const gmaps =', 'const place =', 'const placeUrl =', 'const trail =']
    .map(m => grabLine(source, m));
  // ICON_PIN / ICON_TRAIL are referenced by the helpers; stub them so we don't depend on SVG.
  const code = `const ICON_PIN='[pin]'; const ICON_TRAIL='[trail]';\n${lines.join('\n')}\nreturn {place, placeUrl, trail};`;
  return new Function(code)();
}

const { place, placeUrl, trail } = loadHelpers();

// --- place(): plain place name -> /maps/search query (search-wrapped) ---
const q = place('Wengen', 'Wengen, Switzerland');
assert.match(q, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Wengen%2C%20Switzerland"/,
  'place() must wrap a plain name into a /maps/search query');
assert.ok(q.includes('[pin]Wengen'), 'place() must render the pin icon + label');
assert.ok(q.includes('rel="noopener"') && q.includes('target="_blank"'),
  'place() must keep the open-in-new-tab + noopener attrs');

// place() must NOT pass a value through raw even if it happens to look like a URL —
// that is placeUrl()'s job. (Guards against re-merging the two helpers.)
const placeWithUrl = place('x', 'https://example.com/foo');
assert.ok(!placeWithUrl.includes('href="https://example.com/foo"'),
  'place() must search-wrap, never use its arg directly as href');
assert.ok(placeWithUrl.includes('/maps/search/?api=1&query=https'),
  'place() search-wraps whatever it is given');

// --- placeUrl(): full Maps URL -> used DIRECTLY as the href ---
const realUrl = 'https://www.google.com/maps/place/Pension+Gimmelwald/@46.5466255,7.8925067,3a,75y,90t/data=!3m8';
const u = placeUrl('Pension Gimmelwald', realUrl);
assert.ok(u.includes(`href="${realUrl}"`),
  'placeUrl() must use the http(s) URL directly as the href, not search-wrap it');
assert.ok(!u.includes('/maps/search/?api=1&query=https'),
  'placeUrl() must NOT double-wrap a URL into a maps search query');
assert.ok(u.includes('[pin]Pension Gimmelwald'), 'placeUrl() renders the pin icon + label');
assert.ok(u.includes('rel="noopener"') && u.includes('target="_blank"'),
  'placeUrl() keeps the open-in-new-tab + noopener attrs');

// --- trail(): AllTrails URL -> used directly, with the trail icon ---
const t = trail('North Face Trail', 'https://www.alltrails.com/trail/x');
assert.ok(t.includes('href="https://www.alltrails.com/trail/x"'), 'trail() uses its URL directly');
assert.ok(t.includes('[trail]North Face Trail'), 'trail() renders the trail icon + label');
assert.ok(!t.includes('/maps/search/'), 'trail() never builds a maps search query');

// --- regression guard: the live page must still deep-link curated places via placeUrl(),
//     not regress to search-wrapping (or to deleting the deep-link entirely). ---
assert.ok(
  /placeUrl\("Pension Gimmelwald","https?:\/\//.test(html),
  'the live page should still deep-link Pension Gimmelwald via a full Maps URL through placeUrl()',
);
assert.ok(
  !/\bplace\("[^"]*","https?:\/\//.test(html),
  'no place() call should be fed a raw URL — those must go through placeUrl()',
);

console.log('place-link.test.mjs: 13 passed, 0 failed');
