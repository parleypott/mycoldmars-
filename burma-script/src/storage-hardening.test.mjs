/**
 * STORAGE HARDENING (Johnny 2026-07-23, the Nile false alarm) — src/migrate-doc.js + cloud-health.js.
 *
 * Root cause: the ~5MB localStorage quota is ONE budget shared across every tool on newpress.press.
 * Something else filled it (or Safari private-mode blocked LS), the local mirror write failed, and the
 * save banner screamed "your edits will NOT be saved" — while the cloud copy was saving fine (Nile:
 * cloud v5299, 96s old). These tests pin the honesty + durability contract:
 *
 *   1. saveDoc all-local-failed + CLOUD-BACKED → returns ok cloud-only, fires a CALM degraded note,
 *      NEVER the catastrophic wp-save-failed; the sole-durability one-shot re-raises the loud banner
 *      ONLY if the cloud push then fails.
 *   2. saveDoc all-local-failed + LOCAL-ONLY project → the catastrophic banner still fires (correct:
 *      local really is the only home).
 *   3. RECLAIM tier: when LS is full, saveDoc's escalator evicts sibling REGENERABLE caches
 *      (whh:fetchcache:) to make room — and NEVER a doc / another tool's non-cache key.
 *   4. backupRaw under full/blocked LS falls back to an IndexedDB snapshot (recovery copy survives).
 *
 * A BUDGET-based localStorage shim (total-bytes ceiling, like a real almost-full origin) so evicting
 * a key genuinely frees room and a retry can land — the reclaim path can't be tested with a
 * per-value "too big" shim.
 *
 * Run: bun src/storage-hardening.test.mjs   (auto-discovered by run-tests.mjs)
 */

// ── MOCK INDEXEDDB (compact; same async contract as recovery-store.test.mjs) ──────────────────────
function makeMockIDB() {
  const databases = new Map();
  const soon = (fn) => queueMicrotask(fn);
  class MockRequest { constructor() { this.onsuccess = null; this.onerror = null; this.result = undefined; } }
  const IDBKeyRange = { only: (v) => ({ only: v, includes: (x) => x === v }) };
  function makeStoreHandle(def, tx) {
    const op = (work) => { const req = new MockRequest(); tx._enter(); soon(() => { try { work(req); } catch { req.onerror && req.onerror({ target: req }); } finally { tx._leave(); } }); return req; };
    return {
      _def: def,
      put(rec) { return op((req) => { def.data.set(rec[def.keyPath], rec); req.result = rec[def.keyPath]; req.onsuccess && req.onsuccess({ target: req }); }); },
      get(key) { return op((req) => { req.result = def.data.has(key) ? def.data.get(key) : undefined; req.onsuccess && req.onsuccess({ target: req }); }); },
      delete(key) { return op((req) => { def.data.delete(key); req.onsuccess && req.onsuccess({ target: req }); }); },
      openCursor(range) { return cursorOver(tx, () => [...def.data.values()], range, null); },
      index(name) { const idx = def.indexes.get(name); return { openCursor(range) { return cursorOver(tx, () => [...def.data.values()], range, idx ? idx.keyPath : null); } }; },
    };
  }
  function cursorOver(tx, rowsFn, range, keyPath) {
    const req = new MockRequest();
    const filter = (rows) => { if (range && keyPath) return rows.filter((r) => range.includes(r[keyPath])); if (range && range.only !== undefined) return rows.filter((r) => r.key === range.only); return rows; };
    const snap = filter(rowsFn()); let i = 0;
    const step = () => { tx._enter(); soon(() => { try { if (i < snap.length) { const value = snap[i++]; req.result = { value, continue() { step(); } }; req.onsuccess && req.onsuccess({ target: req }); } else { req.result = null; req.onsuccess && req.onsuccess({ target: req }); } } finally { tx._leave(); } }); };
    step(); return req;
  }
  function makeTransaction(db) {
    let inflight = 0, settled = false;
    const tx = { oncomplete: null, onerror: null, onabort: null,
      _enter() { inflight++; },
      _leave() { inflight--; if (inflight <= 0 && !settled) soon(() => { if (inflight <= 0 && !settled) { settled = true; tx.oncomplete && tx.oncomplete({ target: tx }); } }); },
      objectStore(name) { const def = db._stores.get(name); if (!def) throw new Error('no store ' + name); return makeStoreHandle(def, tx); },
      abort() { settled = true; soon(() => tx.onabort && tx.onabort({ target: tx })); } };
    soon(() => soon(() => { if (inflight <= 0 && !settled) { settled = true; tx.oncomplete && tx.oncomplete({ target: tx }); } }));
    return tx;
  }
  const indexedDB = { open(name, version) { const req = new MockRequest(); soon(() => {
    let db = databases.get(name); const isNew = !db || (version && version > db.version);
    if (!db) { db = { name, version: version || 1, _stores: new Map() }; databases.set(name, db); }
    const h = { name: db.name, version: db.version, _stores: db._stores,
      objectStoreNames: { contains: (n) => db._stores.has(n) },
      createObjectStore(sn, opts) { const def = { keyPath: opts.keyPath, indexes: new Map(), data: new Map() }; db._stores.set(sn, def); return { createIndex(i, kp) { def.indexes.set(i, { keyPath: kp }); } }; },
      transaction() { return makeTransaction(h); }, close() {} };
    if (isNew && req.onupgradeneeded) { req.result = h; req.onupgradeneeded({ target: req }); }
    req.result = h; req.onsuccess && req.onsuccess({ target: req });
  }); return req; } };
  return { indexedDB, IDBKeyRange };
}

