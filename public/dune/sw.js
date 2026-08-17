// Offline-first service worker for /dune/. Caches the app shell on install and
// serves /dune/ assets cache-first so the essays + narration play with no signal.
const CACHE = 'dune-v1';
const SHELL = ['/dune/', '/dune/index.html', '/dune/essays.json', '/dune/manifest.webmanifest', '/dune/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!url.pathname.startsWith('/dune/')) return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        // runtime-cache successful GETs for audio/timing/json so first play makes them offline
        if (res.ok && e.request.method === 'GET') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
    })
  );
});
