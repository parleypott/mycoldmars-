/**
 * DURABLE OFFLINE MEDIA — pending-media store (recovery-store.js v3) unit tests.
 *
 * Phase 2 of the Offline Lock. When a photo/video/audio is dropped/pasted OFFLINE, its raw bytes are
 * durably parked in the per-episode `pending-media` IndexedDB store (keyed by sha256 == contentHash)
 * so a reconnect drain can upload them and the block survives reload. These tests run the REAL
 * recovery-store against the same tiny in-memory MOCK IndexedDB the sibling recovery-store.test.mjs
 * uses (no fake-indexeddb in the repo), proving:
 *   1. put → get → list → delete → bytes round-trip (metadata list carries no blob; bytes summed).
 *   2. SOFT-CAP: a NEW key whose bytes would exceed PENDING_MEDIA_MAX_BYTES is REFUSED ({reason:'full'}).
 *   3. IDEMPOTENT re-write of an EXISTING key is always allowed and consumes NO new bytes.
 *   4. NO IndexedDB → every call is a benign no-op (never throws).
 *   5. v2 → v3 onupgradeneeded is ADDITIVE — a user already on v2 keeps their `doc` + `snapshots`
 *      rows untouched AND gains a working `pending-media` store.
 *
 * Run: bun burma-script/src/recovery-store-pending-media.test.mjs   (auto-discovered by run-tests.mjs)
 */

// ── MOCK INDEXEDDB (verbatim shape from recovery-store.test.mjs — the exact subset the store uses) ──
function makeMockIDB() {
  const databases = new Map();
  const soon = (fn) => queueMicrotask(fn);

  class MockKeyRange { constructor(value) { this.only = value; } includes(v) { return v === this.only; } }
  const IDBKeyRange = { only: (v) => new MockKeyRange(v) };
  class MockRequest { constructor() { this.onsuccess = null; this.onerror = null; this.result = undefined; } }

  function makeStoreHandle(storeDef, tx) {
    const op = (work) => {
      const req = new MockRequest();
      tx._enter();
      soon(() => { try { work(req); } catch { req.onerror && req.onerror({ target: req }); } finally { tx._leave(); } });
      return req;
    };
    return {
      _def: storeDef,
      put(record) { return op((req) => { storeDef.data.set(record[storeDef.keyPath], record); req.result = record[storeDef.keyPath]; req.onsuccess && req.onsuccess({ target: req }); }); },
      get(key) { return op((req) => { req.result = storeDef.data.has(key) ? storeDef.data.get(key) : undefined; req.onsuccess && req.onsuccess({ target: req }); }); },
      delete(key) { return op((req) => { storeDef.data.delete(key); req.result = undefined; req.onsuccess && req.onsuccess({ target: req }); }); },
      openCursor(range) { return cursorOver(tx, () => [...storeDef.data.values()], range, null); },
      index(name) {
        const idxDef = storeDef.indexes.get(name);
        return { openCursor(range) { return cursorOver(tx, () => [...storeDef.data.values()], range, idxDef ? idxDef.keyPath : null); } };
      },
    };
  }
  function cursorOver(tx, rowsFn, range, keyPath) {
    const req = new MockRequest();
    const filter = (rows) => {
      if (range && keyPath) return rows.filter((r) => range.includes(r[keyPath]));
      if (range && range.only !== undefined) return rows.filter((r) => r.key === range.only);
      return rows;
    };
    let snapshot = filter(rowsFn());
    let i = 0;
    const step = () => {
      tx._enter();
      soon(() => {
        try {
          if (i < snapshot.length) { const value = snapshot[i++]; req.result = { value, continue() { step(); } }; req.onsuccess && req.onsuccess({ target: req }); }
          else { req.result = null; req.onsuccess && req.onsuccess({ target: req }); }
        } finally { tx._leave(); }
      });
    };
    step();
    return req;
  }
  function makeTransaction(db, storeNames, mode) {
    let inflight = 0; let settled = false;
    const tx = {
      mode, oncomplete: null, onerror: null, onabort: null,
      _enter() { inflight++; },
      _leave() {
        inflight--;
        if (inflight <= 0 && !settled) {
          soon(() => { if (inflight <= 0 && !settled) { settled = true; tx.oncomplete && tx.oncomplete({ target: tx }); } });
        }
      },
      objectStore(name) { const def = db._stores.get(name); if (!def) throw new Error('no such store ' + name); return makeStoreHandle(def, tx); },
      abort() { settled = true; soon(() => tx.onabort && tx.onabort({ target: tx })); },
    };
    soon(() => soon(() => { if (inflight <= 0 && !settled) { settled = true; tx.oncomplete && tx.oncomplete({ target: tx }); } }));
    return tx;
  }
  const indexedDB = {
    open(name, version) {
      const req = new MockRequest();
      soon(() => {
        let db = databases.get(name);
        const isNew = !db || (version && version > db.version);
        if (!db) { db = { name, version: version || 1, _stores: new Map() }; databases.set(name, db); }
        const dbHandle = {
          name: db.name, version: db.version, _stores: db._stores,
          objectStoreNames: { contains: (n) => db._stores.has(n) },
          createObjectStore(storeName, opts) {
            const def = { keyPath: opts.keyPath, indexes: new Map(), data: new Map() };
            db._stores.set(storeName, def);
            return { createIndex(idxName, keyPath) { def.indexes.set(idxName, { keyPath }); } };
          },
          transaction(storeNames, mode) { return makeTransaction(dbHandle, storeNames, mode || 'readonly'); },
          close() {},
        };
        if (isNew && req.onupgradeneeded) { req.result = dbHandle; req.onupgradeneeded({ target: req }); if (version) db.version = version; }
        req.result = dbHandle;
        req.onsuccess && req.onsuccess({ target: req });
      });
      return req;
    },
  };
  return { indexedDB, IDBKeyRange, _databases: databases };
}

