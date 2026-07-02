/**
 * Tests for saveDoc's DATA-LOSS-CRITICAL guards (vector: savedoc-invariant-coverage) in
 * migrate-doc.js — the three deepest branches that previously had ZERO direct coverage:
 *
 *   STEP 2  QUOTA-EVICT-RETRY loop (setItem throws QuotaExceededError on the compressed `.z` write
 *           -> evict oldest backup ->
 *           retry until it lands or there's nothing left to evict, then {ok:false, reason:'quota'}
 *           + wp-save-failed kind:'quota').
 *   STEP 3  READ-BACK INVARIANT mismatch (re-read/decompress `.z` !== written bytes -> wp-save-failed
 *           kind:'invariant', {ok:false, reason:'invariant-mismatch'}).
 *   STEP 3  GARBLED/TRUNCATED read-back (corrupt compressed bytes come back -> loud wp-save-failed
 *           kind:'invariant', reason:'invariant-unparseable'; a corrupt write is never silently
 *           accepted).
 *
 * saveDoc is the ONLY canonical LS_DOC write path and the cardinal rule is "data loss is the worst
 * outcome", so these silent-corruption guards must be load-bearing. We drive them with a
 * programmable localStorage shim that can throw QuotaExceededError on demand and mangle/truncate the
 * stored bytes after a write. Each test re-imports the module fresh (cache-busting query) so the
 * per-tab module state (knownBaseVersion, sessionBackedUp) starts clean.
 *
 * Run: bun src/savedoc-invariant.test.mjs   (auto-discovered by `bun run test`)
 */

import { strToU8, strFromU8 } from 'fflate';
import { compressDoc, decompressDoc } from './recovery-store.js';

// ---- programmable localStorage shim -----------------------------------------------------------
const store = new Map();
// Controls the shim's misbehaviour. Reset per scenario.
const ctl = {
  quotaMode: 'none', // 'none' | 'while-evictable' | 'always'
};
class QuotaError extends Error { constructor() { super('quota'); this.name = 'QuotaExceededError'; } }

const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_FALLBACK = LS_DOC + '.z';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
const BAK_PREFIX = LS_DOC + '.bak.';
const readSavedRaw = () => {
  const packed = store.get(LS_DOC_FALLBACK);
  return packed == null ? null : decompressDoc(strToU8(packed, true));
};
const packDoc = (raw) => {
  const gz = compressDoc(raw);
  return gz ? strFromU8(gz, true) : null;
};
const hasEvictableBlockers = () => Array.from(store.keys()).some((k) => k.startsWith(BAK_PREFIX));
const isSyncDocKey = (k) => k === LS_DOC_FALLBACK || k === LS_DOC;

globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (isSyncDocKey(k)) {
      if (ctl.quotaMode === 'always') throw new QuotaError();
      if (ctl.quotaMode === 'while-evictable' && hasEvictableBlockers()) throw new QuotaError();
    }
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
  ctl.quotaMode = 'none';
  const M = await import('./migrate-doc.js?inv=1');
  M.syncBaseVersion();
  // Seed two evictable backups so the loop has room to free.
  store.set(BAK_PREFIX + '1000000000000-000000', 'old-backup-A');
  store.set(BAK_PREFIX + '1000000000001-000000', 'old-backup-B');
  // Throw quota on the FIRST `.z` write; the escalator's first effective tier (no LS_BLOCKS present,
  // so tier 0 is skipped) is "evict ALL .bak". After that tier frees space, the retry lands. PHASE-2:
  // when the live doc can't be written we sacrifice the WHOLE .bak tier — a stale session snapshot is
  // worthless if the live doc itself can't persist.
  ctl.quotaMode = 'while-evictable';
  const res = M.saveDoc(doc('LANDS-AFTER-EVICT'));
  ctl.quotaMode = 'none';
  ok(res.ok, '1a. save eventually lands after escalating eviction frees the .bak tier');
  eq(JSON.parse(readSavedRaw()).content[0].content[0].content[0].content[0].content[0].text,
    'LANDS-AFTER-EVICT', '1b. the compressed fallback round-trips to the saved doc');
  ok(bakKeys().length === 0, '1c. the entire .bak tier was sacrificed to land the live doc');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2. QUOTA EXHAUSTED: setItem always throws and no backups remain -> {ok:false, reason:'quota'}
