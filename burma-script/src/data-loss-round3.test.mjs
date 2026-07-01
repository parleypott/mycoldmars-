/**
 * Data-loss round 3 — DL-05 (reset reload guard), DL-09 (guarded migration write), DL-8 (session
 * backup latch reset after a programmatic adopt/seed write).
 *
 * DL-05: resetDoc removed LS_DOC and is reloading; the teardown flush (saveDoc) must be SUPPRESSED
 *        so it can't resurrect the just-reset doc.
 * DL-09: migrateStoredDoc's persist must route through the guarded write (read-back invariant) and,
 *        on a write failure, must NOT set LS_MIGRATED — so the migration re-runs next load.
 * DL-8 : after a programmatic adopt/seed saveDoc, the once-per-session backup latch must be reset so
 *        the EDITOR's first real autosave still takes a pre-edit backup of the seeded doc.
 *
 * Run: bun src/data-loss-round3.test.mjs  (auto-discovered by run-tests.mjs)
 */

const store = new Map();
let truncateNextDocWrite = false;
let truncateNextZWrite = false;
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    // DL-09 probe: simulate a silent platform TRUNCATION of the fat LS_DOC write (the exact failure the
    // read-back invariant exists to catch) — store a mangled value, not what was asked. Under the
    // palau-v2 dual-write refactor this ALONE no longer fails the migration: the compressed `.z`
    // crash-belt copy (key `wp01_burma_doc_v1.z`, untouched here) lands byte-complete, so the migration
    // is durable and correctly reports success. The `truncateNextZWrite` shim lets a SEPARATE case break
    // BOTH synchronous stores to prove the genuine all-sync-stores-fail path still fails loudly.
    if (truncateNextDocWrite && k === 'wp01_burma_doc_v1') { truncateNextDocWrite = false; store.set(k, String(v).slice(0, 10)); return; }
    if (truncateNextZWrite && k === 'wp01_burma_doc_v1.z') { truncateNextZWrite = false; store.set(k, String(v).slice(0, 10)); return; }
    store.set(k, String(v));
  },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = () => true;
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

const md = await import('./migrate-doc.js?dl3');
const {
  saveDoc, syncBaseVersion, migrateStoredDoc, LS_MIGRATED, LS_DOC_FALLBACK, readLatestSavedRaw,
  setReloadingForReset, resetReloadingForReset, isReloadingForReset,
  resetSessionBackup, isSessionBackedUp,
} = md;
const { decompressDoc } = await import('./recovery-store.js');
const { strToU8 } = await import('fflate');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

// ── DL-05 — reset reload guard suppresses the teardown flush so reset can't be resurrected ──────
{
  store.clear();
  store.set('wp01_burma_doc_v1', JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }));
  store.set('wp01_burma_doc_ver_v1', '3|tab');
  syncBaseVersion();
  // resetDoc would removeItem(LS_DOC) then arm the flag then reload. Simulate: arm flag, remove doc.
  setReloadingForReset();
  store.delete('wp01_burma_doc_v1');
  ok(isReloadingForReset(), 'DL-05a. reset guard armed');
  // The teardown flush tries to save the editor's in-memory (pre-reset) doc. It MUST be refused.
  const res = saveDoc({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] });
  ok(res.ok === false && res.reason === 'reloading-for-reset', 'DL-05b. saveDoc refused during reset reload');
  ok(!store.has('wp01_burma_doc_v1'), 'DL-05c. reset doc was NOT resurrected by the teardown flush');
  resetReloadingForReset();
}

