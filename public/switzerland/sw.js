// Los Petrey × Switzerland — offline service worker
const CACHE = 'lpch-v4';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.svg',
  'https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js',
  'https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:ital,opsz@0,6..72;1,6..72&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isMapboxHost = (host) => /(^|\.)mapbox\.com$/.test(host);

// Mapbox rotates a ?sku= (and ?access_token=) token on every tile/glyph/sprite
// request, but the resource itself is fully identified by origin + path (tile
// coords live in the path, not the query). So the CACHE KEY for a mapbox request
// is the query-stripped URL: every rotating token for the same tile collapses to
// one entry. Non-mapbox requests keep their full URL. Returning a string is fine —
// Cache.put() accepts a URL string as the key.
function cacheKeyFor(request) {
  const url = new URL(request.url);
  return isMapboxHost(url.host) ? url.origin + url.pathname : request;
}

// Cache-first with background refresh. The app shell + menu always work offline.
// Map tiles/terrain/glyphs are runtime-cached as you view them, so any area you've
// already looked at while online loads again offline. (Areas never viewed need a
// connection the first time — we don't bulk-download the whole region.)
// We READ mapbox with ignoreSearch AND WRITE under a query-stripped key, so a tile
// is stored ONCE, not once per rotating ?sku= token (which grew the cache without
// bound — the read ignored the token but the write kept minting new entries).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const isMapbox = isMapboxHost(url.host);
  const matchOpts = isMapbox ? { ignoreSearch: true } : undefined;
  const key = cacheKeyFor(e.request);
  e.respondWith(
    caches.match(e.request, matchOpts).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
