/**
 * INDEXEDDB-BACKED RECOVERY STORE (recovery-idb) — Phase 3 of the localStorage-quota fix.
 *
 * THE PRODUCTION FAILURE: the full-size recovery snapshots (.bak / .conflict / .corrupt — each a
 * ~167KB copy of the whole doc) lived in localStorage (~5MB quota) next to the live LS_DOC. They
 * marched the origin toward quota until the CANONICAL saveDoc write started failing ("SAVE FAILED").
 *
 * THE FIX (src/recovery-store.js): route the heavy snapshot WRITES into IndexedDB (quota: hundreds of
 * MB). These tests run the real recovery-store against a MOCK IndexedDB (a tiny in-memory shim that
 * implements just the subset of the IDB API the store touches), proving:
 *   1. put → list round-trips with the right key format, kind, ts, and bytes.
 *   2. keys keep the shared "PREFIX + ms + '-' + seq" shape so recovery.js classifies them identically.
 *   3. per-kind pruning bounds the store to KEEP[kind] (newest kept, oldest dropped).
 *   4. read returns the parsed doc; missing/unparseable → null (never throws).
 *   5. delete removes a single snapshot.
 *   6. NO IndexedDB at all → every call resolves to a benign value (null / [] / false), NEVER throws.
 *
 * Run: bun src/recovery-store.test.mjs   (auto-discovered by `bun run test`)
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// MOCK INDEXEDDB — a minimal in-memory implementation. Synchronous under the hood, but it fires the
// onsuccess / oncomplete callbacks on a microtask so the store's Promise-wrapping code paths run
// exactly as they would against a real async IDB. Implements: open + onupgradeneeded, createObjectStore
// (keyPath), createIndex, transaction(mode), objectStore, put/get/delete, openCursor (store + index),
// and IDBKeyRange.only. That is the entire surface recovery-store.js uses.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
function makeMockIDB() {
  const databases = new Map(); // name -> { version, stores: Map<storeName, {keyPath, indexes, data:Map}> }
  const soon = (fn) => queueMicrotask(fn);

  class MockKeyRange {
    constructor(value) { this.only = value; }
    includes(v) { return v === this.only; }
  }
  const IDBKeyRange = { only: (v) => new MockKeyRange(v) };

  class MockRequest { constructor() { this.onsuccess = null; this.onerror = null; this.result = undefined; } }

  // Each transaction tracks its in-flight operation count. oncomplete fires only once the count
  // returns to zero AND stays zero across a microtask (so a cursor callback that issues new deletes
  // keeps the txn open until the deletes settle) — exactly the real "txn auto-commits when no more
  // requests are pending" semantics. This is what makes prune (cursor → many deletes) work.
  function makeStoreHandle(storeDef, tx) {
    const op = (work) => {
      const req = new MockRequest();
      tx._enter();
      soon(() => {
        try { work(req); } catch (e) { req.onerror && req.onerror({ target: req }); }
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

  // Build a cursor request that walks the rows (snapshotted live each step so deletes during the walk
  // are honored), optionally filtered by `range` on `keyPath`. Each step is one pending op so the txn
  // stays open until the cursor (and any continue()) is fully drained.
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
          // Defer one microtask: if a callback enqueued more ops (e.g. cursor → deletes), inflight
          // will be > 0 again by the time this runs, so we won't prematurely complete.
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
    // If the caller never issues a request (degenerate), still complete on a later microtask.
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
          transaction(storeNames, mode) { return makeTransaction(dbHandle, storeNames, mode || 'readonly'); },
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
const store = await import('./recovery-store.js');
const {
  idbPutSnapshot, idbListSnapshots, idbReadSnapshot, idbDeleteSnapshot, idbPruneKind, idbAvailable,
  idbPruneGlobal, idbPutDoc, idbReadDoc,
  CONFLICT_PREFIX, BAK_PREFIX, CORRUPT_PREFIX, KEEP,
  GLOBAL_MAX_SNAPSHOTS, MAX_SNAPSHOT_AGE_MS, DB_NAME, DB_VERSION,
} = store;

// Seed raw snapshot rows straight into the mock store (bypassing idbPutSnapshot's per-kind + global
// auto-prune) so the GLOBAL count/age caps can be exercised with more rows than the per-kind caps
// would ever allow to accumulate. The store is created lazily by openDB's v2 upgrade on first open.
function seedRows(deps, rows) {
  return new Promise((resolve) => {
    const req = deps.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('snapshots')) {
        const os = db.createObjectStore('snapshots', { keyPath: 'key' });
        os.createIndex('kind', 'kind', { unique: false });
        os.createIndex('ts', 'ts', { unique: false });
      }
      if (!db.objectStoreNames.contains('doc')) db.createObjectStore('doc', { keyPath: 'key' });
    };
    req.onsuccess = (ev) => {
      const db = ev.target.result;
      const tx = db.transaction('snapshots', 'readwrite');
      const os = tx.objectStore('snapshots');
      for (const r of rows) os.put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    };
    req.onerror = () => resolve();
  });
}

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const DOC = (t) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

// A fresh mock per scenario so prunes/deletes don't bleed across tests.
function freshDeps() {
  const mock = makeMockIDB();
  return { indexedDB: mock.indexedDB, IDBKeyRange: mock.IDBKeyRange };
}

/* ── 1: put → list round-trips with correct key format, kind, ts, bytes ── */
{
  const deps = freshDeps();
  const raw = DOC('the unsynced burma word');
  const key = await idbPutSnapshot('conflict', raw, deps);
  ok(typeof key === 'string' && key.startsWith(CONFLICT_PREFIX), '1a. put returns a .conflict key');
  ok(/\.conflict\.\d+-\d{6}$/.test(key), '1b. key keeps PREFIX + ms + "-" + 6-digit seq shape');

  const list = await idbListSnapshots(deps);
  eq(list.length, 1, '1c. exactly one snapshot listed');
  eq(list[0].key, key, '1d. listed key matches the written key');
  eq(list[0].kind, 'conflict', '1e. kind is conflict');
  eq(list[0].bytes, raw.length, '1f. bytes === raw string length');
  ok(list[0].ts > 0, '1g. ts parsed from the key (> 0)');
}

