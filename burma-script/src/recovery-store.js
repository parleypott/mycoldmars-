import { zlibSync, unzlibSync, strToU8, strFromU8 } from 'fflate';
import { getEpisodeStorage, onEpisodeChange } from './episode-config.js';

// Burma Script Tool — INDEXEDDB-BACKED RECOVERY SNAPSHOT STORE (recovery-idb).
//
// THE PRODUCTION FAILURE THIS CLOSES
// The full-size recovery snapshots (.bak / .conflict / .corrupt — each a ~167KB copy of the whole
// doc) lived in localStorage alongside the live LS_DOC. localStorage's quota is ~5MB, so a handful
// of these snapshots — especially the adopt-cloud re-snapshot churn on every reload — marched the
// origin toward the quota wall. Once full, the CANONICAL saveDoc write to LS_DOC started failing
// ("SAVE FAILED"), which is the cardinal sin: the live doc is the one thing that must always land.
//
// THE FIX (this module)
// Move the heavy, best-effort recovery snapshots OFF localStorage and into IndexedDB, whose quota is
// hundreds of MB (browser- and disk-dependent, but always vastly larger than localStorage's ~5MB).
// IndexedDB is asynchronous, so snapshot WRITES become async — which is fine: snapshots are
// best-effort recovery copies, never on the canonical save's critical path. The live LS_DOC +
// LS_DOC_VER stay in localStorage (synchronous, read-back invariant unchanged). Nothing here can
// block, fail, or throw into saveDoc — every call is wrapped and resolves to a benign value.
//
// WHAT STAYS COMPATIBLE
//   • KEY FORMAT is identical to the localStorage snapshots:
//       wp01_burma_doc_v1.{conflict|bak|corrupt}.<epoch-ms>-<zero-padded-seq>
//     so the existing recovery tooling (recovery.js: snapshotTimestamp, kindOf, snapshotToText)
//     classifies and orders IDB snapshots exactly as it does the legacy localStorage ones.
//   • STORE SHAPE per record: { key, kind, ts, raw } — `raw` is the serialized doc string (same
//     bytes that used to be the localStorage value). `bytes` for the UI is derived as raw.length.
//   • BOUNDING per kind mirrors the localStorage policy (CONFLICT_KEEP / BAK_KEEP / CORRUPT_KEEP),
//     so the IDB store can't grow unbounded either — though its ceiling is hundreds of MB, not 5.
//
// EVERY exported function NEVER throws and NEVER rejects with a value the caller must handle: the
// async ones resolve to null / [] / false on any error (no IDB, blocked, quota, schema). Best-effort.

const LEGACY_BURMA_DOC = 'wp01_burma_doc_v1';
let LS_DOC = LEGACY_BURMA_DOC;
let DOC_KEY = LEGACY_BURMA_DOC;
let CONFLICT_PREFIX = LS_DOC + '.conflict.';
let BAK_PREFIX = LS_DOC + '.bak.';
let CORRUPT_PREFIX = LS_DOC + '.corrupt.';

let DB_NAME = 'wp01_burma_recovery';
// DB_VERSION 2 → 3 (2026-08 — DURABLE OFFLINE MEDIA). v3 is ADDITIVE: it introduces the
// `pending-media` store and touches NEITHER the `doc` nor `snapshots` store. A user already on v2
// upgrades in place — their canonical doc row and every recovery snapshot survive untouched (the
// onupgradeneeded guards below only CREATE a store that isn't there yet).
const DB_VERSION = 3;
const STORE = 'snapshots';
const DOC_STORE = 'doc';
// DURABLE OFFLINE MEDIA store. Holds the RAW File/Blob of a photo/video/audio that was dropped or
// pasted WHILE OFFLINE, keyed by the sha256 hex of its final bytes (== the future contentHash), so a
// reconnect drain can upload it and swap the real CDN url into the block. Bytes live ONLY here — never
// in the doc (BYTES-NEVER-IN-THE-DOC law); the doc block carries only the 64-char `localKey` string.
const PENDING_STORE = 'pending-media';

// Soft cap on the TOTAL bytes of queued offline media for the active episode. A plane-load of large
// video drops could otherwise fill the origin's storage; past this ceiling we REFUSE new entries and
// signal the caller to surface a toast ("offline media storage full"). 250MB is generous headroom
// over any realistic single-flight offline session while staying well under a typical IDB quota.
export const PENDING_MEDIA_MAX_BYTES = 250 * 1024 * 1024;

