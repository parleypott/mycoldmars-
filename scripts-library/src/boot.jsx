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

/** Inject a fixed "← Library" affordance (project mode only; engine stays unchanged). */
function injectLibraryBackbar() {
  if (document.getElementById('sl-backbar')) return;
  const a = document.createElement('a');
  a.id = 'sl-backbar';
  a.className = 'sl-backbar';
  a.href = '#library';
  a.textContent = '← Library';
  a.setAttribute('title', 'Back to the Script Library');
  document.body.appendChild(a);
}

async function mountLibrary() {
  mountedMode = 'library';
  const { mountLibrary: mount } = await import('./library.jsx');
  const el = document.getElementById('app');
  mount(el);
}

async function openProject(row) {
  mountedMode = row.slug;
  // Boot-order contract: select the episode FIRST, then dynamically import the engine.
  const { setEpisode } = await import('../../burma-script/src/episode-config.js');
  setEpisode(configForProject(row));
  touchProject(row.id); // float recently-opened to the top of the library
  await import('../../burma-script/src/main.jsx');
  injectLibraryBackbar();
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

  // Already mounted — the engine is a singleton, so any route CHANGE reloads cleanly.
  const target = isLibraryRoute(slug) ? 'library' : slug;
  if (target !== mountedMode) window.location.reload();
}

seedIfAbsent();
window.addEventListener('hashchange', applyRouteFromUrl);
window.addEventListener('popstate', applyRouteFromUrl);
applyRouteFromUrl();