// ── BUDGET-BASED localStorage (total-bytes ceiling) ───────────────────────────────────────────────
const store = new Map();
class QuotaError extends Error { constructor() { super('quota'); this.name = 'QuotaExceededError'; this.code = 22; } }
let BUDGET = Infinity;
function usedBytes(excludeKey) { let n = 0; for (const [k, v] of store) { if (k === excludeKey) continue; n += k.length + v.length; } return n; }
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { v = String(v); if (usedBytes(k) + k.length + v.length > BUDGET) throw new QuotaError(); store.set(k, v); },
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
const failedEvents = () => events.filter((e) => e.type === 'wp-save-failed');
const degradedEvents = () => events.filter((e) => e.type === 'wp-save-degraded');
const savedEvents = () => events.filter((e) => e.type === 'wp-saved');

const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_FALLBACK = LS_DOC + '.z';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';

const M = await import('./migrate-doc.js');
const CH = await import('./cloud-health.js');
const { idbListSnapshots } = await import('./recovery-store.js');

const doc = (t) => ({ type: 'doc', content: [
  { type: 'tableRow', attrs: { cols: 1 }, content: [
    { type: 'tableCell', attrs: { role: 'full' }, content: [
      { type: 'voBlock', attrs: { blockId: 'b', status: 'todo' }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: t }] } ] } ] } ] },
] });

function freshSession() { events.length = 0; M.resetSessionBackup(); CH.resetCloudHealth(); }

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1. ALL-LOCAL-FAILED + CLOUD-BACKED → cloud-only, calm, NO catastrophic banner; escalation re-raises
//    the loud banner ONLY when the cloud push then fails.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); freshSession();
  delete globalThis.indexedDB; // IDB unavailable too → NO local store can land → the all-fail branch.
  store.set(LS_DOC_VER, '4|tab_seed'); // tiny stamp seeded directly (bypasses the budget shim)
  M.syncBaseVersion();
  BUDGET = 0; // localStorage can hold NOTHING new — full/blocked origin
  CH.setCloudBackedPredicate(() => true); // Nile: cloud-backed project

  const res = M.saveDoc(doc('NILE EDIT — cloud is the home'));

  ok(res.ok === true && res.reason === 'cloud-only', '1a. cloud-backed all-fail → ok:true reason:cloud-only');
  ok(res.version > 0, '1b. returns a version so flushSave can push it to the cloud');
  ok(res.degraded === true, '1c. flagged degraded (local mirror is down)');
  ok(failedEvents().length === 0, '1d. NO catastrophic wp-save-failed banner (cloud is saving) — the Nile fix');
  ok(degradedEvents().length === 1 && degradedEvents()[0].detail?.kind === 'local-backup-unavailable',
    '1e. a CALM wp-save-degraded (local-backup-unavailable) fired instead');
  ok(savedEvents().length === 0, '1f. no false green wp-saved (the fast local copy is not there)');
  ok(store.get(LS_DOC_FALLBACK) == null && store.get(LS_DOC) == null, '1g. nothing landed in localStorage (genuinely full)');

  // Escalation: the cloud push flushSave fires now COMES BACK — if it fails, re-raise the loud banner.
  CH.noteCloudOutcome('offline');
  ok(failedEvents().length === 1, '1h. cloud push FAILED → sole-durability one-shot re-raises the loud banner (no silent loss)');
  ok(/export now/i.test(failedEvents()[0].detail?.message || ''), '1i. the escalated banner tells him to export');
}

