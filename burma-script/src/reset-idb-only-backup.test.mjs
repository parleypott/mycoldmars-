/**
 * #4 — RESET ON AN IDB-ONLY DEVICE MUST BACK UP (OR ABORT) BEFORE idbDeleteDoc.
 *
 * The SACRED invariant (main.jsx resetDoc header): "never wipe Johnny's fills without a recoverable
 * copy." resetDoc's backup gate is:
 *
 *     let saved = null;
 *     try { saved = readLatestSavedRaw(); } catch {}
 *     if (saved) { const bak = snapshotDoc(); if (!bak) { alert('cancelled'); return; } }
 *     ...removeItem(LS_DOC/.z/VER/MIGRATED)...
 *     await idbDeleteDoc();            // <-- destroys the ONLY copy on an IDB-only device
 *     location.reload();
 *
 * readLatestSavedRaw() and snapshotDoc() read ONLY synchronous localStorage (`.z` then LS_DOC). On a
 * genuinely-full origin the live doc can exist ONLY in the IDB `doc` store (writeCanonicalStores could
 * not land either sync body, so lsReady=false and boot renders from the in-memory recoveredDoc). In
 * that state readLatestSavedRaw() returns null, the backup gate is SKIPPED, and idbDeleteDoc() then
 * erases the sole surviving copy of the edit — SACRED violation, silent total loss.
 *
 * This test drives the REAL readLatestSavedRaw / snapshotDoc / idbDeleteDoc against a real mock IDB,
 * reproducing resetDoc's exact gate, and asserts the doc still exists somewhere recoverable after a
 * reset on an IDB-only device (backed up, or the reset aborted). It FAILS on palau-v2 today — that is
 * the point: it pins the hole.
 *
 * Run: bun src/reset-idb-only-backup.test.mjs
 */

import { strToU8 } from 'fflate';

// ── real mock IDB (same async contract as doc-store.test.mjs) ──────────────────────────────────────
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

// ── IDB-ONLY origin: localStorage is present but holds NO doc (both sync bodies were quota-skipped) ─
const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
const elShim = () => ({ setAttribute() {}, appendChild() {}, className: '', style: {} });
globalThis.document = globalThis.document || { createElement: elShim, createTextNode: () => ({}), addEventListener() {}, removeEventListener() {}, body: elShim(), documentElement: { style: {} } };
globalThis.navigator = globalThis.navigator || { platform: 'Linux', userAgent: 'node', maxTouchPoints: 0 };
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = globalThis.window.dispatchEvent || (() => true);
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

const mock = makeMockIDB();
globalThis.indexedDB = mock.indexedDB;
globalThis.IDBKeyRange = mock.IDBKeyRange;

const { readLatestSavedRaw, snapshotDoc, ensureResetBackup, LS_DOC_FALLBACK } = await import('./migrate-doc.js?reset-idb');
const { idbPutDoc, idbReadDoc, idbDeleteDoc, idbListSnapshots } = await import('./recovery-store.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

const doc = (t) => JSON.stringify({ type: 'doc', content: [
  { type: 'tableRow', attrs: { cols: 1 }, content: [
    { type: 'tableCell', attrs: { role: 'full' }, content: [
      { type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: t }] } ] } ] } ] },
] });

// ── set up the IDB-ONLY device: the live doc exists ONLY in the IDB doc store; localStorage empty ──
store.clear();
const RAW = doc('JOHNNYS-ONLY-COPY-OF-HIS-FILLS');
await idbPutDoc(RAW, 7, 'tabA');
// microtask drain
await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));

ok((await idbReadDoc())?.raw === RAW, '0a. precondition: the doc lives in the IDB store');
ok(store.get('wp01_burma_doc_v1') == null && store.get(LS_DOC_FALLBACK) == null,
  '0b. precondition: localStorage holds NO doc (genuine IDB-only device)');

// ── reproduce resetDoc's EXACT backup gate against the real functions ──────────────────────────────
let aborted = false;
async function resetGate() {
  // Exercise the REAL production gate (ensureResetBackup — IDB-aware) that resetDoc now calls,
  // instead of the old sync-only reimplementation, then perform resetDoc's exact wipe.
  if (!(await ensureResetBackup())) { aborted = true; return; }   // resetDoc alerts + returns here
  // wipe path
  store.delete('wp01_burma_doc_v1'); store.delete(LS_DOC_FALLBACK);
  store.delete('wp01_burma_doc_ver_v1'); store.delete('wp01_burma_migrated_v1');
  try { await idbDeleteDoc(); } catch {}
}
await resetGate();
await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));

// The sync-only reader saw nothing, so the backup gate was skipped and reset proceeded to delete IDB.
ok(readLatestSavedRaw() == null, '1a. readLatestSavedRaw() (sync-only) sees nothing on the IDB-only device');

// SACRED: after reset, Johnny's fills must still be recoverable SOMEWHERE — a .bak snapshot,
// the surviving IDB doc row, or the reset aborted before deleting. Otherwise it is silent total loss.
const survivingDoc = await idbReadDoc();
const snaps = await idbListSnapshots();
const bakHoldsIt = snaps.some((s) => s.kind === 'bak' && s.raw === RAW);
const lsBackup = Array.from(store.keys()).some((k) => k.includes('.bak.'));
const recoverable = aborted || (survivingDoc && survivingDoc.raw === RAW) || bakHoldsIt || lsBackup;

ok(recoverable,
  '2. SACRED: after RESET on an IDB-only device the fills are recoverable (backed up) or reset aborted — NOT silently destroyed');

console.log(`\nreset-idb-only-backup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
