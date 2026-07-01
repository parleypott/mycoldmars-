/**
 * WRITE -> (simulated reload) -> READ LOOP, localStorage EFFECTIVELY FULL.
 *
 * Fixed palau-v2 behavior under test:
 *   1. A large save can degrade to IDB-only without a false hard SAVE-FAILED.
 *   2. LS_DOC_VER does NOT advance past a failed sync body write.
 *   3. The boot resolver sees the newer IDB row, prefers it by version, and returns the fresh edit.
 *   4. Even if quota still blocks rehydrating LS_DOC, startup renders the recovered in-memory doc.
 *
 * Run: bun src/quota-full-write-read-loop.test.mjs
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
const LS_DOC_FALLBACK = LS_DOC + '.z';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';

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
const events = [];
globalThis.window.dispatchEvent = (e) => { events.push({ type: e.type, detail: e.detail }); return true; };
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };
const saveFailedEvents = () => events.filter((e) => e.type === 'wp-save-failed');
const saveDegradedEvents = () => events.filter((e) => e.type === 'wp-save-degraded');
const savedEvents = () => events.filter((e) => e.type === 'wp-saved');
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

function bootDocFromResolved(resolved) {
  const recoveredDoc = resolved?.renderable && !resolved?.lsReady ? resolved.doc : null;
  if (recoveredDoc) return recoveredDoc;
  try {
    const raw = localStorage.getItem(LS_DOC);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

installFreshIDB();
const M = await import('./migrate-doc.js?wrl');
const { compressDoc, idbReadDoc } = await import('./recovery-store.js');

let savedRaw = null;
let savedVer = 0;
let resolved = null;
let rehydrated = null;

{
  const gz = compressDoc(JSON.stringify(bigDoc('PRE')));
  ok(gz && gz.length > SMALL_LIMIT, `0a. compressed ~300-block payload (${gz ? gz.length : 0}B) exceeds fit budget (${SMALL_LIMIT}B)`);
}

{
  store.clear();
  events.length = 0;
  quotaOn = false;
  installFreshIDB();
  const priorSeed = JSON.stringify({ type: 'doc', content: [
    { type: 'tableRow', attrs: { cols: 1 }, content: [
      { type: 'tableCell', attrs: { role: 'full' }, content: [
        { type: 'voBlock', attrs: { blockId: 'seed', status: 'todo' }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'STALE-PRIOR-SEED' }] },
        ] },
      ] },
    ] },
  ] });
  store.set(LS_DOC, priorSeed);
  store.set(LS_DOC_VER, '3|tab_seed');
  M.syncBaseVersion();
  quotaOn = true;

  const doc = bigDoc('FRESH-EDIT');
  savedRaw = JSON.stringify(doc);
  const res = M.saveDoc(doc);
  await flushAsync();

  ok(res.ok === true && res.reason === 'idb-only', '1a. saveDoc reports durable degraded success (idb-only)');
  ok(saveFailedEvents().length === 0, '1b. no hard wp-save-failed fired');
  ok(saveDegradedEvents().length === 1 && saveDegradedEvents()[0].detail?.kind === 'idb-only', '1c. a soft wp-save-degraded idb-only event fired');
  ok(savedEvents().length === 0, '1d. no false wp-saved fired');
  ok(store.get(LS_DOC_FALLBACK) == null, '1e. the compressed .z copy did not land under quota');
}

{
  const fromIdb = await idbReadDoc();
  savedVer = Number(fromIdb?.ver) || 0;
  ok(fromIdb != null && fromIdb.raw === savedRaw, '2a. IDB round-trips the saved edit byte-identically');
  ok(fromIdb && JSON.parse(fromIdb.raw).content.length === 300, '2b. all 300 blocks round-trip from IDB');
}

{
  ok(store.get(LS_DOC_VER) === '3|tab_seed', '3a. LS_DOC_VER stayed on the stale seed version because no sync body landed');
  ok(savedVer > 3, '3b. the IDB row carries the newer save version');
  ok(store.get(LS_DOC) != null && /STALE-PRIOR-SEED/.test(store.get(LS_DOC) || ''), '3c. LS_DOC itself is still the stale prior seed');
}

{
  resolved = await M.resolveNewestCanonicalDoc();
  ok(resolved.source === 'idb', '4a. resolveNewestCanonicalDoc picks IDB as the newest canonical source');
  ok(resolved.version === savedVer && /FRESH-EDIT/.test(resolved.raw || ''), '4b. resolver returns the fresh edit at the IDB version');
  ok(resolved.candidates.ls.version === 3 && /STALE-PRIOR-SEED/.test(resolved.candidates.ls.raw || ''), '4c. the LS candidate stays stale at the old version');
  ok(resolved.candidates.idb.version === savedVer && /FRESH-EDIT/.test(resolved.candidates.idb.raw || ''), '4d. the IDB candidate carries the fresh edit');

  rehydrated = await M.rehydrateLocalFromNewest();
  ok(rehydrated.source === 'idb' && /FRESH-EDIT/.test(rehydrated.raw || ''), '4e. rehydrateLocalFromNewest still returns the fresh IDB edit');
  ok(rehydrated.lsReady === false, '4f. rehydration could not refresh LS_DOC while quota remained full');
}

{
  const bootDoc = bootDocFromResolved(rehydrated);
  ok(rehydrated.renderable === true, '5a. the recovered resolver result is renderable');
  ok(bootDoc != null && /FRESH-EDIT/.test(JSON.stringify(bootDoc)), '5b. the boot fork would render the recovered fresh edit');

  const fs = await import('node:fs');
  const path = await import('node:path');
  const here = path.dirname(new URL(import.meta.url).pathname);
  const mainSource = fs.readFileSync(path.join(here, 'main.jsx'), 'utf8');
  const resolverCalls = (mainSource.match(/rehydrateLocalFromNewest\s*\(/g) || []).length;
  ok(resolverCalls >= 2, '5c. main.jsx calls rehydrateLocalFromNewest before the render fork');
}

console.log(`\nquota-full-write-read-loop: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
