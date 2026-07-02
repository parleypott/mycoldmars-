// storage-persist.js — #2 STORAGE PERSISTENCE + HEADROOM (durability extra, additive over the IDB layer).
//
// This sits ON TOP of the shipped IndexedDB recovery store (recovery-store.js). It does not touch the
// save path, the schema, or the snapshot format — it only asks the BROWSER for two guarantees the IDB
// layer cannot give itself, and both are best-effort and wrapped to NEVER throw:
//
//   navigator.storage.persist()  — opts this origin into PERSISTENT storage. By default IndexedDB is
//     "best-effort": the browser MAY silently evict it under disk pressure, which for a script tool
//     means the recovery doc row (the GB-scale backstop that catches an edit when localStorage is
//     jammed) can just vanish between sessions. persist() flips the origin to "persistent" — cleared
//     only by an explicit user action — so the backstop actually survives. Called ONCE per load. If
//     the browser DENIES it, or the API is absent (older Safari, some private modes), we DEGRADE
//     silently: everything downstream still works exactly as before this module existed, just best-
//     effort again. Denial is never surfaced as an error to Johnny.
//
//   navigator.storage.estimate() — returns {usage, quota}. This is a REAL headroom number, so we can
//     prune the recovery store BEFORE a write throws QuotaExceededError instead of catching the wall
//     after we hit it. storageHeadroom() normalizes it into a signal a caller can act on, and
//     pruneIfLowHeadroom() wires that signal to the snapshot GC so the pruning happens proactively.
//
// Dependency-injectable: every export takes an optional `nav` (a navigator-like object) so headless
// tests can pass a mock. In the browser the default resolves the real global navigator.

function resolveNavigator(nav) {
  if (nav) return nav;
  if (typeof navigator !== 'undefined') return navigator;
  if (typeof globalThis !== 'undefined' && globalThis.navigator) return globalThis.navigator;
  return null;
}

// Whether the StorageManager API (navigator.storage) exists at all. Both persist() and estimate()
// live on it; a missing StorageManager means we degrade to best-effort with no headroom signal.
export function storageManagerAvailable(nav) {
  const n = resolveNavigator(nav);
  return !!(n && n.storage);
}

// Request PERSISTENT storage for this origin, ONCE per load. Resolves to:
//   { persisted: true,  already: bool }  — the origin is persistent (already was, or just granted)
//   { persisted: false, reason }         — denied / unsupported / errored (all benign; degrade)
// NEVER throws / rejects. Checks persisted() first so we don't re-ask when it's already granted
// (some browsers show a permission affordance; asking once is the polite + correct behavior).
export async function requestPersistentStorage(nav) {
  const n = resolveNavigator(nav);
  try {
    if (!n || !n.storage) return { persisted: false, reason: 'unsupported' };
    // If already persistent, do not re-request — report the existing grant.
    if (typeof n.storage.persisted === 'function') {
      try {
        if (await n.storage.persisted()) return { persisted: true, already: true };
      } catch { /* fall through to persist() */ }
    }
    if (typeof n.storage.persist !== 'function') return { persisted: false, reason: 'no-persist' };
    const granted = await n.storage.persist();
    return granted ? { persisted: true, already: false } : { persisted: false, reason: 'denied' };
  } catch {
    return { persisted: false, reason: 'error' };
  }
}

// Read the origin's storage estimate and normalize it into a headroom signal. Resolves to:
//   { supported: true,  usage, quota, ratio, freeBytes, low }   — ratio = usage/quota in [0,1]
//   { supported: false }                                         — no estimate() available
// `low` is true when we are within LOW_RATIO of the quota OR within LOW_FLOOR_BYTES of it, whichever
// trips first — so both a proportional and an absolute-headroom read can flag the wall early. NEVER
// throws. A garbage/zero quota resolves to supported:false rather than a divide-by-zero.
const LOW_RATIO = 0.85;                 // >85% of quota used → getting tight
const LOW_FLOOR_BYTES = 12 * 1024 * 1024; // …or under ~12 MB of headroom left, absolute

export async function storageHeadroom(nav) {
  const n = resolveNavigator(nav);
  try {
    if (!n || !n.storage || typeof n.storage.estimate !== 'function') return { supported: false };
    const est = await n.storage.estimate();
    const usage = Number(est && est.usage) || 0;
    const quota = Number(est && est.quota) || 0;
    if (!(quota > 0)) return { supported: false };
    const ratio = usage / quota;
    const freeBytes = Math.max(0, quota - usage);
    const low = ratio >= LOW_RATIO || freeBytes <= LOW_FLOOR_BYTES;
    return { supported: true, usage, quota, ratio, freeBytes, low };
  } catch {
    return { supported: false };
  }
}

// PRUNE-BEFORE-THE-WALL. Read the headroom; if it is LOW, run the caller-supplied prune (the snapshot
// GC — idbPruneGlobal from recovery-store.js) to reclaim space PROACTIVELY, before the next save can
// throw QuotaExceededError. Resolves to a small report: { checked, low, pruned }. NEVER throws. When
// the estimate API is unsupported we can't know the headroom, so we do NOT prune (nothing to act on)
// — the store's own age+count caps still bound it on every write regardless.
export async function pruneIfLowHeadroom(pruneFn, nav) {
  try {
    const hr = await storageHeadroom(nav);
    if (!hr.supported) return { checked: false, low: false, pruned: 0 };
    if (!hr.low) return { checked: true, low: false, pruned: 0 };
    let pruned = 0;
    if (typeof pruneFn === 'function') {
      try { pruned = Number(await pruneFn()) || 0; } catch {}
    }
    return { checked: true, low: true, pruned, ratio: hr.ratio, freeBytes: hr.freeBytes };
  } catch {
    return { checked: false, low: false, pruned: 0 };
  }
}