// Bounds per kind — mirror migrate-doc.js's localStorage policy so the IDB recovery set stays sane.
// (The IDB quota is hundreds of MB, so these are about keeping the recovery LIST short for the human,
// not about reclaiming space the way the localStorage caps were.)
const KEEP = { conflict: 4, bak: 3, corrupt: 2 };

// #21 — SNAPSHOT GC: DOUBLE-CAP by both COUNT and AGE, whichever is tighter, pruned oldest-first.
// The per-kind KEEP caps above bound each KIND; these two bound the store GLOBALLY as a backstop so
// an uncapped-in-aggregate snapshot pile can never itself become the "storage full" cause (the exact
// failure class that triggered the original crash). GLOBAL_MAX_SNAPSHOTS caps the TOTAL rows; anything
// older than MAX_SNAPSHOT_AGE_MS is dropped regardless of count. Applied after every snapshot write.
const GLOBAL_MAX_SNAPSHOTS = 20;
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Burma keeps the exact legacy IndexedDB database name so all existing recovery snapshots remain
// discoverable. Other episodes derive their own DB names from their canonical DOC keys so their
// snapshot/doc rows never collide with Burma or with each other.
function deriveDbName(storage) {
  try {
    const doc = storage && storage.DOC ? String(storage.DOC) : LEGACY_BURMA_DOC;
    if (doc === LEGACY_BURMA_DOC) return 'wp01_burma_recovery';
    return doc.replace(/_doc_v1$/, '') + '_recovery';
  } catch {
    return 'wp01_burma_recovery';
  }
}

// Keep the module's storage keys synchronized with the active episode. The listener fires
// immediately on registration, so all exported helpers and live bindings reflect the current
// episode before any caller attempts a read/write.
function syncEpisode() {
  try {
    const storage = getEpisodeStorage();
    LS_DOC = storage && storage.DOC ? String(storage.DOC) : LEGACY_BURMA_DOC;
    DOC_KEY = LS_DOC;
    DB_NAME = deriveDbName(storage);
    CONFLICT_PREFIX = LS_DOC + '.conflict.';
    BAK_PREFIX = LS_DOC + '.bak.';
    CORRUPT_PREFIX = LS_DOC + '.corrupt.';
  } catch {
    LS_DOC = LEGACY_BURMA_DOC;
    DOC_KEY = LEGACY_BURMA_DOC;
    DB_NAME = 'wp01_burma_recovery';
    CONFLICT_PREFIX = LS_DOC + '.conflict.';
    BAK_PREFIX = LS_DOC + '.bak.';
    CORRUPT_PREFIX = LS_DOC + '.corrupt.';
  }
}
onEpisodeChange(syncEpisode);

// Monotonic per-process sequence so two snapshots in the SAME millisecond never collide on key.
// Mirrors migrate-doc.js / cloud-sync.js: fixed-width ms prefix dominates the lexical sort, the
// zero-padded seq breaks within-ms ties in true write order — chronological order is preserved.
let _idbSnapSeq = 0;
function snapshotKey(kind) {
  const prefix = kind === 'conflict' ? CONFLICT_PREFIX
    : kind === 'bak' ? BAK_PREFIX
    : CORRUPT_PREFIX;
  const seq = String((_idbSnapSeq++) % 1000000).padStart(6, '0');
  return prefix + Date.now() + '-' + seq;
}

function kindOf(key) {
  if (key.startsWith(CONFLICT_PREFIX)) return 'conflict';
  if (key.startsWith(BAK_PREFIX)) return 'bak';
  if (key.startsWith(CORRUPT_PREFIX)) return 'corrupt';
  return 'unknown';
}

