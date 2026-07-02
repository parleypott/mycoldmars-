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

import { saveDoc, setReloadingForAdopt } from './migrate-doc.js';
import { snapshotLocalConflictAsync } from './cloud-sync.js';
import { readSnapshotAsync } from './recovery.js';

// Normalize a snapshot payload to the ProseMirror doc body saveDoc expects.
export function snapshotDocBody(parsed) {
  if (parsed == null) return null;
  if (parsed.type === 'doc') return parsed;
  if (parsed.doc && parsed.doc.type === 'doc') return parsed.doc;
  return parsed; // best-effort: hand back whatever we have
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
  } = deps;

  if (!snap || !snap.key) return { ok: false, reason: 'no-snapshot' };

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

  // 3. ADOPT via the canonical saveDoc path.
  let res;
  try { res = save(body); } catch { res = { ok: false }; }
  if (!res || !res.ok) {
    return { ok: false, reason: 'restore-write-failed', backupKey, backedUp: true, writeResult: res };
  }

  // 4. Arm the reload guard so the teardown flush can't resurrect the pre-restore in-memory doc, then
  //    reload — the editor re-seeds from the restored doc.
  try { armReloadGuard(); } catch {}
  try { reload(); } catch {}
  return { ok: true, backupKey, backedUp: true, restoredKey: snap.key };
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
  } = deps;

  const body = snapshotDocBody(docBody);
  if (body == null) return { ok: false, reason: 'no-doc' };

  // 1. BACK UP the current live doc FIRST — must land before we overwrite it (mirrors restoreSnapshot).
  let backupKey = null;
  try { backupKey = await backupCurrent(); } catch { backupKey = null; }
  if (!backupKey) return { ok: false, reason: 'backup-failed', backedUp: false };

  // 2. ADOPT via the canonical saveDoc path.
  let res;
  try { res = save(body); } catch { res = { ok: false }; }
  if (!res || !res.ok) {
    return { ok: false, reason: 'restore-write-failed', backupKey, backedUp: true, writeResult: res };
  }

  // 3. Arm the reload guard so the teardown flush can't resurrect the pre-restore in-memory doc, reload.
  try { armReloadGuard(); } catch {}
  try { reload(); } catch {}
  return { ok: true, backupKey, backedUp: true };
}

function defaultReload() {
  try { if (typeof location !== 'undefined' && location.reload) location.reload(); } catch {}
}
