// Version-history RESTORE — adopt a recovery snapshot as the live doc, SAFELY.
//
// The recovery banner has always let Johnny DOWNLOAD a backup, but never put one back. This adds the
// missing in-app restore. It is as careful as the cloud-adopt path (cloud-sync.js reconcileOnLoad):
//
//   1. BACK UP the CURRENT live doc FIRST to a fresh recovery key — never lose what's on screen. If
//      there IS a live doc and we cannot back it up, we ABORT (mirrors the adopt "must-land" contract).
//   2. READ the chosen snapshot's doc JSON.
//   3. ADOPT it through the SAME canonical write path the cloud-adopt uses: saveDoc() (the ONLY place
//      LS_DOC is written; quota-aware, read-back-verified, fires wp-saved). No storage key is touched
//      directly.
//   4. Arm the reload guard (so the teardown flush cannot clobber the just-restored doc), then reload
//      — the editor re-seeds from the restored doc on the next frame.
//
// Snapshots store the doc JSON directly ({type:'doc',content:[...]}), but tolerate a {doc:...} wrapper.
//
// COLLAB (restore-collab, 2026-07): the adopt+reload path above is a SINGLE-WRITER contract. On a
// collab-flagged project the Yjs room is canonical — saveDoc writes the local snapshot, the page
// reloads, and the room's sync repaints the OLD doc right back: a silent no-op that LIED about
// restoring. So restore now picks a strategy first (decideRestoreStrategy, pure, tested):
//   • single-writer  — collab flag off. Byte-identical to the original adopt+reload path.
//   • collab-live    — a live, SYNCED collab session exists. After the same back-up-current-first
//                      step, the chosen doc is applied INTO the live editor as ONE user-initiated
//                      setContent transaction; the Yjs binding carries it to the room and the
//                      normal collab persistence (onUpdate → flush → snapshot + cloud mirror)
//                      carries it to disk. No reload — the room converges live for everyone.
//                      (COLLAB LOOP LAW: this is a single user-initiated command behind a confirm,
//                      not an auto-dispatching plugin — nothing here reacts to y-sync applies.)
//   • refuse         — collab-flagged but NO live synced session (runtime failed, room unreachable,
//                      still connecting). Restoring into the local store would be the silent lie
//                      again, so we refuse HONESTLY before touching anything.

import { saveDoc, setReloadingForAdopt } from './migrate-doc.js';
import { snapshotLocalConflictAsync } from './cloud-sync.js';
import { readSnapshotAsync } from './recovery.js';
import { isCollabEnabled, getCollabSession } from './collab.js';
import { setEditMode } from './edit-mode.js';

// Normalize a snapshot payload to the ProseMirror doc body saveDoc expects.
export function snapshotDocBody(parsed) {
  if (parsed == null) return null;
  if (parsed.type === 'doc') return parsed;
  if (parsed.doc && parsed.doc.type === 'doc') return parsed.doc;
  return parsed; // best-effort: hand back whatever we have
}

// PURE — which restore path applies? (Exported for tests; see the strategy table in the header.)
//   collabEnabled  — is this a collab-flagged session? (isCollabEnabled(): flag on, not read-only)
//   hasLiveSession — did prepareCollab() produce a live session object? (getCollabSession() != null)
//   synced         — has that session's room completed its initial sync? (session.hasSynced())
export function decideRestoreStrategy({ collabEnabled, hasLiveSession, synced }) {
  if (!collabEnabled) return 'single-writer';
  if (hasLiveSession && synced) return 'collab-live';
  return 'refuse';
}

// Read the LIVE collab state (never throws) and run it through the pure decision above.
function currentRestoreStrategy(deps = {}) {
  const { collabEnabled = isCollabEnabled, getSession = getCollabSession } = deps;
  let enabled = false;
  try { enabled = !!collabEnabled(); } catch { enabled = false; }
  let session = null;
  try { session = getSession() || null; } catch { session = null; }
  let synced = false;
  try { synced = !!(session && typeof session.hasSynced === 'function' && session.hasSynced()); } catch { synced = false; }
  return decideRestoreStrategy({ collabEnabled: enabled, hasLiveSession: !!session, synced });
}

/**
 * COLLAB-LIVE APPLY — put `body` into the live editor as ONE user-initiated transaction.
 * Exported for tests. Returns true only if the write actually landed.
 *   • Restoring is reaching for the pen (same rationale as chapter focus): arm EDIT first, so the
 *     wp-edit-mode listener flips the surface editable synchronously.
 *   • HOUSE LAW — editable:false does NOT gate tiptap commands, so this write path checks
 *     view.editable explicitly instead of trusting the command to refuse.
 *   • emitUpdate:true so the editor's onUpdate fires and the NORMAL collab persistence
 *     (300ms flush → local durability snapshot → periodic cloud mirror) carries the restored doc.
 */
export function applyDocToLiveEditor(editor, body) {
  try {
    if (!editor || editor.isDestroyed || body == null) return false;
    try { setEditMode(true); } catch {}
    if (!editor.view || editor.view.editable === false) return false;
    return editor.commands.setContent(body, { emitUpdate: true }) !== false;
  } catch {
    return false;
  }
}

/**
 * Restore `snap` (a scan result: {key, store, ...}) as the live doc.
 * Returns { ok, reason, backupKey, backedUp, restoredKey }.
 * Deps are injectable for tests; defaults are the real production functions.
 */
