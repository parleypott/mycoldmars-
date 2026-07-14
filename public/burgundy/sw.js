/* BERGUNDY reader — offline service worker.
   Strategy per resource:
   · the shell (this page)      network-first, cache fallback → readable with zero signal
   · book.json                  network-first (fresh publishes win), cache fallback offline
   · paragraph audio (supabase) cache-first — the files are content-hashed and immutable;
                                capped so a long book can't eat the device
   · google fonts               cache-first (immutable)
   · notes API                  network only (the page queues writes itself offline)      */

const SHELL = 'bg-shell-v1';
const DATA = 'bg-data-v2';
const AUDIO = 'bg-audio-v1';
const FONTS = 'bg-fonts-v1';
const AUDIO_CAP = 80;   // most-recent paragraphs; ~1 long chapter of listening

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(['/burgundy/', '/burgundy/index.html'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, DATA, AUDIO, FONTS]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw new Error('offline, uncached');
  }
}
async function cacheFirst(req, cacheName, cap) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    if (cap) {
      const keys = await cache.keys();
      for (let i = 0; i < keys.length - cap; i++) await cache.delete(keys[i]);
    }
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;   // note POSTs etc. go straight through

  if (url.pathname === '/burgundy/book.json') {
    // exactly ONE slot for the book: freshest copy wins, cache can't grow
    e.respondWith((async () => {
      const cache = await caches.open(DATA);
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put('/burgundy/book.json', res.clone());
        return res;
      } catch {
        const hit = await cache.match('/burgundy/book.json');
        if (hit) return hit;
        throw new Error('offline, uncached');
      }
    })()); return;
  }
  if (url.hostname.endsWith('.supabase.co') && url.pathname.includes('/burgundy-audio/')) {
    e.respondWith(cacheFirst(e.request, AUDIO, AUDIO_CAP)); return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(e.request, FONTS)); return;
  }
  if (url.pathname === '/burgundy/' || url.pathname === '/burgundy/index.html' || url.pathname === '/burgundy') {
    e.respondWith(networkFirst(e.request, SHELL)); return;
  }
});
