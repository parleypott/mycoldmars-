/* Newpress Scripts — OFFLINE APP-SHELL service worker.
   ============================================================================
   Purpose: make /scripts-library/ open and run with ZERO internet — the plane
   case. The DOCUMENT already survives offline (the engine's localStorage +
   IndexedDB are the offline source of truth); what the network is still needed
   for today is loading the APP ITSELF (HTML + hashed JS/CSS chunks + fonts).
   This worker precaches/ runtime-caches exactly that, so a reload at 35,000 ft
   still paints the editor.

   SCOPE DISCIPLINE (landmine): this origin serves ~50 apps off one domain
   (/burma-script, /qss, /walden, /burgundy, /ascent, /burma-essays already owns
   its own SW ...). This worker is served FROM /scripts-library/sw.js and
   registered with an explicit { scope: '/scripts-library/' }, so it can only
   ever control /scripts-library/* navigations. It must NEVER hijack a sibling
   app. The one shared surface is the hashed /assets/ pool — we cache-first
   those by their content-hashed (immutable) URL, which is safe for every app.

   API DISCIPLINE (landmine — data integrity): /api/* is NEVER touched. Caching
   a script-doc PUT/GET, a liveblocks-auth token mint, or an image upload would
   corrupt saves or leak a token across viewers — worse than being offline. We
   bail on every non-GET and on any /api/ path before any cache logic runs.

   STALE-BUNDLE DISCIPLINE (landmine): assets are content-hashed and the
   version-beacon (burma-script/src/version-beacon.js) watches the live HTML for
   new asset signatures to detect deploys. So the navigation HTML stays
   NETWORK-FIRST — a fresh deploy's new hashes are always seen when online, and
   the beacon keeps working. Cache is only the FALLBACK when the network fails.
   Only immutable /assets/<hash> files are cache-FIRST.
   ============================================================================ */

const VERSION = 'v1';
const SHELL = 'sl-shell-' + VERSION;   // navigations + hashed app assets
const FONTS = 'sl-fonts-' + VERSION;   // cross-origin Google Fonts (css + woff2)

// The bare minimum to guarantee a boot even on a cold worker: the entry HTML.
// Everything else (hashed chunks, fonts) is captured by the fetch handler on
// the first online visit, and can be force-warmed via warmOfflineCache() below.
const SHELL_URLS = ['/scripts-library/', '/scripts-library/index.html'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // Drop superseded scripts-library caches (bumping VERSION invalidates all),
    // but leave every OTHER app's caches (burma-*, etc.) untouched.
    await Promise.all(keys.map((k) => {
      if (k === SHELL || k === FONTS) return;
      if (k.startsWith('sl-shell-') || k.startsWith('sl-fonts-')) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const isFont = (url) => FONT_ORIGINS.includes(url.origin);
const isApi = (url) => url.pathname.startsWith('/api/');
const isImmutableAsset = (url) =>
  url.origin === location.origin && url.pathname.startsWith('/assets/');
const inScope = (url) =>
  url.origin === location.origin && url.pathname.startsWith('/scripts-library/');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Only GETs are ever cacheable. Everything else (PUT/POST saves, uploads) → pass through.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ── /api/* — NEVER cache. Pass straight to the network. ─────────────────────
  if (isApi(url)) return;

  // ── Fonts (cross-origin) — cache-first, revalidate in background. ───────────
  // First online load fills this; offline serves the cached faces so the mono
  // chrome + reading serifs render on the plane without a CDN round-trip.
  if (isFont(url)) {
    e.respondWith(cacheFirst(req, FONTS));
    return;
  }

  // ── Immutable hashed assets — cache-first (hash IS the version). ────────────
  if (isImmutableAsset(url)) {
    e.respondWith(cacheFirst(req, SHELL));
    return;
  }

  // ── In-scope navigation / same-origin shell — NETWORK-FIRST, cache fallback ─
  // Network-first keeps the version-beacon honest (new hashes seen when online)
  // and never pins a dead bundle. When the network is gone/flaky, fall back to
  // the cached response, then to the app-shell index so deep links (#slug, ?read)
  // still boot offline and route client-side.
  if (inScope(url)) {
    const isNavigation = req.mode === 'navigate' ||
      (req.headers.get('accept') || '').includes('text/html');
    e.respondWith(networkFirst(req, SHELL, isNavigation));
    return;
  }
  // Anything else same-origin (favicons, og images, /fonts if ever self-hosted):
  // opportunistic cache-first so it survives offline too, but never required.
  if (url.origin === location.origin) {
    e.respondWith(cacheFirst(req, SHELL));
  }
});

// Cache-first: serve the cached copy if present; otherwise fetch, cache a clone,
// and return it. Opaque cross-origin font responses are cacheable and replayable.
// NEVER throws — a miss with no network returns a 504 the caller can degrade on.
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

// Network-first with a short timeout so flaky plane wifi can't hang the paint:
// race the fetch against NAV_TIMEOUT; on success cache a clone and return; on
// failure/timeout return the cached response, then the app-shell index for a
// navigation, then a plain Offline stub. NEVER throws.
const NAV_TIMEOUT = 3500;
async function networkFirst(req, cacheName, isNavigation) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(req), NAV_TIMEOUT);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    if (isNavigation) {
      const shell = await cache.match('/scripts-library/index.html', { ignoreVary: true }) ||
                    await cache.match('/scripts-library/', { ignoreVary: true });
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); },
                 (e) => { clearTimeout(t); reject(e); });
  });
}

// ── EXPLICIT CACHE WARM (the pre-flight handshake) ─────────────────────────────
// The page posts { type:'WARM', urls:[...] } right before going offline (e.g. when
// Johnny arms the Offline Lock). We fetch+cache each URL so the exact asset graph
// the editor needs — including the code-split engine chunks that only load once a
// project is opened — is guaranteed present offline, not merely "probably cached".
// Replies { type:'WARM_DONE', ok, total, cached } to the client's MessageChannel port.
self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type !== 'WARM' || !Array.isArray(data.urls)) return;
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    const fonts = await caches.open(FONTS);
    let cached = 0;
    await Promise.all(data.urls.map(async (u) => {
      try {
        const url = new URL(u, location.origin);
        if (isApi(url)) return;                       // never warm /api/*
        const target = isFont(url) ? fonts : shell;
        if (await target.match(u, { ignoreVary: true })) { cached++; return; }
        const res = await fetch(u, isFont(url) ? { mode: 'cors' } : undefined);
        if (res && (res.ok || res.type === 'opaque')) { await target.put(u, res.clone()); cached++; }
      } catch {}
    }));
    const port = e.ports && e.ports[0];
    if (port) port.postMessage({ type: 'WARM_DONE', ok: true, total: data.urls.length, cached });
  })());
});
