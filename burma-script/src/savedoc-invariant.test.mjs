/**
 * Tests for saveDoc's DATA-LOSS-CRITICAL guards (vector: savedoc-invariant-coverage) in
 * migrate-doc.js — the three deepest branches that previously had ZERO direct coverage:
 *
 *   STEP 2  QUOTA-EVICT-RETRY loop (setItem throws QuotaExceededError -> evict oldest backup ->
 *           retry until it lands or there's nothing left to evict, then {ok:false, reason:'quota'}
 *           + wp-save-failed kind:'quota').
 *   STEP 3  READ-BACK INVARIANT mismatch (re-read LS_DOC !== written bytes -> wp-save-failed
 *           kind:'invariant', {ok:false, reason:'invariant-mismatch'}).
 *   STEP 3  GARBLED/TRUNCATED read-back (corrupt bytes come back -> loud wp-save-failed
 *           kind:'invariant', ok:false; a corrupt write is never silently accepted).
 *
 * saveDoc is the ONLY canonical LS_DOC write path and the cardinal rule is "data loss is the worst
 * outcome", so these silent-corruption guards must be load-bearing. We drive them with a
 * programmable localStorage shim that can throw QuotaExceededError on demand and mangle/truncate the
 * stored bytes after a write. Each test re-imports the module fresh (cache-busting query) so the
 * per-tab module state (knownBaseVersion, sessionBackedUp) starts clean.
 *
 * Run: bun src/savedoc-invariant.test.mjs   (auto-discovered by `bun run test`)
 */

// ---- programmable localStorage shim -----------------------------------------------------------
const store = new Map();
// Controls the shim's misbehaviour. Reset per scenario.
const ctl = {
  throwSetItemTimes: 0,   // throw QuotaExceededError on the next N setItem(LS_DOC) calls
};
class QuotaError extends Error { constructor() { super('quota'); this.name = 'QuotaExceededError'; } }

const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
const BAK_PREFIX = LS_DOC + '.bak.';

globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (k === LS_DOC && ctl.throwSetItemTimes > 0) { ctl.throwSetItemTimes--; throw new QuotaError(); }
    store.set(k, String(v));
  },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
const elShim = () => ({ setAttribute() {}, appendChild() {}, className: '', style: {} });
globalThis.document = globalThis.document || {
  createElement: elShim, createTextNode: () => ({}),
  addEventListener() {}, removeEventListener() {},
  body: elShim(), documentElement: { style: {} },
};
globalThis.navigator = globalThis.navigator || { platform: 'Linux', userAgent: 'node', maxTouchPoints: 0 };
const events = [];
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = (e) => { events.push({ type: e.type, detail: e.detail }); return true; };
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
const lastEvent = (type) => [...events].reverse().find((e) => e.type === type);
const bakKeys = () => Array.from(store.keys()).filter((k) => k.startsWith(BAK_PREFIX));
const doc = (text) => ({ type: 'doc', content: [
  { type: 'tableRow', attrs: { cols: 1 }, content: [
    { type: 'tableCell', attrs: { role: 'full' }, content: [
      { type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' }, content: [
        { type: 'paragraph', content: [{ type: 'text', text }] } ] } ] } ] },
] });

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1. QUOTA-EVICT-RETRY: setItem throws once, an evictable backup exists -> doc eventually LANDS.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.throwSetItemTimes = 0;
  const M = await import('./migrate-doc.js?inv=1');
  M.syncBaseVersion();
  // Seed two evictable backups so the loop has room to free.
  store.set(BAK_PREFIX + '1000000000000-000000', 'old-backup-A');
  store.set(BAK_PREFIX + '1000000000001-000000', 'old-backup-B');
  // Throw quota on the FIRST LS_DOC write; the retry after one eviction succeeds.
  ctl.throwSetItemTimes = 1;
  const res = M.saveDoc(doc('LANDS-AFTER-EVICT'));
  ok(res.ok, '1a. save eventually lands after evicting one backup');
  eq(JSON.parse(store.get(LS_DOC)).content[0].content[0].content[0].content[0].content[0].text, 'LANDS-AFTER-EVICT',
    '1b. the doc actually persisted');
  ok(bakKeys().length === 1, '1c. exactly one backup was evicted to make room (oldest first)');
  ok(!bakKeys().includes(BAK_PREFIX + '1000000000000-000000'), '1d. the OLDEST backup is the one evicted');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2. QUOTA EXHAUSTED: setItem always throws and no backups remain -> {ok:false, reason:'quota'}
