/**
 * Tests for the ADOPT-CLOUD RELOAD RACE guard (vector: adopt-cloud-reload-race) in migrate-doc.js
 * + main.jsx + Editor.jsx.
 *
 * THE LOSS PATH (critical, data-loss):
 *   Device A edited the cloud to version 8. Device B (local v5) opens. The offline-first startup
 *   renders <App/> immediately — the editor mounts and seedDoc() calls syncBaseVersion(), setting
 *   this tab's knownBaseVersion to the LOCAL version (5). THEN reconcileOnLoad runs in the
 *   background, sees cloud is strictly newer, and on the adopt path:
 *     1. snapshots the OLD local doc to a .conflict key,
 *     2. primeVersionFloor(8)  -> knownBaseVersion = 8, on-disk LS_DOC_VER = 8,
 *     3. saveDoc(cloudDoc)     -> stamps version 9, knownBaseVersion = 9, on-disk doc = cloud,
 *     4. returns shouldReload:true -> main.jsx calls location.reload().
 *   location.reload() fires pagehide/beforeunload, which the editor turns into flushSave ->
 *   saveDoc(editor.getJSON()) — but the editor's in-memory state STILL holds device B's STALE
 *   LOCAL v5 doc. At that instant storedVersion === knownBaseVersion === 9, so the cross-tab guard
 *   (storedVersion > knownBaseVersion) is FALSE: the guard PASSES and the stale local doc is written
 *   as version 10, CLOBBERING the just-adopted cloud doc. Device A's work is silently lost.
 *
 * THE FIX: main.jsx calls setReloadingForAdopt() immediately before location.reload(). Both
 * flushSave (Editor.jsx) and saveDoc (migrate-doc.js) honor that flag and refuse the write, so the
 * teardown flush can never stomp the already-canonical adopted cloud doc. The reload then re-seeds
 * the editor cleanly from the cloud doc.
 *
 * Run: bun src/adopt-cloud-reload-race.test.mjs   (auto-discovered by `bun run test`)
 */

// ---- shared browser shims (mirror crosstab-conflict.test.mjs) ----------------------------------
const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
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

const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';

const M = await import('./migrate-doc.js?adopt-reload');
const CS = await import('./cloud-sync.js?adopt-reload');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
const textOf = (raw) => {
  const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return d.content[0].content[0].content[0].content[0].content[0].text;
};
const conflictKeys = () => Array.from(store.keys()).filter((k) => k.startsWith(CONFLICT_PREFIX));

const docWith = (text) => ({ type: 'doc', content: [
  { type: 'tableRow', attrs: { cols: 1 }, content: [
    { type: 'tableCell', attrs: { role: 'full' }, content: [
      { type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' }, content: [
        { type: 'paragraph', content: [{ type: 'text', text }] } ] } ] } ] },
] });

// ── SCENARIO: full adopt-cloud reload race, end to end ─────────────────────────────────────────
store.clear();
events.length = 0;
M.resetReloadingForAdopt();

// Device B has a local doc at version 5 (its own prior work). Cloud (device A) is at version 8.
localStorage.setItem(LS_DOC, JSON.stringify(docWith('B-LOCAL-V5')));
localStorage.setItem(LS_DOC_VER, '5|tab_old');

// Step 1 — the editor mounts and seedDoc() adopts the LOCAL on-disk base (v5). This is the exact
// pre-condition that arms the race: knownBaseVersion = local version, NOT cloud.
const base = M.syncBaseVersion();
eq(base, 5, '1. editor seeds at LOCAL base v5 (the race precondition)');

// Step 2 — background reconcile fetches a strictly-newer cloud doc (v8) and runs the adopt path.
const cloudDoc = docWith('A-CLOUD-V8');
const recon = await CS.reconcileOnLoad({
  readLocal: () => ({ hasDoc: true, version: 5, doc: docWith('B-LOCAL-V5') }),
  saveDoc: M.saveDoc,
  primeVersionFloor: M.primeVersionFloor,
  fetchCloud: async () => ({ ok: true, doc: cloudDoc, version: 8 }),
});
eq(recon.action, 'adopt-cloud', '2a. reconcile chose adopt-cloud');
ok(recon.shouldReload, '2b. reconcile signals shouldReload (adopt write landed)');
eq(textOf(localStorage.getItem(LS_DOC)), 'A-CLOUD-V8', '2c. cloud doc is now on disk (adopted)');
eq(parseInt(localStorage.getItem(LS_DOC_VER), 10), 9, '2d. on-disk version stamped to cloud+1 = 9');
eq(M.getKnownBaseVersion(), 9, '2e. knownBaseVersion advanced to 9 (this is what arms the stale flush)');

// The OLD local doc was snapshotted to a .conflict key before adopt (never lost).
ok(conflictKeys().some((k) => textOf(localStorage.getItem(k)) === 'B-LOCAL-V5'),
  '2f. old local doc snapshotted to a .conflict recovery key');

// Step 3 — main.jsx arms the guard right before location.reload().
M.setReloadingForAdopt();
ok(M.isReloadingForAdopt(), '3. adopt-reload guard armed before reload');

// Step 4 — location.reload() fires pagehide/beforeunload -> editor flushSave -> saveDoc(STALE local).
// THIS is the write that, before the fix, clobbered the adopted cloud doc as version 10.
const flush = M.saveDoc(docWith('B-LOCAL-V5')); // the editor's still-in-memory stale local doc
ok(!flush.ok, '4a. the teardown flush of the stale local doc is REFUSED');
eq(flush.reason, 'reloading-for-adopt', '4b. refusal reason is reloading-for-adopt');

// Step 5 — THE ASSERTION THAT MATTERS: the adopted cloud doc survived. No clobber, no v10.
eq(textOf(localStorage.getItem(LS_DOC)), 'A-CLOUD-V8', '5a. adopted cloud doc SURVIVED the teardown flush');
eq(parseInt(localStorage.getItem(LS_DOC_VER), 10), 9, '5b. on-disk version unchanged (still 9, no stale v10)');

// ── CONTROL: WITHOUT the guard, the same flush would clobber the cloud doc ──────────────────────
// Proves the test actually exercises the loss path (guard off => loss). We reset to the post-adopt
// state and flush the stale local doc with the guard cleared.
store.clear();
M.resetReloadingForAdopt();
localStorage.setItem(LS_DOC, JSON.stringify(cloudDoc));
localStorage.setItem(LS_DOC_VER, '9|tab_adopt');
M.primeVersionFloor(9); // tab base = 9, matching the post-adopt state
// guard is NOT armed here — this is the pre-fix behaviour
const stomp = M.saveDoc(docWith('B-LOCAL-V5'));
ok(stomp.ok, '6a. CONTROL: with guard OFF the stale flush is NOT refused (proves the race is real)');
eq(textOf(localStorage.getItem(LS_DOC)), 'B-LOCAL-V5', '6b. CONTROL: cloud doc WAS clobbered when guard is off');

// ── the guard does NOT block the adopt write itself ────────────────────────────────────────────
// The flag is only set AFTER reconcile's adopt write, so a normal adopt always lands. Sanity: a
// fresh saveDoc with the guard reset works (the guard is one-shot for the reload window, not sticky
// beyond an explicit reset — and main.jsx only ever sets it as the page is being torn down).
store.clear();
M.resetReloadingForAdopt();
M.syncBaseVersion();
const normal = M.saveDoc(docWith('NORMAL-WRITE'));
ok(normal.ok, '7. with guard reset, normal saves work (guard does not poison later writes)');

console.log(`\nadopt-cloud-reload-race: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