// Same setup but the cloud push SUCCEEDS → the one-shot disarms, no loud banner ever.
{
  store.clear(); freshSession();
  delete globalThis.indexedDB;
  store.set(LS_DOC_VER, '4|tab_seed'); M.syncBaseVersion();
  BUDGET = 0; CH.setCloudBackedPredicate(() => true);

  M.saveDoc(doc('edit whose cloud push lands'));
  CH.noteCloudOutcome('saved'); // the cloud confirmed
  ok(failedEvents().length === 0, '1j. cloud push CONFIRMED → the one-shot disarms → NO loud banner ever');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2. ALL-LOCAL-FAILED + LOCAL-ONLY project → the catastrophic banner STILL fires (correct).
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); freshSession();
  delete globalThis.indexedDB;
  store.set(LS_DOC_VER, '4|tab_seed'); M.syncBaseVersion();
  BUDGET = 0; CH.setCloudBackedPredicate(() => false); // Palau: local IS the only home

  const res = M.saveDoc(doc('LOCAL-ONLY edit — truly at risk'));
  ok(res.ok === false, '2a. local-only all-fail → ok:false (truly failed)');
  ok(failedEvents().length === 1, '2b. the catastrophic wp-save-failed banner DOES fire (correct — no cloud home)');
  ok(/NOT being saved/i.test(failedEvents()[0].detail?.message || ''), '2c. banner honestly says edits are NOT being saved');
  ok(degradedEvents().length === 0, '2d. no calm degraded note — this really is data loss');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 3. RECLAIM tier — evict sibling REGENERABLE caches (whh:fetchcache:) to make room; NEVER a doc or
//    another tool's non-cache key.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); freshSession();
  delete globalThis.indexedDB; // isolate the LS reclaim path (no IDB masking the result)
  CH.setCloudBackedPredicate(() => false); // force the pure-LS path; a failure would be loud (we expect success)

  const bigCache = 'x'.repeat(4000);         // a fat regenerable sibling fetch cache
  store.set('whh:fetchcache:/api/listings', bigCache); // SAFE to purge
  store.set('whh:cloud:lastSyncedAt', '123'); // NOT a cache — must be preserved
  store.set('translation_doc_v1', 'another tool doc — MUST NOT be touched');
  store.set(LS_DOC_VER, '2|tab_seed'); M.syncBaseVersion();

  // Budget: essentially FULL with the fat whh cache present — a new write of any real size can only
  // land AFTER that regenerable cache is evicted (freeing ~4KB), which is exactly the reclaim path.
  const target = doc('SAVE ME — needs the sibling cache evicted first');
  BUDGET = usedBytes() + 40; // ~full: the doc's write exceeds this until the fat cache is reclaimed

  const res = M.saveDoc(target);
  ok(res.ok === true, '3a. save SUCCEEDS after reclaiming the sibling cache (retry landed)');
  ok(store.get('whh:fetchcache:/api/listings') == null, '3b. the regenerable whh:fetchcache: entry WAS purged to make room');
  ok(store.get('whh:cloud:lastSyncedAt') === '123', '3c. a sibling NON-cache key was NEVER touched');
  ok(store.get('translation_doc_v1') === 'another tool doc — MUST NOT be touched', '3d. another tool\'s doc was NEVER touched');
  ok(store.get(LS_DOC_FALLBACK) != null || store.get(LS_DOC) != null, '3e. the doc actually landed in localStorage');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 4. backupRaw under full/blocked LS → IndexedDB snapshot fallback (recovery copy survives).
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); freshSession();
  const mock = makeMockIDB();
  globalThis.indexedDB = mock.indexedDB; globalThis.IDBKeyRange = mock.IDBKeyRange;
  BUDGET = 0; // localStorage cannot hold ANY new key — full/blocked

  const key = M.backupRaw(JSON.stringify(doc('BACKUP ME even though LS is dead')));
  ok(key === null, '4a. backupRaw returns null (no SYNCHRONOUS LS backup latched — contract unchanged)');
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  const snaps = await idbListSnapshots();
  ok(snaps.some((s) => s.kind === 'bak' && /BACKUP ME/.test(s.raw)),
    '4b. but a durable .bak recovery copy DID land in IndexedDB (survives full/blocked LS)');
}

BUDGET = Infinity;
console.log(`\nstorage-hardening: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
