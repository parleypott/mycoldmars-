// Burma Script Tool — DETERMINISTIC ROOM SEED BUILDER. Extracted from collab-runtime.js (same
// posture as collab-sync-wait.js): the one load-bearing decision here must be lockable by a plain
// node test without dragging in liveblocks or the editor runtime.
//
// THE DOUBLE-SEED RACE THIS CLOSES: seedRoomIfEmpty is check-then-set, and Yjs offers no
// cross-client atomicity — two clients can both pass every emptiness check (fragment empty, no
// meta marker, last-moment re-check) and both apply a seed. With prosemirrorJSONToYDoc each
// conversion runs on a fresh Y.Doc with a RANDOM clientID, so the two seed updates are distinct
// CRDT items and Yjs merges them side by side: the entire script duplicates (verified: 2 rows → 4).
//
// THE FIX: build the seed on a Y.Doc whose clientID is a pure hash of (cloud version + seed
// content). Same cloud doc → same clientID → identical insertion order → byte-identical update.
// Yjs dedupes items by (clientID, clock), so applying the "second" seed is a no-op. Two racers
// seeding from DIFFERENT cloud versions hash to different clientIDs and fall back to today's
// merge behavior — but that window (a cloud save landing between two near-simultaneous first
// joins of an empty room) is vanishingly small compared to the simultaneous-join race.

import * as Y from 'yjs';
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap';

// FNV-1a 32-bit over the version-tagged serialized seed. Both clients receive the cloud doc from
// the same GET (identical key order after JSON.parse), and ensureTableDoc is a pure transform, so
// the serialization — and therefore the clientID — is identical across clients.
export function seedClientId(seedDoc, version) {
  const s = String(version) + ':' + JSON.stringify(seedDoc);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Nonzero: yjs treats clientID as an opaque uint32, but 0 is easy to confuse with "unset" in
  // diagnostics. Collision with a live client's random ID is ~n/2^32 and only matters if that
  // client also writes clock 0 — after a successful seed nobody else writes as this actor.
  return (h >>> 0) || 1;
}

// Build the encoded Yjs update that seeds an empty room from the cloud doc. Deterministic:
// identical (seedDoc, version) inputs yield byte-identical updates on every client.
export function buildSeedUpdate(schema, seedDoc, version, field) {
  const seedY = new Y.Doc();
  seedY.clientID = seedClientId(seedDoc, version);
  prosemirrorJSONToYXmlFragment(schema, seedDoc, seedY.getXmlFragment(field));
  const update = Y.encodeStateAsUpdate(seedY);
  seedY.destroy();
  return update;
}
