// Basic PRESENCE (Enterprise Wave 2) — "who else is in this project right now."
//
// A tiny, calm layer that lives in the LIBRARY chrome (injected by boot.jsx alongside the ← Library
// backbar), so the shared engine files stay UNCHANGED. While a project is open it:
//   • heartbeats /api/script-presence every ~15s with this user's holderId + label + color
//   • polls the active-holder list every ~10s and paints a small stack of initial dots
//   • stale holders (>30s, enforced server-side) simply fall out of the list and their dot disappears
//
// Identity comes from the signed-in Supabase user + their user_profiles row (display_name + color),
// falling back to the email prefix and a stable auto-color. The heartbeat CARRIES the label+color, so
// the GET response already has everything needed to render every holder — no cross-user profile lookups.
//
// FULLY RESILIENT: every network call is best-effort. A project with no cloud row (offline-created
// local_ project) resolves to an empty holder list and the widget simply shows nothing. NEVER throws,
// NEVER blocks the editor. This is the foundation the soft-lock builds on later — NO locking here.

import { supabase } from './supa.js';
import { currentUser, authRequired } from './auth.js';

const PRESENCE_API = '/api/script-presence';
const HEARTBEAT_MS = 15_000;
const POLL_MS = 10_000;

let _projectRef = null;       // slug or cloud uuid — the endpoint resolves either
let _holderId = null;
const _self = { label: '', color: null };
let _el = null;
let _hbTimer = null;
let _pollTimer = null;
let _started = false;

// Deterministic fallback color from a string (so a profile-less user still gets a stable dot color).
const FALLBACK_COLORS = ['#2b7fff', '#9b59d0', '#1f8a72', '#d4703a', '#c0405f', '#5c7cc0', '#b0431f'];
function colorFor(seed) {
  let h = 0;
  const s = String(seed || 'x');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

function initialsOf(label) {
  const s = String(label || '').trim();
  if (!s) return '?';
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

async function loadSelfIdentity() {
  const u = currentUser();
  if (!u) return false;
  _holderId = u.id;
  _self.label = (u.email || '').split('@')[0] || 'me';
  _self.color = colorFor(u.id);
  try {
    if (supabase) {
      const { data } = await supabase
        .from('user_profiles')
        .select('display_name,color')
        .eq('user_id', u.id)
        .maybeSingle();
      if (data) {
        if (data.display_name) _self.label = data.display_name;
        if (data.color) _self.color = data.color;
      }
    }
  } catch {}
  return true;
}

async function sendHeartbeat() {
  if (!_projectRef || !_holderId) return;
  try {
    await fetch(PRESENCE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: _projectRef,
        holderId: _holderId,
        label: _self.label,
        color: _self.color,
      }),
    });
  } catch {}
}

async function fetchHolders() {
  if (!_projectRef) return [];
  try {
    const res = await fetch(`${PRESENCE_API}?project=${encodeURIComponent(_projectRef)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res || !res.ok) return [];
    const body = await res.json().catch(() => null);
    return body && Array.isArray(body.holders) ? body.holders : [];
  } catch {
    return [];
  }
}

function ensureEl() {
  if (_el) return _el;
  const el = document.createElement('div');
  el.id = 'sl-presence';
  el.className = 'sl-presence';
  el.setAttribute('aria-label', 'People in this project');
  document.body.appendChild(el);
  _el = el;
  return el;
}

function render(holders) {
  const el = ensureEl();
  // Show everyone active (including you) — a calm "who's here" stack. Self gets a ring so you can tell
  // which dot is you. Cap at 5 dots + an overflow "+N" so a busy doc stays tidy.
  const list = Array.isArray(holders) ? holders.slice() : [];
  // Keep self first if present, then others by most-recent.
  list.sort((a, b) => (a.holderId === _holderId ? -1 : b.holderId === _holderId ? 1 : 0));
  if (list.length === 0) { el.innerHTML = ''; el.classList.remove('is-visible'); return; }

  const MAX = 5;
  const shown = list.slice(0, MAX);
  const overflow = list.length - shown.length;

  const dots = shown.map((h) => {
    const color = h.color || colorFor(h.holderId || h.label);
    const isSelf = h.holderId === _holderId;
    const label = h.label || 'someone';
    const title = isSelf ? `${label} (you)` : label;
    return `<span class="sl-presence-dot${isSelf ? ' is-self' : ''}" style="--dot:${esc(color)}" title="${esc(title)}">${esc(initialsOf(label))}</span>`;
  }).join('');
  const more = overflow > 0 ? `<span class="sl-presence-more" title="${overflow} more">+${overflow}</span>` : '';

  // No "HERE" label (Johnny: it crowded the find bar) — the dots speak for themselves.
  el.innerHTML = `${dots}${more}`;
  el.classList.add('is-visible');
}

async function tickPoll() {
  const holders = await fetchHolders();
  render(holders);
}

/**
 * Start presence for a project. `projectRef` is the project's slug OR cloud uuid (the endpoint resolves
 * either). Safe to call once per project open; a second call restarts cleanly against the new ref. No-op
 * when auth is unconfigured (open mode) or the user isn't signed in.
 */
export async function startPresence(projectRef) {
  if (!projectRef) return;
  if (authRequired && !authRequired()) return; // open mode — no identity, no presence
  stopPresence();
  _projectRef = String(projectRef);
  _started = true;

  const haveIdentity = await loadSelfIdentity();
  if (!haveIdentity) { _started = false; return; }

  // First beat + first paint immediately, then on intervals.
  await sendHeartbeat();
  await tickPoll();
  _hbTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
  _pollTimer = setInterval(tickPoll, POLL_MS);

  // A final beat on the way out is nice-to-have but not required (rows age out in 30s); we don't send a
  // "leave" delete this wave — the stale-row sweep handles it.
  window.addEventListener('pagehide', stopPresence, { once: true });
}

export function stopPresence() {
  if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _started = false;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Test seam — exercise the pure formatting helpers without a browser/network.
export { initialsOf, colorFor };
