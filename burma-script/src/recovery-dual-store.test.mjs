/**
 * RECOVERY SCAN ACROSS BOTH STORES (recovery-idb) — Phase 3.
 *
 * recovery.js's async scan must read recovery snapshots from BOTH the new IndexedDB store AND any
 * legacy localStorage keys, and OPPORTUNISTICALLY migrate the legacy localStorage copies into IDB
 * (then reclaim the localStorage bytes). These tests prove:
 *   1. An IDB-only snapshot is surfaced by the async scan.
 *   2. A legacy localStorage snapshot is surfaced AND migrated into IDB, freeing the localStorage key.
 *   3. The merged list dedups identical (kind,ts,bytes) snapshots that exist in both stores.
 *   4. readSnapshotAsync reads from IDB (and falls back to localStorage for a legacy key).
 *   5. dismissSnapshotAsync stops a snapshot surfacing (records dismissal + deletes the IDB copy).
 *   6. With NO IndexedDB, the async scan degrades to exactly the legacy localStorage scan.
 *
 * Run: bun src/recovery-dual-store.test.mjs   (auto-discovered by `bun run test`)
 */

// ── reuse the same minimal mock IDB shape as recovery-store.test.mjs ──────────────────────────────
function makeMockIDB() {
  const databases = new Map();
  const soon = (fn) => queueMicrotask(fn);
  class MockKeyRange { constructor(v) { this.only = v; } includes(v) { return v === this.only; } }
  const IDBKeyRange = { only: (v) => new MockKeyRange(v) };
  class MockRequest { constructor() { this.onsuccess = null; this.onerror = null; this.result = undefined; } }

  function makeStoreHandle(storeDef, tx) {
    const op = (work) => {
      const req = new MockRequest(); tx._enter();
      soon(() => { try { work(req); } catch { req.onerror && req.onerror({ target: req }); } finally { tx._leave(); } });
      return req;
    };
    return {
      put(record) { return op((req) => { storeDef.data.set(record[storeDef.keyPath], record); req.result = record[storeDef.keyPath]; req.onsuccess && req.onsuccess({ target: req }); }); },
      get(key) { return op((req) => { req.result = storeDef.data.has(key) ? storeDef.data.get(key) : undefined; req.onsuccess && req.onsuccess({ target: req }); }); },
      delete(key) { return op((req) => { storeDef.data.delete(key); req.result = undefined; req.onsuccess && req.onsuccess({ target: req }); }); },
      openCursor(range) { return cursorOver(tx, () => [...storeDef.data.values()], range, null); },
      index(name) { const d = storeDef.indexes.get(name); return { openCursor(range) { return cursorOver(tx, () => [...storeDef.data.values()], range, d ? d.keyPath : null); } }; },
    };
  }
  function cursorOver(tx, rowsFn, range, keyPath) {
    const req = new MockRequest();
    const filter = (rows) => range && keyPath ? rows.filter((r) => range.includes(r[keyPath])) : (range && range.only !== undefined ? rows.filter((r) => r.key === range.only) : rows);
    const snap = filter(rowsFn()); let i = 0;
    const step = () => { tx._enter(); soon(() => { try { if (i < snap.length) { const value = snap[i++]; req.result = { value, continue() { step(); } }; req.onsuccess && req.onsuccess({ target: req }); } else { req.result = null; req.onsuccess && req.onsuccess({ target: req }); } } finally { tx._leave(); } }); };
    step(); return req;
  }
  function makeTransaction(db) {
    let inflight = 0, settled = false;
    const tx = {
      oncomplete: null, onerror: null, onabort: null,
      _enter() { inflight++; },
      _leave() { inflight--; if (inflight <= 0 && !settled) soon(() => { if (inflight <= 0 && !settled) { settled = true; tx.oncomplete && tx.oncomplete({ target: tx }); } }); },
      objectStore(name) { const def = db._stores.get(name); if (!def) throw new Error('no store'); return makeStoreHandle(def, tx); },
      abort() { settled = true; soon(() => tx.onabort && tx.onabort({ target: tx })); },
    };
    soon(() => soon(() => { if (inflight <= 0 && !settled) { settled = true; tx.oncomplete && tx.oncomplete({ target: tx }); } }));
    return tx;
  }
  const indexedDB = {
    open(name, version) {
      const req = new MockRequest();
      soon(() => {
        let db = databases.get(name); const isNew = !db || (version && version > db.version);
        if (!db) { db = { name, version: version || 1, _stores: new Map() }; databases.set(name, db); }
        const dbHandle = {
          name: db.name, version: db.version, _stores: db._stores,
          objectStoreNames: { contains: (n) => db._stores.has(n) },
          createObjectStore(sn, opts) { const def = { keyPath: opts.keyPath, indexes: new Map(), data: new Map() }; db._stores.set(sn, def); return { createIndex(n, kp) { def.indexes.set(n, { keyPath: kp }); } }; },
          transaction() { return makeTransaction(dbHandle); }, close() {},
        };
        if (isNew && req.onupgradeneeded) { req.result = dbHandle; req.onupgradeneeded({ target: req }); }
        req.result = dbHandle; req.onsuccess && req.onsuccess({ target: req });
      });
      return req;
    },
  };
  return { indexedDB, IDBKeyRange, _databases: databases };
}