// ── Load the REAL store ─────────────────────────────────────────────────────────────────────────
const store = await import('./recovery-store.js');
const {
  idbPutPendingMedia, idbGetPendingMedia, idbListPendingMedia, idbDeletePendingMedia,
  idbPendingMediaBytes, PENDING_MEDIA_MAX_BYTES,
  idbReadDoc, idbListSnapshots, compressDoc,
  DB_NAME, LS_DOC, CONFLICT_PREFIX, BAK_PREFIX,
} = store;

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

function freshDeps() { const m = makeMockIDB(); return { indexedDB: m.indexedDB, IDBKeyRange: m.IDBKeyRange }; }
// Lightweight blob stand-in — the store only ever reads .size / .type and stores the object as-is, so
// this exercises the soft-cap on giant sizes without allocating hundreds of MB.
const blob = (size, type = 'image/png') => ({ size, type });
const MB = 1024 * 1024;

/* ── 1: put → get → list → bytes → delete round-trip ── */
{
  const deps = freshDeps();
  const rec = { key: 'a'.repeat(64), blob: blob(1234, 'image/jpeg'), mime: 'image/jpeg', blockId: 'image_x1', project: 'burma', kind: 'image', alt: 'hi', createdAt: 1000 };
  const put = await idbPutPendingMedia(rec, deps);
  ok(put && put.ok === true && put.key === rec.key, '1a. put ok returns the key');

  const got = await idbGetPendingMedia(rec.key, deps);
  ok(got && got.blob && got.blob.size === 1234, '1b. get returns the full record WITH the blob');
  eq(got.blockId, 'image_x1', '1c. get carries blockId');
  eq(got.kind, 'image', '1d. get carries kind');

  const list = await idbListPendingMedia(deps);
  eq(list.length, 1, '1e. one item listed');
  ok(list[0] && list[0].blob === undefined, '1f. list is METADATA — no blob attached');
  eq(list[0].bytes, 1234, '1g. list carries byte size');
  eq(list[0].blockId, 'image_x1', '1h. list carries blockId (for drain lookup)');

  eq(await idbPendingMediaBytes(deps), 1234, '1i. bytes sums to the one record');

  ok((await idbDeletePendingMedia(rec.key, deps)) === true, '1j. delete reports success');
  eq((await idbListPendingMedia(deps)).length, 0, '1k. empty after delete');
  eq(await idbPendingMediaBytes(deps), 0, '1l. bytes back to 0');
}

/* ── 2: oldest-first listing (drain order) ── */
{
  const deps = freshDeps();
  await idbPutPendingMedia({ key: 'k2', blob: blob(10), blockId: 'b2', kind: 'image', createdAt: 2000 }, deps);
  await idbPutPendingMedia({ key: 'k1', blob: blob(10), blockId: 'b1', kind: 'image', createdAt: 1000 }, deps);
  const list = await idbListPendingMedia(deps);
  eq(list.map((r) => r.key).join(','), 'k1,k2', '2a. listed oldest-first by createdAt');
}

/* ── 3: SOFT-CAP — a NEW key past PENDING_MEDIA_MAX_BYTES is refused; idempotent re-write is free ── */
{
  const deps = freshDeps();
  const big = Math.floor(PENDING_MEDIA_MAX_BYTES * 0.8);   // 80% of the cap
  const a = await idbPutPendingMedia({ key: 'big-a', blob: blob(big), blockId: 'ba', kind: 'video', createdAt: 1 }, deps);
  ok(a && a.ok === true, '3a. first big item (80% of cap) stored');

  // A NEW key that would push total past the cap → refused with reason 'full'.
  const b = await idbPutPendingMedia({ key: 'big-b', blob: blob(big), blockId: 'bb', kind: 'video', createdAt: 2 }, deps);
  ok(b && b.ok === false && b.reason === 'full', '3b. new key over the cap refused as full');
  eq((await idbListPendingMedia(deps)).length, 1, '3c. the refused item was NOT written');
  eq(await idbPendingMediaBytes(deps), big, '3d. total bytes unchanged by the refusal');

  // IDEMPOTENT re-write of the EXISTING key is always allowed (same content-addressed bytes) and
  // consumes NO new bytes — critical so a re-queue of the same offline capture can't self-DoS the cap.
  const aAgain = await idbPutPendingMedia({ key: 'big-a', blob: blob(big), blockId: 'ba', kind: 'video', createdAt: 3 }, deps);
  ok(aAgain && aAgain.ok === true, '3e. re-write of an existing key allowed even at 80% cap');
  eq((await idbListPendingMedia(deps)).length, 1, '3f. still exactly one row (overwrote, not appended)');
  eq(await idbPendingMediaBytes(deps), big, '3g. re-write consumed no NEW bytes');
}