// ── DL-09 — DUAL-WRITE MIGRATION DURABILITY (palau-v2 semantics) ─────────────────────────────────
// The refactor superseded the OLD single-store invariant ('a truncated LS_DOC write must FAIL the
// migration'). migrateStoredDoc now persists through writeCanonicalStores, which writes the compressed
// `.z` crash-belt AND the fat LS_DOC AND queues the IDB row. When ONLY the fat LS_DOC write is silently
// truncated, the `.z` copy still lands byte-complete, so the migration is DURABLE — it correctly
// reports success and sets LS_MIGRATED, and the complete migrated bytes live in `.z` (promoted back
// into LS_DOC on the next boot via rehydrateLocalFromNewest's source==='z' branch). NO edit is lost.
// This case asserts that CORRECT dual-write success semantics — the durability guarantee the refactor
// actually provides — not the stale 'LS_DOC truncation fails the migration' invariant it replaced.
{
  store.clear();
  resetReloadingForReset();
  // A flat (pre-table-spine) doc that needs migration: a single chapter block at top level.
  const flat = {
    type: 'doc',
    content: [{ type: 'chapterBlock', attrs: { blockId: 'c1', genre: 'other' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CH HISTORY one two three' }] }] }],
  };
  store.set('wp01_burma_doc_v1', JSON.stringify(flat));
  syncBaseVersion();
  truncateNextDocWrite = true; // the STEP-4 persist's fat LS_DOC write will be silently truncated
  const r = migrateStoredDoc();
  ok(r.ok === true && r.migrated === true,
    'DL-09a. migration SUCCEEDS despite a truncated fat LS_DOC — the `.z` crash-belt is durable');
  ok(store.get(LS_MIGRATED) === '1',
    'DL-09b. LS_MIGRATED IS set — the migrated doc is durably persisted, no re-run needed');
  // The `.z` copy must hold the COMPLETE migrated bytes (not the 10-char truncated LS_DOC).
  let zRaw = null;
  try {
    const packed = store.get(LS_DOC_FALLBACK);
    zRaw = packed != null ? decompressDoc(strToU8(packed, true)) : null;
  } catch { zRaw = null; }
  let zDoc = null;
  try { zDoc = zRaw ? JSON.parse(zRaw) : null; } catch { zDoc = null; }
  ok(zDoc && zDoc.type === 'doc' && Array.isArray(zDoc.content) && zDoc.content.length > 0,
    'DL-09c. the `.z` copy holds the COMPLETE migrated doc (parses, all rows present)');
  ok(Array.isArray(zDoc?.content) && zDoc.content.every((n) => n && n.type === 'tableRow'),
    'DL-09d. the durable `.z` migrated doc is fully table-wrapped (the migration actually completed)');
  // readLatestSavedRaw() (the canonical newest reader) returns the COMPLETE `.z` bytes, not the
  // truncated LS_DOC — proving the boot resolver reasons from the durable copy, so no edit is lost.
  const newest = readLatestSavedRaw();
  ok(newest === zRaw && newest !== store.get('wp01_burma_doc_v1'),
    'DL-09e. readLatestSavedRaw() prefers the complete `.z` copy over the truncated LS_DOC');
}

// ── DL-09f — GENUINE all-sync-stores-fail STILL fails loudly + does NOT mark migrated ────────────
// The dual-write success above must NOT become a blanket "migration always succeeds". When BOTH
// synchronous stores are broken (fat LS_DOC AND the `.z` crash-belt truncated), writeCanonicalStores
// reports syncDurable===false and migrateStoredDoc must report failure and NOT set LS_MIGRATED, so the
// migration re-runs next load rather than marking a half-persisted state complete.
{
  store.clear();
  resetReloadingForReset();
  const flat = {
    type: 'doc',
    content: [{ type: 'chapterBlock', attrs: { blockId: 'c2', genre: 'other' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CH TWO four five six' }] }] }],
  };
  store.set('wp01_burma_doc_v1', JSON.stringify(flat));
  syncBaseVersion();
  truncateNextDocWrite = true;
  truncateNextZWrite = true; // break BOTH synchronous stores this time
  const r = migrateStoredDoc();
  ok(r.ok === false, 'DL-09f. migration FAILS when BOTH synchronous stores are truncated');
  ok(/write-failed/.test(r.reason || ''), 'DL-09g. failure reason names the write failure');
  ok(store.get(LS_MIGRATED) !== '1', 'DL-09h. LS_MIGRATED NOT set after an all-sync-fail migration (re-runs next load)');
}

// ── DL-8 — a programmatic adopt/seed saveDoc resets the session-backup latch ─────────────────────
{
  store.clear();
  resetReloadingForReset();
  resetSessionBackup();
  // Simulate the bootstrap/adopt programmatic write: first saveDoc of the session burns the latch.
  store.set('wp01_burma_doc_v1', JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }));
  syncBaseVersion();
  const seedRes = saveDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cloud seed' }] }] });
  ok(seedRes.ok, 'DL-8a. programmatic seed write succeeded');
  ok(isSessionBackedUp(), 'DL-8b. seed write burned the session-backup latch (as before)');
  // The reconcile/bootstrap path resets it (cloud-sync calls resetSessionBackup on res.ok).
  resetSessionBackup();
  ok(!isSessionBackedUp(), 'DL-8c. latch reset so the editor first-autosave can take a fresh pre-edit backup');
  // The editor's first real autosave now takes a backup of the seeded doc before overwriting it.
  const bakBefore = Array.from(store.keys()).filter((k) => k.startsWith('wp01_burma_doc_v1.bak.')).length;
  saveDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'johnny edit' }] }] });
  const bakAfter = Array.from(store.keys()).filter((k) => k.startsWith('wp01_burma_doc_v1.bak.')).length;
  ok(bakAfter > bakBefore, 'DL-8d. editor first autosave took a pre-edit backup of the seeded doc');
}

console.log(`data-loss-round3: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
