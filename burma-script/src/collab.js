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

// The build's collab environment, injected by vite `define` from VERCEL_ENV (production /
// preview / development). NOT `import.meta.env.PROD` — that is TRUE for preview deploys too, so a
// Vercel PREVIEW would still name the prod room and clobber the live doc (the 2026-07-08 incident).
// VERCEL_ENV is the only signal that distinguishes prod from preview, and it is immune to
// origin/hash tampering. Defaults to 'development' (localhost `vite dev`, or any missing inject).
export function collabEnv() {
  try {
    const e = import.meta.env?.VITE_COLLAB_ENV;
    return (typeof e === 'string' && e) ? e : 'development';
  } catch { return 'development'; }
}

// The room id convention: `script-<projectSlugOrId>` in PRODUCTION, and
// `script-<projectSlugOrId>-<env>` everywhere else. This is the FRONT-DOOR hard block from the
// 2026-07-08 data-loss audit: a dev/preview build structurally CANNOT name the production room, so
// opening an editable build off-prod can never Yjs-sync into Johnny's live script. The episode id
// still lines up 1:1 with /api/script-doc?project=<ref> in prod. Pure in `env` for the test suite.
export function collabRoomId(episode = getEpisode(), env = collabEnv()) {
  const base = 'script-' + String(episode?.id || 'unknown');
  return env === 'production' ? base : `${base}-${env}`;
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