export async function restoreSnapshot(snap, deps = {}) {
  const {
    backupCurrent = snapshotLocalConflictAsync,
    readSnap = readSnapshotAsync,
    save = saveDoc,
    armReloadGuard = setReloadingForAdopt,
    reload = defaultReload,
    getEditor = null,
    applyToEditor = applyDocToLiveEditor,
  } = deps;

  if (!snap || !snap.key) return { ok: false, reason: 'no-snapshot' };

  // 0. WHICH PATH? Decided UP FRONT. A collab-flagged project whose live room is unreachable must
  //    refuse HONESTLY before touching anything — the adopt+reload path would silently no-op there
  //    (the Yjs room repaints the old doc right back after the reload).
  const strategy = currentRestoreStrategy(deps);
  if (strategy === 'refuse') return { ok: false, reason: 'collab-unreachable' };

  // 1. BACK UP the current live doc FIRST. This MUST land before we overwrite it — the whole point is
  //    that a restore can never cost Johnny the copy currently on screen. snapshotLocalConflictAsync
  //    returns null only if there is nothing to back up OR storage refused; either way, refusing to
  //    proceed without a backup is the safe choice (never destroy the live doc silently).
  let backupKey = null;
  try { backupKey = await backupCurrent(); } catch { backupKey = null; }
  if (!backupKey) {
    return { ok: false, reason: 'backup-failed', backedUp: false };
  }

  // 2. READ the chosen snapshot.
  let parsed = null;
  try { parsed = await readSnap(snap.key, { store: snap.store }); } catch { parsed = null; }
  const body = snapshotDocBody(parsed);
  if (body == null) {
    return { ok: false, reason: 'snapshot-unreadable', backupKey, backedUp: true };
  }

  // 3a. COLLAB-LIVE — apply into the live editor as ONE user-initiated transaction; the Yjs room
  //     and the normal collab persistence carry it from there. NO saveDoc, NO reload.
  if (strategy === 'collab-live') {
    const editor = typeof getEditor === 'function' ? getEditor() : null;
    const applied = applyToEditor(editor, body);
    if (!applied) return { ok: false, reason: 'collab-apply-failed', backupKey, backedUp: true };
    return { ok: true, backupKey, backedUp: true, restoredKey: snap.key, mode: 'collab-live' };
  }

  // 3b. SINGLE-WRITER — ADOPT via the canonical saveDoc path.
  let res;
  try { res = save(body); } catch { res = { ok: false }; }
  if (!res || !res.ok) {
    return { ok: false, reason: 'restore-write-failed', backupKey, backedUp: true, writeResult: res };
  }

  // 4. Arm the reload guard so the teardown flush can't resurrect the pre-restore in-memory doc, then
  //    reload — the editor re-seeds from the restored doc.
  try { armReloadGuard(); } catch {}
  try { reload(); } catch {}
  return { ok: true, backupKey, backedUp: true, restoredKey: snap.key, mode: 'single-writer' };
}

/**
 * Restore an ALREADY-IN-HAND doc body (e.g. a cloud revision fetched from the version history) as the
 * live doc, through the SAME safe adopt path restoreSnapshot uses — the only difference is the source of
 * the doc (a fetched revision, not a local recovery snapshot). Ordering contract is identical:
 *   1. BACK UP the current live doc FIRST (must land, or ABORT — never cost Johnny what's on screen),
 *   2. ADOPT the given body via the canonical saveDoc path,
 *   3. arm the reload guard, then reload so the editor re-seeds from the restored doc.
 * `docBody` may be a bare ProseMirror doc or a {doc:...} wrapper (snapshotDocBody normalizes both).
 * Returns { ok, reason, backupKey, backedUp }. Deps injectable for tests.
 */
export async function restoreDoc(docBody, deps = {}) {
  const {
    backupCurrent = snapshotLocalConflictAsync,
    save = saveDoc,
    armReloadGuard = setReloadingForAdopt,
    reload = defaultReload,
    getEditor = null,
    applyToEditor = applyDocToLiveEditor,
  } = deps;

  const body = snapshotDocBody(docBody);
  if (body == null) return { ok: false, reason: 'no-doc' };

  // 0. WHICH PATH? Same up-front decision as restoreSnapshot — refuse honestly on a collab-flagged
  //    project with no live synced room, BEFORE touching anything.
  const strategy = currentRestoreStrategy(deps);
  if (strategy === 'refuse') return { ok: false, reason: 'collab-unreachable' };

  // 1. BACK UP the current live doc FIRST — must land before we overwrite it (mirrors restoreSnapshot).
  let backupKey = null;
  try { backupKey = await backupCurrent(); } catch { backupKey = null; }
  if (!backupKey) return { ok: false, reason: 'backup-failed', backedUp: false };

  // 2a. COLLAB-LIVE — one user-initiated setContent into the live editor; the room + the normal
  //     collab persistence carry it. NO saveDoc, NO reload.
  if (strategy === 'collab-live') {
    const editor = typeof getEditor === 'function' ? getEditor() : null;
    const applied = applyToEditor(editor, body);
    if (!applied) return { ok: false, reason: 'collab-apply-failed', backupKey, backedUp: true };
    return { ok: true, backupKey, backedUp: true, mode: 'collab-live' };
  }

  // 2b. SINGLE-WRITER — ADOPT via the canonical saveDoc path.
  let res;
  try { res = save(body); } catch { res = { ok: false }; }
  if (!res || !res.ok) {
    return { ok: false, reason: 'restore-write-failed', backupKey, backedUp: true, writeResult: res };
  }

  // 3. Arm the reload guard so the teardown flush can't resurrect the pre-restore in-memory doc, reload.
  try { armReloadGuard(); } catch {}
  try { reload(); } catch {}
  return { ok: true, backupKey, backedUp: true, mode: 'single-writer' };
}

function defaultReload() {
  try { if (typeof location !== 'undefined' && location.reload) location.reload(); } catch {}
}
