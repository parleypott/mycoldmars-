/*
 * restore-flow.test.mjs — Enterprise Wave 1, feature #2.
 *
 * The version-history RESTORE must be as safe as the cloud-adopt path: it can NEVER cost Johnny the
 * copy currently on screen. This locks the ordering contract of restoreSnapshot():
 *
 *   1. the CURRENT live doc is backed up FIRST,
 *   2. and only AFTER that backup lands does the restore write (saveDoc) happen,
 *   3. and if the backup CANNOT land, the restore is ABORTED — no write, no reload.
 *
 * All deps are injected, so this drives the real restore.js ordering logic without a browser.
 *
 * restore-collab (2026-07): restore now picks a strategy first (single-writer / collab-live /
 * refuse — see restore-collab-decision.test.mjs). THIS file locks the SINGLE-WRITER contract, so
 * every call pins `collabEnabled: () => false` (Burma's live config has the collab flag ON, which
 * would otherwise route these through the collab decision instead of the adopt+reload path).
 */
import { restoreSnapshot, restoreDoc, snapshotDocBody } from './restore.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

// Pin the single-writer strategy for every case in this file (spread into each deps object).
const SW = { collabEnabled: () => false };

const CHOSEN = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'restored' }] }] };

// ── snapshotDocBody normalizes both shapes ────────────────────────────────────────────────────────
ok(snapshotDocBody(CHOSEN) === CHOSEN, 'snapshotDocBody: passes a bare doc through');
{
  const wrapped = { doc: CHOSEN, meta: 1 };
  ok(snapshotDocBody(wrapped) === CHOSEN, 'snapshotDocBody: unwraps a {doc:...} snapshot');
}
ok(snapshotDocBody(null) === null, 'snapshotDocBody: null → null');

// ── 1. HAPPY PATH — backup lands BEFORE the restore write, and reload fires ────────────────────────
{
  const order = [];
  const res = await restoreSnapshot({ key: 'k.conflict.1', store: 'idb' }, {
    ...SW,
    backupCurrent: async () => { order.push('backup'); return 'k.conflict.backup'; },
    readSnap: async () => { order.push('read'); return CHOSEN; },
    save: (doc) => { order.push('save'); ok(doc === CHOSEN, 'save receives the chosen doc body'); return { ok: true, version: 7 }; },
    armReloadGuard: () => order.push('arm'),
    reload: () => order.push('reload'),
  });
  ok(res.ok === true, 'happy: returns ok');
  ok(order.indexOf('backup') === 0, 'happy: backup happens FIRST');
  ok(order.indexOf('backup') < order.indexOf('save'), 'happy: current doc snapshotted BEFORE the restore write lands');
  ok(order.indexOf('save') < order.indexOf('reload'), 'happy: write lands before reload');
  ok(order.indexOf('arm') < order.indexOf('reload'), 'happy: reload guard armed before reload');
  ok(res.backupKey === 'k.conflict.backup', 'happy: reports the backup key');
}

// ── 2. BACKUP FAILS — the restore is ABORTED, no write, no reload ──────────────────────────────────
{
  const order = [];
  const res = await restoreSnapshot({ key: 'k.conflict.1', store: 'idb' }, {
    ...SW,
    backupCurrent: async () => { order.push('backup'); return null; }, // storage refused
    readSnap: async () => { order.push('read'); return CHOSEN; },
    save: () => { order.push('save'); return { ok: true }; },
    armReloadGuard: () => order.push('arm'),
    reload: () => order.push('reload'),
  });
  ok(res.ok === false && res.reason === 'backup-failed', 'backup-fail: aborts with backup-failed');
  ok(!order.includes('save'), 'backup-fail: the restore write NEVER happens without a backup');
  ok(!order.includes('reload'), 'backup-fail: no reload');
}

// ── 3. SNAPSHOT UNREADABLE — backed up, but nothing to restore; no write ──────────────────────────
{
  const order = [];
  const res = await restoreSnapshot({ key: 'k.conflict.1', store: 'idb' }, {
    ...SW,
    backupCurrent: async () => { order.push('backup'); return 'k.backup'; },
    readSnap: async () => { order.push('read'); return null; },
    save: () => { order.push('save'); return { ok: true }; },
    armReloadGuard: () => order.push('arm'),
    reload: () => order.push('reload'),
  });
  ok(res.ok === false && res.reason === 'snapshot-unreadable', 'unreadable: reports snapshot-unreadable');
  ok(order.includes('backup') && !order.includes('save'), 'unreadable: backed up but never wrote');
  ok(res.backedUp === true, 'unreadable: still confirms the current copy was backed up');
}

