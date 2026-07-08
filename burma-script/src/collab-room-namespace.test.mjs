/*
 * collab-room-namespace.test.mjs — FRONT-DOOR guardrail from the 2026-07-08 data-loss audit.
 * The room id must be environment-namespaced so a non-production build STRUCTURALLY cannot name
 * the production Liveblocks room. This is the fix for the incident where a localhost editable
 * build joined the live `script-burma` room and Yjs-synced test junk over Johnny's script.
 */
import assert from 'node:assert/strict';
import { collabRoomId } from './collab.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

const BURMA = { id: 'burma' };

ok('production keeps the bare room id (script-burma)', () => {
  assert.equal(collabRoomId(BURMA, 'production'), 'script-burma');
});
ok('preview namespaces to script-burma-preview', () => {
  assert.equal(collabRoomId(BURMA, 'preview'), 'script-burma-preview');
});
ok('development namespaces to script-burma-development', () => {
  assert.equal(collabRoomId(BURMA, 'development'), 'script-burma-development');
});

// THE INCIDENT: any non-production env must NOT be able to name the prod room.
ok('a development build can NEVER name the production room', () => {
  assert.notEqual(collabRoomId(BURMA, 'development'), 'script-burma');
});
ok('a PREVIEW build can NEVER name the production room (the import.meta.env.PROD trap)', () => {
  assert.notEqual(collabRoomId(BURMA, 'preview'), 'script-burma');
});
ok('every collab episode is namespaced the same way', () => {
  for (const id of ['burma', 'palau', 'palau2']) {
    assert.equal(collabRoomId({ id }, 'production'), `script-${id}`);
    assert.notEqual(collabRoomId({ id }, 'development'), `script-${id}`);
  }
});

console.log(`\ncollab-room-namespace: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
