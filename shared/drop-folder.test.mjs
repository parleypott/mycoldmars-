/*
 * drop-folder.test.mjs — SHARED DROP FOLDER (shared/drop-folder.js).
 *
 * Johnny 2026-07-23: one user-picked folder links two same-origin tools — MapKeys WRITES gifs into
 * it, the script tool's ⌘⌃M READS the newest out. Because both pages share an origin they share this
 * IndexedDB, so the FileSystemDirectoryHandle granted ONCE is visible to both.
 *
 * Proves, all headless (the real File System Access API + a real Chrome grant need a live gesture no
 * headless run can produce — so the STORE contract, the PERMISSION state machine, and linkDropFolder
 * are tested against an in-memory IndexedDB shim + mock handles):
 *   1. STORE — save → get round-trips the exact handle object; clear removes it; get on an empty /
 *      missing store returns null; no IndexedDB at all degrades to null/false without throwing.
 *   2. PERMISSION — granted → 'granted' with NO request; prompt+request → requestPermission verdict;
 *      prompt+request:false stays 'prompt' (no ask); denied → 'denied'; a throwing API → 'denied';
 *      mode threads through to queryPermission/requestPermission (read vs readwrite).
 *   3. linkDropFolder — calls showDirectoryPicker with the stable id + startIn:'desktop' + the mode,
 *      persists via the injected saver, returns the handle; a null pick returns null (no save).
 *   4. hasDirectoryPicker reflects window.showDirectoryPicker presence.
 *
 * Run: bun shared/drop-folder.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';

// ── minimal in-memory IndexedDB shim (only what drop-folder.js touches: open + one keyed store,
// put/get/delete, oncomplete/onsuccess). Async callbacks fire on a microtask, mirroring real IDB. ──
function makeMockIDB() {
  const databases = new Map();
  const soon = (fn) => queueMicrotask(fn);
  function req() { return { onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined, error: null }; }
  return {
    open(name) {
      const r = req();
      soon(() => {
        let db = databases.get(name);
        const isNew = !db;
        if (!db) { db = { name, _stores: new Map() }; databases.set(name, db); }
        const handle = {
          objectStoreNames: { contains: (n) => db._stores.has(n) },
          createObjectStore(storeName) { const def = new Map(); db._stores.set(storeName, def); return {}; },
          transaction(storeName) {
            const def = db._stores.get(Array.isArray(storeName) ? storeName[0] : storeName);
            const tx = { oncomplete: null, onerror: null, onabort: null };
            const store = {
              put(val, key) { def.set(key, val); soon(() => tx.oncomplete && tx.oncomplete()); const rr = req(); soon(() => rr.onsuccess && rr.onsuccess()); return rr; },
              get(key) { const rr = req(); soon(() => { rr.result = def.has(key) ? def.get(key) : undefined; rr.onsuccess && rr.onsuccess(); }); return rr; },
              delete(key) { def.delete(key); soon(() => tx.oncomplete && tx.oncomplete()); const rr = req(); soon(() => rr.onsuccess && rr.onsuccess()); return rr; },
            };
            return { objectStore: () => store, get oncomplete() { return tx.oncomplete; }, set oncomplete(f) { tx.oncomplete = f; }, get onerror() { return tx.onerror; }, set onerror(f) { tx.onerror = f; }, set onabort(f) { tx.onabort = f; } };
          },
          close() {},
        };
        if (isNew && r.onupgradeneeded) { r.result = handle; r.onupgradeneeded(); }
        r.result = handle;
        r.onsuccess && r.onsuccess();
      });
      return r;
    },
    _databases: databases,
  };
}

// Install the shim BEFORE importing the module (its idbAvailable() reads the global at call-time, so
// either order works, but this keeps intent obvious).
globalThis.indexedDB = makeMockIDB();

const {
  getDropFolderHandle, saveDropFolderHandle, clearDropFolderHandle,
  ensureDropPermission, linkDropFolder, hasDirectoryPicker, DROP_FOLDER_SUGGEST_COPY,
} = await import('./drop-folder.js');

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const okAsync = async (label, fn) => { await fn(); pass++; };

// ── 1. STORE contract ────────────────────────────────────────────────────────────────────────
await okAsync('save → get round-trips the exact handle; clear removes it', async () => {
  globalThis.indexedDB = makeMockIDB();
  assert.equal(await getDropFolderHandle(), null, 'empty store → null');
  const handle = { id: 'folderA', getFileHandle() {} };
  assert.equal(await saveDropFolderHandle(handle), true, 'save resolves true');
  const got = await getDropFolderHandle();
  assert.strictEqual(got, handle, 'get returns the byte-identical handle object');
  assert.equal(await clearDropFolderHandle(), true, 'clear resolves true');
  assert.equal(await getDropFolderHandle(), null, 'after clear → null');
});

await okAsync('a second save overwrites the single canonical handle', async () => {
  globalThis.indexedDB = makeMockIDB();
  await saveDropFolderHandle({ id: 'first' });
  await saveDropFolderHandle({ id: 'second' });
  const got = await getDropFolderHandle();
  assert.equal(got.id, 'second', 'newest handle wins');
});

await okAsync('NO IndexedDB anywhere stays benign: get→null, save→false, clear→false', async () => {
  const saved = globalThis.indexedDB;
  globalThis.indexedDB = undefined;
  assert.equal(await getDropFolderHandle(), null);
  assert.equal(await saveDropFolderHandle({ id: 'x' }), false);
  assert.equal(await clearDropFolderHandle(), false);
  globalThis.indexedDB = saved;
});

// ── 2. PERMISSION state machine (mock handles) ─────────────────────────────────────────────────
const makeHandle = (queryState, requestState) => {
  const calls = { query: 0, request: 0, lastQueryMode: null, lastRequestMode: null };
  return {
    calls,
    async queryPermission(opts) { calls.query++; calls.lastQueryMode = opts && opts.mode; return queryState; },
    async requestPermission(opts) { calls.request++; calls.lastRequestMode = opts && opts.mode; return requestState; },
  };
};

await okAsync('granted → granted, NO request', async () => {
  const h = makeHandle('granted', 'granted');
  assert.equal(await ensureDropPermission(h), 'granted');
  assert.equal(h.calls.request, 0, 'must not prompt when already granted');
});

await okAsync('prompt+request → requestPermission verdict (grant + refuse)', async () => {
  const grant = makeHandle('prompt', 'granted');
  assert.equal(await ensureDropPermission(grant), 'granted');
  assert.equal(grant.calls.request, 1);
  const refuse = makeHandle('prompt', 'denied');
  assert.equal(await ensureDropPermission(refuse), 'denied');
  assert.equal(refuse.calls.request, 1);
});

await okAsync('prompt + request:false stays prompt (no ask) — the MapKeys silent path', async () => {
  const h = makeHandle('prompt', 'granted');
  assert.equal(await ensureDropPermission(h, { mode: 'readwrite', request: false }), 'prompt');
  assert.equal(h.calls.request, 0, 'never prompts without a gesture');
});

await okAsync('denied → denied; a throwing API / bad handle degrades to denied', async () => {
  assert.equal(await ensureDropPermission(makeHandle('denied', 'denied')), 'denied');
  const thrower = { async queryPermission() { throw new Error('boom'); }, async requestPermission() { throw new Error('boom'); } };
  assert.equal(await ensureDropPermission(thrower), 'denied');
  assert.equal(await ensureDropPermission(null), 'denied');
  assert.equal(await ensureDropPermission({}), 'denied');
});

await okAsync('mode threads through to query + request (readwrite)', async () => {
  const h = makeHandle('prompt', 'granted');
  await ensureDropPermission(h, { mode: 'readwrite' });
  assert.equal(h.calls.lastQueryMode, 'readwrite');
  assert.equal(h.calls.lastRequestMode, 'readwrite');
  const r = makeHandle('granted', 'granted');
  await ensureDropPermission(r); // default mode
  assert.equal(r.calls.lastQueryMode, 'read', 'defaults to read');
});

// ── 3. linkDropFolder (injected deps — no real gesture) ────────────────────────────────────────
await okAsync('linkDropFolder picks with stable id + desktop + mode, persists, returns handle', async () => {
  const seen = { opts: null, saved: null };
  const handle = { id: 'picked', getFileHandle() {} };
  const out = await linkDropFolder({ mode: 'readwrite' }, {
    showDirectoryPicker: async (opts) => { seen.opts = opts; return handle; },
    saveDropFolderHandle: async (h) => { seen.saved = h; return true; },
  });
  assert.strictEqual(out, handle, 'returns the picked handle');
  assert.strictEqual(seen.saved, handle, 'persisted the handle for both tools');
  assert.equal(seen.opts.id, 'wp-drop-folder', 'stable picker id');
  assert.equal(seen.opts.mode, 'readwrite', 'asks for readwrite so one grant covers both tools');
  assert.equal(seen.opts.startIn, 'desktop', 'starts at the desktop, not Downloads');
});

await okAsync('linkDropFolder: a null pick returns null and never saves', async () => {
  let saved = false;
  const out = await linkDropFolder({}, {
    showDirectoryPicker: async () => null,
    saveDropFolderHandle: async () => { saved = true; return true; },
  });
  assert.equal(out, null);
  assert.equal(saved, false, 'nothing persisted when the picker yields nothing');
});

await okAsync('linkDropFolder with no picker available throws (caller shows the Safari message)', async () => {
  await assert.rejects(() => linkDropFolder({}, { showDirectoryPicker: undefined }), /no-directory-picker/);
});

// ── 4. capability + copy ───────────────────────────────────────────────────────────────────────
ok('hasDirectoryPicker reflects window.showDirectoryPicker presence', () => {
  const prevWin = globalThis.window;
  globalThis.window = { showDirectoryPicker: () => {} };
  assert.equal(hasDirectoryPicker(), true);
  globalThis.window = {};
  assert.equal(hasDirectoryPicker(), false);
  globalThis.window = prevWin;
});

ok('suggest copy names a normal folder and warns off Downloads', () => {
  assert.match(DROP_FOLDER_SUGGEST_COPY, /mapkey-gifs/i);
  assert.match(DROP_FOLDER_SUGGEST_COPY, /not Downloads/i);
});

console.log(`drop-folder.test.mjs: ${pass} assertions passed`);
