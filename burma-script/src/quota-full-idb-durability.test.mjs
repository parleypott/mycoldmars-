/**
 * ADVERSARIAL DURABILITY — localStorage EFFECTIVELY FULL, does the edit still land somewhere
 * recoverable, and does the UI honestly reflect it?
 *
 * THE REFACTOR UNDER TEST (palau-v2, IndexedDB persistence): saveDoc's canonical hot-path write
 * moved OFF the big uncompressed LS_DOC key onto the small compressed LS_DOC_FALLBACK ('.z') key,
 * plus a fire-and-forget mirror of the full doc into the GB-scale IndexedDB `doc` store
 * (idbPutDoc). The stated promise of the refactor (recovery-store.js header): "the live doc is the
 * one thing that must always land" — even when localStorage is jammed, IDB catches it.
 *
 * This is the paranoid instrument the task demands. It:
 *   (a) mocks localStorage.setItem to throw QuotaExceededError for LARGE values (the '.z' write) —
 *       localStorage is EFFECTIVELY FULL with nothing evictable, so saveDoc's quota escalator has
 *       no space to reclaim and the synchronous localStorage save genuinely CANNOT land;
 *   (b) runs a save of a large (~300 cartridge-block) doc through the REAL saveDoc;
 *   (c) asserts the doc is READABLE BACK FROM THE IDB `doc` store afterward (idbReadDoc), byte-
 *       identical to what was saved — i.e. the edit is NOT lost at the store layer;
 *   (d) asserts the SAVE-side honesty fix: saveDoc returns {ok:true, reason:'idb-only'} and fires the
 *       SOFT wp-save-degraded — NOT the hard wp-save-failed "storage is full" banner. (The RELOAD-side
 *       hole — LS_DOC stays stale and nothing reads IDB back on boot — is proven in section 2 here and
 *       exhaustively in quota-full-write-read-loop.test.mjs.)
 *
 * A drive-by mock is not enough: this wires the REAL async mock IndexedDB (shared with
 * doc-store.test.mjs) as the GLOBAL indexedDB so saveDoc's un-injected idbPutDoc(out, ver, tab)
 * call resolves it and the doc actually persists to the store the recovery path would read.
 *
 * Run: bun src/quota-full-idb-durability.test.mjs   (auto-discovered by run-tests.mjs)
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// MOCK INDEXEDDB — same minimal async-IDB contract as doc-store.test.mjs / recovery-store.test.mjs:
// open + onupgradeneeded, createObjectStore(keyPath), createIndex, transaction(mode), objectStore,
// put/get/delete, openCursor (store + index), IDBKeyRange.only. Installed on globalThis so the
// production idbPutDoc/idbReadDoc calls (which take NO deps and resolve the global) hit it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
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
      openCursor(range) { return cursorOver(tx, () => [...storeDef.data.values()], range, null); },
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
      mode, oncomplete: null, onerror: null, onabort: null,
      _enter() { inflight++; },
      _leave() {
        inflight--;
        if (inflight <= 0 && !settled) {
          soon(() => {
            if (inflight <= 0 && !settled) { settled = true; tx.oncomplete && tx.oncomplete({ target: tx }); }
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
          name: db.name, version: db.version, _stores: db._stores,
          objectStoreNames: { contains: (n) => db._stores.has(n) },
          createObjectStore(storeName, opts) {
            const def = { keyPath: opts.keyPath, indexes: new Map(), data: new Map() };
            db._stores.set(storeName, def);
            return { createIndex(idxName, keyPath, _opts) { def.indexes.set(idxName, { keyPath }); } };
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

// ── EFFECTIVELY-FULL localStorage: setItem THROWS QuotaExceededError for LARGE values ──────────────
// The refactor's canonical write is the compressed '.z' fallback key. A large ~300-block doc gzips
// to more than SMALL_LIMIT bytes, so every '.z' write throws quota. There is NOTHING evictable
// (no LS_BLOCKS / .bak / .conflict / .corrupt), so saveDoc's escalator exhausts and the synchronous
// localStorage save genuinely cannot land — the exact "localStorage effectively full" condition.
const store = new Map();
class QuotaError extends Error { constructor() { super('quota'); this.name = 'QuotaExceededError'; this.code = 22; } }
const SMALL_LIMIT = 200; // bytes; anything bigger "doesn't fit" — the doc's '.z' payload is far bigger.

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
    // Effectively-full: reject any value that doesn't fit the tiny remaining budget. The version
    // stamp + a fresh episode marker are tiny and still land, matching a real almost-full origin
    // where only the big doc write fails. Only active once quotaOn is armed for the target case.
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

// Install the mock IDB as the GLOBAL so production's un-injected idbPutDoc/idbReadDoc resolve it.
const mock = makeMockIDB();
globalThis.indexedDB = mock.indexedDB;
globalThis.IDBKeyRange = mock.IDBKeyRange;

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };
const saveFailedEvents = () => events.filter((e) => e.type === 'wp-save-failed');
const saveDegradedEvents = () => events.filter((e) => e.type === 'wp-save-degraded');
const savedEvents = () => events.filter((e) => e.type === 'wp-saved');

// A large ~300 cartridge-block doc, table-shape (tableRow > tableCell > voBlock > paragraph), so it
// is schema-shaped like a real migrated Burma doc. Each block carries enough prose that the whole
// doc's compressed '.z' payload comfortably exceeds SMALL_LIMIT (verified below).
function bigDoc(tag) {
  const rows = [];
  for (let i = 0; i < 300; i++) {
    rows.push({
      type: 'tableRow', attrs: { cols: 1 }, content: [
        { type: 'tableCell', attrs: { role: 'full' }, content: [
          { type: 'voBlock', attrs: { blockId: 'blk_' + i, status: 'todo' }, content: [
            { type: 'paragraph', content: [{ type: 'text',
              text: `${tag} block ${i}: ` + 'the myanmar out here on the border with the {tk who} — '.repeat(6) }] },
          ] },
        ] },
      ],
    });
  }
  return { type: 'doc', content: rows };
}

const M = await import('./migrate-doc.js?qfull');
const { compressDoc, decompressDoc, idbReadDoc } = await import('./recovery-store.js');

// ════════════════════════════════════════════════════════════════════════════════════════════
// PRECONDITION — the doc really is "large": its compressed '.z' payload exceeds SMALL_LIMIT, so the
// quota shim genuinely rejects the canonical write (not a rigged pass on a tiny doc).
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  const out = JSON.stringify(bigDoc('PRE'));
  const gz = compressDoc(out);
  ok(gz && gz.length > SMALL_LIMIT, `0a. the ~300-block doc's compressed payload (${gz ? gz.length : 0}B) exceeds the fit budget (${SMALL_LIMIT}B)`);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1. THE ADVERSARIAL CASE — localStorage effectively FULL, nothing evictable. The large doc is
//    saved. We assert the edit survives IN THE IDB doc store (idbReadDoc round-trips byte-identical),
//    AND we record whether a SAVE-FAILED / 'storage is full' event fired.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0; quotaOn = false;
  // Seed a fresh, tiny version stamp (fits under SMALL_LIMIT) so the tab has a base, then arm quota.
  store.set(LS_DOC_VER, '0|tab_seed');
  M.syncBaseVersion();
  quotaOn = true;

  const doc = bigDoc('FRESH-EDIT');
  const out = JSON.stringify(doc);
  const res = M.saveDoc(doc);

  // (b/c) The synchronous localStorage save cannot land (quota, nothing to evict). But saveDoc's
  // fire-and-forget idbPutDoc must have queued the full doc into IDB. Let the microtask-based mock
  // txns drain, then read it back.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const fromIdb = await idbReadDoc();

  ok(fromIdb != null, '1a. the doc IS present in the IDB doc store after a quota-full save (edit not lost)');
  ok(fromIdb && fromIdb.raw === out, '1b. the IDB copy is BYTE-IDENTICAL to the edited doc (no truncation)');
  ok(fromIdb && JSON.parse(fromIdb.raw).content.length === 300,
    '1c. all 300 blocks round-trip from IDB');

  // (a-confirm) the localStorage '.z' write really failed — nothing half-written masquerading as saved.
  ok(store.get(LS_DOC_FALLBACK) == null, '1d. the compressed .z LS write did NOT land (localStorage genuinely full)');

  // (d) THE SAVE-SIDE FALSE-BANNER FIX. Under the palau-v2 dual-write refactor the doc reached IDB, so
  // saveDoc returns {ok:true, reason:'idb-only', degraded:true} and fires the SOFT wp-save-degraded
  // ("saved to the recovery store") — NOT the hard wp-save-failed "storage is full — your edits are
  // NOT being saved" banner. That is exactly the "no false SAVE FAILED" half of the durability claim.
  const failed = saveFailedEvents();
  const degraded = saveDegradedEvents();
  ok(res.ok === true && res.reason === 'idb-only',
    '1e. saveDoc returns ok:true reason:idb-only (durable in IDB) — NO false quota failure');
  ok(failed.length === 0,
    "1f. NO hard 'storage is full' SAVE-FAILED (wp-save-failed) banner fired");
  ok(degraded.length === 1 && degraded[0].detail?.kind === 'idb-only',
    '1g. a soft wp-save-degraded (idb-only) fired instead — honest degraded-but-durable signal');
  ok(savedEvents().length === 0, '1h. no false green wp-saved was fired (the sync fast copy did not land)');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2. THE RELOAD-RECOVERY HOLE — after a quota-full save, does the seed path recover the IDB copy?
//    seedDoc (Editor.jsx) reads localStorage.getItem(LS_DOC) DIRECTLY. saveDoc never writes LS_DOC
//    (only '.z' / IDB), so the ONLY question that matters for "did the edit survive a reload" is:
//    is the IDB doc wired into ANY boot/seed path? It is not — idbReadDoc has zero non-test callers.
//    This case proves the mechanical fact the report leans on: the IDB copy exists, but LS_DOC (the
//    seed source) still holds the STALE pre-edit doc, so a reload renders the stale doc and the
//    IDB-parked fresh edit is orphaned. (Cloud sync is the real backstop; offline, the edit is lost.)
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0; quotaOn = false;
  // A prior (small enough to fit) canonical doc lives at LS_DOC — what seedDoc would render on reload.
  const priorSeed = JSON.stringify({ type: 'doc', content: [
    { type: 'tableRow', attrs: { cols: 1 }, content: [
      { type: 'tableCell', attrs: { role: 'full' }, content: [
        { type: 'voBlock', attrs: { blockId: 'seed', status: 'todo' }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'STALE-PRIOR-SEED' }] } ] } ] } ] },
  ] });
  store.set(LS_DOC, priorSeed);          // seedDoc reads THIS
  store.set(LS_DOC_VER, '3|tab_seed');
  M.syncBaseVersion();
  quotaOn = true;

  const doc = bigDoc('UNSAVEABLE-EDIT');
  M.saveDoc(doc);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  // The IDB store HAS the fresh edit …
  const fromIdb = await idbReadDoc();
  ok(fromIdb && /UNSAVEABLE-EDIT/.test(fromIdb.raw), '2a. IDB holds the fresh (quota-failed) edit');

  // … but LS_DOC — the ONLY thing seedDoc reads on reload — is still the STALE prior seed.
  const whatSeedReadsOnReload = store.get(LS_DOC);
  const seedText = JSON.parse(whatSeedReadsOnReload).content[0].content[0].content[0].content[0].content[0].text;
  ok(seedText === 'STALE-PRIOR-SEED',
    '2b. [DOCUMENTS HOLE] seedDoc source (LS_DOC) is STALE after the quota-full save — reload would render the pre-edit doc');
  // Prove idbReadDoc is not consulted by any seed path: the seed key never gained the fresh edit.
  ok(!/UNSAVEABLE-EDIT/.test(whatSeedReadsOnReload),
    '2c. [DOCUMENTS HOLE] the IDB-parked fresh edit is NOT promoted into the seed key — orphaned on reload (offline = lost)');
}

console.log(`\nquota-full-idb-durability: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
