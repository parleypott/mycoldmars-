// collab-seed.test.mjs — locks the DOUBLE-SEED fix (the enterprise-audit HIGH: two clients racing
// seedRoomIfEmpty's check-then-set both seeded an empty room and DUPLICATED the entire script,
// verified 2 rows → 4). The fix makes the seed update deterministic (content-hashed clientID), so
// the second racer's apply is a Yjs no-op. Run: bun src/collab-seed.test.mjs
//
// Part 3 keeps the OLD behavior on record: random-clientID conversions really do duplicate when
// both land. If that assertion ever starts failing, yjs changed merge semantics — re-audit.

import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { buildSeedUpdate, seedClientId } from './collab-seed.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

// Same schema construction as block-roundtrip.test.mjs — the live editor's node/mark set.
const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
    history: { depth: 100, newGroupDelay: 750 },
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
]);

const FIELD = 'default';

// A two-row doc in the live table-spine shape — the same "2 rows" the audit watched become 4.
const row = (id, text) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [{
    type: 'tableCell', attrs: { role: 'full' },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }],
});
const seedDoc = { type: 'doc', content: [row('r1', 'first row'), row('r2', 'second row')] };

const fragLen = (doc) => doc.getXmlFragment(FIELD).length;

// --- Part 1: determinism ---------------------------------------------------------------------
ok('same (seedDoc, version) → byte-identical updates across "clients"', () => {
  const a = buildSeedUpdate(schema, seedDoc, 7, FIELD);
  const b = buildSeedUpdate(schema, JSON.parse(JSON.stringify(seedDoc)), 7, FIELD);
  assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
});

ok('different cloud versions → different seed actors (no cross-version ID reuse)', () => {
  assert.notEqual(seedClientId(seedDoc, 7), seedClientId(seedDoc, 8));
});

// --- Part 2: the race, replayed with the fix -------------------------------------------------
ok('two racing seeders leave the room with exactly the seed content (2 rows stay 2)', () => {
  // Client A and client B each independently build + apply the seed to their local Y.Doc,
  // then sync (exchange full state) — the worst-case interleaving of the verified race.
  const clientA = new Y.Doc();
  const clientB = new Y.Doc();
  clientA.transact(() => Y.applyUpdate(clientA, buildSeedUpdate(schema, seedDoc, 7, FIELD)), 'wp-collab-seed');
  clientB.transact(() => Y.applyUpdate(clientB, buildSeedUpdate(schema, seedDoc, 7, FIELD)), 'wp-collab-seed');
  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB));
  Y.applyUpdate(clientB, Y.encodeStateAsUpdate(clientA));

  assert.equal(fragLen(clientA), 2, 'client A sees 2 rows');
  assert.equal(fragLen(clientB), 2, 'client B sees 2 rows');
  // Converged AND content-identical to the seed.
  const json = yXmlFragmentToProsemirrorJSON(clientA.getXmlFragment(FIELD));
  assert.equal(json.content.length, 2);
  assert.deepEqual(
    yXmlFragmentToProsemirrorJSON(clientB.getXmlFragment(FIELD)),
    json,
  );
});

ok('double-apply on ONE client is a no-op too (retry / re-entrant seed)', () => {
  const doc = new Y.Doc();
  const update = buildSeedUpdate(schema, seedDoc, 7, FIELD);
  Y.applyUpdate(doc, update);
  Y.applyUpdate(doc, update);
  assert.equal(fragLen(doc), 2);
});

// --- Part 3: the OLD path really was the bug -------------------------------------------------
ok('regression record: random-clientID seeds (old prosemirrorJSONToYDoc path) DO duplicate', () => {
  const clientA = new Y.Doc();
  const clientB = new Y.Doc();
  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, seedDoc, FIELD)));
  Y.applyUpdate(clientB, Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, seedDoc, FIELD)));
  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB));
  assert.equal(fragLen(clientA), 4, 'old path: 2 rows become 4 — the audited bug');
});

console.log('collab-seed: ' + pass + '/5 passed');
