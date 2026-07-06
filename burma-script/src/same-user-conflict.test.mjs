/**
 * SAME-USER CONFLICT tests (the recurring FALSE "ANOTHER DEVICE" banner) — src/cloud-sync.js.
 *
 * THE LIVE FAILURE: Johnny (editing ALONE — script_presence showed one session) kept getting the
 * alarming "ANOTHER DEVICE saved a newer version… RELOAD" banner. The cloud sync detected conflicts
 * purely by version/content divergence, so a leftover second tab or a post-token-expiry reload of
 * HIS OWN session read as "another device". The structural fix: the server now attributes every
 * accepted write (script_docs.updated_by) and hands that id back on a 409; the client compares it to
 * the signed-in user (window.__wpCurrentUserId, published by the library gate).
 *
 * The contract under test:
 *   • 409 + updatedBy === signed-in user  → SAME data safety (both-sides snapshots, push latch) but
 *     the CALM wp-cloud-conflict-own event — NEVER the alarming wp-cloud-conflict banner.
 *   • 409 + updatedBy is a DIFFERENT known user → the full ANOTHER-DEVICE banner (regression lock).
 *   • identity unknown on EITHER side (no signed-in id, or server sent updated_by:null) → the full
 *     banner. Correctness over cleverness: we only soften the alarm on positive proof.
 *   • the benign content-identical guard is untouched and still wins first.
 *
 * Run: bun src/same-user-conflict.test.mjs   (auto-discovered by `bun run test`)
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

const {
  handlePushResult, pushDoc, isOwnCloudConflict, currentCloudUserId,
  isCloudLatched, clearCloudLatch,
  EVT_CLOUD_SAVED, EVT_CLOUD_CONFLICT, EVT_CLOUD_CONFLICT_OWN,
} = await import('./cloud-sync.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const DOC = (t) => ({ type: 'doc', content: [{ type: 'p', text: t }] });
const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';
const conflictKeys = () => Array.from(store.keys()).filter((k) => k.startsWith(CONFLICT_PREFIX));

const ME = 'user-aaaa-1111';
const OTHER = 'user-bbbb-2222';

// A genuinely divergent 409 setup: live local is a third state so the benign guard cannot clear it.
function divergentSetup() {
  store.clear(); clearEvents(); clearCloudLatch();
  store.set(LS_DOC, JSON.stringify(DOC('this tab kept typing after the refused push')));
  store.set(LS_DOC_VER, '11|tabA');
}

/* ── (su1) SAME USER: 409 whose cloud version I wrote myself → calm event, full data safety ─────── */
{
  divergentSetup();
  window.__wpCurrentUserId = ME;
  const refused = DOC('my edit in THIS tab');
  const theirs = DOC('my edit in my OTHER tab');
  const out = handlePushResult({ ok: false, stale: true, doc: theirs, version: 11, updatedBy: ME }, refused);
  ok(out.conflict === true, 'su1a. still reported as a divergence (data safety unchanged)');
  ok(out.sameUser === true, 'su1b. flagged sameUser');
  eq(conflictKeys().length, 2, 'su1c. BOTH sides still snapshotted — safety net untouched');
  ok(isCloudLatched() === true, 'su1d. pushes still latched until reload (no stale stomp possible)');
  eq(eventsOfType(EVT_CLOUD_CONFLICT).length, 0, 'su1e. the alarming ANOTHER-DEVICE banner does NOT fire');
  eq(eventsOfType(EVT_CLOUD_CONFLICT_OWN).length, 1, 'su1f. the calm own-session note fires instead');
  eq(eventsOfType(EVT_CLOUD_CONFLICT_OWN)[0].detail.cloudVersion, 11, 'su1g. calm event carries the cloud version');
  ok(!!eventsOfType(EVT_CLOUD_CONFLICT_OWN)[0].detail.localSnapshot, 'su1h. calm event carries the local recovery key');
  eq(eventsOfType(EVT_CLOUD_SAVED).length, 0, 'su1i. no false green either');
  clearCloudLatch();
}

/* ── (su2) DIFFERENT USER: a real second person → the full banner (regression lock) ─────────────── */
{
  divergentSetup();
  window.__wpCurrentUserId = ME;
  const out = handlePushResult(
    { ok: false, stale: true, doc: DOC('someone else wrote this'), version: 12, updatedBy: OTHER },
    DOC('my refused edit')
  );
  ok(out.conflict === true && out.sameUser !== true, 'su2a. different-user 409 is a REAL conflict');
  eq(eventsOfType(EVT_CLOUD_CONFLICT).length, 1, 'su2b. ANOTHER-DEVICE banner still fires for a real second person');
  eq(eventsOfType(EVT_CLOUD_CONFLICT_OWN).length, 0, 'su2c. no calm event for a different user');
  eq(conflictKeys().length, 2, 'su2d. both sides snapshotted');
  ok(isCloudLatched() === true, 'su2e. latched');
  clearCloudLatch();
}

