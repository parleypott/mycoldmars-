/**
 * #3 — TWO TABS, IDB-ONLY (localStorage effectively full), SAME BASE, DIFFERENT EDITS.
 *
 * The cross-tab conflict guard (migrate-doc.js STEP 0) protects against the crosstab-stale-overwrite
 * loss by comparing LS_DOC_VER (on-disk version stamp) against this tab's knownBaseVersion, and — if
 * disk is newer — snapshotting the newer doc to `.conflict.<ts>` and REFUSING the stomp. That guard is
 * proven end-to-end in crosstab-conflict.test.mjs … but ONLY in the localStorage path.
 *
 * THE HOLE: on a genuinely-full origin, saveDoc degrades to IDB-only. writeCanonicalStores stamps
 * LS_DOC_VER *only* when a SYNCHRONOUS body (`.z` or LS_DOC) lands (`if ((z.ok || ls.ok) && v>0)`),
 * so an IDB-only save does NOT advance LS_DOC_VER — by design, so a reload won't prefer stale LS over
 * fresher IDB. Consequence for two tabs:
 *
 *   1. Tab A & Tab B both open at base vN (LS_DOC_VER = N).
 *   2. Tab A saves (IDB-only): idbPutDoc(rawA, N+1, A) lands in the single canonical IDB DOC_KEY row.
 *      LS_DOC_VER stays N. Tab A's knownBaseVersion advances to N+1 in memory.
 *   3. Tab B saves (IDB-only): STEP 0 reads storedVersion = N (unchanged); B's base = N; N > N is
 *      false → NO conflict detected. idbPutDoc(rawB, N+1, B) OVERWRITES the same DOC_KEY row.
 *
 * Tab A's IDB edit is silently clobbered — no `.conflict` snapshot, no wp-save-failed(conflict). The
 * guard is invisible to the IDB path because it keys off LS_DOC_VER, which IDB-only saves never bump.
 *
 * This test drives the REAL two-tab saveDoc (two module instances over one shared store, exactly like
 * crosstab-conflict.test.mjs) with a REAL mock IDB wired as the global, both localStorages jammed for
 * large values so every save degrades to IDB-only. It asserts tab A's row survives OR a conflict is
 * raised. It FAILS on palau-v2 today — pinning the hole.
 *
 * Run: bun src/crosstab-idb-only-conflict.test.mjs
 */

import { strToU8 } from 'fflate';

function makeMockIDB() {
  const databases = new Map();
  const soon = (fn) => queueMicrotask(fn);
  class MockKeyRange { constructor(v) { this.only = v; } includes(v) { return v === this.only; } }
  const IDBKeyRange = { only: (v) => new MockKeyRange(v) };
  class MockRequest { constructor() { this.onsuccess = null; this.onerror = null; this.result = undefined; } }
  function makeStoreHandle(storeDef, tx) {
    const op = (work) => { const req = new MockRequest(); tx._enter(); soon(() => { try { work(req); } catch { req.onerror && req.onerror({ target: req }); } finally { tx._leave(); } }); return req; };
    return {
      _def: storeDef,
      put(record) { return op((req) => { storeDef.data.set(record[storeDef.keyPath], record); req.result = record[storeDef.keyPath]; req.onsuccess && req.onsuccess({ target: req }); }); },
      get(key) { return op((req) => { req.result = storeDef.data.has(key) ? storeDef.data.get(key) : undefined; req.onsuccess && req.onsuccess({ target: req }); }); },
      delete(key) { return op((req) => { storeDef.data.delete(key); req.result = undefined; req.onsuccess && req.onsuccess({ target: req }); }); },
      openCursor(range) { return cursorOver(tx, () => [...storeDef.data.values()], range, null); },
      index(name) { const idxDef = storeDef.indexes.get(name); return { openCursor(range) { return cursorOver(tx, () => [...storeDef.data.values()], range, idxDef ? idxDef.keyPath : null); } }; },
    };
  }
  function cursorOver(tx, rowsFn, range, keyPath) {
    const req = new MockRequest();
    const filter = (rows) => { if (range && keyPath) return rows.filter((r) => range.includes(r[keyPath])); if (range && range.only !== undefined) return rows.filter((r) => r.key === range.only); return rows; };
    let snapshot = filter(rowsFn()); let i = 0;
    const step = () => { tx._enter(); soon(() => { try { if (i < snapshot.length) { const value = snapshot[i++]; req.result = { value, continue() { step(); } }; req.onsuccess && req.onsuccess({ target: req }); } else { req.result = null; req.onsuccess && req.onsuccess({ target: req }); } } finally { tx._leave(); } }); };
    step(); return req;
  }
  function makeTransaction(db, storeNames, mode) {
    let inflight = 0, settled = false;
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
          createObjectStore(storeName, opts) { const def = { keyPath: opts.keyPath, indexes: new Map(), data: new Map() }; db._stores.set(storeName, def); return { createIndex(idxName, keyPath) { def.indexes.set(idxName, { keyPath }); } }; },
          transaction(_s, txMode) { return makeTransaction(dbHandle, _s, txMode || 'readonly'); },
          close() {},
        };
        if (isNew && req.onupgradeneeded) { req.result = dbHandle; req.onupgradeneeded({ target: req }); }
        req.result = dbHandle; req.onsuccess && req.onsuccess({ target: req });
      });
      return req;
    },
  };
  return { indexedDB, IDBKeyRange, _databases: databases };
}

