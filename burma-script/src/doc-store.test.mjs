/**
 * EPISODE-AWARE COMPRESSED IDB DOC STORE — closes the SAVE FAILED quota wall.
 *
 * THE PRODUCTION FAILURE: the heavy live doc sat in localStorage (~5MB quota), so once recovery
 * copies accumulated, the canonical save could hit quota and fail. This store moves the heavy doc
 * into IndexedDB (GB-scale) and compresses it, leaving localStorage as the crash belt fallback.
 *
 * Run: bun burma-script/src/doc-store.test.mjs
 */

import { strToU8 } from 'fflate';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// MOCK INDEXEDDB — copied from recovery-store.test.mjs so this file proves the real store code
// against the same minimal async-IDB contract: open + onupgradeneeded, createObjectStore(keyPath),
// createIndex, transaction(mode), objectStore, put/get/delete, openCursor (store + index), and
// IDBKeyRange.only. The mock already supports arbitrary store names, so the extra `doc` store
// upgrades through the same path as `snapshots`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
function makeMockIDB() {
  const databases = new Map();
  const soon = (fn) => queueMicrotask(fn);

  class MockKeyRange {
    constructor(value) { this.only = value; }
    includes(v) { return v === this.only; }
  }
  const IDBKeyRange = { only: (v) => new MockKeyRange(v) };

  class MockRequest { constructor() { this.onsuccess = null; this.onerror = null; this.result = undefined; } }

  function makeStoreHandle(storeDef, tx) {
    const op = (work) => {
      const req = new MockRequest();
      tx._enter();
      soon(() => {
        try { work(req); } catch (_e) { req.onerror && req.onerror({ target: req }); }
        finally { tx._leave(); }
      });
      return req;
    };
    return {
      _def: storeDef,
      put(record) {
        return op((req) => {
          storeDef.data.set(record[storeDef.keyPath], record);
          req.result = record[storeDef.keyPath];
          req.onsuccess && req.onsuccess({ target: req });
        });
      },
      get(key) {
        return op((req) => {
          req.result = storeDef.data.has(key) ? storeDef.data.get(key) : undefined;
          req.onsuccess && req.onsuccess({ target: req });
        });
      },
      delete(key) {
        return op((req) => {
          storeDef.data.delete(key);
          req.result = undefined;
          req.onsuccess && req.onsuccess({ target: req });
        });
      },
      openCursor(range) {
        return cursorOver(tx, () => [...storeDef.data.values()], range, null);
      },
      index(name) {
        const idxDef = storeDef.indexes.get(name);
        return {
          openCursor(range) {
            return cursorOver(tx, () => [...storeDef.data.values()], range, idxDef ? idxDef.keyPath : null);
          },
        };
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
          if (i < snapshot.length) {
            const value = snapshot[i++];
            req.result = { value, continue() { step(); } };
            req.onsuccess && req.onsuccess({ target: req });
          } else {
            req.result = null;
            req.onsuccess && req.onsuccess({ target: req });
          }
        } finally { tx._leave(); }
      });
    };
    step();
    return req;
  }

  function makeTransaction(db, storeNames, mode) {
    let inflight = 0;
    let settled = false;
    const tx = {
      mode,
      oncomplete: null,
      onerror: null,
      onabort: null,
      _enter() { inflight++; },
      _leave() {
        inflight--;
        if (inflight <= 0 && !settled) {
          soon(() => {
            if (inflight <= 0 && !settled) {
              settled = true;
              tx.oncomplete && tx.oncomplete({ target: tx });
            }
          });
        }
      },
      objectStore(name) {
        const def = db._stores.get(name);
        if (!def) throw new Error('no such store ' + name);
        return makeStoreHandle(def, tx);
      },
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
          name: db.name,
          version: db.version,
          _stores: db._stores,
          objectStoreNames: { contains: (n) => db._stores.has(n) },
          createObjectStore(storeName, opts) {
            const def = { keyPath: opts.keyPath, indexes: new Map(), data: new Map() };
            db._stores.set(storeName, def);
            return {
              createIndex(idxName, keyPath, _opts) { def.indexes.set(idxName, { keyPath }); },
            };
          },
          transaction(_storeNames, txMode) { return makeTransaction(dbHandle, _storeNames, txMode || 'readonly'); },
          close() {},
        };
        if (isNew && req.onupgradeneeded) {
          req.result = dbHandle;
          req.onupgradeneeded({ target: req });
        }
        req.result = dbHandle;
        req.onsuccess && req.onsuccess({ target: req });
      });
      return req;
    },
  };

  return { indexedDB, IDBKeyRange, _databases: databases };
}

