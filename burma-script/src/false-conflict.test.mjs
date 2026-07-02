/**
 * FALSE-CONFLICT GUARD tests (self-conflict) — src/cloud-sync.js.
 *
 * THE LIVE FAILURE: Johnny saw the "ANOTHER DEVICE" conflict banner constantly while editing ALONE,
 * plus a permanently-stuck "UNSYNCED BACKUP FOUND" recovery banner. Root cause: after any successful
 * push, local version == cloud version (steady state). Every page load's keep-local reconcile then
 * PUT that EQUAL version; the server's strictly-greater rule refused it 409; and handlePushResult
 * treated EVERY 409 as a two-device divergence — banner + two conflict snapshots per load — without
 * ever checking that the "conflicting" cloud doc was content-identical to our own.
 *
 * The fix, two layers:
 *   1. reconcileOnLoad keep-local: when cloud version == local version AND content is identical,
 *      SKIP the doomed push entirely (skippedPush:true, no network write).
 *   2. handlePushResult: a 409 whose cloud doc is content-identical to the pushed doc (steady state)
 *      or to the CURRENT live local doc (our own newer autosave won an out-of-order race) is BENIGN —
 *      no banner, no snapshots, fires an honest wp-cloud-saved instead.
 * A REAL two-device conflict (content genuinely differs on both compares) still gets the full
 * banner + both-sides snapshots — regression-locked below.
 *
 * Run: bun src/false-conflict.test.mjs   (auto-discovered by `bun run test`)
 */

const EVENTS = [];
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = (ev) => { try { EVENTS.push({ type: ev?.type, detail: ev?.detail }); } catch {} return true; };
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };
const eventsOfType = (t) => EVENTS.filter((e) => e.type === t);
const clearEvents = () => { EVENTS.length = 0; };

// localStorage shim BEFORE import so the module's episode-key sync and migrate-doc machinery run.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

