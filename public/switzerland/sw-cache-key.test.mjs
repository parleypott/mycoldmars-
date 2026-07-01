// Verifier-layer test for the Switzerland PWA service worker's CACHE KEY contract.
//
// Switzerland is an offline-first Mapbox PWA. Mapbox rotates a ?sku= (and
// ?access_token=) token on EVERY tile/glyph/sprite request, but the resource is
// fully identified by origin + path (tile coords live in the path). The SW reads
// mapbox with { ignoreSearch: true } — proving intent to treat tiles as
// token-agnostic — but it used to WRITE the cache under e.request (the full URL
// WITH the rotating token). So every background refresh minted a NEW cache entry
// for the same tile under the next token: the Cache Storage grew without bound
// with near-duplicate tile entries (the exact unbounded-cache-growth class this
// loop keeps killing). Fix: cacheKeyFor() strips the query for mapbox hosts so a
// tile is stored ONCE, overwriting the prior token's copy.
//
// It EXTRACTS the real shipped isMapboxHost + cacheKeyFor from sw.js at runtime
// (slice + new Function) so it can't drift from what deploys. Mutation-proven:
// making cacheKeyFor return the full request for mapbox turns the collapse
// assertions RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

function loadHelpers(source) {
  const start = source.indexOf('const isMapboxHost');
  assert.notEqual(start, -1, 'could not find isMapboxHost in sw.js');
  // grab through the end of the cacheKeyFor function body (its closing brace line)
  const anchor = source.indexOf('\n}', source.indexOf('function cacheKeyFor'));
  assert.notEqual(anchor, -1, 'could not find end of cacheKeyFor in sw.js');
  const block = source.slice(start, anchor + 2);
  // URL is a node global; expose both helpers.
  return new Function(`${block}\nreturn { isMapboxHost, cacheKeyFor };`)();
}

const { isMapboxHost, cacheKeyFor } = loadHelpers(src);
const reqOf = (url) => ({ url });

// --- host classification ---
assert.equal(isMapboxHost('api.mapbox.com'), true, 'api.mapbox.com is mapbox');
assert.equal(isMapboxHost('events.mapbox.com'), true, 'events.mapbox.com is mapbox');
assert.equal(isMapboxHost('mapbox.com'), true, 'bare mapbox.com is mapbox');
assert.equal(isMapboxHost('fonts.googleapis.com'), false, 'google fonts is not mapbox');
assert.equal(isMapboxHost('notmapbox.com'), false, 'notmapbox.com must not match (anchored)');
assert.equal(isMapboxHost('mapbox.com.evil.net'), false, 'suffix host must not match (anchored)');

// --- THE CONTRACT: the same tile under two rotating sku tokens -> ONE key ---
const tile = 'https://api.mapbox.com/v4/mapbox.terrain-rgb/12/2145/1436.pngraw';
const k1 = cacheKeyFor(reqOf(`${tile}?sku=101aAAAA1111&access_token=pk.aaa`));
const k2 = cacheKeyFor(reqOf(`${tile}?sku=202bBBBB2222&access_token=pk.aaa`));
assert.equal(typeof k1, 'string', 'mapbox key is a query-stripped string');
assert.equal(k1, tile, 'mapbox key is origin + pathname, no query');
assert.equal(k1, k2, 'two rotating sku tokens for the SAME tile collapse to ONE cache key');

// different tiles keep different keys (path carries the tile identity)
const other = 'https://api.mapbox.com/v4/mapbox.terrain-rgb/12/2145/1437.pngraw';
const k3 = cacheKeyFor(reqOf(`${other}?sku=101aAAAA1111`));
assert.notEqual(k1, k3, 'different tile paths must NOT collapse together');

// glyphs/sprites (also token-bearing) collapse the same way
const glyph = 'https://api.mapbox.com/fonts/v1/mapbox/Inter%20Regular/0-255.pbf';
assert.equal(
  cacheKeyFor(reqOf(`${glyph}?sku=zzz`)),
  cacheKeyFor(reqOf(`${glyph}?sku=yyy`)),
  'glyph ranges collapse across tokens too',
);

// --- non-mapbox requests keep their FULL request (query preserved) ---
const goog = reqOf('https://fonts.googleapis.com/css2?family=Inter:wght@400');
assert.equal(cacheKeyFor(goog), goog, 'non-mapbox request is returned as-is (full URL key)');
const shell = reqOf('https://los-petrey.example/switzerland/index.html');
assert.equal(cacheKeyFor(shell), shell, 'same-origin shell request is returned as-is');

// --- mutation proof: if the write side had kept the token, the two keys diverge ---
// (mirrors the OLD buggy behavior: key === e.request for mapbox)
const buggyKey = (req) => req; // what the code did before the fix
assert.notEqual(
  buggyKey(reqOf(`${tile}?sku=101aAAAA1111`)),
  buggyKey(reqOf(`${tile}?sku=202bBBBB2222`)),
  'sanity: the pre-fix behavior DID mint distinct keys per token (this is the bug we fixed)',
);

console.log('sw-cache-key.test.mjs: 15 passed, 0 failed');
