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
 */
import { restoreSnapshot, snapshotDocBody } from './restore.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

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

console.log(`restore-flow: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
