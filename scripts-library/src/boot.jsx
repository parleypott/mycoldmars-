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

import { seedIfAbsent, findBySlug, touchProject, renameProject, healSlugDrift } from './project-store.js';
import { configForProject } from './config-for-project.js';
import { ensureUnlocked, detectSession, requestSignIn, hideGate } from './gate.js';
import { resolvePublicProject, rowForGuest, mountPrivateScriptPage, injectGuestSignInPill } from './guest.js';
import { armSentry } from '../../burma-script/src/sentry-boot.js';

const RESERVED_LIBRARY = new Set(['', 'library', 'home']);

// What the CURRENT DOM is showing, so a hashchange knows whether it must reload.
let mountedMode = null; // 'library' | '<slug>'

/** Read the active route slug from the URL hash (decoded, trimmed). */
function currentSlug() {
  let raw = String(window.location.hash || '').replace(/^#/, '');
  // Hash-query (#slug?backups) carries per-open FLAGS the engine reads (showAdminBackups,
  // read-mode) — it is not part of the slug. Without this strip the library's Backups entry
  // routed to a nonexistent "slug?backups" project and bounced to the library.
  const q = raw.indexOf('?');
  if (q >= 0) raw = raw.slice(0, q);
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

/**
 * IN-EDITOR RENAME. The shared engine renders the script's name as a static <h1 class="wp-masthead-title">
 * from config (main.jsx DOC_TITLE) with NO rename path — the engine stays library-agnostic. The library
 * wires renaming here, same posture as the back-bar. Click the title → an OVERLAY input (appended to
 * <body>, positioned over the h1) opens; the overlay avoids mutating the Preact-owned <h1> in place,
 * which a re-render would clobber. Commit → renameProject (title + cloud PATCH; slug regenerated) →
 * point the hash at the new slug and reload, so the engine remounts from the renamed config (h1 text and
 * document.title both refresh). Renames project metadata only — never the Yjs doc — so it's collab-safe.
 * Polls a few frames because the engine mounts asynchronously after its dynamic import resolves.
 */
function injectMastheadRename(row, tries = 0) {
  const titleEl = document.querySelector('.wp-masthead-title');
  if (!titleEl) {
    // The engine mounts ASYNCHRONOUSLY after its import resolves (rehydrate → migrate → render),
    // so the masthead can appear a few seconds later. Poll via setTimeout (NOT requestAnimationFrame,
    // which throttles hard in a background tab) for ~10s before giving up.
    if (tries < 200) setTimeout(() => injectMastheadRename(row, tries + 1), 50);
    return;
  }
  if (titleEl.dataset.renameWired) return;
  titleEl.dataset.renameWired = '1';
  titleEl.classList.add('sl-renamable');
  titleEl.setAttribute('title', 'Click to rename');

  titleEl.addEventListener('click', () => {
    if (document.getElementById('sl-masthead-rename')) return;
    const rect = titleEl.getBoundingClientRect();
    const cs = getComputedStyle(titleEl);
    const current = String(row.title || titleEl.textContent || '').trim();
    const input = document.createElement('input');
    input.id = 'sl-masthead-rename';
    input.value = current;
    Object.assign(input.style, {
      position: 'fixed',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: Math.max(rect.width + 24, 240) + 'px',
      minHeight: rect.height + 'px',
      font: cs.font,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      color: cs.color,
      background: 'var(--frame, #efeadd)',
      border: '2px solid var(--orange, #ff5b1f)',
      borderRadius: '8px',
      padding: '2px 8px',
      margin: '0',
      zIndex: '9999',
      outline: 'none',
      boxSizing: 'border-box',
    });
    document.body.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      input.remove();
      if (commit && next && next !== current) {
        const updated = renameProject(row.id, next);
        const slug = (updated && updated.slug) || row.slug;
        try { history.replaceState(null, '', '#' + encodeURIComponent(slug)); } catch {}
        mountedMode = slug; // keep the route reconciler in sync across the reload
        showLoadingVeil('Renaming…');
        window.location.reload();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  });
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
    // Wire in-editor rename — but never on a ?read share (structurally read-only).
    import('../../burma-script/src/read-mode.js')
      .then((m) => { if (!m.isReadOnly()) injectMastheadRename(row); })
      .catch(() => {});
    // PRESENCE (Wave 2): show who else is in this project. Fire-and-forget from the library layer so the
    // engine files stay UNCHANGED. Pass the cloud id when we have it, else the slug — the endpoint
    // resolves either. A local-only project (no cloud row) resolves to an empty list and renders nothing.
    import('./presence.js')
      .then((m) => m.startPresence(row.cloudId || row.slug))
      .catch(() => {});
    // DRIFT HEAL (Wave 2 slug-sync): reconcile this project's cloud slug with the local one. Background,
    // once per session. Renames done before slug-sync left the cloud slug stale — this pushes the local
    // slug up (the owner's URL is the shared one). If it instead ADOPTS the cloud slug (collision /
    // teammate rename), realign the URL + route state so a refresh resolves and future opens use it.
    healSlugDrift(row)
      .then((res) => {
        if (res && res.action === 'adopted' && res.slug) {
          try { history.replaceState(null, '', '#' + encodeURIComponent(res.slug)); } catch {}
          mountedMode = res.slug;
        }
      })
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

// ── GUEST PATH (Google-Docs link sharing) ────────────────────────────────────
// A signed-OUT visitor on a PROJECT link opens the script READ-ONLY with no login. Contract:
//   • the engine is FORCE-latched read-only BEFORE it imports — bare #slug and #slug?read are
//     identical for a guest (the whole existing ?read surface applies: no saves, no collab join,
//     owner chrome hidden; roles/workspaces/check-off still work)
//   • slug resolution is SCOPED (resolvePublicProject → /api/script-projects?slug=) — a guest
//     boot NEVER fetches the project list, so the library index can't leak
//   • unknown / private / trashed slug → the calm "this script is private" page, NEVER the library
//   • ZERO cloud writes: no touchProject cloud echo, no presence heartbeat, no rename wiring;
//     the guest chrome is a "Sign in" pill instead of the '< Library' backbar
async function openProjectAsGuest(slug) {
  mountedMode = slug; // the reconciler treats this route as mounted (hash edits → reload → re-boot)
  showLoadingVeil('Opening…');
  // index.html ships #app with .sl-hidden; on the signed-in road hideGate() (via detectSession/
  // ensureUnlocked) strips it. The guest road must strip it too or the mounted script paints nothing.
  hideGate();
  const pub = await resolvePublicProject(slug);
  if (!pub) {
    hideLoadingVeil();
    return mountPrivateScriptPage(requestSignIn);
  }
  try {
    // ORDER IS LOAD-BEARING: latch read-only, then select the episode, THEN import the engine —
    // read-mode/episode state must be final before main.jsx's module-level consumers evaluate.
    const { forceReadOnly } = await import('../../burma-script/src/read-mode.js');
    forceReadOnly();
    const { setEpisode } = await import('../../burma-script/src/episode-config.js');
    setEpisode(configForProject(rowForGuest(pub)));
    await import('../../burma-script/src/main.jsx');
    injectGuestSignInPill(requestSignIn);
  } finally {
    setTimeout(hideLoadingVeil, 120);
  }
}

// Route-change dispatch. SIGNED-IN (or open-mode) sessions keep the exact old reconciler. A GUEST
// session must NEVER run applyRouteFromUrl: its unknown-slug fallback is `hash='library'; mountLibrary()`
// — which, fired from a hash edit while the guest sits on the sign-in wall (mountedMode null,
// localStorage seeded), would mount the library INDEX into the (hidden) DOM with no session. Live-caught
// hole. For guests every route CHANGE is a full reload instead — boot re-runs and re-routes it down the
// guest/gate fork; a same-route hash tweak (e.g. ?read appearing) stays a no-op, matching the old feel.
let guestSession = false;
function onRouteEvent() {
  if (!guestSession) return applyRouteFromUrl();
  const slug = currentSlug();
  const target = isLibraryRoute(slug) ? 'library' : slug;
  if (mountedMode !== null && target === mountedMode) return; // same route — nothing to do
  showLoadingVeil(target === 'library' ? 'Loading…' : 'Opening…');
  window.location.reload();
}

seedIfAbsent();
window.addEventListener('hashchange', onRouteEvent);
window.addEventListener('popstate', onRouteEvent);

// Gate FIRST — but the gate now has a GUEST-shaped hole in it, scoped to project links:
//   • signed in / auth unconfigured → exactly the old flow (edit access, library, everything)
//   • signed OUT + library route     → the sign-in wall, exactly as before
//   • signed OUT + project slug      → the guest read-only path above (no login anywhere)
// The fetch interceptor is installed by detectSession either way, so a signed-in session's
// /api/* calls carry the JWT and a guest's carry nothing.
(async () => {
  const session = await detectSession();
  if (session === 'guest') {
    guestSession = true; // flips the route reconciler to reload-on-change (see onRouteEvent)
    const slug = currentSlug();
    if (!isLibraryRoute(slug)) return openProjectAsGuest(slug);
    await ensureUnlocked(); // library route stays walled — resolves after sign-in
    guestSession = false;   // signed in mid-session: back to the normal reconciler
    return applyRouteFromUrl();
  }
  return applyRouteFromUrl();
})();

// Error monitoring — lazy chunk after first paint, clean no-op without VITE_SENTRY_DSN.
// One shot per page load is enough to tag correctly: a route CHANGE reloads the page
// (engine singleton), so the tag chosen here is the tag for this whole page lifetime.
armSentry({ episode: isLibraryRoute(currentSlug()) ? 'library' : currentSlug() });
