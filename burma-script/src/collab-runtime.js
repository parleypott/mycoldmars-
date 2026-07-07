// Burma Script Tool — COLLAB RUNTIME (Phase 1, Liveblocks + Yjs). Heavy module: yjs, liveblocks,
// and the tiptap collaboration extensions live HERE and only here. Loaded via dynamic import from
// collab.js's prepareCollab() when the episode's `collab` flag is on — a non-collab session never
// fetches these bytes (vite parks them in the 'collab-vendor' chunk).
//
// SPIKE GROUND TRUTH (proven, do not re-derive):
//   • the custom schema round-trips through Yjs losslessly; NodeViews dispatch real PM
//     transactions and flow through the binding untouched — NO schema changes needed.
//   • history must be OFF in collab (Collaboration ships its own Y.UndoManager undo/redo).
//   • each room is seeded ONCE from the current cloud doc via prosemirrorJSONToYDoc; after
//     that the Y.Doc is canonical. Seeding must NEVER touch a non-empty room (shouldSeedRoom).

import * as Y from 'yjs';
import { createClient } from '@liveblocks/client';
import { LiveblocksYjsProvider } from '@liveblocks/yjs';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { UndoViewportGuard } from './extensions/undo-viewport-guard.js';
import { buildSeedUpdate } from './collab-seed.js';
import { isRemoteEchoTransaction } from './collab-echo.js';
import { makeCollabAnchorAdapter } from './collab-anchors.js';
import { setImageDropCollabAnchors } from './extensions/image-drop.js';
import { collabRoomId, shouldSeedRoom } from './collab.js';
import { providerSynced } from './collab-sync-wait.js';
import { fetchCloud } from './cloud-sync.js';
import { ensureTableDoc } from './document-builder.js';
import { primeVersionFloor } from './migrate-doc.js';

const AUTH_ENDPOINT = '/api/liveblocks-auth';
// The Yjs fragment tiptap's Collaboration extension binds by default ({ field: 'default' }).
const Y_FIELD = 'default';
// Room-level metadata map — carries the one-shot seed marker so two clients can't double-seed.
const META_MAP = 'wp-collab-meta';

// Caret fallback palette (mirrors presence.js) — replaced by the server-issued identity color the
// moment the room connects and getSelf().info arrives.
const CARET_COLORS = ['#2b7fff', '#9b59d0', '#1f8a72', '#d4703a', '#c0405f', '#5c7cc0', '#b0431f'];
function fallbackCaretUser() {
  const color = CARET_COLORS[Math.floor(Math.random() * CARET_COLORS.length)];
  return { name: 'someone', color };
}

// providerSynced (the "is the room's emptiness KNOWN?" gate) is extracted to ./collab-sync-wait.js
// — it's the one dep-free, load-bearing decision in this heavy module, so it lives where a plain
// node test can lock it. Imported above; behavior here is byte-identical to the old inline copy.

// ONE-SHOT ROOM SEED. Called from the editor's onCreate in collab mode. Await initial sync, then
// seed the Y.Doc from the current cloud doc ONLY IF the room is genuinely empty (no fragment
// nodes, no seed marker). The seed content + marker land in a SINGLE Yjs transaction, so a racing
// second client sees either nothing or both. The cloud doc stays the seed source of truth; a
// non-empty room is never touched (shouldSeedRoom is the structural guard). NEVER throws.
export async function seedRoomIfEmpty(session, editor) {
  try {
    const synced = await providerSynced(session.provider);
    if (!synced) return { seeded: false, reason: 'not-synced' };
    const fragment = session.yDoc.getXmlFragment(Y_FIELD);
    const meta = session.yDoc.getMap(META_MAP);
    const already = !!meta.get('seeded');
    if (fragment.length > 0 || already) {
      return { seeded: false, reason: fragment.length > 0 ? 'room-not-empty' : 'already-seeded' };
    }
    // Fetch the canonical cloud doc (same GET the save engine uses). Wrapped through ensureTableDoc
    // so a pre-table-spine cloud doc seeds in the exact shape the live editor renders.
    const cloud = await fetchCloud();
    if (!cloud || cloud.ok !== true) return { seeded: false, reason: 'cloud-unavailable' };
    const seedDoc = cloud.doc != null ? ensureTableDoc(cloud.doc) : null;
    if (!shouldSeedRoom({ fragmentLength: fragment.length, alreadySeeded: !!meta.get('seeded'), cloudDoc: seedDoc })) {
      return { seeded: false, reason: 'nothing-to-seed' };
    }
    // LAST-MOMENT RE-CHECK — another client may have seeded while we awaited the cloud GET.
    if (fragment.length > 0 || meta.get('seeded')) return { seeded: false, reason: 'raced' };
    // Deterministic seed (collab-seed.js): two clients racing past every check above build
    // byte-identical updates, so the loser's apply is a Yjs no-op instead of a full duplication.
    const update = buildSeedUpdate(editor.schema, seedDoc, cloud.version || 0, Y_FIELD);
    session.yDoc.transact(() => {
      Y.applyUpdate(session.yDoc, update);
      meta.set('seeded', true);
      meta.set('seededFrom', 'cloud@v' + (cloud.version || 0));
      meta.set('seededAt', Date.now());
    }, 'wp-collab-seed');
    // Keep the local snapshot version stamps ahead of the cloud so the periodic read-only snapshot
    // pushes are accepted (strictly-greater rule) instead of bouncing 409 until they catch up.
    try { primeVersionFloor(cloud.version); } catch {}
    console.info('[burma] collab: seeded room ' + session.roomId + ' from cloud v' + (cloud.version || 0));
    return { seeded: true, version: cloud.version || 0 };
  } catch (e) {
    console.warn('[burma] collab: room seed failed (room left untouched):', e);
    return { seeded: false, reason: 'error' };
  }
}

