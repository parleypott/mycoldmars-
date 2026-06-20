/**
 * DL-5 — recovery-snapshot pruning + quota eviction order.
 *
 * THE BUG: only .bak.<ts> keys were bounded (BAK_KEEP) and evictable. .conflict.<ts> and
 * .corrupt.<ts> keys — each a full ~167KB copy of the doc — were NEVER pruned and NEVER evicted.
 * A repeated cross-tab / cloud-conflict loop accumulates full-doc copies until they permanently
 * consume localStorage, at which point saveDoc's quota loop (which only freed .bak) runs out of
 * evictable space and flips EVERY future save to the quota-failed banner. The recovery machinery
 * itself becomes the thing that fills storage and stops saving.
 *
 * THE FIX: bound .conflict (CONFLICT_KEEP) the same way .bak is bounded, and make saveDoc's
 * quota-eviction loop able to drop the OLDEST .conflict / .corrupt copies as a last resort (after
 * .bak), always keeping at least the single newest of each so a recover-a-backup flow still works.
 *
 * Run: bun src/recovery-prune.test.mjs  (auto-discovered by run-tests.mjs)
 */

// ── programmable localStorage shim (length/key so prefix scans work; quota on demand) ───────────
const store = new Map();
let throwQuota = false;
function quotaErr() { const e = new Error('quota'); e.name = 'QuotaExceededError'; return e; }
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (throwQuota && k === 'wp01_burma_doc_v1') throw quotaErr(); store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = () => true;
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

const md = await import('./migrate-doc.js?dl5');
const { pruneConflictSnapshots, saveDoc, CONFLICT_PREFIX, CORRUPT_PREFIX, CONFLICT_KEEP } = md;

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };
const keysWith = (p) => Array.from(store.keys()).filter((k) => k.startsWith(p));

// 1) pruneConflictSnapshots keeps only the newest CONFLICT_KEEP keys.
{
  store.clear();
  // Write CONFLICT_KEEP + 5 conflict keys with strictly increasing ms (lexical = chronological).
  const n = CONFLICT_KEEP + 5;
  for (let i = 0; i < n; i++) {
    const key = CONFLICT_PREFIX + String(1700000000000 + i) + '-000000';
    store.set(key, 'doc' + i);
  }
  ok(keysWith(CONFLICT_PREFIX).length === n, '1a. seeded n conflict keys');
  pruneConflictSnapshots();
  const left = keysWith(CONFLICT_PREFIX).sort();
  ok(left.length === CONFLICT_KEEP, `1b. pruned to CONFLICT_KEEP (${left.length} === ${CONFLICT_KEEP})`);
  // The newest ones survive: highest ms suffixes.
  const newest = CONFLICT_PREFIX + String(1700000000000 + (n - 1)) + '-000000';
  ok(left.includes(newest), '1c. newest conflict copy survives the prune');
  const oldest = CONFLICT_PREFIX + String(1700000000000) + '-000000';
  ok(!left.includes(oldest), '1d. oldest conflict copy was pruned');
}

// 2) saveDoc's ESCALATING quota loop reaches into the .conflict tier (after .bak is exhausted) so a
//    save can land even when conflict copies are the things hogging storage. PHASE-2 change: when the
//    live doc can't be written we sacrifice the WHOLE .conflict tier, not just its oldest copy — a
//    stale divergence snapshot is worthless if the live doc itself can't persist. We force quota
//    throws until eviction has reached the conflict tier and the write lands.
{
  store.clear();
  store.set('wp01_burma_doc_v1', JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }));
  store.set('wp01_burma_doc_ver_v1', '1|tab_seed');
  md.syncBaseVersion();
  // Three conflict copies hogging storage. No corrupt this round.
  store.set(CONFLICT_PREFIX + '1700000000000-000000', 'c-old');
  store.set(CONFLICT_PREFIX + '1700000000500-000000', 'c-mid');
  store.set(CONFLICT_PREFIX + '1700000000900-000000', 'c-new');

  // Keep failing the LS_DOC write until eviction has freed at least 3 keys: the session .bak (tier 1)
  // then all three .conflict copies (tier 2). After the conflict tier is freed, the write lands.
  let freedSeen = 0;
  let prevKeyCount = store.size;
  globalThis.localStorage.setItem = (k, v) => {
    if (k === 'wp01_burma_doc_v1') {
      if (store.size < prevKeyCount) freedSeen += (prevKeyCount - store.size);
      prevKeyCount = store.size;
      if (freedSeen < 3) { throw quotaErr(); } // keep failing until the conflict tier is reclaimed
    }
    store.set(k, String(v));
  };

  const res = saveDoc({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] });
  ok(res.ok === true, '2a. saveDoc recovered from quota by escalating into the .conflict tier');
  const conflictsLeft = keysWith(CONFLICT_PREFIX);
  ok(conflictsLeft.length === 0, '2b. the ENTIRE .conflict tier was sacrificed to land the live doc (PHASE-2)');
}

console.log(`recovery-prune: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
