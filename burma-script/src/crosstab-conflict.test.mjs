/**
 * Tests for the CROSS-TAB CONFLICT GUARD (vector: crosstab-stale-overwrite) in migrate-doc.js.
 *
 * The loss path: two tabs share localStorage. Tab A loads the doc (base v1). Tab B edits + saves
 * (v2). Tab A then flushes (e.g. the eager visibilitychange(hidden) listener fires on tab switch)
 * and — before this guard — silently overwrote B's newer doc with A's stale in-memory copy.
 *
 * The guard, proven here end to end:
 *   1. every saveDoc write stamps a monotonically increasing LS_DOC_VER (+ per-tab id), and each
 *      tab tracks the base version it last read/wrote (syncBaseVersion / successful save).
 *   2. before overwriting, saveDoc compares on-disk version vs this tab's base. If disk is NEWER,
 *      it SNAPSHOTS the newer (other-tab) doc to a `.conflict.<ts>` key, raises wp-save-failed
 *      (kind 'conflict'), and SKIPS the destructive write — NOTHING is lost, both docs on disk.
 *   3. a fresh tab that reads via syncBaseVersion adopts the current version and can save cleanly.
 *
 * To model two INDEPENDENT tabs (each with its own module-level knownBaseVersion + TAB_ID) over
 * ONE shared localStorage, we import the source module twice with distinct cache-busting query
 * strings. Both import instances see the same globalThis.localStorage — exactly two browser tabs.
 *
 * Run: bun src/crosstab-conflict.test.mjs   (auto-discovered by `bun run test`)
 */

import { strToU8, strFromU8, unzlibSync } from 'fflate';

// ---- shared browser shims (one localStorage = the shared origin store; window captures events) --
const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
// document/navigator no-op shims so the source module's tiptap imports load under bun/node.
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
// CustomEvent shim (bun/node has no DOM CustomEvent globally in this context).
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
const LS_DOC_FALLBACK = LS_DOC + '.z';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';

// saveDoc now writes the canonical doc BODY as a compressed (fflate zlib, latin1-packed) copy to the
// small LS_DOC_FALLBACK key, NOT the fat uncompressed LS_DOC key — the whole point of the IDB/quota
// fix. The cross-tab GUARD still keys off LS_DOC_VER (unchanged), so every version/refusal assertion
// below is unaffected; only the "what doc body actually landed on disk" read-backs must decompress
// the .z payload. This helper reads the persisted body the way the app's own read-back invariant does.
const bodyOnDisk = () => {
  const packed = store.get(LS_DOC_FALLBACK);
  if (packed == null) return null;
  let raw = null;
  try { raw = strFromU8(unzlibSync(strToU8(packed, true))); } catch { return null; }
  try { return JSON.parse(raw); } catch { return null; }
};
const bodyText = (doc) => doc?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.text ?? null;

// Two independent "tabs" — separate module instances, shared store.
const TabA = await import('./migrate-doc.js?tab=A');
const TabB = await import('./migrate-doc.js?tab=B');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
const conflictKeys = () => Array.from(store.keys()).filter((k) => k.startsWith(CONFLICT_PREFIX));
const lastEvent = (type) => [...events].reverse().find((e) => e.type === type);

const docWith = (text) => ({ type: 'doc', content: [
  { type: 'tableRow', attrs: { cols: 1 }, content: [
    { type: 'tableCell', attrs: { role: 'full' }, content: [
      { type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' }, content: [
        { type: 'paragraph', content: [{ type: 'text', text }] } ] } ] } ] },
] });

// ── scenario: A loads, B edits+saves, A flushes (stale) — A must NOT stomp B ───────────────────
store.clear();
events.length = 0;

// Seed an existing doc on disk (as if a prior session saved it). No version yet → implicit v0.
localStorage.setItem(LS_DOC, JSON.stringify(docWith('ORIGINAL')));

