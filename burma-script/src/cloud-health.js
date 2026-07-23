// Burma Script Tool — CLOUD DURABILITY SIGNAL (honest-banner).
//
// This module answers the ONE question the save-failure banners must ask before they scream data
// loss: "localStorage just failed to hold the doc — is Johnny's work actually AT RISK, or is the
// CLOUD a healthy durable home for it?"
//
// WHY THIS EXISTS (Johnny 2026-07-23, the Nile false alarm): saveDoc and the startup migration used
// to raise the catastrophic "your edits will NOT be saved — export now" banner on ANY localStorage
// failure, completely blind to the cloud. For a cloud-backed project whose cloud copy is saving fine
// (Nile: cloud version 5299, confirmed 96s ago, a tiny 207KB doc) that banner is a flat lie —
// localStorage is a convenience MIRROR, the cloud is the source of truth. Something else on the
// shared newpress.press origin filled the ~5MB localStorage quota (or Safari blocked it in private
// mode), the local mirror write failed, and the banner falsely told him total data loss while every
// real save was landing in the cloud.
//
// This module tracks cloud push health from the `wp-cloud-*` events cloud-sync.js ALREADY fires (no
// coupling into pushDoc internals), and knows whether the active project is cloud-backed (via an
// injected predicate set once at startup from main.jsx's isCloudBackedProject). The banners consult
// it so they only scream when durability is GENUINELY gone.
//
// ── SAFETY POSTURE — FAIL TOWARD THE ALARM ──────────────────────────────────────────────────────
// Every answer defaults to "at risk" (the loud banner stands) unless we have POSITIVE proof the doc
// has a durable cloud home: the project is cloud-backed. We never HIDE a real data-loss alarm; we
// only SUPPRESS a provably-false one, and when a cloud-backed save leans SOLELY on a cloud push
// (localStorage fully dead), we ARM a one-shot that re-raises the loud banner the instant that push
// comes back offline/conflict — so an under-alarm (the cardinal sin) is impossible.

// The injected "is the ACTIVE episode a cloud-backed project?" predicate. Default: assume NOT
// cloud-backed, so an un-wired context (a bare unit test, an old build) keeps the loud banner rather
// than silently suppressing it. main.jsx calls setCloudBackedPredicate(isCloudBackedProject) at boot.
let _isCloudBacked = () => false;

// Last cloud push outcome we observed, and when a save last CONFIRMED. Drives the escalation one-shot
// and any freshness question. 'none' until the first push settles.
let _lastOutcome = 'none'; // 'none' | 'syncing' | 'saved' | 'offline' | 'conflict'
let _lastSavedAt = 0;      // ms epoch of the last confirmed wp-cloud-saved

// The SOLE-DURABILITY one-shot. When a cloud-backed save could NOT land in ANY local store and is
// relying entirely on the cloud push that flushSave is about to fire, saveDoc arms this with an
// onLost() callback. The next terminal cloud event decides: a confirmed save disarms it (durable,
// stay calm); an offline/conflict fires onLost() — the loud banner — because now NOTHING holds the
// edit. Latest arm wins (a newer save supersedes an older pending one).
let _soleDurability = null; // { onLost: () => void } | null

let _listenersInstalled = false;

// PUBLIC: wire the cloud-backed predicate. Injected so this module never imports the episode/config
// graph (keeps it dependency-light + browserless-testable, mirroring cloud-sync.js's pure core).
export function setCloudBackedPredicate(fn) {
  _isCloudBacked = typeof fn === 'function' ? fn : () => false;
}

// PUBLIC: is the ACTIVE project cloud-backed (has a durable cloud home for the doc)? POSITIVE proof
// only — any throw or missing predicate → false (fail toward the alarm). This is the gate the
// startup migration banner and saveDoc's all-local-failed branch use to decide "suppress the
// catastrophic banner": a cloud-backed project's doc survives a dead localStorage; a local-only
// project's does not.
export function isCloudBackedProject() {
  try { return !!_isCloudBacked(); } catch { return false; }
}

