/**
 * RECONCILE / SNAPSHOT SOURCE CORRECTNESS — the read-side data-loss cluster (palau-v2 round 3).
 *
 * The palau-v2 dual-write refactor made the WRITE side + boot RESOLVER correct: a quota-full edit lands
 * in the compressed `.z` crash-belt and/or the IndexedDB doc row, and rehydrateLocalFromNewest promotes
 * the newest of { LS_DOC, `.z`, IDB } on boot. An adversarial review then found the READ side still had
 * several call sites reading `localStorage.getItem(LS_DOC)` DIRECTLY instead of the canonical
 * `readLatestSavedRaw()` — so on the recovered-boot path (LS_DOC stale, fresh edit only in `.z`/IDB)
 * the reconcile would DIFF and SNAPSHOT the STALE body, silently losing the fresh edit when it adopts a
 * newer cloud doc. This test proves the fix in BOTH conditions:
 *
 *   1. NORMAL: saveDoc an edit → boot-rehydrate → reconcile against a content-EQUAL cloud doc →
 *      localDiffersFrom (reading the fresh doc via readLatestSavedRaw) returns false → NO spurious
 *      .conflict snapshot is burned. And a fresh seed reads back exactly the saved bytes.
 *
 *   2. QUOTA-FULL / RECOVERED BOOT: the edit lands ONLY in IDB (both sync LS writes rejected). Boot
 *      rehydration recovers it in-memory but cannot refresh LS_DOC/`.z`. Reconcile then adopts a
 *      strictly-newer DIFFERENT cloud doc. Using main.jsx's exact recovered-boot injection
 *      (readLocal/localDiffersFrom/snapshotConflict all bound to the recovered doc), the must-land
 *      .conflict snapshot that gets written must contain the FRESH RECOVERED edit bytes — never a
 *      stale pre-edit LS_DOC — and localDiffersFrom must have returned true for fresh-vs-cloud. This is
 *      the exact silent-loss the findings describe: it FAILS against the pre-fix stale-LS_DOC reads.
 *
 * Run: bun src/reconcile-source-recovered.test.mjs   (auto-discovered by scripts/run-tests.mjs)
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// MOCK INDEXEDDB — same minimal async-IDB contract as write-read-loop / quota-full-idb-durability:
// open + onupgradeneeded, createObjectStore(keyPath), createIndex, transaction(mode), objectStore,
// put/get/delete, openCursor (store + index), IDBKeyRange.only. Installed on globalThis so the
// production idbPutDoc/idbReadDoc/idbPutSnapshot calls (which take NO deps) resolve it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
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

// ── EFFECTIVELY-FULL localStorage: setItem THROWS QuotaExceededError for LARGE values ──────────────
const store = new Map();
class QuotaError extends Error { constructor() { super('quota'); this.name = 'QuotaExceededError'; this.code = 22; } }
const SMALL_LIMIT = 200;
const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_FALLBACK = LS_DOC + '.z';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';

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
const flushAsync = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

function installFreshIDB() {
  const mock = makeMockIDB();
  globalThis.indexedDB = mock.indexedDB;
  globalThis.IDBKeyRange = mock.IDBKeyRange;
  return mock;
}

// Table-shaped (tableRow > tableCell > voBlock > paragraph) so it is schema-like a real migrated doc.
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

// A large ~300-block doc whose compressed `.z` payload comfortably exceeds SMALL_LIMIT.
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

function conflictSnapshotRaws() {
  // The bytes of every .conflict snapshot currently in localStorage (newest last).
  const keys = [];
  for (const k of store.keys()) if (k.startsWith(CONFLICT_PREFIX)) keys.push(k);
  keys.sort();
  return keys.map((k) => store.get(k));
}

installFreshIDB();
const M = await import('./migrate-doc.js?rsr');
const CS = await import('./cloud-sync.js?rsr');
const { compressDoc, idbListSnapshots } = await import('./recovery-store.js');
const { readLatestSavedRaw, resolveNewestCanonicalDoc, rehydrateLocalFromNewest, saveDoc, syncBaseVersion } = M;
const { reconcileOnLoad, localDiffersFrom, docsDiffer, snapshotDocConflictAsync } = CS;

// PRECONDITION — the big doc really is large enough that its `.z` payload exceeds the quota budget.
{
  const gz = compressDoc(JSON.stringify(bigDoc('PRE')));
  ok(gz && gz.length > SMALL_LIMIT, `0a. compressed quota doc (${gz ? gz.length : 0}B) exceeds fit budget (${SMALL_LIMIT}B)`);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. NORMAL — save lands synchronously; reconcile against a content-EQUAL cloud takes NO snapshot,
//    and a fresh seed reads back exactly the saved bytes (write→read loop, reconcile-source correct).
// ════════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0; quotaOn = false;
  installFreshIDB();
  syncBaseVersion();

  const edited = doc('FRESH-NORMAL-EDIT');
  const res = saveDoc(edited);
  await flushAsync();

  ok(res.ok === true && res.reason === 'saved', '1a. normal save reports saved (synchronous copy landed)');

  // Simulate a fresh boot: resolve + rehydrate the newest canonical doc.
  const resolved = await rehydrateLocalFromNewest();
  ok(resolved.renderable === true, '1b. boot resolver is renderable after a normal save');
  const seeded = JSON.parse(localStorage.getItem(LS_DOC) || 'null');
  ok(firstText(seeded) === 'FRESH-NORMAL-EDIT', '1c. a fresh seed from LS_DOC reads back the just-saved bytes exactly');

  // localDiffersFrom reads readLatestSavedRaw() — it must see the FRESH edit, so a content-equal cloud
  // doc reads as NO divergence (no spurious snapshot). Use a deep clone as the "cloud" doc.
  const cloudEqual = JSON.parse(readLatestSavedRaw());
  ok(localDiffersFrom(cloudEqual) === false, '1d. localDiffersFrom(FRESH) === false vs a content-equal cloud (no false divergence)');

  // Run the FULL reconcile against a content-equal cloud at a HIGHER version (adopt-cloud decision):
  // because local content equals cloud, the churn guard must SKIP the snapshot (needSnapshot false).
  const before = conflictSnapshotRaws().length;
  const r = await reconcileOnLoad({
    saveDoc,
    primeVersionFloor: M.primeVersionFloor,
    fetchCloud: async () => ({ ok: true, doc: cloudEqual, version: (resolved.version || 0) + 5 }),
  });
  await flushAsync();
  const after = conflictSnapshotRaws().length;
  ok(r.action === 'adopt-cloud', '1e. reconcile decided adopt-cloud (cloud strictly newer)');
  ok(after === before, '1f. NO spurious .conflict snapshot burned — local content equals cloud, nothing unique to preserve');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. QUOTA-FULL / RECOVERED BOOT — the fresh edit lands ONLY in IDB. On the recovered-boot adopt of a
//    strictly-newer DIFFERENT cloud doc, the must-land .conflict snapshot must contain the FRESH
//    RECOVERED bytes, NOT a stale pre-edit LS_DOC. This is the exact silent-loss the findings target.
// ════════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0; quotaOn = false;
  installFreshIDB();

  // A prior small doc lives at LS_DOC (fits) — this is the STALE body a pre-fix read would snapshot.
  const stalePrior = JSON.stringify(doc('STALE-PRIOR-LS_DOC'));
  store.set(LS_DOC, stalePrior);
  store.set('wp01_burma_doc_ver_v1', '3|tab_seed');
  syncBaseVersion();

  // Now Johnny makes a large edit while the origin is effectively full: it can only reach IDB.
  quotaOn = true;
  const freshEdit = bigDoc('FRESH-RECOVERED-EDIT');
  const freshOut = JSON.stringify(freshEdit);
  const saveRes = saveDoc(freshEdit);
  await flushAsync();
  ok(saveRes.ok === true && saveRes.reason === 'idb-only', '2a. quota-full save degrades to idb-only (edit lives only in IDB)');

  // The fat LS_DOC is STILL the stale prior (the sync write was rejected). Prove the trap exists.
  ok(store.get(LS_DOC) === stalePrior, '2b. LS_DOC is STILL the stale prior after the quota-full save (the trap)');

  // BOOT REHYDRATION recovers the newest doc from IDB, but quota still blocks refreshing LS_DOC/`.z`.
  const resolved = await rehydrateLocalFromNewest();
  ok(resolved.source === 'idb', '2c. boot resolver recovers the fresh edit from IDB');
  ok(resolved.renderable === true && /FRESH-RECOVERED-EDIT/.test(JSON.stringify(resolved.doc || {})), '2d. the recovered in-memory doc holds the fresh edit');
  ok(resolved.lsReady === false, '2e. sync LS storage could NOT be rehydrated (still quota-blocked) — the recovered-boot case');

  // main.jsx's EXACT recovered-boot injection: readLocal/localDiffersFrom/snapshotConflict all bound
  // to the recovered doc object, so the adopt guard reasons from the FRESH recovered content.
  const recoveredDoc = resolved.doc;
  const recoveredRead = () => ({ hasDoc: true, version: resolved.version || 0, doc: recoveredDoc });
  const recoveredDiffers = (otherDoc) => docsDiffer(recoveredDoc, otherDoc);
  const recoveredSnapshot = () => snapshotDocConflictAsync(recoveredDoc);

  // A strictly-newer, genuinely DIFFERENT cloud doc — the adopt-over case that MUST snapshot first.
  const cloudNewer = doc('DIFFERENT-CLOUD-WINNER');
  const cloudVersion = (resolved.version || 0) + 9;

  // Sanity: the recovered comparator MUST see divergence (fresh recovered != different cloud).
  ok(recoveredDiffers(cloudNewer) === true, '2f. localDiffersFrom(recovered) === true vs a DIFFERENT cloud (real divergence)');

  const beforeLs = conflictSnapshotRaws();
  const beforeIdb = (await idbListSnapshots()).map((s) => s.raw);
  const r = await reconcileOnLoad({
    saveDoc,
    primeVersionFloor: M.primeVersionFloor,
    readLocal: recoveredRead,
    readLiveLocal: recoveredRead,
    localDiffersFrom: recoveredDiffers,
    // The recovered snapshotter (snapshotDocConflictAsync) prefers IDB when available — exactly the
    // main.jsx path. So inspect BOTH stores below; the preserved BYTES are the recovered doc regardless.
    snapshotConflict: recoveredSnapshot,
    fetchCloud: async () => ({ ok: true, doc: cloudNewer, version: cloudVersion }),
  });
  await flushAsync();

  ok(r.action === 'adopt-cloud', '2g. reconcile decided adopt-cloud (cloud strictly newer + different)');
  ok(r.aborted !== true, '2h. adopt was NOT aborted (the recovered snapshot landed)');

  // THE CARDINAL ASSERTION — a conflict snapshot was taken (in localStorage OR IDB), and its bytes are
  // the FRESH RECOVERED edit, NOT the stale prior LS_DOC. Against the pre-fix code (bare
  // getItem(LS_DOC)) this snapshot would have held STALE-PRIOR-LS_DOC and the fresh edit would be
  // silently lost on the adopt. We scan both stores because the async snapshotter routes to IDB.
  const afterLs = conflictSnapshotRaws();
  const afterIdb = (await idbListSnapshots()).map((s) => s.raw);
  const allBefore = [...beforeLs, ...beforeIdb];
  const allAfter = [...afterLs, ...afterIdb];
  const preservedFresh = allAfter.some((raw) => /FRESH-RECOVERED-EDIT/.test(raw || ''));
  const preservedStale = allAfter.some((raw) => /STALE-PRIOR-LS_DOC/.test(raw || ''));
  ok(allAfter.length > allBefore.length, '2i. a must-land conflict snapshot WAS written before adopting cloud');
  ok(preservedFresh, '2j. CARDINAL: the conflict snapshot preserves the FRESH RECOVERED edit bytes (not lost)');
  ok(!preservedStale, '2k. CARDINAL: the snapshot does NOT preserve the STALE pre-edit LS_DOC (the pre-fix bug)');
  // Belt-and-suspenders: at least one snapshot object round-trips to the fresh edit's exact bytes.
  const exact = allAfter.some((raw) => {
    try { return JSON.stringify(JSON.parse(raw)) === JSON.stringify(freshEdit); } catch { return false; }
  });
  ok(exact, '2l. the preserved snapshot round-trips byte-identical to the fresh recovered edit');
  void freshOut;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. SEED-A-FRESH-EDITOR read-back — after saveDoc, the canonical newest reader returns exactly the
//    just-saved bytes, in BOTH normal and quota-full conditions (the write→read seed contract).
// ════════════════════════════════════════════════════════════════════════════════════════════════
{
  // NORMAL
  store.clear(); events.length = 0; quotaOn = false;
  installFreshIDB();
  syncBaseVersion();
  const normalEdit = doc('SEED-READBACK-NORMAL');
  saveDoc(normalEdit);
  await flushAsync();
  const newestNormal = await resolveNewestCanonicalDoc();
  ok(newestNormal.renderable && firstText(newestNormal.doc) === 'SEED-READBACK-NORMAL',
    '3a. NORMAL: resolveNewestCanonicalDoc returns the just-saved bytes for a fresh seed');
  ok(readLatestSavedRaw() === JSON.stringify(normalEdit),
    '3b. NORMAL: readLatestSavedRaw() is byte-identical to the just-saved doc');

  // QUOTA-FULL
  store.clear(); events.length = 0; quotaOn = false;
  installFreshIDB();
  store.set('wp01_burma_doc_ver_v1', '0|tab_seed');
  syncBaseVersion();
  quotaOn = true;
  const quotaEdit = bigDoc('SEED-READBACK-QUOTA');
  const quotaOut = JSON.stringify(quotaEdit);
  const qres = saveDoc(quotaEdit);
  await flushAsync();
  ok(qres.ok === true && qres.reason === 'idb-only', '3c. QUOTA: save degraded to idb-only');
  const newestQuota = await resolveNewestCanonicalDoc();
  ok(newestQuota.source === 'idb' && newestQuota.raw === quotaOut,
    '3d. QUOTA: resolveNewestCanonicalDoc recovers the exact just-saved bytes from IDB for a fresh seed');
}

console.log(`\nreconcile-source-recovered: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