function snapshotTimestamp(key) {
  try {
    const tail = String(key).split('.').pop() || '';
    const ms = parseInt(String(tail).split('-')[0], 10);
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

// Resolve the IndexedDB factory. Dependency-injected for headless tests (a mock IDB), else the real
// global. Returns null when there is no IndexedDB at all (node without a shim, private mode lockouts,
// or a browser that refuses) — every caller treats null as "best-effort no-op".
function resolveIDB(deps) {
  if (deps && deps.indexedDB) return deps.indexedDB;
  if (typeof indexedDB !== 'undefined') return indexedDB;
  if (typeof globalThis !== 'undefined' && globalThis.indexedDB) return globalThis.indexedDB;
  return null;
}

// Open (and lazily upgrade/create) the recovery database. Resolves to the IDBDatabase, or null on
// ANY failure (no IDB, open error, blocked). NEVER rejects. The object store is keyed by `key` and
// carries a `kind` index so per-kind pruning is a single cursor walk.
function openDB(deps = {}) {
  const idb = resolveIDB(deps);
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = (ev) => {
      try {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'key' });
          os.createIndex('kind', 'kind', { unique: false });
          os.createIndex('ts', 'ts', { unique: false });
        }
        if (!db.objectStoreNames.contains(DOC_STORE)) {
          db.createObjectStore(DOC_STORE, { keyPath: 'key' });
        }
        // v3 ADDITIVE — create the durable offline-media store WITHOUT touching doc/snapshots. The
        // guard makes this a no-op for a db already carrying it, and the two stores above keep their
        // rows because this branch never re-creates or clears them.
        if (!db.objectStoreNames.contains(PENDING_STORE)) {
          db.createObjectStore(PENDING_STORE, { keyPath: 'key' });
        }
      } catch { /* upgrade failure surfaces as an open error below */ }
    };
    req.onsuccess = (ev) => resolve(ev.target.result || null);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

// Run `fn(store)` inside a transaction of `mode`, resolving to the value `fn` returns via the
// supplied `done(value)` callback (since IDB requests are themselves async). NEVER rejects: any
// throw / abort / error resolves to `fallback`. The db handle is closed when the txn completes.
function withStore(db, mode, fallback, fn) {
  return new Promise((resolve) => {
    if (!db) { resolve(fallback); return; }
    let tx;
    try {
      tx = db.transaction(STORE, mode);
    } catch {
      try { db.close(); } catch {}
      resolve(fallback);
      return;
    }
    let result = fallback;
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      try { db.close(); } catch {}
      resolve(v);
    };
    tx.oncomplete = () => finish(result);
    tx.onerror = () => finish(fallback);
    tx.onabort = () => finish(fallback);
    try {
      const store = tx.objectStore(STORE);
      // fn calls back with the value to resolve once the txn commits.
      fn(store, (v) => { result = v; });
    } catch {
      try { tx.abort(); } catch {}
      finish(fallback);
    }
  });
}

// Run `fn(store)` inside a transaction against the canonical compressed doc store. This is kept
// separate from the snapshot helper because the transaction target is different, and preserving the
// never-throw / close-on-complete belt matters more than being clever about reuse here.
function withDocStore(db, mode, fallback, fn) {
  return new Promise((resolve) => {
    if (!db) { resolve(fallback); return; }
    let tx;
    try {
      tx = db.transaction(DOC_STORE, mode);
    } catch {
      try { db.close(); } catch {}
      resolve(fallback);
      return;
    }
    let result = fallback;
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      try { db.close(); } catch {}
      resolve(v);
    };
    tx.oncomplete = () => finish(result);
    tx.onerror = () => finish(fallback);
    tx.onabort = () => finish(fallback);
    try {
      const store = tx.objectStore(DOC_STORE);
      fn(store, (v) => { result = v; });
    } catch {
      try { tx.abort(); } catch {}
      finish(fallback);
    }
  });
}

// Compress/decompress the canonical doc synchronously so callers can use the same helpers inside
// crash-belt code paths that cannot afford to await a worker or stream. Any failure resolves to null
// rather than ever throwing into the save path.
export function compressDoc(rawJsonString) {
  try {
    return zlibSync(strToU8(String(rawJsonString)));
  } catch {
    return null;
  }
}

export function decompressDoc(gz) {
  try {
    if (!gz) return null;
    const u8 = gz instanceof Uint8Array ? gz : new Uint8Array(gz);
    return strFromU8(unzlibSync(u8));
  } catch {
    return null;
  }
}

