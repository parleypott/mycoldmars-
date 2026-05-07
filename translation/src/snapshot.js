// Local snapshot vault — last-resort recovery if Supabase loses a write
// (network partition, browser crash mid-save, etc).
//
// On every successful save, we mirror the payload to localStorage under
// mcm_snap_{transcriptId} alongside the server's updated_at. On load,
// if the local snapshot has a NEWER updated_at than the server returned,
// we prompt the user to restore.
//
// We cap total snapshot bytes at ~4 MB and number of distinct transcripts
// at 10 to stay well under typical localStorage quota. LRU eviction.

const PREFIX = 'mcm_snap_';
const INDEX_KEY = 'mcm_snap_index'; // ordered list of transcriptIds, newest first
const MAX_TRANSCRIPTS = 10;
const MAX_BYTES = 4 * 1024 * 1024;

function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
  } catch { return []; }
}

function writeIndex(index) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); } catch {}
}

function snapKey(id) { return PREFIX + id; }

/**
 * Save a snapshot for a transcript.
 *
 * @param {string} transcriptId — required for cloud-tracked transcripts
 * @param {object} payload — same shape gatherState() returns
 * @param {string|null} updatedAt — server's updated_at after save succeeded.
 *   Pass `null` to mark this snapshot as "dirty" (unsaved work that never
 *   made it to the cloud — used for crash recovery when autosave is failing).
 */
export function saveSnapshot(transcriptId, payload, updatedAt) {
  if (!transcriptId) return;
  const record = {
    transcriptId,
    payload,
    updatedAt,
    savedAt: new Date().toISOString(),
    dirty: !updatedAt, // true = local edits not confirmed by server
  };
  const json = JSON.stringify(record);

  // If too big to fit at all, skip — better than crashing the app.
  if (json.length > MAX_BYTES) return;

  // Evict oldest until this fits AND we're under the transcript cap.
  let index = readIndex().filter(id => id !== transcriptId);
  index.unshift(transcriptId);

  while (index.length > MAX_TRANSCRIPTS) {
    const evict = index.pop();
    try { localStorage.removeItem(snapKey(evict)); } catch {}
  }

  // Try the write. If quota exceeded, evict more and retry.
  let attempts = 0;
  while (attempts < MAX_TRANSCRIPTS) {
    try {
      localStorage.setItem(snapKey(transcriptId), json);
      writeIndex(index);
      return;
    } catch (err) {
      if (err && err.name === 'QuotaExceededError') {
        if (index.length <= 1) return; // can't shrink further
        const evict = index.pop();
        try { localStorage.removeItem(snapKey(evict)); } catch {}
        attempts++;
        continue;
      }
      console.warn('[snapshot] save failed:', err);
      return;
    }
  }
}

/**
 * Load a snapshot if one exists for this transcript.
 * @returns {object|null} { transcriptId, payload, updatedAt, savedAt }
 */
export function loadSnapshot(transcriptId) {
  if (!transcriptId) return null;
  try {
    const raw = localStorage.getItem(snapKey(transcriptId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

/**
 * Discard a snapshot (after successful restore or explicit dismissal).
 */
export function clearSnapshot(transcriptId) {
  if (!transcriptId) return;
  try {
    localStorage.removeItem(snapKey(transcriptId));
    const index = readIndex().filter(id => id !== transcriptId);
    writeIndex(index);
  } catch {}
}

/**
 * Should we offer to restore this snapshot?
 *
 * Returns true when:
 *   - The snapshot is dirty (`snap.dirty === true`) — by definition it
 *     contains edits that never made it to the server, so always offer.
 *   - The snapshot's updatedAt is strictly newer than the server's.
 *
 * Returns false otherwise (snapshot is stale or matches the server).
 */
export function isSnapshotNewerThan(snap, serverUpdatedAt) {
  if (!snap) return false;
  if (snap.dirty) return true; // unsaved local work — always offer to restore
  if (!snap.updatedAt) return false;
  if (!serverUpdatedAt) return true;
  return new Date(snap.updatedAt).getTime() > new Date(serverUpdatedAt).getTime();
}

// ──────────────────────────────────────────────────────────────────────────
// Draft snapshot — for the pre-id window between a media upload + the first
// successful save. Until the server returns a transcript id, we have no key
// to use for the regular indexed snapshots, so we'd silently drop the work
// on tab close if the first save fails. Draft snapshot fills that gap with
// a single fixed key. Cleared as soon as a real id exists.
// ──────────────────────────────────────────────────────────────────────────
const DRAFT_KEY = 'mcm_draft_snapshot';

export function saveDraftSnapshot(payload) {
  const record = {
    payload,
    savedAt: new Date().toISOString(),
  };
  try {
    const json = JSON.stringify(record);
    if (json.length > MAX_BYTES) return;
    localStorage.setItem(DRAFT_KEY, json);
  } catch {}
}

export function loadDraftSnapshot() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function clearDraftSnapshot() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

/**
 * Diagnostic: how many snapshots and roughly how much storage they use.
 */
export function snapshotStats() {
  const index = readIndex();
  let bytes = 0;
  for (const id of index) {
    const v = localStorage.getItem(snapKey(id));
    if (v) bytes += v.length;
  }
  return { count: index.length, bytes };
}
