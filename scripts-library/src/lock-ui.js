// Script Library — OFFLINE LOCK button + lifecycle (the "big button" Johnny presses before a flight).
//
// WHAT IT DOES
//   • ARM (online): claim an exclusive server lock on THIS project (api/script-lock acquire), warm the
//     offline app-shell cache (so a reload at altitude still paints), and flip the UI to "locked for
//     offline". While locked, HE keeps editing (online or offline — the engine's localStorage is the
//     offline source of truth); every OTHER signed-in teammate is refused writes server-side (423) and
//     shown read-only. Text edits, and photos/videos (Phase 2 offline-media), persist locally.
//   • HEARTBEAT (online): refresh the lock every few minutes so a live tab never goes stale.
//   • UNLOCK & SYNC (back online): flush the live local doc to the cloud with a TRUE compare-and-swap,
//     drain the offline media queue, and only THEN release the lock — so teammates never regain edit
//     before Johnny's offline work (and its media) is safely in the cloud.
//
// SAFETY POSTURE: the lock is a convenience over an already-watertight core. The doc is ALWAYS durable
// in localStorage/IndexedDB regardless of lock state; the server's CAS + shrink-quarantine + append-only
// revision ledger still protect the data. So every failure here degrades safe: a failed acquire leaves
// the doc editable-and-syncing exactly as before; a failed unlock KEEPS the lock (never releases with
// unflushed work); a lost network just defers the sync to reconnect.
//
// Engine files stay UNCHANGED — this lives entirely in the library shell (like the backbar/presence),
// reaching the engine only through its stable public seams (cloud-sync pushDoc, read-mode forceReadOnly).

import { currentUser } from './auth.js';
import { warmOfflineCache, isOnline, onConnectivityChange } from './offline-shell.js';

const LS_KEY = 'sl_offline_lock_v1';       // persists MY held lock across reloads (survive a mid-flight reopen)
const HEARTBEAT_MS = 150000;               // 2.5 min — comfortably inside the server's 24h stale window
const LOCK_API = '/api/script-lock';
const DOC_API = '/api/script-doc';

let _slug = null;
let _heartbeatTimer = null;
let _statusPollTimer = null;
let _connUnsub = null;
let _lastStatus = null;                    // last known REMOTE lock view
let _busy = false;                         // guards double-clicks during acquire/unlock

/* ─────────────────────────────── identity ─────────────────────────────── */

function myIdentity() {
  let u = null;
  try { u = currentUser(); } catch {}
  const id = (u && u.id) || (typeof window !== 'undefined' ? window.__wpCurrentUserId : null) || null;
  const label =
    (u && (u.user_metadata?.display_name || u.user_metadata?.name || u.email)) ||
    'A teammate';
  return { id, label };
}

/* ───────────────────── local held-lock persistence ────────────────────── */
// The record of a lock THIS device holds: enough to heartbeat, to flush-on-unlock with a correct CAS
// base, and to know (offline, with no server reachable) that we're the holder and must sync on return.

function readHeld() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o && typeof o === 'object' && o.slug && o.token) ? o : null;
  } catch { return null; }
}
function writeHeld(rec) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(rec)); } catch {}
}
function clearHeld() {
  try { localStorage.removeItem(LS_KEY); } catch {}
}
function heldForThis() {
  const h = readHeld();
  return h && h.slug === _slug ? h : null;
}

/* ───────────────────────────── server calls ───────────────────────────── */
// All /api calls ride the gate.js fetch interceptor, which attaches the signed-in JWT. NEVER throw.

