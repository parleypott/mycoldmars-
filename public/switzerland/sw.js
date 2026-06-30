// Los Petrey × Switzerland — offline service worker
const CACHE = 'lpch-v1';
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

// Cache-first with background refresh. The app shell + menu always work offline.
// Map tiles/terrain/glyphs are runtime-cached as you view them, so any area you've
// already looked at while online loads again offline. (Areas never viewed need a
// connection the first time — we don't bulk-download the whole region.)
// Mapbox appends a rotating ?sku= token to every tile request; we ignore the query
// string for mapbox hosts so a tile cached under one token still serves under the next.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const isMapbox = /(^|\.)mapbox\.com$/.test(url.host);
  const matchOpts = isMapbox ? { ignoreSearch: true } : undefined;
  e.respondWith(
    caches.match(e.request, matchOpts).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
