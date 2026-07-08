/*
 * restore-collab-decision.test.mjs — restore-collab (2026-07).
 *
 * "RESTORE THIS VERSION" used to silently no-op on collab-enabled projects: the adopt+reload path
 * wrote the local snapshot, the page reloaded, and the Yjs room repainted the OLD doc right back.
 * This locks the strategy split that makes restore REAL on collab and HONEST when it can't be:
 *
 *   • single-writer — collab flag off → byte-identical to the original adopt+reload contract
 *                     (backup FIRST, saveDoc, arm reload guard, reload).
 *   • collab-live   — a live SYNCED session exists → backup FIRST, then apply the chosen doc INTO
 *                     the live editor as ONE user-initiated transaction. NO saveDoc, NO reload —
 *                     the room + the normal collab persistence carry it.
 *   • refuse        — collab-flagged but no live synced room → refuse BEFORE touching anything
 *                     (reason 'collab-unreachable'), instead of the silent lie.
 *
 * All deps are injected, so this drives the real restore.js logic without a browser.
 */
import { decideRestoreStrategy, restoreSnapshot, restoreDoc, applyDocToLiveEditor } from './restore.js';
import { isEditMode, __setEditModeForTest } from './edit-mode.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

const CHOSEN = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'restored' }] }] };
const liveSession = { hasSynced: () => true };
const unsyncedSession = { hasSynced: () => false };

// ── decideRestoreStrategy — the pure decision table ───────────────────────────────────────────────
ok(decideRestoreStrategy({ collabEnabled: false, hasLiveSession: false, synced: false }) === 'single-writer',
  'decide: flag off → single-writer');
ok(decideRestoreStrategy({ collabEnabled: false, hasLiveSession: true, synced: true }) === 'single-writer',
  'decide: flag off wins even with a (stale) session object around');
ok(decideRestoreStrategy({ collabEnabled: true, hasLiveSession: true, synced: true }) === 'collab-live',
  'decide: flag on + live synced session → collab-live');
ok(decideRestoreStrategy({ collabEnabled: true, hasLiveSession: false, synced: false }) === 'refuse',
  'decide: flag on + NO session (runtime failed / never prepared) → refuse');
ok(decideRestoreStrategy({ collabEnabled: true, hasLiveSession: true, synced: false }) === 'refuse',
  'decide: flag on + session that never synced (room unreachable) → refuse');

// ── restoreDoc: COLLAB-LIVE happy path — backup FIRST, then ONE apply into the live editor ─────────
{
  const order = [];
  const fakeEditor = { tag: 'live-editor' };
  const res = await restoreDoc({ doc: CHOSEN, version: 12 }, {
    collabEnabled: () => true,
    getSession: () => liveSession,
    getEditor: () => fakeEditor,
    backupCurrent: async () => { order.push('backup'); return 'k.conflict.backup'; },
    applyToEditor: (editor, body) => {
      order.push('apply');
      ok(editor === fakeEditor, 'collab-live: apply receives the live editor from getEditor');
      ok(body === CHOSEN, 'collab-live: apply receives the NORMALIZED doc body ({doc:...} unwrapped)');
      return true;
    },
    save: () => { order.push('save'); return { ok: true }; },
    armReloadGuard: () => order.push('arm'),
    reload: () => order.push('reload'),
  });
  ok(res.ok === true && res.mode === 'collab-live', 'collab-live: returns ok with mode collab-live');
  ok(order.indexOf('backup') === 0, 'collab-live: current doc backed up FIRST');
  ok(order.indexOf('backup') < order.indexOf('apply'), 'collab-live: backup lands BEFORE the live apply');
  ok(!order.includes('save'), 'collab-live: saveDoc is NEVER called (the room + collab persistence carry it)');
  ok(!order.includes('reload') && !order.includes('arm'), 'collab-live: NO reload, NO reload guard — the room converges live');
  ok(res.backedUp === true && res.backupKey === 'k.conflict.backup', 'collab-live: reports the backup');
}