/* ── (su3) IDENTITY UNKNOWN on the client (not signed in / global absent) → the full banner ─────── */
{
  divergentSetup();
  delete window.__wpCurrentUserId;
  const out = handlePushResult(
    { ok: false, stale: true, doc: DOC('cloud side'), version: 13, updatedBy: ME },
    DOC('refused side')
  );
  ok(out.conflict === true && out.sameUser !== true, 'su3a. unknown self-identity → treated as a real conflict');
  eq(eventsOfType(EVT_CLOUD_CONFLICT).length, 1, 'su3b. banner fires (safe fallback — never weaker than before)');
  eq(eventsOfType(EVT_CLOUD_CONFLICT_OWN).length, 0, 'su3c. no calm event without positive proof');
  clearCloudLatch();
}

/* ── (su4) SERVER didn't attribute the row (updatedBy null / absent) → the full banner ──────────── */
{
  divergentSetup();
  window.__wpCurrentUserId = ME;
  const outNull = handlePushResult(
    { ok: false, stale: true, doc: DOC('cloud side'), version: 14, updatedBy: null },
    DOC('refused side')
  );
  ok(outNull.conflict === true && outNull.sameUser !== true, 'su4a. updatedBy null → real-conflict treatment');
  eq(eventsOfType(EVT_CLOUD_CONFLICT).length, 1, 'su4b. banner fires when the server cannot say who wrote it');
  clearEvents(); clearCloudLatch();
  store.clear();
  store.set(LS_DOC, JSON.stringify(DOC('third state again')));
  store.set(LS_DOC_VER, '15|tabA');
  const outAbsent = handlePushResult(
    { ok: false, stale: true, doc: DOC('cloud side'), version: 15 }, // pre-updated_by server: field absent
    DOC('refused side')
  );
  ok(outAbsent.conflict === true && outAbsent.sameUser !== true, 'su4c. field ABSENT (old server) → real-conflict treatment');
  eq(eventsOfType(EVT_CLOUD_CONFLICT).length, 1, 'su4d. banner fires against an old server too');
  eq(eventsOfType(EVT_CLOUD_CONFLICT_OWN).length, 0, 'su4e. still no calm event');
  clearCloudLatch();
}

/* ── (su5) BENIGN guard still wins first: identical content + same user → no snapshots, no events ─ */
{
  store.clear(); clearEvents(); clearCloudLatch();
  window.__wpCurrentUserId = ME;
  const doc = DOC('same words both sides');
  const out = handlePushResult(
    { ok: false, stale: true, doc, version: 7, updatedBy: ME },
    DOC('same words both sides')
  );
  ok(out.conflict === false && out.benign === true, 'su5a. content-identical guard untouched (benign, not own-conflict)');
  eq(conflictKeys().length, 0, 'su5b. no snapshots burned on benign');
  eq(eventsOfType(EVT_CLOUD_CONFLICT_OWN).length, 0, 'su5c. benign does not emit the own-conflict note');
  eq(eventsOfType(EVT_CLOUD_SAVED).length, 1, 'su5d. honest wp-cloud-saved as before');
  ok(isCloudLatched() === false, 'su5e. no latch on benign');
}

/* ── (su6) isOwnCloudConflict is proof-or-nothing (pure) ────────────────────────────────────────── */
{
  eq(isOwnCloudConflict(ME, ME), true, 'su6a. equal non-empty ids → own');
  eq(isOwnCloudConflict(OTHER, ME), false, 'su6b. different ids → not own');
  eq(isOwnCloudConflict(null, ME), false, 'su6c. null updatedBy → not own');
  eq(isOwnCloudConflict('', ME), false, 'su6d. empty updatedBy → not own');
  eq(isOwnCloudConflict(ME, null), false, 'su6e. no self id → not own');
  eq(isOwnCloudConflict(ME, ''), false, 'su6f. empty self id → not own');
  eq(isOwnCloudConflict(undefined, undefined), false, 'su6g. both unknown → not own');
  eq(isOwnCloudConflict(123, 123), false, 'su6h. non-string ids → not own (type-strict)');
  window.__wpCurrentUserId = ME;
  eq(currentCloudUserId(), ME, 'su6i. currentCloudUserId reads the library-published global');
  window.__wpCurrentUserId = null;
  eq(currentCloudUserId(), null, 'su6j. null global → identity unknown');
}

/* ── (su7) pushDoc carries the 409 body's updated_by through as updatedBy ───────────────────────── */
{
  store.clear(); clearEvents(); clearCloudLatch();
  const fetch409 = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: { code: 'STALE' }, doc: DOC('cloud copy'), version: 9, updated_by: ME }),
  });
  const res = await pushDoc(DOC('mine'), 8, fetch409);
  ok(res.ok === false && res.stale === true, 'su7a. 409 still reads as stale');
  eq(res.updatedBy, ME, 'su7b. updatedBy parsed from the 409 body');
  eq(res.version, 9, 'su7c. version intact');
  const fetch409NoAttr = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: { code: 'STALE' }, doc: DOC('cloud copy'), version: 9 }),
  });
  const res2 = await pushDoc(DOC('mine'), 8, fetch409NoAttr);
  eq(res2.updatedBy, null, 'su7d. absent updated_by (old server) → null, never undefined-truthiness surprises');
  const fetch409Junk = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: { code: 'STALE' }, doc: DOC('cloud copy'), version: 9, updated_by: 42 }),
  });
  const res3 = await pushDoc(DOC('mine'), 8, fetch409Junk);
  eq(res3.updatedBy, null, 'su7e. non-string updated_by coerced to null (proof-or-nothing)');
}

console.log(`same-user-conflict: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