const { reconcileOnLoad, handlePushResult, isCloudLatched, clearCloudLatch, EVT_CLOUD_SAVED, EVT_CLOUD_CONFLICT } = await import('./cloud-sync.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const DOC = (t) => ({ type: 'doc', content: [{ type: 'p', text: t }] });
const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';
const conflictKeys = () => Array.from(store.keys()).filter((k) => k.startsWith(CONFLICT_PREFIX));

/* ── (fc1) STEADY-STATE 409: cloud doc content-identical to the pushed doc → BENIGN ─────────────── */
{
  store.clear(); clearEvents(); clearCloudLatch();
  const doc = DOC('same words both sides');
  const out = handlePushResult({ ok: false, stale: true, doc, version: 7 }, DOC('same words both sides'));
  ok(out.conflict === false, 'fc1a. identical-content 409 is NOT a conflict');
  ok(out.benign === true, 'fc1b. reported benign');
  eq(out.reason, 'content-identical', 'fc1c. reason names the steady-state case');
  eq(conflictKeys().length, 0, 'fc1d. NO conflict snapshots burned');
  eq(eventsOfType(EVT_CLOUD_CONFLICT).length, 0, 'fc1e. NO two-device banner raised');
  eq(eventsOfType(EVT_CLOUD_SAVED).length, 1, 'fc1f. fires an honest wp-cloud-saved instead');
  eq(eventsOfType(EVT_CLOUD_SAVED)[0].detail.version, 7, 'fc1g. saved event carries the cloud version');
  ok(isCloudLatched() === false, 'fc1h. a BENIGN steady-state 409 must NEVER latch cloud pushes');
}

/* ── (fc2) jsonb KEY-REORDER cannot fake a conflict: same content, different key order → BENIGN ── */
{
  store.clear(); clearEvents();
  const local = { type: 'doc', content: [{ type: 'p', text: 'reordered' }] };
  const cloudReordered = { content: [{ text: 'reordered', type: 'p' }], type: 'doc' };
  const out = handlePushResult({ ok: false, stale: true, doc: cloudReordered, version: 9 }, local);
  ok(out.conflict === false && out.benign === true, 'fc2a. key-reordered cloud doc reads as identical (canonical compare)');
  eq(conflictKeys().length, 0, 'fc2b. no snapshots for a cosmetic reorder');
}

/* ── (fc3) AUTOSAVE RACE: refused doc is older, but OUR newer save already IS the cloud → BENIGN ── */
{
  store.clear(); clearEvents(); clearCloudLatch();
  const newer = DOC('newer autosave from this device');
  const older = DOC('older autosave from this device');
  // The live on-disk doc (this device's newest save) matches what the cloud holds.
  store.set(LS_DOC, JSON.stringify(newer));
  store.set(LS_DOC_VER, '12|tabX');
  const out = handlePushResult({ ok: false, stale: true, doc: DOC('newer autosave from this device'), version: 12 }, older);
  ok(out.conflict === false && out.benign === true, 'fc3a. own-newer-landed race is NOT a conflict');
  eq(out.reason, 'own-newer-landed', 'fc3b. reason names the self-race case');
  eq(conflictKeys().length, 0, 'fc3c. no snapshots burned on a self-race');
  eq(eventsOfType(EVT_CLOUD_CONFLICT).length, 0, 'fc3d. no banner on a self-race');
  ok(isCloudLatched() === false, 'fc3e. a self-race benign 409 must NOT latch');
}

/* ── (fc4) REAL two-device conflict still gets the FULL treatment (regression lock) ─────────────── */
{
  store.clear(); clearEvents(); clearCloudLatch();
  // Live local is a THIRD state (device A kept typing) — neither compare matches.
  store.set(LS_DOC, JSON.stringify(DOC('A kept typing after the refused push')));
  store.set(LS_DOC_VER, '11|tabA');
  const refused = DOC('A-edited-paragraph-Y');
  const theirs = DOC('B-edited-paragraph-X');
  const out = handlePushResult({ ok: false, stale: true, doc: theirs, version: 11 }, refused);
  ok(out.conflict === true, 'fc4a. genuinely divergent 409 IS still a conflict');
  eq(conflictKeys().length, 2, 'fc4b. both sides still snapshotted');
  eq(eventsOfType(EVT_CLOUD_CONFLICT).length, 1, 'fc4c. banner still raised for the real case');
  eq(eventsOfType(EVT_CLOUD_SAVED).length, 0, 'fc4d. no false green on a real conflict');
  ok(isCloudLatched() === true, 'fc4e. a REAL two-device conflict latches cloud pushes off');
  clearCloudLatch(); // reset so the following reconcile tests start clean
}

/* ── (fc5) reconcileOnLoad steady state: equal version + identical content → push SKIPPED ───────── */
{
  store.clear(); clearEvents();
  const doc = DOC('steady state');
  let pushFetches = 0;
  globalThis.fetch = async (url, init) => { if (init?.method === 'PUT') pushFetches++; return { ok: true, json: async () => ({}) }; };
  const res = await reconcileOnLoad({
    readLocal: () => ({ hasDoc: true, version: 5, doc }),
    readLiveLocal: () => ({ hasDoc: true, version: 5, doc }),
    fetchCloud: async () => ({ ok: true, doc: DOC('steady state'), version: 5 }),
  });
  eq(res.action, 'keep-local', 'fc5a. steady state stays keep-local');
  ok(res.skippedPush === true, 'fc5b. the doomed equal-version push is SKIPPED');
  // give any (wrongly) fired push a tick to run
  await new Promise((r) => setTimeout(r, 10));
  eq(pushFetches, 0, 'fc5c. zero PUTs on a steady-state load');
  eq(eventsOfType(EVT_CLOUD_CONFLICT).length, 0, 'fc5d. no banner on a steady-state load');
}

/* ── (fc6) reconcileOnLoad equal version but DIVERGENT content → push still attempted ───────────── */
{
  store.clear(); clearEvents();
  let putBodies = [];
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'PUT') { putBodies.push(init.body); return { ok: true, json: async () => ({ version: 6 }) }; }
    return { ok: true, json: async () => ({}) };
  };
  const mine = DOC('my equal-version edit');
  const res = await reconcileOnLoad({
    readLocal: () => ({ hasDoc: true, version: 5, doc: mine }),
    readLiveLocal: () => ({ hasDoc: true, version: 5, doc: mine }),
    fetchCloud: async () => ({ ok: true, doc: DOC('their different equal-version edit'), version: 5 }),
  });
  eq(res.action, 'keep-local', 'fc6a. divergent tie stays keep-local');
  ok(res.skippedPush !== true, 'fc6b. divergent equal-version content is NOT skipped');
  await new Promise((r) => setTimeout(r, 10));
  eq(putBodies.length, 1, 'fc6c. the push IS attempted (real ties must reach handlePushResult)');
}

console.log(`\nfalse-conflict: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