// ── restoreDoc: REFUSE — collab-flagged, no live room → nothing runs, honest reason ────────────────
{
  const order = [];
  const res = await restoreDoc(CHOSEN, {
    collabEnabled: () => true,
    getSession: () => null, // runtime failed to load / never prepared
    backupCurrent: async () => { order.push('backup'); return 'k'; },
    applyToEditor: () => { order.push('apply'); return true; },
    save: () => { order.push('save'); return { ok: true }; },
    reload: () => order.push('reload'),
  });
  ok(res.ok === false && res.reason === 'collab-unreachable', 'refuse: reports collab-unreachable');
  ok(order.length === 0, 'refuse: NOTHING ran — no backup, no apply, no save, no reload');
}
{
  const order = [];
  const res = await restoreDoc(CHOSEN, {
    collabEnabled: () => true,
    getSession: () => unsyncedSession, // session exists but the room never synced
    backupCurrent: async () => { order.push('backup'); return 'k'; },
    applyToEditor: () => { order.push('apply'); return true; },
    save: () => { order.push('save'); return { ok: true }; },
    reload: () => order.push('reload'),
  });
  ok(res.ok === false && res.reason === 'collab-unreachable', 'refuse(unsynced): reports collab-unreachable');
  ok(order.length === 0, 'refuse(unsynced): nothing ran');
}

// ── restoreDoc: COLLAB-LIVE backup fails → ABORT before the apply (never cost the live doc) ───────
{
  const order = [];
  const res = await restoreDoc(CHOSEN, {
    collabEnabled: () => true,
    getSession: () => liveSession,
    getEditor: () => ({}),
    backupCurrent: async () => { order.push('backup'); return null; }, // storage refused
    applyToEditor: () => { order.push('apply'); return true; },
    reload: () => order.push('reload'),
  });
  ok(res.ok === false && res.reason === 'backup-failed', 'collab-live backup-fail: aborts with backup-failed');
  ok(!order.includes('apply') && !order.includes('reload'), 'collab-live backup-fail: no apply, no reload');
}

// ── restoreDoc: COLLAB-LIVE apply refused → surfaces honestly, no reload, no save ─────────────────
{
  const order = [];
  const res = await restoreDoc(CHOSEN, {
    collabEnabled: () => true,
    getSession: () => liveSession,
    getEditor: () => null, // editor unmounted / destroyed
    backupCurrent: async () => 'k.backup',
    applyToEditor: (editor) => { order.push('apply'); return !!editor; },
    save: () => { order.push('save'); return { ok: true }; },
    reload: () => order.push('reload'),
  });
  ok(res.ok === false && res.reason === 'collab-apply-failed', 'collab-live apply-fail: reports collab-apply-failed');
  ok(res.backedUp === true, 'collab-live apply-fail: the current copy WAS backed up first');
  ok(!order.includes('reload') && !order.includes('save'), 'collab-live apply-fail: no reload, no saveDoc');
}

// ── restoreSnapshot: COLLAB-LIVE — same contract with the snapshot read in between ────────────────
{
  const order = [];
  const res = await restoreSnapshot({ key: 'k.conflict.1', store: 'idb' }, {
    collabEnabled: () => true,
    getSession: () => liveSession,
    getEditor: () => ({ tag: 'ed' }),
    backupCurrent: async () => { order.push('backup'); return 'k.backup'; },
    readSnap: async () => { order.push('read'); return { doc: CHOSEN }; },
    applyToEditor: (editor, body) => {
      order.push('apply');
      ok(body === CHOSEN, 'snapshot collab-live: apply receives the normalized snapshot body');
      return true;
    },
    save: () => { order.push('save'); return { ok: true }; },
    armReloadGuard: () => order.push('arm'),
    reload: () => order.push('reload'),
  });
  ok(res.ok === true && res.mode === 'collab-live' && res.restoredKey === 'k.conflict.1',
    'snapshot collab-live: ok, mode collab-live, reports the restored key');
  ok(order.join(',') === 'backup,read,apply', 'snapshot collab-live: backup → read → apply, and NOTHING else');
}
{
  const order = [];
  const res = await restoreSnapshot({ key: 'k.conflict.1', store: 'idb' }, {
    collabEnabled: () => true,
    getSession: () => null,
    backupCurrent: async () => { order.push('backup'); return 'k'; },
    readSnap: async () => { order.push('read'); return CHOSEN; },
    save: () => { order.push('save'); return { ok: true }; },
    reload: () => order.push('reload'),
  });
  ok(res.ok === false && res.reason === 'collab-unreachable', 'snapshot refuse: reports collab-unreachable');
  ok(order.length === 0, 'snapshot refuse: refused BEFORE the backup — nothing ran');
}