// Keep the caret label/color in lockstep with the SERVER-ISSUED identity (the auth endpoint's
// userInfo: real display_name + color from user_profiles). getSelf() is only populated once the
// room connection completes AND presence settles — which can land before OR after the editor's
// onCreate — so we apply now, on every status flip to connected, and on a short bounded retry
// ladder (covers the "connected before we subscribed, self not yet populated at first apply"
// race the live two-browser test surfaced). Returns an unsubscribe fn.
export function wireCaretIdentity(session, editor) {
  let applied = false;
  const apply = () => {
    if (applied) return;
    try {
      const info = session.room.getSelf()?.info;
      if (info && (info.name || info.color) && editor && !editor.isDestroyed) {
        editor.commands.updateUser({
          name: info.name || 'teammate',
          color: info.color || CARET_COLORS[0],
        });
        applied = true;
      }
    } catch {}
  };
  apply();
  let unsub = null;
  try {
    unsub = session.room.subscribe('status', (s) => { if (s === 'connected') apply(); });
  } catch {}
  const timers = [500, 1500, 4000, 10000].map((ms) => setTimeout(apply, ms));
  return () => {
    try { unsub && unsub(); } catch {}
    for (const t of timers) clearTimeout(t);
  };
}

// Build the live collab session for the ACTIVE episode. Synchronous: enterRoom and the Yjs
// provider connect in the background; tiptap binds to the (initially empty) Y.Doc immediately
// and fills in as sync arrives. Called once per page load via collab.js's prepareCollab().
export function createCollabSession() {
  const roomId = collabRoomId();
  const client = createClient({ authEndpoint: AUTH_ENDPOINT });
  const { room, leave } = client.enterRoom(roomId);
  const yDoc = new Y.Doc();
  const provider = new LiveblocksYjsProvider(room, yDoc);

  // SYNC-KNOWN TRACKING (blank-editor guard). Until the provider completes its initial sync the
  // local Y.Doc is an EMPTY SHELL, not the script — a connect/auth failure used to leave a blank
  // editable editor whose first keystroke became a near-empty snapshot that the 20s cloud mirror
  // then pushed OVER the real script. Editor.jsx gates editability + every save path on this.
  // Unlike providerSynced (one-shot, timeout-bounded, seed-scoped), this listens forever: a room
  // that syncs after a slow reconnect still flips the editor live.
  let syncKnown = !!provider.synced;
  const syncListeners = new Set();
  const markSynced = () => {
    if (syncKnown) return;
    syncKnown = true;
    for (const listener of syncListeners) {
      try { listener(); } catch (err) { console.warn('[burma] collab: onSynced listener threw:', err); }
    }
    syncListeners.clear();
  };
  try { provider.on('synced', markSynced); } catch {}

  const session = {
    roomId,
    client,
    room,
    leave,
    yDoc,
    provider,
    // The two tiptap extensions the editor adds in collab mode. Built here so Editor.jsx never
    // has to import the heavy packages itself.
    extensions() {
      return [
        Collaboration.configure({ document: yDoc }),
        CollaborationCaret.configure({ provider, user: fallbackCaretUser() }),
        // UNDO VIEWPORT GUARD — y-tiptap's undo can fail its selection restore and let the
        // caret map to the DOC END, then scrollIntoView slams the viewport to the bottom of
        // the script. The guard snaps a mis-restored caret back to the undone-change site
        // (selection-only appended tr, never touches the doc). Lives HERE (not Editor.jsx)
        // because it imports @tiptap/y-tiptap: only the collab chunk may carry that dep.
        UndoViewportGuard,
      ];
    },
    seedIfEmpty(editor) { return seedRoomIfEmpty(session, editor); },
    wireCaretIdentity(editor) { return wireCaretIdentity(session, editor); },
    // Editor.jsx's onUpdate asks this instead of importing ySyncPluginKey itself (bundle law:
    // @tiptap/y-tiptap stays in the collab chunk). True = a teammate's edit echoing in through
    // the Yjs binding — nothing THIS tab needs to persist.
    isRemoteEcho(transaction) { return isRemoteEchoTransaction(transaction); },
    // TRUE once the room's content is KNOWN (initial sync completed). Before that the Y.Doc's
    // emptiness means nothing and no save path may treat the editor JSON as the script.
    hasSynced() { return syncKnown || !!provider.synced; },
    // Fires fn once, when sync first completes (immediately if already synced). Returns unsubscribe.
    onSynced(fn) {
      if (session.hasSynced()) { try { fn(); } catch {} return () => {}; }
      syncListeners.add(fn);
      return () => syncListeners.delete(fn);
    },
    destroy() {
      try { provider.destroy(); } catch {}
      try { leave(); } catch {}
    },
  };
  // Arm image-drop's placeholder anchors: in a collab session, upload placeholders must pin to
  // Yjs relative positions or the first remote keystroke (a full-doc y-sync replace) kills them.
  setImageDropCollabAnchors(makeCollabAnchorAdapter());

  console.info('[burma] collab: entering room ' + roomId + ' (Liveblocks + Yjs; Y.Doc is canonical)');
  // Diagnostics seam (mirrors gate.js's window.__wpCurrentUserId): lets the console / an E2E test
  // inspect the live room, provider, and identity without importing module internals.
  try { if (typeof window !== 'undefined') window.__wpCollabSession = session; } catch {}
  return session;
}