const store = await import('./recovery-store.js');
const {
  compressDoc, decompressDoc, idbPutDoc, idbReadDoc,
  DB_NAME, DOC_STORE, LS_DOC,
} = store;

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

function freshDeps() {
  const mock = makeMockIDB();
  return { indexedDB: mock.indexedDB, IDBKeyRange: mock.IDBKeyRange, mock };
}

function makeLargeRawDoc() {
  const blocks = Array.from({ length: 1200 }, (_, i) => ({
    id: i,
    type: 'paragraph',
    text: `mars-${i % 12} ` + 'compressed recovery payload '.repeat(8),
    marks: ['bold', 'italic', 'underline'],
  }));
  return JSON.stringify({ type: 'doc', version: 1, title: 'Burma Script', blocks });
}

/* ── 1: put → read round-trips, compression is real, single canonical row exists ── */
{
  const deps = freshDeps();
  const raw = makeLargeRawDoc();
  const put = await idbPutDoc(raw, 5, 'tabX', deps);
  ok(put && put.ok === true, '1a. put reports success');
  eq(put.ver, 5, '1b. put echoes the written version');

  const read = await idbReadDoc(deps);
  ok(read && read.raw === raw, '1c. read returns the byte-identical raw JSON');
  eq(read && read.ver, 5, '1d. read returns the stored version');
  eq(read && read.tab, 'tabX', '1e. read returns the stored tab id');

  const db = deps.mock._databases.get(DB_NAME);
  const docStore = db && db._stores.get(DOC_STORE);
  const record = docStore && docStore.data.get(LS_DOC);
  ok(record && record.gz instanceof Uint8Array, '1f. stored gz payload is a Uint8Array');
  ok(record && record.gz.length < strToU8(raw).length, '1g. compressed payload is smaller than raw UTF-8 bytes');
  eq(docStore && docStore.data.size, 1, '1h. only one canonical doc row exists');
}

/* ── 2: second put overwrites the canonical row instead of accumulating rows ── */
{
  const deps = freshDeps();
  const raw1 = JSON.stringify({ type: 'doc', text: 'first ' + 'alpha '.repeat(2000) });
  const raw2 = JSON.stringify({ type: 'doc', text: 'second ' + 'beta '.repeat(2500) });
  await idbPutDoc(raw1, 1, 'tabA', deps);
  const put2 = await idbPutDoc(raw2, 9, 'tabB', deps);
  ok(put2 && put2.ok === true, '2a. second put succeeds');
  eq(put2.ver, 9, '2b. second put reports newest version');

  const read = await idbReadDoc(deps);
  ok(read && read.raw === raw2, '2c. read returns the newest raw payload');
  eq(read && read.ver, 9, '2d. read returns the newest version');
  eq(read && read.tab, 'tabB', '2e. read returns the newest tab');

  const db = deps.mock._databases.get(DB_NAME);
  const docStore = db && db._stores.get(DOC_STORE);
  eq(docStore && docStore.data.size, 1, '2f. overwrite still leaves exactly one row');
}

/* ── 3: helper round-trips and bad inputs never throw ── */
{
  const s = JSON.stringify({ hello: 'mars', repeated: 'zlib '.repeat(50) });
  const gz = compressDoc(s);
  ok(gz instanceof Uint8Array, '3a. compressDoc returns Uint8Array');
  eq(decompressDoc(gz), s, '3b. decompressDoc(compressDoc(s)) === s');
  eq(decompressDoc(compressDoc(123)), '123', '3c. compressDoc coerces non-strings');
  ok(compressDoc(null) instanceof Uint8Array, '3d. compressDoc(null) still returns compressed bytes');
  eq(decompressDoc(null), null, '3e. decompressDoc(null) === null');
  eq(decompressDoc(new Uint8Array([1, 2, 3, 4])), null, '3f. decompressDoc(garbage) === null');
}

/* ── 4: NO IndexedDB anywhere stays benign and never throws ── */
{
  const put = await idbPutDoc('{"type":"doc"}', 3, 'tab-no-idb', {});
  ok(put && put.ok === false, '4a. no IDB put resolves {ok:false}');
  eq(await idbReadDoc({}), null, '4b. no IDB read resolves null');
}

console.log(`\ndoc-store: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
