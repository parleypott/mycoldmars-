// GUEST PATH — Google-Docs-style link sharing for the Script Library.
//
// A signed-OUT visitor who lands on a project link (#<slug>, with or without ?read) gets the script
// READ-ONLY with no login — exactly like a Google Docs "anyone with the link can view" doc. The laws:
//
//   • STRUCTURALLY READ-ONLY: boot.jsx latches read-mode (forceReadOnly) BEFORE the engine imports,
//     so a bare #slug and #slug?read behave identically for a guest — the whole existing read-mode
//     surface (contenteditable=false, saveDoc/pushDoc refuse, no collab join, owner chrome hidden)
//     applies. Roles / workspaces / check-off (guest's own localStorage) keep working.
//   • THE INDEX NEVER LEAKS: a guest resolves ONE slug to ONE project via the scoped anonymous
//     endpoint (GET /api/script-projects?slug=…). This module NEVER fetches the project list, and the
//     server now refuses the list to anonymous callers anyway (belt + suspenders).
//   • NEVER THE LIBRARY: unknown slug, sharing OFF, and resolution failure all land on the same calm
//     branded "this script is private" page with a sign-in button — never a bounce into #library
//     (which stays behind the login gate exactly as before).
//   • ZERO CLOUD WRITES: the only network call here is the one scoped GET. No POST/PUT/PATCH/DELETE
//     exists in this module, no presence heartbeat, no project touch.

/**
 * Resolve one PUBLIC project by slug, anonymously. Returns the minimal wire row
 * ({id,slug,title,episode,updated_at}) or null for unknown / private / trashed / any failure —
 * the caller can't (and shouldn't) tell those apart; they all mean "show the private page".
 * NEVER throws. `fetchImpl` is a test seam.
 */
export async function resolvePublicProject(slug, fetchImpl = globalThis.fetch) {
  const s = String(slug || '').trim();
  if (!s) return null;
  try {
    const res = await fetchImpl(`/api/script-projects?slug=${encodeURIComponent(s)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res || !res.ok) return null;
    const body = await res.json().catch(() => null);
    const p = body && body.project;
    return (p && p.id && p.slug) ? p : null;
  } catch {
    return null;
  }
}

/**
 * PURE — shape the scoped wire row into the index-row shape configForProject expects.
 * Mirrors project-store's mergeCloudRows adoption (cloud UUID is the id → drives the
 * script_<id>_* namespace + /api/script-doc?project=<id>); a legacy episode pin
 * ('burma'|'palau'|'palau2') rides through so seeded projects mount their pinned config.
 */
export function rowForGuest(p) {
  if (!p || !p.id) return null;
  return {
    id: p.id,
    cloudId: p.id,
    slug: p.slug,
    title: p.title || 'Untitled Script',
    episode: p.episode ?? null,
    createdAt: null,
    updatedAt: p.updated_at || null,
    trashedAt: null,
  };
}

/**
 * The calm branded "this script is private" page. Shown INSIDE #app (so showGate()'s
 * hide-the-app behavior composes) for: sharing OFF, unknown slug, resolution failure.
 * `onSignIn` wires the button (boot passes gate.js requestSignIn).
 */
export function mountPrivateScriptPage(onSignIn) {
  const el = document.getElementById('app') || document.body;
  el.innerHTML = `
    <div class="sl-private">
      <div class="sl-private-inner">
        <div class="sl-gate-eyebrow">Newpress</div>
        <h1 class="sl-private-title">This script is private</h1>
        <p class="sl-private-sub">The link you followed isn’t shared right now.
        If you’re on the team, sign in. Otherwise ask whoever sent it to turn sharing on.</p>
        <button id="sl-private-signin" class="sl-gate-btn sl-gate-btn--primary">Sign in</button>
      </div>
    </div>`;
  const btn = el.querySelector('#sl-private-signin');
  if (btn && typeof onSignIn === 'function') {
    btn.addEventListener('click', (e) => { e.preventDefault(); onSignIn(); });
  }
  try { document.title = 'Private script — Newpress'; } catch {}
}

/**
 * The guest's replacement for the '< Library' backbar: a "Sign in" pill in the same spot.
 * A guest must have NO affordance that routes into the library index — the pill opens the
 * sign-in gate in place (and a successful sign-in reloads into the real session on this slug).
 */
export function injectGuestSignInPill(onSignIn) {
  if (document.getElementById('sl-guest-signin')) return;
  const a = document.createElement('a');
  a.id = 'sl-guest-signin';
  a.className = 'sl-backbar sl-guest-signin';
  a.href = '#';
  a.textContent = 'Sign in';
  a.setAttribute('title', 'Team member? Sign in to edit');
  a.setAttribute('aria-label', 'Sign in');
  a.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof onSignIn === 'function') onSignIn();
  });
  document.body.appendChild(a);
}
