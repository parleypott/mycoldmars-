// Script Library — OFFLINE APP-SHELL client glue.
//
// Registers the service worker (public/scripts-library/sw.js), exposes a
// warmOfflineCache() the Offline Lock uses as its pre-flight handshake ("make
// SURE everything this page needs is on the device before we lose the network"),
// and publishes a coarse online/offline signal other modules can read.
//
// The DOCUMENT already persists offline (the engine's localStorage/IndexedDB are
// the offline source of truth). This module only guarantees the APP CODE (HTML +
// hashed chunks + fonts) is on-device so a reload at altitude still paints.

let _reg = null;

// Register scoped to /scripts-library/ ONLY — this origin hosts ~50 apps and a
// root-scope worker would hijack all of them. Best-effort: any failure is a
// no-op (the app still works online, exactly as before the worker existed).
export function registerOfflineShell() {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (typeof window === 'undefined') return;
    // Register after load so it never competes with the auth gate / first paint.
    const go = () => {
      navigator.serviceWorker
        .register('/scripts-library/sw.js', { scope: '/scripts-library/' })
        .then((reg) => { _reg = reg; })
        .catch(() => {});
    };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  } catch {}
}

// Enumerate the asset graph THIS page has actually loaded — the entry HTML, every
// <script>/<link> the built page pulled, the hashed chunks the browser has already
// fetched (Resource Timing), and the two font origins. This is the exact set the
// editor needs offline; handing it to the SW's WARM guarantees each one is cached
// rather than merely "probably cached from browsing".
function collectAssetUrls() {
  const urls = new Set(['/scripts-library/', '/scripts-library/index.html']);
  const add = (u) => {
    if (!u) return;
    try {
      const url = new URL(u, location.origin);
      if (url.pathname.startsWith('/api/')) return;                 // never warm /api/*
      const sameOrigin = url.origin === location.origin;
      const isFont = url.origin === 'https://fonts.googleapis.com' ||
                     url.origin === 'https://fonts.gstatic.com';
      if (sameOrigin || isFont) urls.add(url.href);
    } catch {}
  };
  try {
    document.querySelectorAll('script[src]').forEach((s) => add(s.getAttribute('src')));
    document.querySelectorAll('link[href]').forEach((l) => {
      const rel = (l.getAttribute('rel') || '').toLowerCase();
      if (rel.includes('stylesheet') || rel.includes('manifest') || rel.includes('preload') || rel.includes('modulepreload')) {
        add(l.getAttribute('href'));
      }
    });
    // Hashed code-split chunks + fonts the browser already fetched this session.
    if (performance && performance.getEntriesByType) {
      performance.getEntriesByType('resource').forEach((r) => add(r.name));
    }
  } catch {}
  return Array.from(urls);
}

// Ask the SW to cache the full current asset graph and wait for it to confirm.
// Resolves { ok, total, cached } (ok:false if there's no controller yet). The
// Offline Lock awaits this so it only tells Johnny "ready for offline" once the
// bytes are truly on the device. NEVER throws.
export function warmOfflineCache(extraUrls = []) {
  return new Promise((resolve) => {
    try {
      const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!ctrl) { resolve({ ok: false, reason: 'no-controller' }); return; }
      const urls = collectAssetUrls().concat(Array.isArray(extraUrls) ? extraUrls : []);
      const ch = new MessageChannel();
      const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout', total: urls.length }), 20000);
      ch.port1.onmessage = (ev) => {
        clearTimeout(timer);
        const d = ev.data || {};
        resolve({ ok: !!d.ok, total: d.total, cached: d.cached });
      };
      ctrl.postMessage({ type: 'WARM', urls }, [ch.port2]);
    } catch {
      resolve({ ok: false, reason: 'error' });
    }
  });
}

// Coarse connectivity signal. navigator.onLine is a weak hint (true on captive
// portals), but combined with the engine's structural push-failure detection it's
// good enough to drive UI (the offline badge) and to decide when to drain queues.
export function isOnline() {
  try { return typeof navigator === 'undefined' ? true : navigator.onLine !== false; }
  catch { return true; }
}

// Subscribe to online/offline transitions. Returns an unsubscribe fn.
export function onConnectivityChange(handler) {
  const on = () => { try { handler(true); } catch {} };
  const off = () => { try { handler(false); } catch {} };
  try {
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
  } catch {}
  return () => {
    try { window.removeEventListener('online', on); } catch {}
    try { window.removeEventListener('offline', off); } catch {}
  };
}
