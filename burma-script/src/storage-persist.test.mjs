/**
 * #2 — STORAGE PERSISTENCE + HEADROOM (storage-persist.js).
 *
 * Proves the two best-effort browser Storage guarantees behave correctly AND degrade silently:
 *   1. requestPersistentStorage: already-persistent → reports it without re-asking; grant / denial /
 *      unsupported all resolve to a benign {persisted} object (never throws).
 *   2. storageHeadroom: normalizes estimate() into {ratio, freeBytes, low}; unsupported → {supported:false}.
 *   3. pruneIfLowHeadroom: runs the prune ONLY when headroom is low; skips (no prune) otherwise and
 *      when the estimate API is unavailable.
 *
 * Run: bun src/storage-persist.test.mjs   (auto-discovered by `bun run test`)
 */

const {
  requestPersistentStorage, storageHeadroom, pruneIfLowHeadroom, storageManagerAvailable,
} = await import('./storage-persist.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

// A navigator whose storage manager is programmable per test.
const nav = (storage) => ({ storage });

/* ── 1: already-persistent origin → reports the existing grant, never re-asks ── */
{
  let persistCalls = 0;
  const n = nav({
    persisted: async () => true,
    persist: async () => { persistCalls++; return true; },
    estimate: async () => ({ usage: 0, quota: 1 }),
  });
  const r = await requestPersistentStorage(n);
  ok(r.persisted === true && r.already === true, '1a. already-persistent reported as {persisted:true, already:true}');
  eq(persistCalls, 0, '1b. persist() was NOT called again when already granted');
}

/* ── 2: not yet persistent, browser GRANTS → {persisted:true, already:false} ── */
{
  const n = nav({ persisted: async () => false, persist: async () => true });
  const r = await requestPersistentStorage(n);
  ok(r.persisted === true && r.already === false, '2. fresh grant reported as {persisted:true, already:false}');
}

/* ── 3: browser DENIES → benign {persisted:false, reason:'denied'}, no throw ── */
{
  const n = nav({ persisted: async () => false, persist: async () => false });
  const r = await requestPersistentStorage(n);
  ok(r.persisted === false && r.reason === 'denied', '3. denial degrades to {persisted:false, reason:denied}');
}

/* ── 4: no StorageManager at all → unsupported, never throws ── */
{
  const r = await requestPersistentStorage({}); // navigator with no .storage
  ok(r.persisted === false && r.reason === 'unsupported', '4a. missing StorageManager → unsupported');
  ok(storageManagerAvailable({}) === false, '4b. storageManagerAvailable(no storage) === false');
  ok(storageManagerAvailable(nav({})) === true, '4c. storageManagerAvailable(has storage) === true');
}

/* ── 5: persisted() itself throws → falls through to persist() and still resolves ── */
{
  const n = nav({ persisted: async () => { throw new Error('boom'); }, persist: async () => true });
  const r = await requestPersistentStorage(n);
  ok(r.persisted === true, '5. persisted() throwing falls through to persist() and grants');
}

/* ── 6: storageHeadroom normalizes estimate() and flags LOW past the ratio threshold ── */
{
  const MB = 1024 * 1024;
  const plenty = await storageHeadroom(nav({ estimate: async () => ({ usage: 10 * MB, quota: 1000 * MB }) }));
  ok(plenty.supported === true && plenty.low === false, '6a. 1% used with ample free → not low');
  ok(Math.abs(plenty.ratio - 0.01) < 1e-9, '6b. ratio computed as usage/quota');

  const tight = await storageHeadroom(nav({ estimate: async () => ({ usage: 950 * MB, quota: 1000 * MB }) }));
  ok(tight.supported === true && tight.low === true, '6c. 95% used → low (ratio threshold)');
}

/* ── 7: storageHeadroom flags LOW on the absolute free-bytes floor even below the ratio threshold ── */
{
  const MB = 1024 * 1024;
  // Modest ratio (0.8 < 0.85) but only ~10 MB free (< the 12 MB floor) → low via the absolute floor.
  const quota = 50 * MB;
  const usage = 40 * MB; // 10 MB free, ratio 0.8
  const hr = await storageHeadroom(nav({ estimate: async () => ({ usage, quota }) }));
  ok(hr.low === true && hr.ratio < 0.85, '7. absolute free-bytes floor flags low even below the ratio threshold');
}

/* ── 8: storageHeadroom on missing / zero-quota estimate → unsupported, no divide-by-zero ── */
{
  eq((await storageHeadroom({})).supported, false, '8a. no estimate() → unsupported');
  eq((await storageHeadroom(nav({ estimate: async () => ({ usage: 0, quota: 0 }) }))).supported, false, '8b. zero quota → unsupported');
}

/* ── 9: pruneIfLowHeadroom runs the prune ONLY when low ── */
{
  const MB = 1024 * 1024;
  let pruned = 0;
  const pruneFn = async () => { pruned++; return 3; };

  pruned = 0;
  const plentyRes = await pruneIfLowHeadroom(pruneFn, nav({ estimate: async () => ({ usage: 10 * MB, quota: 1000 * MB }) }));
  ok(plentyRes.low === false && plentyRes.pruned === 0 && pruned === 0, '9a. ample headroom → prune NOT called');

  pruned = 0;
  const lowRes = await pruneIfLowHeadroom(pruneFn, nav({ estimate: async () => ({ usage: 999 * MB, quota: 1000 * MB }) }));
  ok(lowRes.low === true && lowRes.pruned === 3 && pruned === 1, '9b. low headroom → prune called, count reported');

  pruned = 0;
  const noApi = await pruneIfLowHeadroom(pruneFn, {}); // no estimate → can't know → don't prune
  ok(noApi.checked === false && pruned === 0, '9c. no estimate API → cannot know headroom → no prune');
}

console.log(`\nstorage-persist: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