//    + a loud wp-save-failed kind:'quota'. The live doc must NOT be silently believed-saved.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.quotaMode = 'none';
  const M = await import('./migrate-doc.js?inv=2');
  M.syncBaseVersion();
  // No backups to evict; reject BOTH sync doc-body writes so the loop exhausts and bails.
  ctl.quotaMode = 'always';
  const res = M.saveDoc(doc('CANNOT-LAND'));
  ctl.quotaMode = 'none';
  ok(!res.ok, '2a. save fails when quota is exhausted with nothing to evict');
  eq(res.reason, 'quota', '2b. failure reason is quota');
  const ev = lastEvent('wp-save-failed');
  ok(ev && ev.detail?.kind === 'quota', '2c. a loud wp-save-failed kind=quota was raised');
  ok(ev && /full/i.test(ev.detail?.message || ''), '2d. the message tells Johnny storage is full / export now');
  ok(store.get(LS_DOC_FALLBACK) == null, '2e. nothing was written (no half-write masquerading as saved)');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 3. READ-BACK INVARIANT MISMATCH: the write "succeeds" but the re-read differs -> wp-save-failed
//    kind:'invariant', {ok:false, reason:'invariant-mismatch'}. Catches silent truncation/corruption.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.quotaMode = 'none';
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
    if (written && k === LS_DOC_FALLBACK) return packDoc(JSON.stringify(doc('SOMETHING-ELSE')));
    if (written && k === LS_DOC) return JSON.stringify(doc('SOMETHING-ELSE'));
    return realGet(k);
  };
  globalThis.localStorage.setItem = (k, v) => { realSet(k, v); if (isSyncDocKey(k)) written = true; };
  const res = M.saveDoc(intended);
  globalThis.localStorage.getItem = realGet;
  globalThis.localStorage.setItem = realSet;
  ok(!res.ok, '3a. save fails when read-back !== written bytes');
  eq(res.reason, 'invariant-mismatch', '3b. failure reason is invariant-mismatch');
  const ev = lastEvent('wp-save-failed');
  ok(ev && ev.detail?.kind === 'invariant', '3c. a loud wp-save-failed kind=invariant was raised');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 4. GARBLED / TRUNCATED READ-BACK: the compressed bytes that come back do not even decompress ->
//    the invariant guard fires LOUDLY (wp-save-failed kind:'invariant') and saveDoc returns
//    ok:false, reason:'invariant-unparseable'. This is the protection CH-01 cares about: a corrupt
//    write is NEVER silently accepted as saved.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.quotaMode = 'none';
  const M = await import('./migrate-doc.js?inv=4');
  M.syncBaseVersion();
  const intended = doc('GARBLED-READBACK');
  let written = false;
  const realGet = globalThis.localStorage.getItem;
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.getItem = (k) => {
    if (written && k === LS_DOC_FALLBACK) return '\u0000totally-not-a-zlib-stream';
    if (written && k === LS_DOC) throw new Error('garbled raw read-back');
    return realGet(k);
  };
  globalThis.localStorage.setItem = (k, v) => { realSet(k, v); if (isSyncDocKey(k)) written = true; };
  const res = M.saveDoc(intended);
  globalThis.localStorage.getItem = realGet; // restore
  globalThis.localStorage.setItem = realSet;
  ok(!res.ok, '4a. save fails when the read-back is garbled/truncated');
  eq(res.reason, 'invariant-unparseable', '4b. failure reason is invariant-unparseable');
  const ev = lastEvent('wp-save-failed');
  ok(ev && ev.detail?.kind === 'invariant', '4c. a loud wp-save-failed kind=invariant was raised (corrupt write never silently accepted)');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 5. HAPPY PATH SANITY (no shim misbehaviour): a clean save returns ok + stamps a version + fires
//    wp-saved. Confirms the shim itself doesn't break the normal path.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.quotaMode = 'none';
  const M = await import('./migrate-doc.js?inv=5');
  M.syncBaseVersion();
  const res = M.saveDoc(doc('CLEAN'));
  ok(res.ok && res.reason === 'saved', '5a. clean save succeeds');
  ok(res.version === 1, '5b. clean save stamps version 1');
  ok(lastEvent('wp-saved') != null, '5c. wp-saved fired on success');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 6. EMPTY-DOC CLOBBER GUARD — the Burma blank-out root cause. A ZERO-text doc must NEVER be