// Write exactly one canonical compressed doc row per episode. The key is the episode's DOC key, so
// subsequent writes overwrite the same row instead of accumulating more quota pressure.
export async function idbPutDoc(rawJsonString, ver, tab, deps = {}) {
  try {
    const gz = compressDoc(rawJsonString);
    if (!gz) return { ok: false };
    const db = await openDB(deps);
    if (!db) return { ok: false };
    const key = DOC_KEY;
    const incomingVer = Number(ver) || 0;
    const incomingTab = String(tab || '');
    const record = { key, ver: incomingVer, ts: Date.now(), tab: incomingTab, gz };
    // OPTIMISTIC-CONCURRENCY GUARD (#3 — cross-tab IDB-only clobber). In the quota-full IDB-only
    // regime LS_DOC_VER never advances, so two tabs can compute the SAME version and blind-overwrite
    // the single canonical DOC_KEY row. Read the current row first and REFUSE to stomp a DIFFERENT
    // tab's equal-or-newer, different-bytes edit. The loser is preserved as a `.conflict` snapshot
    // (below) so it is never silently lost. Same-tab progression and strictly-newer writes overwrite.
    const outcome = await withDocStore(db, 'readwrite', { ok: false }, (store, done) => {
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const cur = getReq.result || null;
        if (cur && cur.gz !== gz) {
          const curVer = Number(cur.ver) || 0;
          const sameTab = String(cur.tab || '') === incomingTab;
          // STALE-SAVE GUARD (#3) — a late async save carrying a STRICTLY OLDER version than the row
          // already present must never overwrite it. This is the same-tab out-of-order case: two
          // overlapping flushes (e.g. the 300ms debounce write and a pagehide/visibilitychange
          // teardown flush) fire idbPutDoc back-to-back and their async puts resolve in the WRONG
          // order, so the older doc lands last and rewinds the row. The newer content is already
          // durable here, so the older one is a benign no-op: dropped SILENTLY — no `.conflict`
          // snapshot and no banner, because nothing was lost (a strictly-newer version supersedes it).
          if (sameTab && curVer > incomingVer) { done({ ok: false, reason: 'stale' }); return; }
          // CROSS-TAB CLOBBER (existing behavior, unchanged) — a DIFFERENT tab's equal-or-newer edit
          // sits in the single canonical row. Refuse and preserve THIS tab's refused edit as a
          // `.conflict` snapshot (below) so it surfaces via the RecoveryBanner and is never lost.
          if (!sameTab && curVer >= incomingVer) { done({ ok: false, reason: 'conflict' }); return; }
        }
        const putReq = store.put(record);
        putReq.onsuccess = () => done({ ok: true, ver: incomingVer });
        putReq.onerror = () => done({ ok: false });
      };
      getReq.onerror = () => done({ ok: false });
    });
    if (outcome && outcome.reason === 'conflict') {
      // Preserve the refused (incoming) edit so it surfaces via the RecoveryBanner. Report whether
      // that snapshot actually landed so the caller can word the banner honestly (kept vs on-screen-only).
      let preserved = false;
      try { preserved = !!(await idbPutSnapshot('conflict', rawJsonString, deps)); } catch {}
      return { ok: false, reason: 'conflict', preserved };
    }
    return outcome || { ok: false };
  } catch {
    return { ok: false };
  }
}

// Read the canonical compressed doc row for the active episode and hand callers the exact JSON
// string back. Returning null on any corruption keeps this best-effort recovery path isolated from
// the live save path's invariants.
export async function idbReadDoc(deps = {}) {
  try {
    const db = await openDB(deps);
    if (!db) return null;
    const rec = await withDocStore(db, 'readonly', null, (store, done) => {
      const req = store.get(DOC_KEY);
      req.onsuccess = () => done(req.result || null);
      req.onerror = () => done(null);
    });
    if (!rec) return null;
    const raw = decompressDoc(rec.gz);
    if (raw == null) return null;
    return { raw, ver: Number(rec.ver) || 0, tab: rec.tab || '' };
  } catch {
    return null;
  }
}

// Discriminated existence probe for the canonical doc row. idbReadDoc collapses "genuinely empty",
// "open blocked/errored", and "row present but gz won't decompress" all to null — which is unsafe
// for resetDoc's must-back-up gate. This distinguishes them so the gate can FAIL CLOSED on any
// ambiguity and only wipe when the row is POSITIVELY confirmed absent. Returns 'present' | 'absent'
// | 'unknown'. ('present' includes a row whose gz is corrupt — still something we must not destroy.)
export async function idbDocProbe(deps = {}) {
  try {
    const db = await openDB(deps);
    if (!db) return idbAvailable(deps) ? 'unknown' : 'absent';
    return await withDocStore(db, 'readonly', 'unknown', (store, done) => {
      const req = store.get(DOC_KEY);
      req.onsuccess = () => done(req.result ? 'present' : 'absent');
      req.onerror = () => done('unknown');
    });
  } catch {
    return 'unknown';
  }
}