// ── 4. WRITE REFUSED — surfaces, does not reload, current copy backed up ──────────────────────────
{
  const order = [];
  const res = await restoreSnapshot({ key: 'k.conflict.1', store: 'idb' }, {
    ...SW,
    backupCurrent: async () => { order.push('backup'); return 'k.backup'; },
    readSnap: async () => CHOSEN,
    save: () => { order.push('save'); return { ok: false, reason: 'cross-tab-conflict' }; },
    armReloadGuard: () => order.push('arm'),
    reload: () => order.push('reload'),
  });
  ok(res.ok === false && res.reason === 'restore-write-failed', 'write-refused: reports restore-write-failed');
  ok(!order.includes('reload'), 'write-refused: no reload on a refused write');
}

// ── 5. NO SNAPSHOT — guard ────────────────────────────────────────────────────────────────────────
{
  const res = await restoreSnapshot(null, {});
  ok(res.ok === false && res.reason === 'no-snapshot', 'no-snapshot: guarded');
}

/* ── restoreDoc — the CLOUD-revision restore (an in-hand doc, same safe adopt path) ────────────────── */

// R1. HAPPY PATH — backup FIRST, then adopt the given body, then reload.
{
  const order = [];
  const res = await restoreDoc(CHOSEN, {
    ...SW,
    backupCurrent: async () => { order.push('backup'); return 'k.conflict.backup'; },
    save: (doc) => { order.push('save'); ok(doc === CHOSEN, 'restoreDoc: save receives the given body'); return { ok: true, version: 9 }; },
    armReloadGuard: () => order.push('arm'),
    reload: () => order.push('reload'),
  });
  ok(res.ok === true, 'restoreDoc happy: returns ok');
  ok(order.indexOf('backup') === 0, 'restoreDoc happy: current doc backed up FIRST');
  ok(order.indexOf('backup') < order.indexOf('save'), 'restoreDoc happy: backup lands BEFORE the restore write');
  ok(order.indexOf('save') < order.indexOf('reload'), 'restoreDoc happy: write before reload');
  ok(order.indexOf('arm') < order.indexOf('reload'), 'restoreDoc happy: reload guard armed before reload');
}

// R2. BACKUP FAILS — aborted, no write, no reload (never cost Johnny the live doc).
{
  const order = [];
  const res = await restoreDoc(CHOSEN, {
    ...SW,
    backupCurrent: async () => { order.push('backup'); return null; },
    save: () => { order.push('save'); return { ok: true }; },
    armReloadGuard: () => order.push('arm'),
    reload: () => order.push('reload'),
  });
  ok(res.ok === false && res.reason === 'backup-failed', 'restoreDoc backup-fail: aborts');
  ok(!order.includes('save') && !order.includes('reload'), 'restoreDoc backup-fail: no write, no reload');
}

// R3. WRITE REFUSED — surfaces, no reload, current copy backed up.
{
  const order = [];
  const res = await restoreDoc(CHOSEN, {
    ...SW,
    backupCurrent: async () => 'k.backup',
    save: () => { order.push('save'); return { ok: false, reason: 'cross-tab-conflict' }; },
    reload: () => order.push('reload'),
  });
  ok(res.ok === false && res.reason === 'restore-write-failed', 'restoreDoc write-refused: reports it');
  ok(!order.includes('reload'), 'restoreDoc write-refused: no reload');
}

// R4. NO DOC — guarded before any backup.
{
  let backedUp = false;
  const res = await restoreDoc(null, { backupCurrent: async () => { backedUp = true; return 'k'; } });
  ok(res.ok === false && res.reason === 'no-doc', 'restoreDoc: null body guarded');
  ok(backedUp === false, 'restoreDoc: a null body never even backs up');
}

// R5. accepts a {doc:...} wrapper (a cloud revision fetched as {doc,version}).
{
  const order = [];
  const res = await restoreDoc({ doc: CHOSEN, version: 12 }, {
    ...SW,
    backupCurrent: async () => 'k.backup',
    save: (doc) => { order.push('save'); ok(doc === CHOSEN, 'restoreDoc: unwraps {doc:...} before saving'); return { ok: true }; },
    armReloadGuard: () => {},
    reload: () => order.push('reload'),
  });
  ok(res.ok === true && order.includes('save'), 'restoreDoc: wrapped revision body restores');
}

console.log(`restore-flow: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