//    + a loud wp-save-failed kind:'quota'. The live doc must NOT be silently believed-saved.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.throwSetItemTimes = 0;
  const M = await import('./migrate-doc.js?inv=2');
  M.syncBaseVersion();
  // No backups to evict; throw on every LS_DOC write so the loop exhausts and bails.
  ctl.throwSetItemTimes = 999;
  const res = M.saveDoc(doc('CANNOT-LAND'));
  ok(!res.ok, '2a. save fails when quota is exhausted with nothing to evict');
  eq(res.reason, 'quota', '2b. failure reason is quota');
  const ev = lastEvent('wp-save-failed');
  ok(ev && ev.detail?.kind === 'quota', '2c. a loud wp-save-failed kind=quota was raised');
  ok(ev && /full/i.test(ev.detail?.message || ''), '2d. the message tells Johnny storage is full / export now');
  ok(store.get(LS_DOC) == null, '2e. nothing was written (no half-write masquerading as saved)');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 3. READ-BACK INVARIANT MISMATCH: the write "succeeds" but the re-read differs -> wp-save-failed
//    kind:'invariant', {ok:false, reason:'invariant-mismatch'}. Catches silent truncation/corruption.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.throwSetItemTimes = 0;
  const M = await import('./migrate-doc.js?inv=3');
  M.syncBaseVersion();
  // setItem stores fine, but the read-back (the FIRST LS_DOC read after the write) returns DIFFERENT
  // but still valid-JSON bytes — simulating silent corruption. Override getItem to mangle LS_DOC
  // reads only AFTER the write has landed (a setItem wrapper flips the flag).
  const intended = doc('INTENDED');
  let written = false;
  const realGet = globalThis.localStorage.getItem;
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.getItem = (k) => {
    if (k === LS_DOC && written) return JSON.stringify(doc('SOMETHING-ELSE')); // != out, parses fine
    return realGet(k);
  };
  globalThis.localStorage.setItem = (k, v) => { realSet(k, v); if (k === LS_DOC) written = true; };
  const res = M.saveDoc(intended);
  globalThis.localStorage.getItem = realGet;
  globalThis.localStorage.setItem = realSet;
  ok(!res.ok, '3a. save fails when read-back !== written bytes');
  eq(res.reason, 'invariant-mismatch', '3b. failure reason is invariant-mismatch');
  const ev = lastEvent('wp-save-failed');
  ok(ev && ev.detail?.kind === 'invariant', '3c. a loud wp-save-failed kind=invariant was raised');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 4. GARBLED / TRUNCATED READ-BACK: the bytes that come back are unparseable garbage (a truncated
//    or corrupted write) -> the invariant guard fires LOUDLY (wp-save-failed kind:'invariant') and
//    saveDoc returns ok:false. This is the protection CH-01 cares about: a corrupt write is NEVER
//    silently accepted as saved.
//
//    NOTE on the code path: STEP 3 reads LS_DOC ONCE and compares `readBack !== out`; an unparseable
//    read-back ALSO differs from the valid `out`, so the mismatch arm fires first (same kind:
//    'invariant', reason:'invariant-mismatch'). The `invariant-unparseable` arm is only reachable if
//    a platform returns bytes that EQUAL the valid `out` yet fail JSON.parse — impossible for a
//    well-formed `out`, so it is a defense-in-depth guard. We assert the reachable, load-bearing
//    behaviour: garbled read-back -> loud invariant failure, ok:false.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.throwSetItemTimes = 0;
  const M = await import('./migrate-doc.js?inv=4');
  M.syncBaseVersion();
  const intended = doc('GARBLED-READBACK');
  let written = false;
  const realGet = globalThis.localStorage.getItem;
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.getItem = (k) => {
    if (k === LS_DOC && written) return '{ truncated json that will not par'; // garbled read-back
    return realGet(k);
  };
  globalThis.localStorage.setItem = (k, v) => { realSet(k, v); if (k === LS_DOC) written = true; };
  const res = M.saveDoc(intended);
  globalThis.localStorage.getItem = realGet; // restore
  globalThis.localStorage.setItem = realSet;
  ok(!res.ok, '4a. save fails when the read-back is garbled/truncated');
  const ev = lastEvent('wp-save-failed');
  ok(ev && ev.detail?.kind === 'invariant', '4b. a loud wp-save-failed kind=invariant was raised (corrupt write never silently accepted)');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 5. HAPPY PATH SANITY (no shim misbehaviour): a clean save returns ok + stamps a version + fires
//    wp-saved. Confirms the shim itself doesn't break the normal path.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.throwSetItemTimes = 0;
  const M = await import('./migrate-doc.js?inv=5');
  M.syncBaseVersion();
  const res = M.saveDoc(doc('CLEAN'));
  ok(res.ok && res.reason === 'saved', '5a. clean save succeeds');
  ok(res.version === 1, '5b. clean save stamps version 1');
  ok(lastEvent('wp-saved') != null, '5c. wp-saved fired on success');
}

console.log(`\nsavedoc-invariant: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