// ── fake localStorage (insertion-ordered) ─────────────────────────────────────────────────────────
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    _map: map,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

const {
  scanRecoverySnapshotsAsync, readSnapshotAsync, dismissSnapshotAsync, scanRecoverySnapshots,
  CONFLICT_PREFIX, BAK_PREFIX, CORRUPT_PREFIX, LS_DOC,
} = await import('./recovery.js');
const idbStore = await import('./recovery-store.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
const DOC = (t) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

function deps(storageInit = {}) {
  const mock = makeMockIDB();
  return { storage: makeStorage(storageInit), indexedDB: mock.indexedDB, IDBKeyRange: mock.IDBKeyRange };
}

/* ── 1: an IDB-only snapshot is surfaced by the async scan ── */
{
  const d = deps();
  const key = await idbStore.idbPutSnapshot('conflict', DOC('lives only in IDB'), d);
  const list = await scanRecoverySnapshotsAsync(d);
  eq(list.length, 1, '1a. one snapshot surfaced from IDB');
  eq(list[0].key, key, '1b. the IDB key is surfaced');
  eq(list[0].kind, 'conflict', '1c. kind classified');
  eq(list[0].store, 'idb', '1d. tagged store=idb');
}

/* ── 2: a legacy localStorage snapshot is surfaced AND migrated into IDB (LS key reclaimed) ── */
{
  const legacyKey = CONFLICT_PREFIX + '1718800000000-000000';
  const d = deps({ [legacyKey]: DOC('legacy edit stranded in localStorage') });
  // Before the scan: the legacy key is in localStorage and IDB is empty.
  eq((await idbStore.idbListSnapshots(d)).length, 0, '2a. IDB starts empty');
  const list = await scanRecoverySnapshotsAsync(d);
  eq(list.length, 1, '2b. the legacy snapshot is surfaced (nothing hidden)');
  eq(list[0].store, 'idb', '2c. it now reports as an IDB snapshot (migrated)');
  // localStorage copy reclaimed; IDB now holds it.
  eq(d.storage.getItem(legacyKey), null, '2d. the legacy localStorage key was reclaimed (freed)');
  eq((await idbStore.idbListSnapshots(d)).length, 1, '2e. the snapshot was migrated INTO IDB');
}

/* ── 3: dedup — same content present in both stores appears ONCE ── */
{
  const raw = DOC('the SAME bytes in both stores');
  const d = deps();
  // Put into IDB.
  await idbStore.idbPutSnapshot('bak', raw, d);
  // Also drop an identical-content legacy LS copy (different key, same bytes).
  d.storage.setItem(BAK_PREFIX + '999', raw);
  const list = await scanRecoverySnapshotsAsync(d);
  eq(list.length, 1, '3a. identical-content snapshot in both stores collapses to ONE entry');
}

/* ── 4: readSnapshotAsync reads from IDB, and falls back to LS for a legacy key ── */
{
  const d = deps();
  const idbKey = await idbStore.idbPutSnapshot('conflict', DOC('idb doc body'), d);
  const fromIdb = await readSnapshotAsync(idbKey, d);
  ok(fromIdb && fromIdb.content[0].content[0].text === 'idb doc body', '4a. reads the IDB snapshot doc');

  const legacyKey = CORRUPT_PREFIX + '500';
  const d2 = deps({ [legacyKey]: DOC('legacy ls doc body') });
  const fromLs = await readSnapshotAsync(legacyKey, { ...d2, store: 'ls' });
  ok(fromLs && fromLs.content[0].content[0].text === 'legacy ls doc body', '4b. falls back to localStorage for a legacy key');
}

/* ── 5: dismissSnapshotAsync stops a snapshot surfacing ── */
{
  const d = deps();
  const key = await idbStore.idbPutSnapshot('conflict', DOC('to be dismissed'), d);
  eq((await scanRecoverySnapshotsAsync(d)).length, 1, '5a. surfaces before dismissal');
  await dismissSnapshotAsync(key, d);
  eq((await scanRecoverySnapshotsAsync(d)).length, 0, '5b. no longer surfaces after dismissal (IDB copy deleted)');
}

/* ── 6: NO IndexedDB → async scan degrades to exactly the legacy localStorage scan ── */
{
  const storage = makeStorage({
    [CONFLICT_PREFIX + '2000-000000']: DOC('ls only A'),
    [BAK_PREFIX + '1000']: DOC('ls only B'),
  });
  const noIdb = { storage, indexedDB: null };
  const asyncList = await scanRecoverySnapshotsAsync(noIdb);
  const syncList = scanRecoverySnapshots({ storage });
  eq(asyncList.length, syncList.length, '6a. async scan length === legacy sync scan length when no IDB');
  eq(asyncList.length, 2, '6b. both localStorage snapshots surfaced');
  // No IDB → nothing migrated → the localStorage keys remain (not reclaimed, but still surfaced).
  ok(storage.getItem(CONFLICT_PREFIX + '2000-000000') != null, '6c. legacy LS key retained when no IDB to migrate into');
}

console.log(`\nrecovery-dual-store: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
