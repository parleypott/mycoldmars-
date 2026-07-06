// Gate — the sign-in screen shown before the Script Library. Mirrors
// translation/src/gate.js, trimmed to email+password (+ magic-link fallback).
//
// Runs BEFORE boot.jsx mounts the library. Installs a fetch interceptor that
// injects `Authorization: Bearer <jwt>` on same-origin /api/* calls so
// /api/admin-users receives the caller's session for the ADMIN_EMAILS check.
//
// If Supabase isn't configured (no VITE_SUPABASE_URL/ANON_KEY), the app runs
// OPEN — the gate never shows and boot() proceeds immediately (Palau posture).

import { bootstrap, signInWithPassword, sendMagicLink, currentUser, onAuthChange, authRequired, getFreshAccessToken } from './auth.js';
import { readSupabaseAccessTokenSync, tokenExpiresWithin } from './auth-token.js';

// ── Fetch interceptor: Bearer JWT on same-origin /api/* ──────────────────────
function installApiFetchInterceptor() {
  if (window.__slApiFetchPatched) return;
  window.__slApiFetchPatched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const isApi = url && (
        url.startsWith('/api/') ||
        (url.startsWith(window.location.origin) && url.slice(window.location.origin.length).startsWith('/api/'))
      );
      if (isApi) {
        init = init || {};
        const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined) || {});
        if (!headers.has('authorization')) {
          try {
            // Prefer the sync-read token, but if it's expired/expiring, force a refresh FIRST so a
            // long editing session's saves never 401 into "cloud offline" with a stale JWT.
            let tok = readSupabaseAccessTokenSync();
            if (!tok || tokenExpiresWithin(tok)) {
              const fresh = await getFreshAccessToken();
              if (fresh) tok = fresh;
            }
            if (tok) headers.set('Authorization', `Bearer ${tok}`);
          } catch {}
        }
        init.headers = headers;

        // Send it, and if the server still says 401 (token died between check and send, or a clock
        // skew), refresh ONCE and retry. A 401'd write never touched the DB, so retrying is safe and
        // idempotent. This is the belt to the refresh-first suspenders — together they keep cloud sync
        // alive across a token expiry instead of silently dropping to "SAVED ON THIS DEVICE · OFFLINE".
        const res = await originalFetch(input, init);
        if (res && res.status === 401) {
          try {
            const fresh = await getFreshAccessToken();
            if (fresh) {
              headers.set('Authorization', `Bearer ${fresh}`);
              return await originalFetch(input, { ...init, headers });
            }
          } catch {}
        }
        return res;
      }
    } catch {}
    return originalFetch(input, init);
  };
}

// ── Gate DOM (built here so index.html stays minimal) ────────────────────────
function buildGateDom() {
  if (document.getElementById('sl-gate')) return;
  const gate = document.createElement('div');
  gate.id = 'sl-gate';
  gate.className = 'sl-gate';
  gate.innerHTML = `
    <div class="sl-gate-inner">
      <div class="sl-gate-eyebrow">Newpress</div>
      <h1 class="sl-gate-title">scripts</h1>
      <p class="sl-gate-sub">Sign in with your email and password.</p>
      <input id="sl-gate-email" class="sl-gate-input" type="email" placeholder="you@newpress.com"
             aria-label="Email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false">
      <input id="sl-gate-password" class="sl-gate-input" type="password" placeholder="Password"
             aria-label="Password" autocomplete="current-password">
      <button id="sl-gate-submit" class="sl-gate-btn sl-gate-btn--primary">Sign in</button>
      <p id="sl-gate-error" class="sl-gate-msg sl-gate-msg--error" hidden role="alert"></p>
      <p id="sl-gate-success" class="sl-gate-msg sl-gate-msg--success" hidden role="status"></p>
      <p class="sl-gate-note">New users default to password <code>newpress</code>. Change it from your account menu after signing in.</p>
      <details class="sl-gate-fallback">
        <summary>Forgot password? Use a magic link</summary>
        <input id="sl-gate-magic" class="sl-gate-input" type="email" placeholder="Email for magic link" aria-label="Email for magic link">
        <button id="sl-gate-magic-submit" class="sl-gate-btn">Send sign-in link</button>
      </details>
    </div>`;
  document.body.appendChild(gate);
}

