/* Burma Essays — offline service worker.
   Caches the app shell so the page opens with no internet, and serves
   saved audio from the device with full Range (seek/scrub) support. */
const SHELL = 'burma-shell-v3';
const API   = 'burma-api-v3';
const AUDIO = 'burma-audio-v1';            // user downloads — never auto-purged
const SHELL_URLS = ['/burma-essays/', '/burma-essays/index.html', '/burma-essays/manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // drop old shell/api caches, but keep the user's downloaded audio
    await Promise.all(keys.map((k) => {
      if (k === SHELL || k === API || k === AUDIO) return;
      if (k.startsWith('burma-shell-') || k.startsWith('burma-api-')) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

const isAudio = (url) => url.pathname.includes('/burma-audio/');
const isApi   = (url) => url.pathname === '/api/burma-essays';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ---- saved audio: cache-first, with Range support rebuilt from the blob ----
  if (isAudio(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(AUDIO);
      const hit = await cache.match(url.href, { ignoreVary: true });
      if (hit) return rangeFrom(hit, req);
      try { return await fetch(req); } catch { return new Response('', { status: 504 }); }
    })());
    return;
  }

  // ---- API: network-first, fall back to last cached response when offline ----
  if (isApi(url)) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(API);
        cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await caches.match(req);
        return hit || new Response(JSON.stringify({ essays: [] }), { headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // ---- app shell / same-origin: network-first, fall back to cache ----
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) { const cache = await caches.open(SHELL); cache.put(req, res.clone()); }
        return res;
      } catch {
        const hit = await caches.match(req) || await caches.match('/burma-essays/index.html');
        return hit || new Response('Offline', { status: 503 });
      }
    })());
  }
});

/* Build a 206 Partial Content response from a fully-cached audio blob so the
   browser can seek/scrub while offline. Falls back to the whole file if no Range. */
async function rangeFrom(res, req) {
  const range = req.headers.get('range');
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  if (!range) {
    return new Response(buf, { status: 200, headers: {
      'Content-Type': 'audio/mpeg', 'Content-Length': String(size), 'Accept-Ranges': 'bytes',
    }});
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end   = m[2] ? parseInt(m[2], 10) : size - 1;
  if (isNaN(start)) start = 0;
  if (isNaN(end) || end >= size) end = size - 1;
  if (start > end) start = 0;
  const chunk = buf.slice(start, end + 1);
  return new Response(chunk, { status: 206, headers: {
    'Content-Type': 'audio/mpeg',
    'Content-Length': String(chunk.byteLength),
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
  }});
}