/* ── 2: read returns the parsed doc; missing / bad → null, never throws ── */
{
  const deps = freshDeps();
  const key = await idbPutSnapshot('bak', DOC('hello recovery'), deps);
  const doc = await idbReadSnapshot(key, deps);
  ok(doc && doc.type === 'doc', '2a. read returns the parsed doc object');
  ok(doc.content[0].content[0].text === 'hello recovery', '2b. the recovered word survived round-trip');
  const missing = await idbReadSnapshot('wp01_burma_doc_v1.bak.999-000000', deps);
  ok(missing === null, '2c. missing key → null');
}

/* ── 3: per-kind pruning bounds the store to KEEP[kind] (newest kept) ── */
{
  const deps = freshDeps();
  // Write more conflicts than KEEP.conflict (4); each put prunes back to the bound.
  const keys = [];
  for (let i = 0; i < 7; i++) {
    // distinct content so nothing dedups; the store doesn't dedup but be explicit
    keys.push(await idbPutSnapshot('conflict', DOC('conflict #' + i), deps));
  }
  const list = await idbListSnapshots(deps);
  const conflicts = list.filter((s) => s.kind === 'conflict');
  eq(conflicts.length, KEEP.conflict, '3a. conflict snapshots bounded to KEEP.conflict');
  // The newest KEEP.conflict keys must be the ones that survived (newest-first list[0] is the last put).
  const survivingKeys = new Set(conflicts.map((s) => s.key));
  ok(survivingKeys.has(keys[6]) && survivingKeys.has(keys[3]), '3b. the NEWEST snapshots are the ones kept');
  ok(!survivingKeys.has(keys[0]), '3c. the OLDEST snapshot was pruned');
}

/* ── 4: prune is per-kind — bak and corrupt have their own bounds, independent of conflict ── */
{
  const deps = freshDeps();
  for (let i = 0; i < 5; i++) await idbPutSnapshot('bak', DOC('bak #' + i), deps);
  for (let i = 0; i < 5; i++) await idbPutSnapshot('corrupt', DOC('corrupt #' + i), deps);
  for (let i = 0; i < 5; i++) await idbPutSnapshot('conflict', DOC('conflict #' + i), deps);
  const list = await idbListSnapshots(deps);
  eq(list.filter((s) => s.kind === 'bak').length, KEEP.bak, '4a. bak bounded to KEEP.bak');
  eq(list.filter((s) => s.kind === 'corrupt').length, KEEP.corrupt, '4b. corrupt bounded to KEEP.corrupt');
  eq(list.filter((s) => s.kind === 'conflict').length, KEEP.conflict, '4c. conflict bounded to KEEP.conflict');
}

