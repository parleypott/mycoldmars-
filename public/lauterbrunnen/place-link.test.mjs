// Verifier-layer test for the Lauterbrunnen menu's place() link helper.
//
// THE BUG: place(label, q) always wrapped its second arg in a Google Maps SEARCH
// query: href = gmaps(q) = '/maps/search/?api=1&query=' + encodeURIComponent(q).
// That's right when q is a plain place name ("Wengen, Switzerland"). But entry 3,
// step 4 passes a FULL curated Google Maps place URL as q (the Pension Gimmelwald
// deep-link with photos + place-id). Wrapping a URL in a search query produces
//   /maps/search/?api=1&query=https%3A%2F%2Fwww.google.com%2Fmaps%2Fplace%2F...
// i.e. Maps searches for the literal URL string instead of opening the place — a
// degraded/broken link on a live page built for a friend.
//
// FIX: when q is already an http(s) URL, use it directly as the href; otherwise wrap
// in gmaps() as before. Byte-identical for every plain-query call; only the URL case
// changes (exactly the bug).
//
// The test EXTRACTS the real shipped gmaps + place lines from index.html at runtime
// (regex + new Function) so it can't drift from a mirror. Mutation-proven: the old
// `href="${gmaps(q)}"` form turns the URL-passthrough assertions RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function grabLine(src, marker) {
  const i = src.indexOf(marker);
  assert.notEqual(i, -1, `could not find "${marker}" in index.html`);
  const end = src.indexOf('\n', i);
  return src.slice(i, end === -1 ? src.length : end).trim();
}

function loadPlace(source = html) {
  const gmapsLine = grabLine(source, 'const gmaps =');
  const placeLine = grabLine(source, 'const place =');
  // ICON_PIN is referenced by place(); stub it to a sentinel so we don't depend on its SVG.
  const code = `const ICON_PIN = '[pin]';\n${gmapsLine}\n${placeLine}\nreturn place;`;
  return new Function(code)();
}

const place = loadPlace();

// --- plain query: wrapped in a maps SEARCH (unchanged behavior) ---
const q = place('Wengen', 'Wengen, Switzerland');
assert.match(q, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Wengen%2C%20Switzerland"/,
  'plain place name must still build a /maps/search query');
assert.ok(q.includes('[pin]Wengen'), 'label + pin icon must render');

// --- full place URL: used DIRECTLY as the href (the fix) ---
const realUrl = 'https://www.google.com/maps/place/Pension+Gimmelwald/@46.5466255,7.8925067,3a,75y,90t/data=!3m8';
const u = place('Pension Gimmelwald', realUrl);
assert.ok(u.includes(`href="${realUrl}"`),
  'an http(s) URL must be used directly as the href, not search-wrapped');
assert.ok(!u.includes('/maps/search/?api=1&query=https'),
  'a URL must NOT be double-wrapped into a maps search query');
assert.ok(u.includes('rel="noopener"') && u.includes('target="_blank"'),
  'security/open-in-new-tab attrs preserved');

// http (not just https) also passes through directly
const h = place('x', 'http://example.com/foo');
assert.ok(h.includes('href="http://example.com/foo"'), 'http URLs pass through too');

// The shipped page must actually exercise the URL path (regression guard against the
// data being "fixed" by removing the deep-link rather than keeping it working).
assert.ok(
  /place\("Pension Gimmelwald","https?:\/\//.test(html),
  'the live page should still deep-link Pension Gimmelwald via a full Maps URL',
);

console.log('place-link.test.mjs: 7 passed, 0 failed');