// Best-effort delete of the canonical compressed doc row for the active episode. resetDoc uses this
// so an intentional wipe cannot leave an IDB-only doc behind to be rehydrated on the next boot.
// Resolves true iff the delete txn committed. NEVER throws.
export async function idbDeleteDoc(deps = {}) {
  try {
    const db = await openDB(deps);
    if (!db) return false;
    return await withDocStore(db, 'readwrite', false, (store, done) => {
      const delReq = store.delete(DOC_KEY);
      delReq.onsuccess = () => done(true);
      delReq.onerror = () => done(false);
    });
  } catch {
    return false;
  }
}

// Write a snapshot to IDB and prune that kind back to its KEEP bound. `kind` is one of
// 'conflict' | 'bak' | 'corrupt'. `raw` is the serialized doc string. Resolves to the written key,
// or null if it could not be written (no IDB / blocked / empty raw). NEVER throws / rejects.
// BEST-EFFORT: a null return must NEVER block or fail the canonical saveDoc.
export async function idbPutSnapshot(kind, raw, deps = {}) {
  try {
    if (!raw) return null;
    if (kind !== 'conflict' && kind !== 'bak' && kind !== 'corrupt') return null;
    const db = await openDB(deps);
    if (!db) return null;
    const key = snapshotKey(kind);
    const ts = snapshotTimestamp(key);
    const record = { key, kind, ts, raw: String(raw) };
    const wrote = await withStore(db, 'readwrite', null, (store, done) => {
      const putReq = store.put(record);
      putReq.onsuccess = () => done(key);
      putReq.onerror = () => done(null);
    });
    if (wrote) {
      // Best-effort prune of this kind; failure to prune never invalidates the write.
      await idbPruneKind(kind, KEEP[kind], deps);
      // #21 — then apply the GLOBAL age + count double-cap across ALL kinds so the aggregate
      // snapshot pile is bounded, not just each kind independently. Best-effort; never blocks.
      await idbPruneGlobal(deps);
    }
    return wrote;
  } catch {
    return null;
  }
}

// List ALL snapshots in IDB, newest first: [{ key, kind, ts, bytes, raw }]. `bytes` is raw.length (a
// cheap size hint for the UI; the raw doc is not parsed here). `raw` is the serialized doc string,
// carried so callers (recovery.js's async scan) can compare canonical content WITHOUT a second IDB
// read per snapshot — the cursor already has it in hand. Resolves to [] on any error.
export async function idbListSnapshots(deps = {}) {
  try {
    const db = await openDB(deps);
    if (!db) return [];
    const rows = await withStore(db, 'readonly', [], (store, done) => {
      const out = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (cursor) {
          const v = cursor.value || {};
          const key = v.key;
          const kind = v.kind && v.kind !== 'unknown' ? v.kind : kindOf(String(key));
          if (key && kind !== 'unknown' && v.raw) {
            const raw = String(v.raw);
            out.push({ key, kind, ts: v.ts || snapshotTimestamp(key), bytes: raw.length, raw });
          }
          cursor.continue();
        } else {
          done(out);
        }
      };
      cursorReq.onerror = () => done([]);
    });
    rows.sort((a, b) => b.ts - a.ts); // newest first, matching recovery.js's ordering
    return rows;
  } catch {
    return [];
  }
}

