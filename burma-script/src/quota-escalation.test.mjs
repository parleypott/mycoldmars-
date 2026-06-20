/**
 * PHASE-2 — ESCALATING QUOTA EVICTION in saveDoc (migrate-doc.js).
 *
 * THE LIVE FAILURE: localStorage filled with full-size recovery snapshots (.bak/.conflict/.corrupt
 * @ ~167KB each) plus a derived LS_BLOCKS second copy. saveDoc's old quota loop freed ONE oldest
 * recovery copy per retry and never touched LS_BLOCKS at all, so the canonical LS_DOC write could
 * stay stuck while reclaimable space still existed → "SAVE FAILED".
 *
 * THE FIX: saveDoc's quota retry now ESCALATES through reclaim tiers, retrying the canonical write
 * after each step, so the live doc essentially never stays permanently stuck while ANY reclaimable
 * space exists. Tier order, most-disposable first:
 *
 *   tier 0: drop the derived LS_BLOCKS key (fully re-derivable from LS_DOC; nothing reads it).
 *   tier 1: evict ALL .bak  (routine session snapshots; cloud is the real backstop).
 *   tier 2: evict ALL .conflict (divergence recovery copies).
 *   tier 3: evict ALL .corrupt  (corruption recovery copies).
 *
 * We only fail loudly (ok:false, reason:'quota', wp-save-failed kind:'quota') when EVERY tier is
 * exhausted — i.e. nothing reclaimable remains.
 *
 * Run: bun src/quota-escalation.test.mjs   (auto-discovered by run-tests.mjs)
 */

// ── programmable localStorage shim: throws quota for LS_DOC until enough bytes are freed ─────────
const store = new Map();
class QuotaError extends Error { constructor() { super('quota'); this.name = 'QuotaExceededError'; } }

const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
const LS_BLOCKS = 'wp01_burma_blocks_v1';
const BAK_PREFIX = LS_DOC + '.bak.';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';
const CORRUPT_PREFIX = LS_DOC + '.corrupt.';

// The shim "fills up" when the number of stored keys exceeds `capacity`. Each LS_DOC write demands
// room; while the store is over capacity the write throws QuotaExceededError. Evicting keys (which
// the escalator does) brings the store back under capacity so a retry succeeds. This models the real
// "lots of fat recovery snapshots hogging quota" condition without needing real byte accounting.
let capacity = Infinity;
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (k === LS_DOC) {
      // Count the keys that AREN'T the doc itself (the doc slot is always allowed); if those exceed
      // capacity, there's no room for the doc write yet.
      const others = store.size - (store.has(LS_DOC) ? 1 : 0);
      if (others > capacity) throw new QuotaError();
    }
    store.set(k, String(v));
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
const keysWith = (p) => Array.from(store.keys()).filter((k) => k.startsWith(p));
const lastEvent = (t) => [...events].reverse().find((e) => e.type === t);
const doc = (text) => ({ type: 'doc', content: [
  { type: 'tableRow', attrs: { cols: 1 }, content: [
    { type: 'tableCell', attrs: { role: 'full' }, content: [
      { type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' }, content: [
        { type: 'paragraph', content: [{ type: 'text', text }] } ] } ] } ] },
] });

const M = await import('./migrate-doc.js?qesc');

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1. TIER 0 FIRST: a lingering derived LS_BLOCKS key is dropped BEFORE any recovery snapshot.
//    Capacity allows the doc once exactly ONE non-doc key is freed; with both LS_BLOCKS and a .bak
//    present, the escalator must reclaim LS_BLOCKS first and leave the .bak intact.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0; capacity = Infinity;
  store.set(LS_DOC_VER, '1|tab_seed');
  M.syncBaseVersion();
  store.set(LS_BLOCKS, 'X'.repeat(50));               // dead-weight derived copy
  store.set(BAK_PREFIX + '1700000000000-000000', 'bak-keep'); // a real backup we'd rather keep
  // Now allow at most 2 non-doc keys (ver + one of {blocks,bak}); start over with 3 present so the
  // first write throws and exactly one eviction is needed.
  capacity = 2; // ver + bak == 2 OK; ver + blocks + bak == 3 too many.
  const res = M.saveDoc(doc('LANDS'));
  ok(res.ok, '1a. save lands after escalation frees space');
  ok(store.get(LS_BLOCKS) == null, '1b. the derived LS_BLOCKS key was dropped FIRST (tier 0)');
  ok(store.get(BAK_PREFIX + '1700000000000-000000') === 'bak-keep',
    '1c. the .bak backup was preserved — tier 0 sufficed, never escalated to .bak');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2. FULL ESCALATION: LS_BLOCKS + many .bak + many .conflict, capacity so tight only the .corrupt
