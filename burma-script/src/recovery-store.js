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

const LS_DOC = 'wp01_burma_doc_v1';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';
const BAK_PREFIX = LS_DOC + '.bak.';
const CORRUPT_PREFIX = LS_DOC + '.corrupt.';

const DB_NAME = 'wp01_burma_recovery';
const DB_VERSION = 1;
const STORE = 'snapshots';

// Bounds per kind — mirror migrate-doc.js's localStorage policy so the IDB recovery set stays sane.
// (The IDB quota is hundreds of MB, so these are about keeping the recovery LIST short for the human,
// not about reclaiming space the way the localStorage caps were.)
const KEEP = { conflict: 4, bak: 3, corrupt: 2 };

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
    }
    return wrote;
  } catch {
    return null;
  }
}

// List ALL snapshots in IDB, newest first: [{ key, kind, ts, bytes }]. `bytes` is raw.length (a
// cheap size hint for the UI; the raw doc is not parsed here). Resolves to [] on any error.
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
            out.push({ key, kind, ts: v.ts || snapshotTimestamp(key), bytes: String(v.raw).length });
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

export {
  LS_DOC, CONFLICT_PREFIX, BAK_PREFIX, CORRUPT_PREFIX,
  DB_NAME, DB_VERSION, STORE, KEEP,
  snapshotKey, kindOf, snapshotTimestamp,
};
