// Tests for burma-script/src/collab.js — the collab GATE (flag, room id, seed decision).
//
// These lock the three structural guarantees the whole Phase 1 rests on:
//   1. FLAG GATING — collab is per-episode opt-in (features.collab) and read-only sessions can
//      NEVER enter collab even on a collab-enabled episode.
//   2. ROOM CONVENTION — room id is `script-<episode id>`, 1:1 with the cloud endpoint's
//      ?project=<ref>, for legacy slugs AND library uuids alike.
//   3. SEED-ONLY-WHEN-EMPTY — the pure decision that makes room seeding structurally incapable
//      of overwriting a non-empty room or seeding junk.
//
// Run: bun burma-script/src/collab.test.mjs
import assert from 'node:assert';

const { setEpisode } = await import('./episode-config.js');
const { __setReadOnlyForTest } = await import('./read-mode.js');
const { isCollabEnabled, collabRoomId, shouldSeedRoom, getCollabSession, __setCollabSessionForTest } =
  await import('./collab.js');

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

const episode = (id, features = {}) => ({
  id, title: id, storage: { DOC: `t_${id}_doc_v1`, DOC_VER: `t_${id}_doc_ver_v1` },
  cloud: { api: `/api/script-doc?project=${id}` }, features,
});

/* ── 1. flag gating ──────────────────────────────────────────────────────── */

ok('flag OFF (absent features / empty features) → collab disabled', () => {
  __setReadOnlyForTest(false);
  setEpisode(episode('plain'));
  assert.equal(isCollabEnabled(), false);
  setEpisode({ ...episode('plain2'), features: undefined });
  assert.equal(isCollabEnabled(), false);
});

ok('flag ON → collab enabled', () => {
  __setReadOnlyForTest(false);
  setEpisode(episode('burma', { collab: true }));
  assert.equal(isCollabEnabled(), true);
});

ok('read-only share NEVER enters collab, even with the flag on', () => {
  setEpisode(episode('burma', { collab: true }));
  __setReadOnlyForTest(true);
  assert.equal(isCollabEnabled(), false);
  __setReadOnlyForTest(false);
  assert.equal(isCollabEnabled(), true);
});

ok('flag value must be truthy — collab:false is off', () => {
  __setReadOnlyForTest(false);
  setEpisode(episode('x', { collab: false }));
  assert.equal(isCollabEnabled(), false);
});

/* ── 2. room convention ──────────────────────────────────────────────────── */

ok('room id is script-<episode id> for slugs and uuids', () => {
  assert.equal(collabRoomId(episode('burma')), 'script-burma');
  assert.equal(collabRoomId(episode('palau2')), 'script-palau2');
  const uuid = '3f2c8a1e-9b4d-4f6a-8c2e-1d5b7a9c0e3f';
  assert.equal(collabRoomId(episode(uuid)), 'script-' + uuid);
});

ok('room id degrades safely on a junk episode (never throws)', () => {
  assert.equal(collabRoomId({}), 'script-unknown');
  assert.equal(collabRoomId(null), 'script-unknown');
});

/* ── 3. seed-only-when-empty ─────────────────────────────────────────────── */

const cloudDoc = { type: 'doc', content: [{ type: 'tableRow', content: [] }] };

ok('seeds ONLY an empty, never-seeded room with a real cloud doc', () => {
  assert.equal(shouldSeedRoom({ fragmentLength: 0, alreadySeeded: false, cloudDoc }), true);
});

ok('a NON-EMPTY room is never seeded (the destructive-overwrite guard)', () => {
  assert.equal(shouldSeedRoom({ fragmentLength: 1, alreadySeeded: false, cloudDoc }), false);
  assert.equal(shouldSeedRoom({ fragmentLength: 228, alreadySeeded: false, cloudDoc }), false);
});

ok('an already-seeded room is never re-seeded, even if it LOOKS empty', () => {
  // (e.g. the team deliberately cleared the doc — a reload must not resurrect the cloud copy)
  assert.equal(shouldSeedRoom({ fragmentLength: 0, alreadySeeded: true, cloudDoc }), false);
});

ok('an empty / missing / junk cloud doc never seeds', () => {
  assert.equal(shouldSeedRoom({ fragmentLength: 0, alreadySeeded: false, cloudDoc: null }), false);
  assert.equal(shouldSeedRoom({ fragmentLength: 0, alreadySeeded: false, cloudDoc: undefined }), false);
  assert.equal(shouldSeedRoom({ fragmentLength: 0, alreadySeeded: false, cloudDoc: { type: 'doc', content: [] } }), false);
  assert.equal(shouldSeedRoom({ fragmentLength: 0, alreadySeeded: false, cloudDoc: { type: 'doc' } }), false);
  assert.equal(shouldSeedRoom({ fragmentLength: 0, alreadySeeded: false, cloudDoc: 'junk' }), false);
});

/* ── session holder ──────────────────────────────────────────────────────── */

ok('session holder: null by default, test-injectable, clearable', () => {
  assert.equal(getCollabSession(), null);
  const fake = { roomId: 'script-test' };
  __setCollabSessionForTest(fake);
  assert.equal(getCollabSession(), fake);
  __setCollabSessionForTest(null);
  assert.equal(getCollabSession(), null);
});

console.log(`collab gate: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