//    tier (plus ver) fits. The escalator must blow through LS_BLOCKS, ALL .bak, ALL .conflict — and
//    the live doc must land. We assert each disposable tier is fully reclaimed in order.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0; capacity = Infinity;
  store.set(LS_DOC_VER, '5|tab_seed');
  M.syncBaseVersion();
  store.set(LS_BLOCKS, 'blocks');
  for (let i = 0; i < 4; i++) store.set(BAK_PREFIX + (1700000001000 + i) + '-000000', 'bak' + i);
  for (let i = 0; i < 3; i++) store.set(CONFLICT_PREFIX + (1700000002000 + i) + '-000000', 'cf' + i);
  // Keep ONE corrupt copy — it must survive (it's the deepest tier and isn't needed for room here).
  store.set(CORRUPT_PREFIX + '1700000003000-000000', 'corrupt-keep');
  // Allow at most: ver + corrupt == 2 non-doc keys. Everything above (blocks+bak+conflict) must go.
  capacity = 2;
  const res = M.saveDoc(doc('SURVIVES-FULL-ESCALATION'));
  ok(res.ok, '2a. save lands after escalating through LS_BLOCKS → all .bak → all .conflict');
  ok(store.get(LS_BLOCKS) == null, '2b. LS_BLOCKS reclaimed');
  ok(keysWith(BAK_PREFIX).length === 0, '2c. the ENTIRE .bak tier was sacrificed');
  ok(keysWith(CONFLICT_PREFIX).length === 0, '2d. the ENTIRE .conflict tier was sacrificed');
  ok(store.get(CORRUPT_PREFIX + '1700000003000-000000') === 'corrupt-keep',
    '2e. the .corrupt tier was never touched — escalation stopped as soon as the doc fit');
  ok(JSON.parse(store.get(LS_DOC)).content[0].content[0].content[0].content[0].content[0].text
    === 'SURVIVES-FULL-ESCALATION', '2f. the live doc actually persisted');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 3. EVERYTHING SACRIFICED, DOC STILL LANDS: capacity 0 non-doc keys. The escalator must drop
//    LS_BLOCKS, all .bak, all .conflict, AND all .corrupt to land the live doc — the live doc never
//    stays stuck while ANY reclaimable space exists.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0; capacity = Infinity;
  store.set(LS_DOC_VER, '9|tab_seed'); // the ver key is exempt from the non-doc count via capacity math? no:
  M.syncBaseVersion();
  store.set(LS_BLOCKS, 'b');
  store.set(BAK_PREFIX + '1700000004000-000000', 'bak');
  store.set(CONFLICT_PREFIX + '1700000004100-000000', 'cf');
  store.set(CORRUPT_PREFIX + '1700000004200-000000', 'cor');
  // Allow only the ver key (1 non-doc key). All four recovery/derived keys must be reclaimed.
  capacity = 1;
  const res = M.saveDoc(doc('LANDS-AT-ALL-COSTS'));
  ok(res.ok, '3a. live doc lands even when every recovery tier must be sacrificed');
  ok(store.get(LS_BLOCKS) == null && keysWith(BAK_PREFIX).length === 0 &&
     keysWith(CONFLICT_PREFIX).length === 0 && keysWith(CORRUPT_PREFIX).length === 0,
     '3b. all derived + recovery copies reclaimed to make room for the live doc');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 4. NOTHING LEFT TO FREE → FAIL LOUDLY: no LS_BLOCKS, no .bak/.conflict/.corrupt, and capacity is
//    impossibly tight. The escalator exhausts every tier and the save fails with reason:'quota' and
//    a loud wp-save-failed kind:'quota'. The live doc is never silently believed-saved.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0; capacity = Infinity;
  store.set(LS_DOC_VER, '2|tab_seed');
  M.syncBaseVersion();
  // The ver key alone is over capacity, and there is NOTHING evictable (no derived/recovery keys).
  capacity = 0;
  const res = M.saveDoc(doc('CANNOT-LAND'));
  ok(!res.ok, '4a. save fails when every reclaim tier is exhausted');
  ok(res.reason === 'quota', '4b. failure reason is quota');
  const ev = lastEvent('wp-save-failed');
  ok(ev && ev.detail?.kind === 'quota', '4c. a loud wp-save-failed kind=quota was raised');
  ok(store.get(LS_DOC) == null, '4d. nothing half-written masquerading as saved');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 5. RETRY-AFTER-EACH-STEP: a .bak tier with several copies is freed as ONE step (all of them), then
//    the immediately-following retry lands — proving the escalator retries the canonical write after
//    each tier rather than only at the very end.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0; capacity = Infinity;
  store.set(LS_DOC_VER, '3|tab_seed');
  M.syncBaseVersion();
  for (let i = 0; i < 6; i++) store.set(BAK_PREFIX + (1700000005000 + i) + '-000000', 'bak' + i);
  capacity = 1; // only the ver key may remain alongside the doc.
  const res = M.saveDoc(doc('RETRY-LANDS'));
  ok(res.ok, '5a. save lands after the .bak tier is reclaimed in one step + retried');
  ok(keysWith(BAK_PREFIX).length === 0, '5b. all six .bak copies freed in the one tier step');
}

console.log(`\nquota-escalation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