// Read a single snapshot's PARSED doc by key. Resolves to the parsed object, or null if missing /
// unparseable / no IDB. NEVER throws.
export async function idbReadSnapshot(key, deps = {}) {
  try {
    if (!key) return null;
    const db = await openDB(deps);
    if (!db) return null;
    const raw = await withStore(db, 'readonly', null, (store, done) => {
      const getReq = store.get(key);
      getReq.onsuccess = () => done(getReq.result ? getReq.result.raw : null);
      getReq.onerror = () => done(null);
    });
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Delete a single snapshot by key. Resolves to true iff the delete txn committed (best-effort —
// callers use this to forget a snapshot the user dismissed or that was migrated). NEVER throws.
export async function idbDeleteSnapshot(key, deps = {}) {
  try {
    if (!key) return false;
    const db = await openDB(deps);
    if (!db) return false;
    return await withStore(db, 'readwrite', false, (store, done) => {
      const delReq = store.delete(key);
      delReq.onsuccess = () => done(true);
      delReq.onerror = () => done(false);
    });
  } catch {
    return false;
  }
}

// Keep only the newest `keep` snapshots of `kind`, deleting the rest. NEVER throws. Resolves to the
// number of records dropped (0 on any error / nothing to drop).
export async function idbPruneKind(kind, keep, deps = {}) {
  try {
    const limit = Number.isFinite(keep) ? keep : (KEEP[kind] ?? 0);
    const db = await openDB(deps);
    if (!db) return 0;
    return await withStore(db, 'readwrite', 0, (store, done) => {
      // Gather this kind's keys (oldest first), then delete all but the newest `limit`.
      const keys = [];
      let cursorReq;
      try {
        const idx = store.index('kind');
        cursorReq = idx.openCursor(idbKeyRange(deps, kind));
      } catch {
        cursorReq = store.openCursor(); // fallback: full scan, filter in JS
      }
      cursorReq.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (cursor) {
          const v = cursor.value || {};
          const k = v.key;
          const thisKind = v.kind && v.kind !== 'unknown' ? v.kind : kindOf(String(k));
          if (k && thisKind === kind) keys.push(k);
          cursor.continue();
          return;
        }
        // Cursor exhausted — sort oldest-first (lexical == chronological) and drop the overflow.
        keys.sort();
        const drop = keys.slice(0, Math.max(0, keys.length - limit));
        if (drop.length === 0) { done(0); return; }
        let removed = 0;
        let pending = drop.length;
        for (const dk of drop) {
          const delReq = store.delete(dk);
          delReq.onsuccess = () => { removed++; if (--pending === 0) done(removed); };
          delReq.onerror = () => { if (--pending === 0) done(removed); };
        }
      };
      cursorReq.onerror = () => done(0);
    });
  } catch {
    return 0;
  }
}

// #21 — GLOBAL snapshot GC across ALL kinds: cap by BOTH count (GLOBAL_MAX_SNAPSHOTS) AND age
// (MAX_SNAPSHOT_AGE_MS), oldest-first, whichever bound is tighter. This is the aggregate backstop the
// per-kind idbPruneKind can't provide: it drops anything past 7 days OUTRIGHT (stale recovery copies
// are worthless), then trims the surviving set down to the newest GLOBAL_MAX_SNAPSHOTS. `nowMs` is
// injectable so a headless test can age snapshots deterministically; production passes nothing and it
// reads Date.now(). Resolves to the number of records dropped (0 on any error). NEVER throws.
export async function idbPruneGlobal(deps = {}, nowMs) {
  try {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const db = await openDB(deps);
    if (!db) return 0;
    return await withStore(db, 'readwrite', 0, (store, done) => {
      const rows = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (cursor) {
          const v = cursor.value || {};
          const k = v.key;
          if (k) rows.push({ key: k, ts: Number(v.ts) || snapshotTimestamp(k) });
          cursor.continue();
          return;
        }
        // Oldest-first, so a COUNT trim slices off the head (the stalest rows).
        rows.sort((a, b) => a.ts - b.ts);
        const drop = new Set();
        // AGE cap — anything older than the max age is dropped regardless of how few rows remain.
        for (const r of rows) { if (now - r.ts > MAX_SNAPSHOT_AGE_MS) drop.add(r.key); }
        // COUNT cap — of what's left after the age cull, keep only the newest GLOBAL_MAX_SNAPSHOTS.
        const survivors = rows.filter((r) => !drop.has(r.key));
        const overflow = survivors.length - GLOBAL_MAX_SNAPSHOTS;
        for (let i = 0; i < overflow; i++) drop.add(survivors[i].key); // survivors already oldest-first
        const keys = [...drop];
        if (keys.length === 0) { done(0); return; }
        let removed = 0;
        let pending = keys.length;
        for (const dk of keys) {
          const delReq = store.delete(dk);
          delReq.onsuccess = () => { removed++; if (--pending === 0) done(removed); };
          delReq.onerror = () => { if (--pending === 0) done(removed); };
        }
      };
      cursorReq.onerror = () => done(0);
    });
  } catch {
    return 0;
  }
}

// IDBKeyRange.only(kind) for the kind index lookup — resolved from deps (mock) or the global. Returns
// undefined when no key-range constructor is available, in which case openCursor() does a full scan
// and idbPruneKind filters in JS (the fallback path above).
function idbKeyRange(deps, kind) {
  try {
    const KR = (deps && deps.IDBKeyRange) ||
      (typeof IDBKeyRange !== 'undefined' ? IDBKeyRange : null) ||
      (typeof globalThis !== 'undefined' ? globalThis.IDBKeyRange : null);
    return KR ? KR.only(kind) : undefined;
  } catch {
    return undefined;
  }
}

// Whether IndexedDB is available at all in this environment. Used by recovery.js to decide whether
// to route snapshot writes to IDB or fall back to the legacy localStorage path. NEVER throws.
export function idbAvailable(deps = {}) {
  return resolveIDB(deps) != null;
}

// ── DURABLE OFFLINE MEDIA ─────────────────────────────────────────────────────────────────────────
// Same never-throw / close-on-complete belt as withStore/withDocStore, targeting the pending-media
// store. Kept separate (rather than parameterizing the store name) so each write path's transaction
// target is explicit and the fail-soft posture is impossible to accidentally lose.
function withPendingStore(db, mode, fallback, fn) {
  return new Promise((resolve) => {
    if (!db) { resolve(fallback); return; }
    let tx;
    try {
      tx = db.transaction(PENDING_STORE, mode);
    } catch {
      try { db.close(); } catch {}
      resolve(fallback);
      return;
    }
    let result = fallback;
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      try { db.close(); } catch {}
      resolve(v);
    };
    tx.oncomplete = () => finish(result);
    tx.onerror = () => finish(fallback);
    tx.onabort = () => finish(fallback);
    try {
      const store = tx.objectStore(PENDING_STORE);
      fn(store, (v) => { result = v; });
    } catch {
      try { tx.abort(); } catch {}
      finish(fallback);
    }
  });
}