async function apiLockStatus(slug) {
  try {
    // Timeout-guarded so a slow/absent network can't delay the project open (this GET runs before the
    // engine imports). On timeout/offline we fail open (return null → editable), never block the boot.
    const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(4000) : undefined;
    const r = await fetch(`${LOCK_API}?project=${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' }, signal });
    if (!r || !r.ok) return null;
    return await r.json().catch(() => null);
  } catch { return null; }
}

async function apiLockPost(slug, action, extra = {}, token = '') {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers['X-Lock-Token'] = token;
  const res = await fetch(`${LOCK_API}?project=${encodeURIComponent(slug)}`, {
    method: 'POST', headers, body: JSON.stringify({ action, ...extra }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

async function apiCloudVersion(slug) {
  try {
    const r = await fetch(`${DOC_API}?project=${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
    if (!r || !r.ok) return 0;
    const b = await r.json().catch(() => ({}));
    const n = Math.floor(Number(b?.version));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

/* ───────────────────────── boot: read-only-for-others ──────────────────── */
// Called by boot.jsx BEFORE the engine imports. If a DIFFERENT teammate holds a fresh lock, latch the
// engine read-only (structurally write-incapable, same surface as a ?read guest) so this teammate can
// view but cannot edit — and can't strand edits against a doc the server would refuse anyway. Returns
// the status so the caller can show a banner after mount. NEVER throws; fail-open (editable) on doubt.
export async function applyLockGateBeforeEngine(slug) {
  try {
    const status = await apiLockStatus(slug);
    _lastStatus = status;
    if (status && status.locked && !status.mine) {
      const { forceReadOnly } = await import('../../burma-script/src/read-mode.js');
      forceReadOnly();
      return status;
    }
  } catch {}
  return _lastStatus;
}

/* ─────────────────────────── acquire / release ─────────────────────────── */

async function armLock() {
  if (_busy) return;
  _busy = true;
  renderButton('arming');
  try {
    const id = myIdentity();
    if (!id.id) { toast('Sign in to lock this script for offline.'); return; }
    // Base version = the cloud version at lock time. Because the lock stops everyone else from writing,
    // the cloud can't advance while we're away — so the unlock flush's CAS(base) should still match and
    // apply cleanly. If it DOESN'T (a stale lock got broken and someone edited), the CAS 409s and both
    // sides are snapshotted losslessly rather than one stomping the other.
    const baseVersion = await apiCloudVersion(_slug);
    const res = await apiLockPost(_slug, 'acquire', { label: id.label });
    if (!res.ok) {
      if (res.status === 423) {
        _lastStatus = res.body;
        toast(`Checked out by ${res.body?.lockedByLabel || 'someone else'} — can't lock.`);
      } else if (res.status === 401) {
        toast('Offline Lock needs a signed-in account.');
      } else {
        toast('Could not lock. Try again.');
      }
      return;
    }
    writeHeld({ slug: _slug, token: res.body.lockToken, baseVersion, lockedAt: res.body.lockedAt || new Date().toISOString(), label: id.label });
    // PRE-FLIGHT WARM — pull the whole app-shell + engine chunks + fonts onto the device so a reload
    // with no internet still paints. We already have the project open (engine chunks loaded), so this
    // mostly confirms; it's the honest "you're ready to fly" gate.
    let warm = { ok: false };
    try { warm = await warmOfflineCache(); } catch {}
    startHeartbeat();
    _lastStatus = { locked: true, mine: true, lockedByLabel: id.label, lockedAt: readHeld()?.lockedAt };
    renderButton('locked-mine');
    toast(warm && warm.ok ? 'Locked. Ready to fly — you can go offline now.' : 'Locked. (Cache warm incomplete — reconnect once to finish.)');
  } finally {
    _busy = false;
    refresh();
  }
}

async function unlockAndSync() {
  if (_busy) return;
  const held = heldForThis();
  if (!held) { renderButton(); return; }
  if (!isOnline()) { toast('Connect to the internet to sync and unlock.'); return; }
  _busy = true;
  renderButton('syncing');
  try {
    // 1) FLUSH the live local doc to the cloud with a TRUE CAS (baseVersion=lock base). This reuses the
    //    engine's exact watertight push path. A clean accept → cloud now holds the offline work. A 409
    //    (someone edited during a broken-lock window, or a shrink-quarantine) → the engine has already
    //    snapshotted both sides losslessly; we KEEP the lock and surface it rather than release over it.
    const flush = await flushDocToCloud(held.baseVersion);
    if (!flush.ok) {
      renderButton('locked-mine');
      toast(flush.message || 'Sync hit a conflict — your work is safe on this device. Reload to merge, then unlock.');
      return;
    }
    // 2) DRAIN offline media — upload every queued photo/video and swap the CDN url into its block.
    const media = await drainOfflineMedia();
    if (media && media.failed > 0) {
      renderButton('locked-mine');
      toast(`${media.uploaded} media synced, ${media.failed} still pending — staying locked. Retry when connection is stronger.`);
      return;
    }
    // 3) RELEASE the server lock — only now, with doc + media confirmed in the cloud.
    try { await apiLockPost(_slug, 'release', {}, held.token); } catch {}
    clearHeld();
    stopHeartbeat();
    _lastStatus = { locked: false, mine: false };
    renderButton('unlocked');
    toast('Synced and unlocked. Your team can edit again.' + (media && media.uploaded ? ` ${media.uploaded} media uploaded.` : ''));
  } finally {
    _busy = false;
    refresh();
  }
}

// Push the newest on-disk doc to the cloud via the engine's cloud-sync (dynamic import so the episode
// is already set). Returns { ok, message }. Clean accept OR benign-409 (the cloud already holds this
// device's own content, e.g. an earlier autosave already landed it) → ok. Only a REAL foreign
// divergence / unreachable cloud / pending latch → not-ok (keep the lock; never release over unsynced work).
async function flushDocToCloud(baseVersion) {
  try {
    const cs = await import('../../burma-script/src/cloud-sync.js');
    const live = cs.defaultReadLocal();
    if (!live || !live.hasDoc || live.doc == null || !(live.version > 0)) {
      return { ok: true }; // nothing local to flush (fresh/empty) — releasing is safe
    }
    // TRUE CAS on the unlock path: base = the cloud version we locked on. Two outcomes matter:
    //   • cloud still == base (the normal case — the lock kept everyone else out, offline edits never
    //     pushed) → the push applies cleanly and advances the cloud to live.version.
    //   • cloud advanced (my OWN autosaves landed while I was online, OR a broken-stale-lock let someone
    //     else in) → 409. handlePushResult then decides by CONTENT: cloud holds MY content → benign
    //     (already synced, safe to release); cloud holds DIFFERENT content → real conflict (keep lock).
    const res = await cs.pushDoc(live.doc, live.version, undefined, baseVersion);
    if (res && res.ok) return { ok: true };
    if (res && res.offline) {
      // Cloud unreachable → keep the lock; the engine's offline-retry will catch it up, and the user can
      // hit Unlock again once it's through. NEVER release with work that isn't confirmed in the cloud.
      return { ok: false, message: 'Cloud unreachable — your work is safe locally. Try Unlock again in a moment.' };
    }
    if (res && res.skipped) {
      // A pending conflict LATCH means a prior real divergence is unresolved — do not release over it.
      if (res.latched) return { ok: false, message: 'A sync conflict is pending — reload to merge, then unlock.' };
      return { ok: true }; // read-only (impossible for the holder) / plain no-op — nothing unsynced
    }
    if (res && res.stale) {
      // Route the 409 through the engine's own handler: it snapshots both sides losslessly and returns
      // whether this was BENIGN (cloud already has my content) or a REAL two-writer divergence.
      let outcome = { conflict: true };
      try { outcome = cs.handlePushResult(res, live.doc) || outcome; } catch {}
      if (outcome && (outcome.benign || outcome.conflict === false)) return { ok: true };
      return { ok: false, message: 'Someone edited while you were offline — both copies saved. Reload to merge, then unlock.' };
    }
    return { ok: false, message: 'Sync error — your work is safe on this device. Try again.' };
  } catch {
    return { ok: false, message: 'Sync error — your work is safe on this device. Try again.' };
  }
}

// Drain the Phase 2 offline-media queue if that build is present. Returns { uploaded, failed } or null.
async function drainOfflineMedia() {
  try {
    const mod = await import('../../burma-script/src/extensions/image-drop.js');
    if (typeof mod.drainPendingMedia === 'function') {
      const r = await mod.drainPendingMedia();
      return r && typeof r === 'object' ? r : { uploaded: 0, failed: 0 };
    }
  } catch {}
  return { uploaded: 0, failed: 0 };
}

/* ─────────────────────────────── heartbeat ─────────────────────────────── */

function startHeartbeat() {
  stopHeartbeat();
  _heartbeatTimer = setInterval(async () => {
    const held = heldForThis();
    if (!held || !isOnline()) return;
    try {
      const res = await apiLockPost(_slug, 'heartbeat', {}, held.token);
      if (res.status === 409) {
        // Lock lost (released elsewhere / reclaimed after a stale window). Stand down cleanly.
        clearHeld(); stopHeartbeat();
        _lastStatus = await apiLockStatus(_slug);
        renderButton();
        toast('Your offline lock was released elsewhere.');
      }
    } catch {}
  }, HEARTBEAT_MS);
}
function stopHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

/* ─────────────────────────────── rendering ─────────────────────────────── */

injectStylesOnce();

// Decide the button state from local held-lock + last remote status + connectivity, and render.
function refresh() {
  const held = heldForThis();
  if (held) { renderButton(isOnline() ? 'locked-mine' : 'locked-offline'); return; }
  const s = _lastStatus;
  if (s && s.locked && !s.mine) { renderButton('locked-other'); return; }
  renderButton('unlocked');
}

function mediaQueueCountText() {
  // Best-effort count of queued offline media (Phase 2). Non-blocking; returns '' if unavailable.
  try {
    const n = window.__slPendingMediaCount;
    return (typeof n === 'number' && n > 0) ? ` · ${n} media queued` : '';
  } catch { return ''; }
}

function renderButton(stateOverride) {
  const host = ensureHost();
  if (!host) return;
  const held = heldForThis();
  const state = stateOverride || (held ? (isOnline() ? 'locked-mine' : 'locked-offline')
                : (_lastStatus && _lastStatus.locked && !_lastStatus.mine ? 'locked-other' : 'unlocked'));
  host.dataset.state = state;

  if (state === 'locked-other') {
    const who = (_lastStatus && _lastStatus.lockedByLabel) || 'A teammate';
    host.innerHTML = `<div class="sl-lock-banner" role="status">
      <span class="sl-lock-ic">🔒</span>
      <span><b>${escapeHtml(who)}</b> has this checked out for offline editing.<br>
      <span class="sl-lock-sub">You can read it — editing returns when they sync back.</span></span></div>`;
    return;
  }

  let icon = '🔓', title = 'OFFLINE LOCK', sub = 'Lock this script and edit it offline', cls = 'is-unlocked', disabled = false, action = 'arm';
  if (state === 'arming') { icon = '⏳'; title = 'PREPARING…'; sub = 'Caching everything for offline'; cls = 'is-arming'; disabled = true; }
  else if (state === 'syncing') { icon = '⏳'; title = 'SYNCING…'; sub = 'Uploading your offline work'; cls = 'is-arming'; disabled = true; }
  else if (state === 'locked-mine') { icon = '🔒'; title = 'LOCKED FOR OFFLINE'; sub = 'Ready to fly' + mediaQueueCountText() + ' · tap to Unlock &amp; Sync'; cls = 'is-locked'; action = 'unlock'; }
  else if (state === 'locked-offline') { icon = '✈️'; title = 'OFFLINE — EDITING'; sub = 'Saved on this device' + mediaQueueCountText() + ' · connect to sync'; cls = 'is-offline'; disabled = true; }

  host.innerHTML = `<button type="button" class="sl-lock-btn ${cls}" ${disabled ? 'disabled' : ''} aria-live="polite">
      <span class="sl-lock-ic" aria-hidden="true">${icon}</span>
      <span class="sl-lock-txt"><span class="sl-lock-title">${title}</span><span class="sl-lock-sub">${sub}</span></span>
    </button>`;
  const btn = host.querySelector('button');
  if (btn && !disabled) {
    btn.addEventListener('click', () => { if (action === 'arm') armLock(); else if (action === 'unlock') unlockAndSync(); });
  }
}

function ensureHost() {
  if (typeof document === 'undefined') return null;
  let host = document.getElementById('sl-lock-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'sl-lock-host';
    host.className = 'sl-lock-host';
    document.body.appendChild(host);
  }
  return host;
}

/* ─────────────────────────────── lifecycle ─────────────────────────────── */

// Called by boot.jsx AFTER the engine mounts (like injectLibraryBackbar). Idempotent per project open.
export function mountLockUi(slug) {
  if (!slug) return;
  _slug = slug;
  // If a ?read/guest session, do not offer the lock (no write standing).
  import('../../burma-script/src/read-mode.js').then((m) => {
    if (m.isReadOnly() && !heldForThis()) {
      // read-only viewer: only show the "someone else has it" banner if applicable, no button.
      if (_lastStatus && _lastStatus.locked && !_lastStatus.mine) renderButton('locked-other');
      return;
    }
    renderButton();
    // Resume a lock we already hold (reopened offline session): restart the heartbeat.
    if (heldForThis()) startHeartbeat();
    // Live-refresh on connectivity changes and poll remote status occasionally while unlocked so a
    // teammate's lock (or its release) reflects without a manual reload.
    if (!_connUnsub) _connUnsub = onConnectivityChange(() => refresh());
    startStatusPoll();
  }).catch(() => { renderButton(); });
}

function startStatusPoll() {
  if (_statusPollTimer) return;
  _statusPollTimer = setInterval(async () => {
    if (heldForThis() || !isOnline()) return;    // I hold it, or offline → nothing to poll
    const s = await apiLockStatus(_slug);
    if (s) { _lastStatus = s; refresh(); }
  }, 20000);
}

/* ─────────────────────────────── chrome ────────────────────────────────── */

function toast(msg) {
  try {
    // Reuse the engine's toast if present; else a minimal inline one.
    if (typeof window !== 'undefined' && typeof window.__wpToast === 'function') { window.__wpToast(msg); return; }
  } catch {}
  try {
    const el = document.createElement('div');
    el.className = 'sl-lock-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3600);
  } catch {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function injectStylesOnce() {
  if (typeof document === 'undefined' || document.getElementById('sl-lock-style')) return;
  const st = document.createElement('style');
  st.id = 'sl-lock-style';
  st.textContent = `
  .sl-lock-host{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:9600;font-family:'JetBrains Mono',ui-monospace,monospace;}
  .sl-lock-btn{display:flex;align-items:center;gap:11px;padding:11px 18px;border:1.5px solid #1f1d18;border-radius:12px;background:#fbfaf5;color:#1f1d18;cursor:pointer;box-shadow:0 3px 0 #1f1d18;transition:transform .08s ease,box-shadow .08s ease,background .15s ease;}
  .sl-lock-btn:not([disabled]):active{transform:translateY(3px);box-shadow:0 0 0 #1f1d18;}
  .sl-lock-btn[disabled]{opacity:.7;cursor:default;}
  .sl-lock-ic{font-size:20px;line-height:1;}
  .sl-lock-txt{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;text-align:left;}
  .sl-lock-title{font-weight:800;font-size:12px;letter-spacing:.08em;}
  .sl-lock-sub{font-weight:500;font-size:10.5px;letter-spacing:.02em;opacity:.72;}
  .sl-lock-btn.is-locked{background:#F44315;color:#fff;border-color:#1f1d18;box-shadow:0 3px 0 #1f1d18;}
  .sl-lock-btn.is-locked .sl-lock-sub{opacity:.85;}
  .sl-lock-btn.is-offline{background:#23211b;color:#efe9da;}
  .sl-lock-btn.is-arming{background:#efeadd;}
  .sl-lock-banner{display:flex;gap:10px;align-items:flex-start;max-width:420px;padding:12px 15px;border:1.5px solid #1f1d18;border-radius:12px;background:#efe9da;color:#1f1d18;box-shadow:0 3px 0 #1f1d18;font-size:12px;line-height:1.35;}
  .sl-lock-banner .sl-lock-ic{font-size:16px;margin-top:1px;}
  .sl-lock-banner .sl-lock-sub{opacity:.7;font-size:11px;}
  .sl-lock-toast{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:9700;background:#1f1d18;color:#fbfaf5;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;padding:10px 15px;border-radius:9px;max-width:88vw;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,.28);transition:opacity .35s ease;}
  .sl-lock-toast.out{opacity:0;}
  @media (max-width:640px){ .sl-lock-host{left:12px;right:12px;transform:none;bottom:12px;} .sl-lock-btn{width:100%;justify-content:center;} }
  `;
  document.head.appendChild(st);
}
