// Burma Script Tool — COLLAB GATE (Phase 1, Liveblocks + Yjs).
//
// This module is deliberately LIGHT: no yjs, no liveblocks, no tiptap imports — just the flag
// gate, the room-id convention, the pure seed decision, and the session holder. The heavy
// realtime runtime (collab-runtime.js) is loaded via dynamic import ONLY when the episode's
// `collab` feature flag is on, so a non-collab session ships ZERO extra bytes and behaves
// byte-identically to the pre-collab engine.
//
// THE CONTRACT (spike-proven, 2026-07):
//   • flag OFF  -> nothing here ever runs beyond isCollabEnabled() returning false. The editor
//                  keeps the full single-writer engine: WP-12 history, 300ms flushSave, version-CAS
//                  cloud push, cross-tab conflict banner — all unchanged.
//   • flag ON   -> main.jsx awaits prepareCollab() before render; the editor then mounts with
//                  Collaboration (Yjs doc canonical) + CollaborationCaret, history OFF (Yjs ships
//                  its own UndoManager), and the save engine is DEMOTED (not deleted) to a local
//                  durability snapshot + a periodic read-only cloud snapshot (version history /
//                  export / recovery all keep working; the 409/adopt-reload conflict machinery is
//                  retired for the session because Yjs merges instead of conflicting).
//   • read-only (`?read`/`?view`) NEVER enters collab — a reader stays on the frozen share path.

import { episodeFlag, getEpisode } from './episode-config.js';
import { isReadOnly } from './read-mode.js';

// Is this session a collab session? Flag is per-episode (config `features.collab`); read-only
// share links are always excluded. NEVER throws.
export function isCollabEnabled() {
  try {
    return !!(episodeFlag('collab') && !isReadOnly());
  } catch {
    return false;
  }
}

// The room id convention: `script-<projectSlugOrId>`. The episode id IS the project ref the
// generalized cloud endpoint routes on (burma / palau / palau2 / a library row's uuid), so the
// room namespace lines up 1:1 with /api/script-doc?project=<same ref>.
export function collabRoomId(episode = getEpisode()) {
  return 'script-' + String(episode?.id || 'unknown');
}

// PURE — should we seed the room's Y.Doc from the cloud doc? ONLY when the room is genuinely
// empty (fragment has no nodes AND no prior seed marker) and the cloud actually has content.
// This is the guard that makes seeding structurally incapable of overwriting a live room.
// Exported for tests.
export function shouldSeedRoom({ fragmentLength, alreadySeeded, cloudDoc }) {
  if (alreadySeeded) return false;
  if (Number(fragmentLength) > 0) return false;
  if (!cloudDoc || typeof cloudDoc !== 'object') return false;
  if (!Array.isArray(cloudDoc.content) || cloudDoc.content.length === 0) return false;
  return true;
}

// ── SESSION HOLDER ────────────────────────────────────────────────────────────────────────────
// main.jsx prepares the session ASYNC before render; Editor.jsx reads it SYNC at mount. A null
// session (flag off, runtime failed to load, network down) means the editor falls back to the
// full single-writer engine — collab failure can never brick the editor.
let _session = null;

export async function prepareCollab() {
  if (!isCollabEnabled()) return null;
  if (_session) return _session;
  try {
    const mod = await import('./collab-runtime.js');
    _session = mod.createCollabSession();
  } catch (e) {
    console.warn('[burma] collab runtime failed to load — staying on the single-writer engine:', e);
    _session = null;
  }
  return _session;
}

export function getCollabSession() {
  return _session;
}

// TEST SEAM ONLY — lets a test install/clear a fake session without loading the runtime.
export function __setCollabSessionForTest(s) {
  _session = s ?? null;
  return _session;
}