function showGate() {
  buildGateDom();
  document.getElementById('sl-gate').classList.remove('sl-hidden');
  const app = document.getElementById('app');
  if (app) app.classList.add('sl-hidden');
  wireGateForms();
  setTimeout(() => document.getElementById('sl-gate-email')?.focus(), 30);
}

function hideGate() {
  document.getElementById('sl-gate')?.classList.add('sl-hidden');
  const app = document.getElementById('app');
  if (app) app.classList.remove('sl-hidden');
}

let _gateWired = false;
function wireGateForms() {
  if (_gateWired) return;
  _gateWired = true;
  const email = document.getElementById('sl-gate-email');
  const pass = document.getElementById('sl-gate-password');
  const submit = document.getElementById('sl-gate-submit');
  const errEl = document.getElementById('sl-gate-error');
  const okEl = document.getElementById('sl-gate-success');

  const showErr = (m) => { errEl.textContent = m; errEl.hidden = false; okEl.hidden = true; };
  const clearMsg = () => { errEl.hidden = true; okEl.hidden = true; };

  async function send() {
    clearMsg();
    const e = email.value.trim(), p = pass.value;
    if (!e || !p) { showErr('Email and password required.'); return; }
    submit.disabled = true; submit.textContent = 'Signing in…';
    try {
      const res = await signInWithPassword(e, p);
      if (!res.ok) showErr(res.error || 'Wrong email or password.');
      // On success, onAuthChange fires → unlock().
    } catch (err) {
      showErr(err?.message || 'Network error. Try again.');
    } finally {
      submit.disabled = false; submit.textContent = 'Sign in';
    }
  }

  submit.addEventListener('click', (e) => { e.preventDefault(); send(); });
  email.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pass.focus(); } });
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  [email, pass].forEach((el) => el.addEventListener('input', clearMsg));

  const magic = document.getElementById('sl-gate-magic');
  const magicBtn = document.getElementById('sl-gate-magic-submit');
  magicBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const addr = magic.value.trim();
    if (!addr) return;
    magicBtn.disabled = true; magicBtn.textContent = 'Sending…';
    try {
      const res = await sendMagicLink(addr);
      if (res.ok) { okEl.textContent = `Link sent to ${addr}. Open it on this device.`; okEl.hidden = false; errEl.hidden = true; }
      else { showErr(res.error || 'Could not send the link.'); }
    } finally { magicBtn.disabled = false; magicBtn.textContent = 'Send sign-in link'; }
  });
}

/**
 * Bring auth online, then resolve once the app is allowed to mount.
 * Returns a promise that resolves when: Supabase is unconfigured (open mode),
 * OR the user is already signed in, OR they sign in via the gate. The gate
 * stays visible until sign-in; boot() awaits this before mounting the library.
 */
export async function ensureUnlocked() {
  installApiFetchInterceptor();

  // IDENTITY SEAM for the engine (same-user false-conflict fix): mirror the signed-in user's auth id
  // to a window global the episode engine's cloud-sync can read WITHOUT importing the library (the
  // engine stays library-agnostic). cloud-sync compares this against a 409's `updated_by` to tell
  // "my own other tab/session" from "genuinely another person" — and it fails SAFE: when this is
  // null/undefined (signed out, open mode, standalone read-only page) the engine treats identity as
  // unknown and keeps the full ANOTHER-DEVICE banner. onAuthChange fires immediately with the cached
  // user and again on every sign-in/out/token-refresh, so the global tracks the whole session.
  onAuthChange((user) => {
    try { window.__wpCurrentUserId = (user && user.id) || null; } catch {}
  });

  // Open mode — no auth configured. Mount immediately.
  if (!authRequired()) { hideGate(); return; }

  await bootstrap();

  if (currentUser()) { hideGate(); return; }

  // Not signed in — show the gate and wait for a successful sign-in.
  showGate();
  await new Promise((resolve) => {
    const unsub = onAuthChange((user) => {
      if (user) { unsub(); hideGate(); resolve(); }
    });
  });
}

export { showGate, hideGate };
