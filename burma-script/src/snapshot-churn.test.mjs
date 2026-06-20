/**
 * SNAPSHOT-CHURN FIX (recovery-banner-spam) — the LIVE production failure.
 *
 * THE BUG: every page reload runs reconcileOnLoad. In steady state the cloud is strictly newer than
 * the local version stamp (this device's own last push, or another tab/device, bumped the cloud
 * version past the local stamp) — so decideReconcile returns adopt-cloud with snapshotLocal:true.
 * The OLD adopt path then called snapshotLocalConflict() UNCONDITIONALLY before pulling cloud, even
 * though the local doc was byte-identical to (a content-equal ancestor of) the cloud doc being
 * adopted. Result: a fresh full-size (~167KB) .conflict snapshot manufactured on EVERY reload, the
 * "N unsynced backups found" recovery banner never cleared, and the snapshots marched localStorage
 * toward quota until saveDoc started firing SAVE FAILED.
 *
 * THE FIX (cloud-sync.js):
 *   • localDiffersFrom(cloudDoc): only snapshot when the local doc GENUINELY differs from the doc
 *     about to overwrite it. Content-identical (or content-equal ancestor) → ZERO snapshots.
 *   • DEDUP: never write a snapshot whose content matches the most recent existing snapshot.
 *   • CAP: keep only the newest CS_CONFLICT_CAP (2) conflict snapshots.
 *
 * THE CONTRACT THIS TEST LOCKS IN:
 *   1. Adopting a cloud doc IDENTICAL to local creates ZERO new snapshots (no churn, banner clears).
 *   2. Reloading that same identical state N times STILL creates zero snapshots (the live symptom).
 *   3. Adopting a GENUINELY-DIFFERENT cloud doc creates EXACTLY ONE snapshot of the local edit.
 *   4. DEDUP: a second adopt whose local doc matches the newest snapshot writes nothing.
 *   5. CAP: many divergent adopts never exceed CS_CONFLICT_CAP conflict snapshots.
 *
 * Run: bun src/snapshot-churn.test.mjs   (auto-discovered by `bun run test`)
 */

// ---- programmable localStorage shim (insertion-ordered, real get/set/remove) -------------------
const store = new Map();
const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';
const BAK_PREFIX = LS_DOC + '.bak.';

globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
const events = [];
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = (e) => { events.push({ type: e.type, detail: e.detail }); return true; };
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

const { reconcileOnLoad, snapshotLocalConflict, localDiffersFrom } = await import('./cloud-sync.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const DOC = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const countConflicts = () => Array.from(store.keys()).filter((k) => k.startsWith(CONFLICT_PREFIX)).length;
function seedLocal(doc, version) {
  store.clear();
  store.set(LS_DOC, JSON.stringify(doc));
  store.set(LS_DOC_VER, String(version) + '|tab_seed');
}

// A reconcile harness that uses the REAL snapshotLocalConflict (so the divergence gate, dedup, and
// cap are all exercised end-to-end) but stubs cloud + the write so we don't pull in TipTap/saveDoc.
async function adopt(cloudDoc, cloudVersion, localVersion) {
  return reconcileOnLoad({
    readLocal: () => ({ hasDoc: true, version: localVersion, doc: JSON.parse(store.get(LS_DOC)) }),
    fetchCloud: async () => ({ ok: true, doc: cloudDoc, version: cloudVersion }),
    // Stub the canonical write so the test stays browserless; the real saveDoc is covered elsewhere.
    saveDoc: (doc) => { store.set(LS_DOC, JSON.stringify(doc)); return { ok: true, version: cloudVersion + 1 }; },
    primeVersionFloor: () => {},
    // NOTE: snapshotConflict left as DEFAULT → the real snapshotLocalConflict runs.
  });
}

/* ── 1 + 2: adopting a cloud doc IDENTICAL to local creates ZERO snapshots, even across reloads ── */
{
  const same = DOC('the burma script — v647, fully synced');
  seedLocal(same, 646);
  eq(countConflicts(), 0, '1a. clean slate: no conflict snapshots');

  // localDiffersFrom is the gate — local IS the same content as cloud, so it must report no diff.
  ok(localDiffersFrom(same) === false, '1b. localDiffersFrom(identical cloud) === false');

  const r1 = await adopt(same, 647, 646);
  eq(r1.action, 'adopt-cloud', '1c. cloud strictly newer (v647 > v646) → adopt-cloud');
  ok(r1.aborted !== true, '1d. NOT aborted (nothing to snapshot is fine — local is safe in cloud)');
  eq(countConflicts(), 0, '1e. CARDINAL: adopting an identical cloud doc created ZERO snapshots');

  // The live symptom: reload again and again on the same synced state. Each reload re-seeds local
  // identical to cloud. The banner must STAY clear — zero snapshots after every reload.
  for (let i = 0; i < 6; i++) {
    await adopt(same, 647, 646);
  }
  eq(countConflicts(), 0, '2. SIX more reloads of the synced state → STILL zero snapshots (no churn)');
}

/* ── 3: adopting a GENUINELY-DIFFERENT cloud doc creates EXACTLY ONE snapshot of the local edit ── */
{
  const localEdit = DOC('a line Johnny typed on THIS device that never reached the cloud');
  const cloudNewer = DOC('a different line another device pushed to the cloud');
  seedLocal(localEdit, 700);
  eq(countConflicts(), 0, '3a. clean slate');

  ok(localDiffersFrom(cloudNewer) === true, '3b. localDiffersFrom(different cloud) === true');

  const r = await adopt(cloudNewer, 701, 700);
  eq(r.action, 'adopt-cloud', '3c. adopt-cloud');
  ok(r.aborted !== true, '3d. not aborted — snapshot landed');
  eq(countConflicts(), 1, '3e. EXACTLY ONE snapshot created for the genuinely-divergent local edit');

  // And that snapshot holds the LOCAL edit (the thing about to be overwritten), not the cloud doc.
  const snapKey = Array.from(store.keys()).find((k) => k.startsWith(CONFLICT_PREFIX));
  ok(store.get(snapKey) === JSON.stringify(localEdit), '3f. the snapshot holds the local edit bytes');
}

/* ── 4: DEDUP — re-snapshotting identical local content writes nothing new ── */
{
  store.clear();
  const localEdit = DOC('same unsynced edit, snapshotted twice in a churn loop');
  store.set(LS_DOC, JSON.stringify(localEdit));
  const k1 = snapshotLocalConflict();
  eq(countConflicts(), 1, '4a. first snapshot written');
  const k2 = snapshotLocalConflict(); // identical content → must dedup
  eq(countConflicts(), 1, '4b. DEDUP: identical content did NOT create a second snapshot');
  eq(k2, k1, '4c. dedup returns the existing key, not a new one');
}

/* ── 5: CAP — many DIFFERENT divergent snapshots never exceed CS_CONFLICT_CAP (2) ── */
{
  store.clear();
  for (let i = 0; i < 10; i++) {
    store.set(LS_DOC, JSON.stringify(DOC('divergent edit #' + i)));
    snapshotLocalConflict();
  }
  ok(countConflicts() <= 2, '5. CAP: 10 distinct divergent snapshots bounded to <= 2 conflict keys');
}

console.log(`\nsnapshot-churn: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
