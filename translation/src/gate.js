// Gate bootstrap. Decides whether to:
//   • Unlock immediately (existing Supabase session, or dev mode)
//   • Show the magic-link form (preferred multi-user flow)
//   • Show the access-code fallback (legacy single-user / dev)
//
// Loaded BEFORE main.js so the rest of the app boots into an already-
// authenticated state. The /api/* fetch interceptor is installed here so
// every subsequent server call carries the right credentials regardless
// of which gate path won.

import { bootstrap, sendMagicLink, signInWithPassword, currentUser, currentProfile, onAuthChange } from './auth.js';

const COOKIE_NAME = 'np_access';
const gate = document.getElementById('gate');
const app  = document.getElementById('app');

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 90}`;
}

// ── Fetch interceptor for x-access-code header ──
// Runs BEFORE any /api/* request so /api/transcribe, /api/claude, /api/gemini
// etc. all receive the gate credential. Idempotent.
function installApiFetchInterceptor() {
  if (window.__mcmApiFetchPatched) return;
  window.__mcmApiFetchPatched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url && /^(\/|https?:\/\/)?[^\s]*\/api\//.test(url)) {
        const code = sessionStorage.getItem('mcm_access_code') || '';
        if (code) {
          init = init || {};
          const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined) || {});
          if (!headers.has('x-access-code')) headers.set('x-access-code', code);
          init.headers = headers;
        }
      }
    } catch {}
    return originalFetch(input, init);
  };
}

function unlock(opts = {}) {
  if (opts.accessCode) {
    try { sessionStorage.setItem('mcm_access_code', opts.accessCode); } catch {}
  }
  if (opts.cookie !== false) setCookie(COOKIE_NAME, 'granted');
  installApiFetchInterceptor();
  gate.classList.add('hidden');
  app.classList.remove('hidden');
  // Let main.js know identity may have changed (header avatar etc).
  window.dispatchEvent(new CustomEvent('mcm-gate-unlocked'));
}

// Re-lock and show the gate (used by signOut from the header dropdown).
export function showGate() {
  gate.classList.remove('hidden');
  app.classList.add('hidden');
  // Reset the magic-link form state.
  document.getElementById('gate-success')?.classList.add('hidden');
  document.getElementById('gate-error')?.classList.add('hidden');
  document.getElementById('gate-email')?.focus();
}
window.showGate = showGate;

// Public routes — never gated. Anyone can land here without signing in.
// The Sacred Sequencer is paste-and-export only; it doesn't load any
// account data. Useful for sharing the sequencer URL with collaborators
// (Sam, etc) who shouldn't need to register an email to use it.
const PUBLIC_HASHES = new Set(['#sequencer', '#sequencer-public']);

function isPublicRoute() {
  const h = (window.location.hash || '').trim();
  if (PUBLIC_HASHES.has(h)) return true;
  // Also support ?public=1 for explicit override.
  if (window.location.search.includes('public=1')) return true;
  return false;
}

(async function gateBootstrap() {
  installApiFetchInterceptor();

  // Public-route bypass: no auth required. Unlock immediately so the
  // app boots and the URL-router can land on the sequencer.
  if (isPublicRoute()) {
    unlock({ cookie: false });
    // If the user later signs in via the avatar menu, that still works.
    return;
  }

  // Bring auth state online ASAP so the redirect-from-magic-link handshake
  // can complete on URL load. supabase-js auto-detects ?access_token=... in
  // the URL hash and stores the session.
  await bootstrap();

  // Magic-link path: user is already signed in (cookie/localStorage session
  // restored or magic-link callback just ran).
  if (currentUser()) {
    unlock();
    return;
  }

  // Probe whether the access-code gate is even configured. If /api/access
  // returns 200 to an empty code, we're in dev mode (no ACCESS_CODE) and
  // can unlock without prompting. Skip the magic-link UI in that case so
  // local dev stays fast.
  let devMode = false;
  try {
    const probe = await fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '' }),
    });
    if (probe.status === 404) devMode = true; // endpoint doesn't exist locally
    else if (probe.ok) {
      // Endpoint exists, returned ok with empty code → ACCESS_CODE unset.
      const body = await probe.json().catch(() => ({}));
      if (body?.dev) devMode = true;
    }
  } catch {
    devMode = true; // network error → assume local dev
  }

  if (devMode && !currentUser()) {
    // No auth providers + no access code = pure local dev. Just unlock.
    // Auth-protected features (presence, comments, attribution) will show
    // the user as 'anonymous' until they sign in via the avatar menu.
    unlock();
    return;
  }

  // We're in production-with-auth mode. Wire the password form (primary),
  // the magic-link form (recovery), and the access-code fallback (legacy).
  wirePasswordForm();
  wireMagicLinkForm();
  wireAccessCodeFallback();

  // If auth state changes mid-session (magic-link callback completes,
  // sign-in from another tab), unlock automatically.
  onAuthChange((user) => { if (user) unlock(); });
})();

// ─── Primary path: email + password ───────────────────────────────────
function wirePasswordForm() {
  const emailInput  = document.getElementById('gate-email');
  const passInput   = document.getElementById('gate-password');
  const submitBtn   = document.getElementById('gate-submit');
  const errorMsg    = document.getElementById('gate-error');
  const successMsg  = document.getElementById('gate-success');
  if (!emailInput || !passInput || !submitBtn) return;

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('hidden');
    successMsg.classList.add('hidden');
  }
  function clearMessages() {
    errorMsg.classList.add('hidden');
    successMsg.classList.add('hidden');
  }

  async function send() {
    clearMessages();
    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) { showError('Email and password required.'); return; }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';
    const res = await signInWithPassword(email, password);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';
    if (res.ok) {
      // onAuthChange listener calls unlock() automatically.
    } else {
      showError(res.error || 'Wrong email or password.');
    }
  }

  submitBtn.addEventListener('click', (e) => { e.preventDefault(); send(); });
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); passInput.focus(); } });
  passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  [emailInput, passInput].forEach(el => el.addEventListener('input', clearMessages));
  emailInput.focus();
}

// ─── Fallback path: magic-link recovery ───────────────────────────────
function wireMagicLinkForm() {
  const emailInput = document.getElementById('gate-magic-email');
  const submitBtn  = document.getElementById('gate-magic-submit');
  const successMsg = document.getElementById('gate-success');
  const errorMsg   = document.getElementById('gate-error');
  if (!emailInput || !submitBtn) return;

  async function send() {
    const email = emailInput.value.trim();
    if (!email) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    const res = await sendMagicLink(email);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send sign-in link';
    if (res.ok) {
      successMsg.textContent = `Link sent to ${email}. Open it on this device.`;
      successMsg.classList.remove('hidden');
      errorMsg.classList.add('hidden');
    } else {
      errorMsg.textContent = res.error || 'Could not send the link.';
      errorMsg.classList.remove('hidden');
    }
  }

  submitBtn.addEventListener('click', (e) => { e.preventDefault(); send(); });
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
}

function wireAccessCodeFallback() {
  const codeInput  = document.getElementById('gate-code');
  const codeBtn    = document.getElementById('gate-code-submit');
  const errorMsg   = document.getElementById('gate-error');
  if (!codeInput || !codeBtn) return;

  async function send() {
    const code = codeInput.value.trim();
    if (!code) return;
    try {
      const res = await fetch('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        unlock({ accessCode: code });
      } else {
        errorMsg.textContent = 'Wrong code.';
        errorMsg.classList.remove('hidden');
        codeInput.value = '';
        codeInput.focus();
      }
    } catch {
      // Network error (dev mode) — just unlock.
      unlock();
    }
  }

  codeBtn.addEventListener('click', (e) => { e.preventDefault(); send(); });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
}

// Re-export currentUser/currentProfile so other modules can import from
// gate.js if convenient. Most should import from auth.js directly.
export { currentUser, currentProfile, onAuthChange };
