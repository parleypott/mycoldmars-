/**
 * WRITE -> (simulated reload) -> READ LOOP regression.
 *
 * Covers both:
 *   1. normal conditions: saveDoc lands synchronously and a fresh seed reads the same bytes back.
 *   2. quota-full conditions: both sync stores reject the large doc, IDB catches it, and reload
 *      recovery surfaces the fresh edit from IDB.
 *
 * Run: bun src/write-read-loop.test.mjs
 */

function makeMockIDB() {
  const databases = new Map();
  const soon = (fn) => queueMicrotask(fn);
  class MockKeyRange { constructor(v) { this.only = v; } includes(x) { return x === this.only; } }
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
      mode, oncomplete: null, onerror: null, onabort: null,
      _enter() { inflight++; },
      _leave() { inflight--; if (inflight <= 0 && !settled) soon(() => { if (inflight <= 0 && !settled) { settled = true; tx.oncomplete && tx.oncomplete({ target: tx }); } }); },
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
          transaction(_storeNames, txMode) { return makeTransaction(dbHandle, _storeNames, txMode || 'readonly'); },
          close() {},
        };
        if (isNew && req.onupgradeneeded) { req.result = dbHandle; req.onupgradeneeded({ target: req }); }
        req.result = dbHandle;
        req.onsuccess && req.onsuccess({ target: req });
      });
      return req;
    },
  };
  return { indexedDB, IDBKeyRange, _databases: databases };
}

const store = new Map();
class QuotaError extends Error { constructor() { super('quota'); this.name = 'QuotaExceededError'; this.code = 22; } }
const SMALL_LIMIT = 200;
const LS_DOC = 'wp01_burma_doc_v1';

let quotaOn = false;
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    const s = String(v);
    if (quotaOn && s.length > SMALL_LIMIT) throw new QuotaError();
    store.set(k, s);
  },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = globalThis.window.dispatchEvent || (() => true);
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };
const flushAsync = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

function installFreshIDB() {
  const mock = makeMockIDB();
  globalThis.indexedDB = mock.indexedDB;
  globalThis.IDBKeyRange = mock.IDBKeyRange;
  return mock;
}

function doc(text) {
  return { type: 'doc', content: [
    { type: 'tableRow', attrs: { cols: 1 }, content: [
      { type: 'tableCell', attrs: { role: 'full' }, content: [
        { type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' }, content: [
          { type: 'paragraph', content: [{ type: 'text', text }] },
        ] },
      ] },
    ] },
  ] };
}

function bigDoc(tag) {
  const rows = [];
  for (let i = 0; i < 300; i++) {
    rows.push({ type: 'tableRow', attrs: { cols: 1 }, content: [
      { type: 'tableCell', attrs: { role: 'full' }, content: [
        { type: 'voBlock', attrs: { blockId: 'blk_' + i, status: 'todo' }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: `${tag} block ${i}: ` + 'the myanmar out here on the border with the {tk who} - '.repeat(6) }] },
        ] },
      ] },
    ] });
  }
  return { type: 'doc', content: rows };
}

function firstText(parsedDoc) {
  return parsedDoc?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.text ?? null;
}

installFreshIDB();
const M = await import('./migrate-doc.js?wrl2');
const { compressDoc } = await import('./recovery-store.js');

{
  const gz = compressDoc(JSON.stringify(bigDoc('EDIT-B')));
  ok(gz && gz.length > SMALL_LIMIT, `0a. compressed quota doc (${gz ? gz.length : 0}B) exceeds fit budget (${SMALL_LIMIT}B)`);
}

{
  store.clear();
  quotaOn = false;
  installFreshIDB();
  M.syncBaseVersion();

  const res = M.saveDoc(doc('EDIT-A'));
  await flushAsync();
  const resolved = await M.rehydrateLocalFromNewest();
  const seeded = JSON.parse(localStorage.getItem(LS_DOC) || 'null');

  ok(res.ok === true && res.reason === 'saved', '1a. normal save reports saved');
  ok(resolved.renderable === true, '1b. resolver result is renderable after a normal save');
  ok(firstText(seeded) === 'EDIT-A', '1c. a fresh seed from LS_DOC reads back EDIT-A exactly');
}

{
  store.clear();
  quotaOn = true;
  installFreshIDB();
  M.syncBaseVersion();

  const res = M.saveDoc(bigDoc('EDIT-B'));
  await flushAsync();
  const resolved = await M.rehydrateLocalFromNewest();

  ok(res.ok === true && res.reason === 'idb-only', '2a. quota-full save degrades to idb-only');
  ok(resolved.source === 'idb', '2b. resolver reloads from IDB when both sync stores reject the save');
  ok(/EDIT-B/.test(resolved.raw || '') && /EDIT-B/.test(JSON.stringify(resolved.doc || {})), '2c. the recovered doc contains the fresh EDIT-B bytes');
}

console.log(`\nwrite-read-loop: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