//    written over a stored doc that HAS text. The good doc stays canonical; the empty attempt is
//    parked in a .corrupt.<ts> key; NO version bump, NO wp-saved (so Editor.flushSave won't push
//    the empty doc to cloud); a soft wp-save-degraded kind:'empty-clobber-blocked' explains it.
// ════════════════════════════════════════════════════════════════════════════════════════════
const emptyDoc = () => ({ type: 'doc', content: [
  { type: 'tableRow', attrs: { cols: 1 }, content: [
    { type: 'tableCell', attrs: { role: 'full' }, content: [
      { type: 'paragraph' } ] } ] },
] });
const CORRUPT_PREFIX = LS_DOC + '.corrupt.';
const corruptKeys = () => Array.from(store.keys()).filter((k) => k.startsWith(CORRUPT_PREFIX));
{
  store.clear(); events.length = 0;
  ctl.quotaMode = 'none';
  const M = await import('./migrate-doc.js?inv=6');
  M.syncBaseVersion();
  // Seed a real script first.
  const seed = M.saveDoc(doc('MY-WHOLE-SCRIPT'));
  ok(seed.ok, '6a. the non-empty script saves cleanly first');
  const versionBefore = seed.version;
  events.length = 0; // ignore the seed's wp-saved
  // Now an accidental empty autosave tries to clobber it.
  const res = M.saveDoc(emptyDoc());
  ok(!res.ok, '6b. the empty save is REFUSED');
  eq(res.reason, 'empty-clobber-blocked', '6c. reason is empty-clobber-blocked');
  eq(JSON.parse(readSavedRaw()).content[0].content[0].content[0].content[0].content[0].text,
    'MY-WHOLE-SCRIPT', '6d. the GOOD script is still canonical on disk — untouched');
  ok(corruptKeys().length === 1, '6e. the empty attempt is parked in a .corrupt recovery key');
  ok(lastEvent('wp-saved') == null, '6f. NO wp-saved fired (so flushSave will not push empty to cloud)');
  const ev = lastEvent('wp-save-degraded');
  ok(ev && ev.detail?.kind === 'empty-clobber-blocked', '6g. a soft wp-save-degraded explains the refusal');
  eq(M.getKnownBaseVersion(), versionBefore, '6h. the version did NOT advance (nothing to push)');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 7. EMPTY-OVER-ABSENT is ALLOWED — a brand-new project's very first save is legitimately empty
//    and must go through (nothing is being destroyed). The guard only fires empty-OVER-nonempty.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.quotaMode = 'none';
  const M = await import('./migrate-doc.js?inv=7');
  M.syncBaseVersion();
  const res = M.saveDoc(emptyDoc());
  ok(res.ok, '7a. an empty first save (nothing stored yet) is ALLOWED');
  ok(res.reason === 'saved', '7b. it persists normally');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 8. ONE WORD IS ENOUGH — any real text passes the guard (only ZERO text is refused). A doc with a
//    single word saved over a full script is a legitimate (if drastic) edit, not a clobber.
// ════════════════════════════════════════════════════════════════════════════════════════════
{
  store.clear(); events.length = 0;
  ctl.quotaMode = 'none';
  const M = await import('./migrate-doc.js?inv=8');
  M.syncBaseVersion();
  M.saveDoc(doc('THE-WHOLE-THING'));
  const res = M.saveDoc(doc('x'));
  ok(res.ok && res.reason === 'saved', '8a. a one-word doc over a full one is allowed (has text)');
  eq(JSON.parse(readSavedRaw()).content[0].content[0].content[0].content[0].content[0].text,
    'x', '8b. the one-word edit is what persisted');
  // And the docHasAnyText predicate itself: empty shapes are empty, any text is not.
  ok(M.docHasAnyText(doc('hi')) === true, '8c. docHasAnyText: real text → true');
  ok(M.docHasAnyText(emptyDoc()) === false, '8d. docHasAnyText: empty rows/cells/paragraph → false');
  ok(M.docHasAnyText({ type: 'doc', content: [] }) === false, '8e. docHasAnyText: no content → false');
  ok(M.docHasAnyText('not json at all') === false, '8f. docHasAnyText: garbage string → false (never throws)');
}

console.log(`\nsavedoc-invariant: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