// Both tabs open and adopt the on-disk base (v0).
const baseA = TabA.syncBaseVersion();
const baseB = TabB.syncBaseVersion();
eq(baseA, 0, '1a. tab A adopts on-disk base v0');
eq(baseB, 0, '1b. tab B adopts on-disk base v0');
ok(TabA.getTabId() !== TabB.getTabId(), '1c. the two tabs have distinct ids');

// Tab B edits and saves → version bumps to 1.
const resB = TabB.saveDoc(docWith('B-NEWER-EDITS'));
ok(resB.ok, '2a. tab B save succeeds');
eq(resB.version, 1, '2b. tab B save stamps version 1');
eq(parseInt(localStorage.getItem(LS_DOC_VER), 10), 1, '2c. on-disk version is now 1');
ok(bodyText(bodyOnDisk()) === 'B-NEWER-EDITS',
  '2d. on-disk doc is B\'s newer edits');

// Tab A is still on base v0. It now flushes its STALE in-memory doc (the eager-flush stomp path).
const resA = TabA.saveDoc(docWith('A-STALE-WOULD-STOMP'));
ok(!resA.ok, '3a. tab A stale save is REFUSED');
eq(resA.reason, 'cross-tab-conflict', '3b. refusal reason is cross-tab-conflict');

// B's doc is STILL on disk untouched — nothing was stomped.
eq(bodyText(bodyOnDisk()),
  'B-NEWER-EDITS', '3c. B\'s newer doc survived — A did NOT overwrite it');
eq(parseInt(localStorage.getItem(LS_DOC_VER), 10), 1, '3d. on-disk version unchanged (still 1)');

// The newer (B) doc was snapshotted to a .conflict key before refusal — never lost.
ok(conflictKeys().length === 1, '4a. exactly one .conflict recovery snapshot written');
ok(JSON.parse(localStorage.getItem(conflictKeys()[0])).content[0].content[0].content[0].content[0].content[0].text === 'B-NEWER-EDITS',
  '4b. the conflict snapshot holds B\'s newer doc (both versions preserved)');

// A loud wp-save-failed (kind conflict) was raised so the banner shows.
const failEvt = lastEvent('wp-save-failed');
ok(failEvt && failEvt.detail?.kind === 'conflict', '5a. wp-save-failed raised with kind=conflict');
ok(failEvt && /another tab/i.test(failEvt.detail?.message || ''), '5b. conflict message tells the user another tab is newer');

// ── recovery: A reloads → re-syncs base to current (v1) → can now save cleanly ─────────────────
const baseAreload = TabA.syncBaseVersion();
eq(baseAreload, 1, '6a. after reload A adopts the current base v1');
const resA2 = TabA.saveDoc(docWith('A-AFTER-RELOAD'));
ok(resA2.ok, '6b. A saves cleanly once it is no longer stale');
eq(resA2.version, 2, '6c. monotonic version advances to 2');
eq(parseInt(localStorage.getItem(LS_DOC_VER), 10), 2, '6d. on-disk version is now 2');

// ── monotonicity: B was still on base 1; its next save must ALSO be caught as conflict now ─────
// (B is now the stale tab — same guard protects A's v2 from B's v1-based stomp.)
const resB2 = TabB.saveDoc(docWith('B-NOW-STALE'));
ok(!resB2.ok && resB2.reason === 'cross-tab-conflict', '7. guard is symmetric — now B (stale) is refused');
eq(bodyText(bodyOnDisk()),
  'A-AFTER-RELOAD', '7b. A\'s v2 survived B\'s stale attempt');

// ── fresh first-write: a brand-new origin (no prior doc) saves cleanly, stamps v1 ──────────────
store.clear();
const TabC = await import('./migrate-doc.js?tab=C');
TabC.syncBaseVersion(); // no doc → base 0
const resC = TabC.saveDoc(docWith('FIRST-EVER'));
ok(resC.ok && resC.version === 1, '8. first-ever save on a clean origin succeeds and stamps v1');

console.log(`\ncrosstab-conflict: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