// PUBLIC (test/telemetry): record a cloud outcome directly, bypassing the DOM events. Tests drive
// this; in the app the installed listeners call it from the real wp-cloud-* events.
export function noteCloudOutcome(kind, atMs = Date.now()) {
  if (kind === 'saved') { _lastOutcome = 'saved'; _lastSavedAt = atMs; disarmSoleDurability(); return; }
  if (kind === 'syncing') { _lastOutcome = 'syncing'; return; } // in flight — neither confirms nor loses
  if (kind === 'offline' || kind === 'conflict') {
    _lastOutcome = kind;
    // A cloud push we may have been leaning on for sole durability just failed to land — escalate.
    triggerSoleDurabilityLost();
    return;
  }
}

// PUBLIC (telemetry): the last observed cloud outcome + confirmed-save time.
export function getCloudOutcome() { return { outcome: _lastOutcome, lastSavedAt: _lastSavedAt }; }

// Has the cloud CONFIRMED a save within `windowMs`? Used as corroborating evidence that the cloud is
// a live durable home (not just configured). Not required to suppress the banner — cloud-backed-ness
// plus the escalation one-shot already make suppression safe — but exported for richer UI wording.
export function cloudRecentlySaved(windowMs = 5 * 60 * 1000, nowMs = Date.now()) {
  return _lastOutcome === 'saved' && _lastSavedAt > 0 && (nowMs - _lastSavedAt) <= windowMs;
}

// PUBLIC: the durability verdict a runtime save consults when EVERY local store failed. True means
// "the doc has a durable cloud home, so a dead localStorage is NOT data loss — go cloud-only and stay
// calm". We gate on cloud-backed-ness (positive proof of a cloud home) rather than a recent confirmed
// save, because the save we're about to fire IS the durability; the sole-durability one-shot then
// guarantees we re-alarm if that push fails to land. Local-only projects → false → loud banner stands.
export function cloudDurabilityHealthy() {
  return isCloudBackedProject();
}

// PUBLIC: arm the sole-durability one-shot. Called by saveDoc when a cloud-backed edit could not land
// in ANY local store and now depends entirely on the cloud push flushSave is about to fire. `onLost`
// is invoked (exactly once) if the next terminal cloud event is a FAILURE (offline/conflict), so the
// loud banner + export fallback fire when — and only when — the cloud didn't catch the edit either.
export function armCloudSoleDurability(onLost) {
  _soleDurability = { onLost: typeof onLost === 'function' ? onLost : () => {} };
}

function disarmSoleDurability() { _soleDurability = null; }

function triggerSoleDurabilityLost() {
  const pending = _soleDurability;
  _soleDurability = null;
  if (pending) { try { pending.onLost(); } catch {} }
}

// PUBLIC (test): reset all module state between cases.
export function resetCloudHealth() {
  _lastOutcome = 'none';
  _lastSavedAt = 0;
  _soleDurability = null;
}

// PUBLIC: attach the cloud-outcome listeners to `win` ONCE. Idempotent. main.jsx calls this at
// startup so the module observes the real wp-cloud-* events cloud-sync.js fires; the escalation
// one-shot and any freshness question stay live for the whole session. NEVER throws.
export function installCloudHealthListeners(win = (typeof window !== 'undefined' ? window : null)) {
  try {
    if (_listenersInstalled || !win || !win.addEventListener) return;
    _listenersInstalled = true;
    win.addEventListener('wp-cloud-saving', () => noteCloudOutcome('syncing'));
    win.addEventListener('wp-cloud-saved', () => noteCloudOutcome('saved'));
    win.addEventListener('wp-cloud-offline', () => noteCloudOutcome('offline'));
    win.addEventListener('wp-cloud-conflict', () => noteCloudOutcome('conflict'));
    // A same-user conflict is still a push that did NOT merge this edit — treat as a failed landing
    // for sole-durability purposes (its data is snapshotted, but the cloud didn't take THIS edit).
    win.addEventListener('wp-cloud-conflict-own', () => noteCloudOutcome('conflict'));
  } catch {}
}
