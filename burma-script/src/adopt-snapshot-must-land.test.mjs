/**
 * SILENT-BYTE-LOSS FIX — adopt-cloud must NOT proceed when the local snapshot fails to land.
 *
 * The bug: on adopt-cloud (cloud strictly newer than an existing local doc), reconcileOnLoad
 * snapshots the local doc to .conflict.<ts> FIRST, then writes the cloud doc via saveDoc and reloads.
 * snapshotLocalConflict() returns NULL (it does not throw) when localStorage refuses under quota /
 * private mode. The old code discarded that return inside `try {} catch {}`, so it proceeded to
 * saveDoc(cloudDoc) — whose quota loop EVICTS the .bak/.conflict backups to make room and SUCCEEDS —
 * then location.reload(). Net result: the unsynced local edit is gone from LS_DOC, NO .conflict
 * snapshot exists, NO banner fires. A word vanishes silently. The bootstrap/adopt tests all stub the
 * snapshot to ALWAYS return a key, so the null/quota branch was untested.
 *
 * The fix: capture snapshotConflict()'s return; if a snapshot was REQUIRED (snapshotLocal) but did
 * NOT land, ABORT — do not prime, do not save, do not reload — and fire the loud wp-save-failed
 * banner. The cloud doc is untouched in the cloud (still adoptable later); local stays on screen.
 *
 * Run: bun src/adopt-snapshot-must-land.test.mjs   (auto-discovered by `bun run test`)
 */

const EVENTS = [];
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = (ev) => { try { EVENTS.push({ type: ev?.type, detail: ev?.detail }); } catch {} return true; };
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };
const eventsOfType = (t) => EVENTS.filter((e) => e.type === t);
const clearEvents = () => { EVENTS.length = 0; };

const { reconcileOnLoad } = await import('./cloud-sync.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
const DOC = (t) => ({ type: 'doc', content: [{ type: 'p', text: t }] });

/* ── THE FIX: snapshot returns null on adopt -> abort, no save, no reload, loud banner ── */
{
  clearEvents();
  const calls = { saved: [], primed: [], snapshots: 0 };
  const r = await reconcileOnLoad({
    readLocal: () => ({ hasDoc: true, version: 2, doc: DOC('local-unsynced-word') }),
    fetchCloud: async () => ({ ok: true, doc: DOC('cloud-newer'), version: 8 }),
    // saveDoc would SUCCEED here (its quota loop evicts backups) — that is exactly the trap. If the
    // abort works, saveDoc must NEVER be called, so this recording proves the doc was never written.
    saveDoc: (doc) => { calls.saved.push(doc); return { ok: true, version: 9 }; },
    primeVersionFloor: (v) => { calls.primed.push(v); },
    // QUOTA: the snapshot refuses to land and returns null (mirrors snapshotLocalConflict under quota).
    snapshotConflict: () => { calls.snapshots++; return null; },
  });

  eq(r.action, 'adopt-cloud', 'A1. decision was still adopt-cloud (cloud is strictly newer)');
  ok(r.aborted === true, 'A2. but the adopt was ABORTED because the snapshot did not land');
  ok(r.wrote === false, 'A3. nothing was written');
  ok(r.shouldReload === false, 'A4. NO reload — local stays on screen (the unsynced word survives)');
  eq(r.reason, 'adopt-snapshot-failed', 'A5. reason names the snapshot failure');
  eq(calls.snapshots, 1, 'A6. snapshot was attempted exactly once');
  eq(calls.saved.length, 0, 'A7. CARDINAL: saveDoc was NEVER called — cloud doc did NOT clobber local');
  eq(calls.primed.length, 0, 'A8. version floor was NOT primed (we aborted before priming)');

  const failed = eventsOfType('wp-save-failed');
  ok(failed.length === 1, 'A9. a LOUD wp-save-failed banner fired (not silent)');
  ok(/storage|space|back up|full/i.test(failed[0]?.detail?.message || ''), 'A10. message explains storage is full and local is kept');
}

/* ── CONTROL: snapshot succeeds -> adopt proceeds exactly as before (no regression) ── */
{
  clearEvents();
  const calls = { saved: [], primed: [], snapshots: 0 };
  const r = await reconcileOnLoad({
    readLocal: () => ({ hasDoc: true, version: 2, doc: DOC('local-older') }),
    fetchCloud: async () => ({ ok: true, doc: DOC('cloud-newer'), version: 8 }),
    saveDoc: (doc) => { calls.saved.push(doc); return { ok: true, version: 9 }; },
    primeVersionFloor: (v) => { calls.primed.push(v); },
    snapshotConflict: () => { calls.snapshots++; return 'wp01_burma_doc_v1.conflict.123-000000'; },
  });
  eq(r.action, 'adopt-cloud', 'B1. snapshot landed -> adopt proceeds');
  ok(r.aborted === undefined || r.aborted === false, 'B2. not aborted');
  ok(r.shouldReload === true, 'B3. reloads to re-seed the adopted cloud doc');
  eq(calls.saved.length, 1, 'B4. cloud doc written via saveDoc');
  eq(calls.primed[0], 8, 'B5. version floor primed to cloud version');
  ok(eventsOfType('wp-save-failed').length === 0, 'B6. no failure banner on the happy path');
}

/* ── SEED (no local doc) never needs a snapshot, so a null snapshot stub is irrelevant there ── */
{
  clearEvents();
  const calls = { saved: [], primed: [], snapshots: 0 };
  const r = await reconcileOnLoad({
    readLocal: () => ({ hasDoc: false, version: 0, doc: null }),
    fetchCloud: async () => ({ ok: true, doc: DOC('cloud'), version: 5 }),
    saveDoc: (doc) => { calls.saved.push(doc); return { ok: true, version: 6 }; },
    primeVersionFloor: (v) => { calls.primed.push(v); },
    snapshotConflict: () => { calls.snapshots++; return null; },
  });
  eq(r.action, 'seed-from-cloud', 'C1. fresh device seeds from cloud');
  ok(r.aborted === undefined || r.aborted === false, 'C2. seed is NOT aborted (no local doc to snapshot)');
  eq(calls.snapshots, 0, 'C3. no snapshot attempted on seed (snapshotLocal is false)');
  eq(calls.saved.length, 1, 'C4. cloud doc seeded');
  ok(r.shouldReload === true, 'C5. reloads to seed');
}

console.log(`\nadopt-snapshot-must-land: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