/* ── 4: bad input + NO IndexedDB → benign no-ops, never throw ── */
{
  const deps = freshDeps();
  const bad = await idbPutPendingMedia({ key: '', blob: blob(1) }, deps);
  ok(bad && bad.ok === false, '4a. missing key refused');
  const noBlob = await idbPutPendingMedia({ key: 'x', blob: null }, deps);
  ok(noBlob && noBlob.ok === false, '4b. missing blob refused');

  const noIdb = { indexedDB: null };
  ok((await idbPutPendingMedia({ key: 'y', blob: blob(1) }, noIdb)).ok === false, '4c. no-idb put → {ok:false}');
  ok((await idbGetPendingMedia('y', noIdb)) === null, '4d. no-idb get → null');
  ok(Array.isArray(await idbListPendingMedia(noIdb)) && (await idbListPendingMedia(noIdb)).length === 0, '4e. no-idb list → []');
  ok((await idbDeletePendingMedia('y', noIdb)) === false, '4f. no-idb delete → false');
  eq(await idbPendingMediaBytes(noIdb), 0, '4g. no-idb bytes → 0');
}

/* ── 5: v2 → v3 upgrade is ADDITIVE — pre-existing doc + snapshots rows survive, pending-media added ── */
{
  const deps = freshDeps();

  // Simulate a user ALREADY ON v2: open the DB at version 2 and create ONLY the v2 stores (doc +
  // snapshots) with rows — exactly the shape recovery-store.js created before this change.
  const docGz = compressDoc(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }));
  await new Promise((resolve) => {
    const req = deps.indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      const snaps = db.createObjectStore('snapshots', { keyPath: 'key' });
      snaps.createIndex('kind', 'kind', { unique: false });
      snaps.createIndex('ts', 'ts', { unique: false });
      db.createObjectStore('doc', { keyPath: 'key' });
    };
    req.onsuccess = (ev) => {
      const db = ev.target.result;
      const t1 = db.transaction('doc', 'readwrite');
      t1.objectStore('doc').put({ key: LS_DOC, ver: 7, ts: 111, tab: 'tabZ', gz: docGz });
      const t2 = db.transaction('snapshots', 'readwrite');
      const os = t2.objectStore('snapshots');
      os.put({ key: CONFLICT_PREFIX + '111-000000', kind: 'conflict', ts: 111, raw: JSON.stringify({ type: 'doc', content: [] }) });
      os.put({ key: BAK_PREFIX + '222-000000', kind: 'bak', ts: 222, raw: JSON.stringify({ type: 'doc', content: [] }) });
      let done = 0; const fin = () => { if (++done >= 2) resolve(); };
      t1.oncomplete = fin; t1.onerror = fin; t1.onabort = fin;
      t2.oncomplete = fin; t2.onerror = fin; t2.onabort = fin;
    };
    req.onerror = () => resolve();
  });

  // Now touch the store through its v3 code path — this triggers the v2→v3 onupgradeneeded, which
  // must ADD pending-media WITHOUT clearing doc/snapshots.
  const putRes = await idbPutPendingMedia({ key: 'p1', blob: blob(42), blockId: 'bp', kind: 'image', createdAt: 5 }, deps);
  ok(putRes && putRes.ok === true, '5a. pending-media store created + writable after v2→v3 upgrade');

  // The pre-existing canonical doc row survived the additive upgrade untouched.
  const doc = await idbReadDoc(deps);
  ok(doc && doc.ver === 7 && doc.tab === 'tabZ', '5b. pre-existing DOC row survived v2→v3 upgrade');

  // Both pre-existing recovery snapshots survived.
  const snaps = await idbListSnapshots(deps);
  eq(snaps.length, 2, '5c. both pre-existing snapshots survived v2→v3 upgrade');
  ok(snaps.some((s) => s.kind === 'conflict') && snaps.some((s) => s.kind === 'bak'), '5d. snapshot kinds intact');

  // And the new store genuinely works alongside them.
  const got = await idbGetPendingMedia('p1', deps);
  ok(got && got.blob && got.blob.size === 42, '5e. the new pending-media row reads back');
}

console.log(`\nrecovery-store-pending-media: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