/* ── 5: delete removes a single snapshot, leaves the rest ── */
{
  const deps = freshDeps();
  const k1 = await idbPutSnapshot('conflict', DOC('one'), deps);
  const k2 = await idbPutSnapshot('conflict', DOC('two'), deps);
  eq((await idbListSnapshots(deps)).length, 2, '5a. two before delete');
  const okDel = await idbDeleteSnapshot(k1, deps);
  ok(okDel === true, '5b. delete reports success');
  const after = await idbListSnapshots(deps);
  eq(after.length, 1, '5c. one after delete');
  eq(after[0].key, k2, '5d. the OTHER snapshot survived');
}

/* ── 6: list is newest-first ── */
{
  const deps = freshDeps();
  const a = await idbPutSnapshot('bak', DOC('first'), deps);
  const b = await idbPutSnapshot('bak', DOC('second'), deps);
  const list = await idbListSnapshots(deps);
  ok(list[0].ts >= list[list.length - 1].ts, '6a. list ordered newest-first by ts');
}

/* ── 7: explicit idbPruneKind keeps exactly `keep` newest ── */
{
  const deps = freshDeps();
  // Put without the auto-prune interfering: write corrupt (KEEP.corrupt=2) then prune to 1 explicitly.
  await idbPutSnapshot('corrupt', DOC('c1'), deps);
  await idbPutSnapshot('corrupt', DOC('c2'), deps);
  const dropped = await idbPruneKind('corrupt', 1, deps);
  ok(dropped >= 1, '7a. pruneKind reports it dropped at least one');
  eq((await idbListSnapshots(deps)).filter((s) => s.kind === 'corrupt').length, 1, '7b. exactly 1 corrupt kept');
}

/* ── 8: NO IndexedDB → every call is a benign no-op, NEVER throws ── */
{
  const noIdb = { indexedDB: null }; // resolveIDB returns null; idbAvailable false
  ok(idbAvailable(noIdb) === false, '8a. idbAvailable(no idb) === false');
  // With deps.indexedDB null, resolveIDB still checks the global; in node there is none, so these
  // exercise the genuine "no IDB anywhere" path. They must resolve to benign values.
  ok((await idbPutSnapshot('conflict', DOC('x'), noIdb)) === null, '8b. put → null (no throw)');
  ok(Array.isArray(await idbListSnapshots(noIdb)) && (await idbListSnapshots(noIdb)).length === 0, '8c. list → []');
  ok((await idbReadSnapshot('any', noIdb)) === null, '8d. read → null');
  ok((await idbDeleteSnapshot('any', noIdb)) === false, '8e. delete → false');
  ok((await idbPruneKind('bak', 2, noIdb)) === 0, '8f. prune → 0');
}

/* ── 9: bad inputs are rejected without writing (best-effort, never throws) ── */
{
  const deps = freshDeps();
  ok((await idbPutSnapshot('conflict', '', deps)) === null, '9a. empty raw → null (nothing written)');
  ok((await idbPutSnapshot('bogus-kind', DOC('x'), deps)) === null, '9b. unknown kind → null');
  eq((await idbListSnapshots(deps)).length, 0, '9c. nothing was written for the bad inputs');
}

/* ── 10 (#21): GLOBAL age cap — snapshots older than MAX_SNAPSHOT_AGE_MS are pruned outright ── */
{
  const deps = freshDeps();
  await idbPutSnapshot('bak', DOC('fresh-1'), deps);
  await idbPutSnapshot('conflict', DOC('fresh-2'), deps);
  eq((await idbListSnapshots(deps)).length, 2, '10a. two fresh snapshots present');
  // With a normal now, nothing is stale → nothing pruned.
  eq(await idbPruneGlobal(deps), 0, '10b. fresh snapshots survive a normal-now global prune');
  eq((await idbListSnapshots(deps)).length, 2, '10c. both still present after fresh prune');
  // Fast-forward `now` past the 7-day window → BOTH are older than the age cap → both dropped.
  const future = Date.now() + MAX_SNAPSHOT_AGE_MS + 60_000;
  const dropped = await idbPruneGlobal(deps, future);
  eq(dropped, 2, '10d. age cap drops every snapshot older than 7 days');
  eq((await idbListSnapshots(deps)).length, 0, '10e. store empty after the age cull');
}