// The best-effort byte size of a blob-ish value (File/Blob → .size; anything else → 0). Persisted on
// the record so idbListPendingMedia / idbPendingMediaBytes read a number without re-touching the blob.
function blobBytes(blob) {
  try { const n = Number(blob && blob.size); return Number.isFinite(n) && n > 0 ? n : 0; }
  catch { return 0; }
}

// Strip the heavy `blob` off a record for the LIST view — callers that only need to enumerate what's
// queued (the drain driver, a quota readout) never hold a reference to megabytes of bytes.
function pendingMeta(rec) {
  if (!rec) return null;
  return {
    key: rec.key,
    mime: rec.mime || '',
    blockId: rec.blockId || '',
    project: rec.project || '',
    kind: rec.kind || 'image',
    alt: rec.alt || '',
    createdAt: Number(rec.createdAt) || 0,
    bytes: Number.isFinite(rec.bytes) ? rec.bytes : blobBytes(rec.blob),
  };
}

// Sum the bytes of all queued offline media for the active episode. Cheap (reads the stored `bytes`
// field, not the blobs). Resolves 0 on any error / no IDB. NEVER throws. Used as the pre-write quota
// guard and for a "storage nearly full" readout.
export async function idbPendingMediaBytes(deps = {}) {
  try {
    const db = await openDB(deps);
    if (!db) return 0;
    return await withPendingStore(db, 'readonly', 0, (store, done) => {
      let total = 0;
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (cursor) {
          const v = cursor.value || {};
          total += Number.isFinite(v.bytes) ? v.bytes : blobBytes(v.blob);
          cursor.continue();
        } else {
          done(total);
        }
      };
      cursorReq.onerror = () => done(0);
    });
  } catch {
    return 0;
  }
}