// ── SINGLE-WRITER — flag off: byte-identical to the original contract, apply NEVER consulted ──────
{
  const order = [];
  const res = await restoreDoc(CHOSEN, {
    collabEnabled: () => false,
    getSession: () => liveSession, // must be ignored when the flag is off
    getEditor: () => ({}),
    backupCurrent: async () => { order.push('backup'); return 'k.backup'; },
    applyToEditor: () => { order.push('apply'); return true; },
    save: (doc) => { order.push('save'); ok(doc === CHOSEN, 'single-writer: saveDoc receives the body'); return { ok: true, version: 3 }; },
    armReloadGuard: () => order.push('arm'),
    reload: () => order.push('reload'),
  });
  ok(res.ok === true && res.mode === 'single-writer', 'single-writer: ok with mode single-writer');
  ok(order.join(',') === 'backup,save,arm,reload', 'single-writer: backup → save → arm → reload, apply never called');
}

// ── applyDocToLiveEditor — the ONE user-initiated write into the live editor ──────────────────────
{
  ok(applyDocToLiveEditor(null, CHOSEN) === false, 'apply: null editor refused');
  ok(applyDocToLiveEditor({ isDestroyed: true }, CHOSEN) === false, 'apply: destroyed editor refused');
  ok(applyDocToLiveEditor({ isDestroyed: false, view: { editable: true }, commands: {} }, null) === false,
    'apply: null body refused');

  // HOUSE LAW — editable:false does NOT gate tiptap commands, so the write path must check itself.
  __setEditModeForTest(false);
  const nonEditable = {
    isDestroyed: false,
    view: { editable: false },
    commands: { setContent: () => { fail++; console.log('FAIL apply: setContent ran on a non-editable view'); return true; } },
  };
  ok(applyDocToLiveEditor(nonEditable, CHOSEN) === false, 'apply: non-editable view refused (house law)');

  // Happy path: arms EDIT mode (restoring is reaching for the pen), then ONE setContent with
  // emitUpdate so the normal collab persistence (onUpdate → flush) carries the restored doc.
  __setEditModeForTest(false);
  let got = null;
  const editable = {
    isDestroyed: false,
    view: { editable: true },
    commands: { setContent: (body, opts) => { got = { body, opts }; return true; } },
  };
  ok(applyDocToLiveEditor(editable, CHOSEN) === true, 'apply: editable editor accepts the write');
  ok(got && got.body === CHOSEN, 'apply: setContent receives the doc body');
  ok(got && got.opts && got.opts.emitUpdate === true, 'apply: emitUpdate true — collab persistence must hear it');
  ok(isEditMode() === true, 'apply: arms EDIT mode (restore is reaching for the pen)');

  // A refused setContent surfaces as false.
  const refusing = {
    isDestroyed: false,
    view: { editable: true },
    commands: { setContent: () => false },
  };
  ok(applyDocToLiveEditor(refusing, CHOSEN) === false, 'apply: a refused setContent surfaces as false');
  __setEditModeForTest(false); // leave the module singleton the way we found it
}

console.log(`restore-collab-decision: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