/* ── 11 (#21): GLOBAL count cap — the store is trimmed to GLOBAL_MAX_SNAPSHOTS, oldest-first ── */
{
  const deps = freshDeps();
  const N = GLOBAL_MAX_SNAPSHOTS + 6; // seed 6 over the cap
  const base = 1_700_000_000_000;
  const rows = [];
  for (let i = 0; i < N; i++) {
    // Strictly increasing ts (all well within 7 days of each other) so ordering is unambiguous and
    // the age cap does NOT fire — this isolates the COUNT cap.
    const ts = base + i * 1000;
    rows.push({ key: BAK_PREFIX + ts + '-000000', kind: 'bak', ts, raw: DOC('seed-' + i) });
  }
  await seedRows(deps, rows);
  eq((await idbListSnapshots(deps)).length, N, '11a. seeded N > GLOBAL_MAX rows directly');
  // Prune with `now` pinned just after the newest seed so NOTHING is age-stale — only the count cap acts.
  const dropped = await idbPruneGlobal(deps, base + N * 1000);
  eq(dropped, N - GLOBAL_MAX_SNAPSHOTS, '11b. count cap dropped exactly the overflow');
  const left = await idbListSnapshots(deps);
  eq(left.length, GLOBAL_MAX_SNAPSHOTS, '11c. exactly GLOBAL_MAX_SNAPSHOTS kept');
  // The survivors are the NEWEST ones (highest ts); the oldest seeds were dropped.
  const survivingTs = left.map((s) => s.ts).sort((a, b) => a - b);
  ok(survivingTs[0] === base + 6 * 1000, '11d. the 6 OLDEST snapshots were the ones pruned');
}

/* ── 12 (#3): STALE-SAVE GUARD in idbPutDoc — a same-tab STRICTLY-OLDER version can't rewind the row,
      but a different tab's equal-or-newer edit still raises a conflict (existing behavior intact) ── */
{
  const deps = freshDeps();
  const A1 = JSON.stringify({ type: 'doc', content: [{ type: 'text', text: 'edit at v5' }] });
  const A0 = JSON.stringify({ type: 'doc', content: [{ type: 'text', text: 'older edit, v4' }] });
  const B1 = JSON.stringify({ type: 'doc', content: [{ type: 'text', text: 'other tab at v5' }] });

  const r1 = await idbPutDoc(A1, 5, 'tabA', deps);
  ok(r1 && r1.ok === true && r1.ver === 5, '12a. tabA writes v5 → ok');

  // Same tab, STRICTLY OLDER version (a late out-of-order flush) → refused as benign 'stale', NOT a conflict.
  const r2 = await idbPutDoc(A0, 4, 'tabA', deps);
  ok(r2 && r2.ok === false && r2.reason === 'stale', '12b. same-tab older version refused as stale (not conflict)');
  const after = await idbReadDoc(deps);
  ok(after && after.ver === 5 && after.raw === A1, '12c. the newer v5 row is intact — stale write did NOT rewind it');
  // A stale refusal must NOT manufacture a .conflict snapshot (nothing was lost).
  eq((await idbListSnapshots(deps)).filter((s) => s.kind === 'conflict').length, 0, '12d. no conflict snapshot for a benign stale drop');

  // Different tab, equal version, different bytes → still a real conflict (preserved), unchanged.
  const r3 = await idbPutDoc(B1, 5, 'tabB', deps);
  ok(r3 && r3.ok === false && r3.reason === 'conflict', '12e. cross-tab equal-version clobber still raises conflict');
  ok((await idbListSnapshots(deps)).some((s) => s.kind === 'conflict' && s.raw === B1), '12f. the refused cross-tab edit is preserved as a conflict snapshot');
  const still = await idbReadDoc(deps);
  ok(still && still.ver === 5 && still.raw === A1, '12g. the canonical row still holds tabA v5 after the cross-tab refusal');
}

console.log(`\nrecovery-store: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