// Durably store the RAW bytes of an offline-captured media file. `rec` MUST carry:
//   { key: <sha256 hex>, blob: <File|Blob>, mime, blockId, project, kind: 'image'|'video'|'audio', alt, createdAt }
// SOFT-CAP GUARD: if this write would push the episode's total queued bytes past PENDING_MEDIA_MAX_BYTES
// AND the key isn't already stored, REFUSE and resolve { ok:false, reason:'full' } so the caller can
// toast "offline media storage full" (and NOT land a block that will never have local bytes to preview).
// A re-write of an EXISTING key (idempotent re-queue of the same content-addressed bytes) is always
// allowed — it consumes no NEW bytes. Resolves { ok:true, key } on success. NEVER throws.
export async function idbPutPendingMedia(rec, deps = {}) {
  try {
    if (!rec || !rec.key || !rec.blob) return { ok: false, reason: 'bad' };
    const bytes = blobBytes(rec.blob);
    const db = await openDB(deps);
    if (!db) return { ok: false, reason: 'no-idb' };
    const record = {
      key: String(rec.key),
      blob: rec.blob,
      bytes,
      mime: String(rec.mime || (rec.blob && rec.blob.type) || ''),
      blockId: String(rec.blockId || ''),
      project: String(rec.project || ''),
      kind: rec.kind === 'video' || rec.kind === 'audio' ? rec.kind : 'image',
      alt: String(rec.alt || ''),
      createdAt: Number(rec.createdAt) || Date.now(),
    };
    return await withPendingStore(db, 'readwrite', { ok: false, reason: 'no-idb' }, (store, done) => {
      // Read the current row for this key first: an existing key re-write is free (same bytes), and we
      // need the live total to enforce the soft cap on a genuinely NEW entry.
      const getReq = store.get(record.key);
      getReq.onsuccess = () => {
        const exists = !!getReq.result;
        if (!exists) {
          // Sum the store to enforce the cap. (Correctness over cleverness: a handful of queued items,
          // one cursor walk — never the hot path.)
          let total = 0;
          const sumReq = store.openCursor();
          sumReq.onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (cursor) {
              const v = cursor.value || {};
              total += Number.isFinite(v.bytes) ? v.bytes : blobBytes(v.blob);
              cursor.continue();
              return;
            }
            if (total + bytes > PENDING_MEDIA_MAX_BYTES) { done({ ok: false, reason: 'full' }); return; }
            const putReq = store.put(record);
            putReq.onsuccess = () => done({ ok: true, key: record.key });
            putReq.onerror = () => done({ ok: false, reason: 'write' });
          };
          sumReq.onerror = () => done({ ok: false, reason: 'write' });
          return;
        }
        const putReq = store.put(record);
        putReq.onsuccess = () => done({ ok: true, key: record.key });
        putReq.onerror = () => done({ ok: false, reason: 'write' });
      };
      getReq.onerror = () => done({ ok: false, reason: 'write' });
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// Read one queued media record IN FULL (INCLUDING the blob) by key. The drain path needs the bytes to
// upload; the nodeview preview needs them to make an objectURL. Resolves null if missing / no IDB.
// NEVER throws.
export async function idbGetPendingMedia(key, deps = {}) {
  try {
    if (!key) return null;
    const db = await openDB(deps);
    if (!db) return null;
    return await withPendingStore(db, 'readonly', null, (store, done) => {
      const req = store.get(String(key));
      req.onsuccess = () => done(req.result || null);
      req.onerror = () => done(null);
    });
  } catch {
    return null;
  }
}

// List all queued media as METADATA (no blob) for the active episode: [{ key, mime, blockId, project,
// kind, alt, createdAt, bytes }], oldest-first (drain in capture order). Resolves [] on any error.
// NEVER throws.
export async function idbListPendingMedia(deps = {}) {
  try {
    const db = await openDB(deps);
    if (!db) return [];
    const rows = await withPendingStore(db, 'readonly', [], (store, done) => {
      const out = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (cursor) {
          const meta = pendingMeta(cursor.value);
          if (meta && meta.key) out.push(meta);
          cursor.continue();
        } else {
          done(out);
        }
      };
      cursorReq.onerror = () => done([]);
    });
    rows.sort((a, b) => a.createdAt - b.createdAt); // oldest-first — drain in the order they were queued
    return rows;
  } catch {
    return [];
  }
}

// Delete a single queued media record by key (after a successful drain upload, or when its block was
// removed before reconnect). Resolves true iff the delete txn committed. NEVER throws.
export async function idbDeletePendingMedia(key, deps = {}) {
  try {
    if (!key) return false;
    const db = await openDB(deps);
    if (!db) return false;
    return await withPendingStore(db, 'readwrite', false, (store, done) => {
      const delReq = store.delete(String(key));
      delReq.onsuccess = () => done(true);
      delReq.onerror = () => done(false);
    });
  } catch {
    return false;
  }
}

export {
  LS_DOC, CONFLICT_PREFIX, BAK_PREFIX, CORRUPT_PREFIX,
  DB_NAME, DB_VERSION, STORE, DOC_STORE, PENDING_STORE, KEEP,
  GLOBAL_MAX_SNAPSHOTS, MAX_SNAPSHOT_AGE_MS,
  snapshotKey, kindOf, snapshotTimestamp,
};
