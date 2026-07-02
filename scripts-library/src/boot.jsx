// Script Library entry — hash-routed home + project router.
//
// The URL is the SOURCE OF TRUTH (mirrors the Interpreter's applyRouteFromUrl):
//   • ''  / '#'  / '#library'  → the LIBRARY landing.
//   • '#<slug>'                → OPEN that project by resolving its index row,
//                                setEpisode(configForProject(row)), THEN dynamically
//                                importing the shared engine (../../burma-script/src/
//                                main.jsx). The dynamic import is the load-bearing
//                                boot-order contract: setEpisode() MUST run before
//                                the engine's module-level `const EPISODE =
//                                getEpisode()` (and document-builder's episode-derived
//                                regexes) evaluate. A static import would hoist above
//                                setEpisode and read the default episode too early.
//
// The engine is a singleton module (its EPISODE is captured once at import), so
// switching between mounted routes RELOADS the page — v1 "open" is reload-to-hash,
// which is fine and keeps state trivially correct. A "← Library" affordance is
// injected into the page in project mode (the engine files stay UNCHANGED).

import { seedIfAbsent, findBySlug, touchProject } from './project-store.js';
import { configForProject } from './config-for-project.js';
import { ensureUnlocked } from './gate.js';

const RESERVED_LIBRARY = new Set(['', 'library', 'home']);

// What the CURRENT DOM is showing, so a hashchange knows whether it must reload.
let mountedMode = null; // 'library' | '<slug>'

/** Read the active route slug from the URL hash (decoded, trimmed). */
function currentSlug() {
  let raw = String(window.location.hash || '').replace(/^#/, '');
  try { raw = decodeURIComponent(raw); } catch {}
  return raw.trim();
}

function isLibraryRoute(slug) {
  return RESERVED_LIBRARY.has(slug);
}

/**
 * Inject a fixed "Library" button (project mode only; the engine files stay
 * UNCHANGED). It's a real pill button with a back-chevron, not a bare link, so
 * it reads as navigation. Clicking it hard-navigates to the library route.
 */
function injectLibraryBackbar() {
  if (document.getElementById('sl-backbar')) return;
  const a = document.createElement('a');
  a.id = 'sl-backbar';
  a.className = 'sl-backbar';
  a.href = '#library';
  a.innerHTML = '<span class="sl-backbar-chev" aria-hidden="true">‹</span> Library';
  a.setAttribute('title', 'Back to the Script Library');
  a.setAttribute('aria-label', 'Back to the Script Library');
  document.body.appendChild(a);
}

// ── Full-screen loading veil ─────────────────────────────────────────────────
// Shown while a project's engine chunk (~200KB) dynamically imports, so opening
// a script never flashes a blank screen. Removed once the engine has mounted.
function showLoadingVeil(label) {
  let v = document.getElementById('sl-loading-veil');
  if (!v) {
    v = document.createElement('div');
    v.id = 'sl-loading-veil';
    v.className = 'sl-loading-veil';
    v.innerHTML = `
      <div class="sl-loading-inner">
        <div class="sl-loading-mark">SCRIPTS</div>
        <div class="sl-loading-spinner" aria-hidden="true"></div>
        <div class="sl-loading-label"></div>
      </div>`;
    document.body.appendChild(v);
  }
  v.querySelector('.sl-loading-label').textContent = label || 'Loading…';
  v.classList.remove('sl-veil-out');
  return v;
}
function hideLoadingVeil() {
  const v = document.getElementById('sl-loading-veil');
  if (!v) return;
  v.classList.add('sl-veil-out');
  setTimeout(() => { v.remove(); }, 260);
}

async function mountLibrary() {
  mountedMode = 'library';
  // A library that's already been imported paints instantly from localStorage;
  // only the very first import needs the veil. Keep it lightweight.
  const el = document.getElementById('app');
  try {
    const { mountLibrary: mount } = await import('./library.jsx');
    mount(el);
  } finally {
    hideLoadingVeil();
  }
}

async function openProject(row) {
  mountedMode = row.slug;
  showLoadingVeil(`Opening ${row.title || 'script'}…`);
  try {
    // Boot-order contract: select the episode FIRST, then dynamically import the engine.
    const { setEpisode } = await import('../../burma-script/src/episode-config.js');
    setEpisode(configForProject(row));
    touchProject(row.id); // float recently-opened to the top of the library
    await import('../../burma-script/src/main.jsx');
    injectLibraryBackbar();
    // PRESENCE (Wave 2): show who else is in this project. Fire-and-forget from the library layer so the
    // engine files stay UNCHANGED. Pass the cloud id when we have it, else the slug — the endpoint
    // resolves either. A local-only project (no cloud row) resolves to an empty list and renders nothing.
    import('./presence.js')
      .then((m) => m.startPresence(row.cloudId || row.slug))
      .catch(() => {});
  } finally {
    // The engine mounts synchronously after import; give it a beat to paint,
    // then lift the veil so there's no blank flash between veil and script.
    setTimeout(hideLoadingVeil, 120);
  }
}

/** Single reconciler wired to hashchange + popstate. */
async function applyRouteFromUrl() {
  const slug = currentSlug();

  // First paint — nothing mounted yet.
  if (mountedMode === null) {
    if (isLibraryRoute(slug)) return mountLibrary();
    const row = findBySlug(slug);
    if (!row || row.trashedAt) {
      // Unknown / trashed slug → fall back to the library (URL rewrite re-triggers us).
      window.location.hash = 'library';
      return mountLibrary();
    }
    return openProject(row);
  }

  // Already mounted — the engine is a singleton, so any route CHANGE reloads
  // cleanly. Raise the veil BEFORE the reload so the swap reads as a smooth
  // transition, not a white flash. (The reload re-runs boot, which paints the
  // target and lifts the veil again.)
  const target = isLibraryRoute(slug) ? 'library' : slug;
  if (target !== mountedMode) {
    showLoadingVeil(isLibraryRoute(slug) ? 'Back to Library…' : 'Opening…');
    window.location.reload();
  }
}

seedIfAbsent();
window.addEventListener('hashchange', applyRouteFromUrl);
window.addEventListener('popstate', applyRouteFromUrl);

// Gate FIRST — show the sign-in screen (or unlock immediately if already signed
// in / auth unconfigured), THEN route into the library or a project. The engine
// only mounts behind a valid session, and the fetch interceptor is installed so
// /api/admin-users receives the caller's JWT for the ADMIN_EMAILS check.
ensureUnlocked().then(() => applyRouteFromUrl());