// ── shared origin: localStorage that REJECTS large values (both sync doc bodies jam) but keeps tiny ─
const store = new Map();
class QuotaError extends Error { constructor() { super('quota'); this.name = 'QuotaExceededError'; this.code = 22; } }
const SMALL_LIMIT = 200;
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { const s = String(v); if (s.length > SMALL_LIMIT) throw new QuotaError(); store.set(k, s); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
const elShim = () => ({ setAttribute() {}, appendChild() {}, className: '', style: {} });
globalThis.document = globalThis.document || { createElement: elShim, createTextNode: () => ({}), addEventListener() {}, removeEventListener() {}, body: elShim(), documentElement: { style: {} } };
globalThis.navigator = globalThis.navigator || { platform: 'Linux', userAgent: 'node', maxTouchPoints: 0 };
const events = [];
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = (e) => { events.push({ type: e.type, detail: e.detail }); return true; };
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

const mock = makeMockIDB();
globalThis.indexedDB = mock.indexedDB;
globalThis.IDBKeyRange = mock.IDBKeyRange;

const { idbReadDoc, idbListSnapshots } = await import('./recovery-store.js');
const TabA = await import('./migrate-doc.js?idbtab=A');
const TabB = await import('./migrate-doc.js?idbtab=B');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

// A doc big enough that its `.z` payload exceeds SMALL_LIMIT (forces IDB-only), table-shaped.
function bigDoc(tag) {
  const rows = [];
  for (let i = 0; i < 120; i++) {
    rows.push({ type: 'tableRow', attrs: { cols: 1 }, content: [
      { type: 'tableCell', attrs: { role: 'full' }, content: [
        { type: 'voBlock', attrs: { blockId: 'blk_' + i, status: 'todo' }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: `${tag} block ${i}: ` + 'the myanmar out here on the border — '.repeat(4) }] } ] } ] } ] });
  }
  return { type: 'doc', content: rows };
}

store.clear(); events.length = 0;
// A tiny version stamp fits under SMALL_LIMIT → both tabs adopt the same base vN (say 0).
store.set('wp01_burma_doc_ver_v1', '0|seed');
const baseA = TabA.syncBaseVersion();
const baseB = TabB.syncBaseVersion();
ok(baseA === 0 && baseB === 0, '0a. both tabs adopt the same base v0');
ok(TabA.getTabId() !== TabB.getTabId(), '0b. the two tabs have distinct ids');

// Tab A saves its edit → degrades to IDB-only (both sync bodies jam).
const resA = TabA.saveDoc(bigDoc('TAB-A-EDIT'));
await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
ok(resA.reason === 'idb-only', '1a. tab A save degraded to IDB-only (both sync bodies jammed)');
ok((await idbReadDoc())?.raw === JSON.stringify(bigDoc('TAB-A-EDIT')),
  '1b. tab A edit landed in the IDB doc row');
ok(store.get('wp01_burma_doc_ver_v1') === '0|seed',
  '1c. LS_DOC_VER did NOT advance on the IDB-only save (stays v0)');

// Tab B — still on base v0, a DIFFERENT edit — now saves. It should EITHER detect the conflict (A's
// newer IDB edit) and snapshot it, OR its write must not obliterate A's edit without a recovery copy.
const resB = TabB.saveDoc(bigDoc('TAB-B-EDIT'));
await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));

const idbNow = await idbReadDoc();
const snaps = await idbListSnapshots();
const rawA = JSON.stringify(bigDoc('TAB-A-EDIT'));
const conflictEvt = events.find((e) => e.type === 'wp-save-failed' && e.detail?.kind === 'conflict');
const aPreservedInIdbRow = idbNow?.raw === rawA;
const aPreservedInSnapshot = snaps.some((s) => s.raw === rawA);
const lsConflict = Array.from(store.keys()).some((k) => k.includes('.conflict.') && store.get(k) === rawA);

// The SACRED invariant: tab A's edit must survive tab B's write — as the live IDB row, a `.conflict`
// snapshot (LS or IDB), or a raised conflict that forced B to stand down. Silent clobber = FAIL.
ok(aPreservedInIdbRow || aPreservedInSnapshot || lsConflict || !!conflictEvt,
  '2. SACRED: tab A\'s IDB edit survives tab B\'s IDB-only save (conflict snapshot or refusal) — NOT silently clobbered');

console.log(`\ncrosstab-idb-only-conflict: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
