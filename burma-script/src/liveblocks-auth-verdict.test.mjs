/*
 * liveblocks-auth-verdict.test.mjs — SERVER TWIN of the room-namespace guardrail (2026-07-08 audit).
 * A drift-free backstop: even if a client build regressed and asked for the bare prod room from a
 * non-prod deployment, the server refuses to mint the token. In production any valid room passes;
 * in preview/development the room MUST carry this deployment's own -<env> suffix.
 */
import assert from 'node:assert/strict';
import { collabAuthVerdict } from '../../api/liveblocks-auth.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

ok('production allows the bare prod room', () => {
  assert.equal(collabAuthVerdict({ room: 'script-burma', vercelEnv: 'production' }).ok, true);
});
ok('production allows any env-suffixed room too (harmless)', () => {
  assert.equal(collabAuthVerdict({ room: 'script-burma-preview', vercelEnv: 'production' }).ok, true);
});

// THE BACKSTOP: a non-prod deployment must REFUSE the bare prod room.
ok('development REFUSES the prod room (script-burma)', () => {
  const v = collabAuthVerdict({ room: 'script-burma', vercelEnv: 'development' });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'NON_PROD_ROOM');
});
ok('preview REFUSES the prod room (script-burma)', () => {
  assert.equal(collabAuthVerdict({ room: 'script-burma', vercelEnv: 'preview' }).ok, false);
});
ok('development allows its OWN -development room', () => {
  assert.equal(collabAuthVerdict({ room: 'script-burma-development', vercelEnv: 'development' }).ok, true);
});
ok('preview allows its OWN -preview room', () => {
  assert.equal(collabAuthVerdict({ room: 'script-burma-preview', vercelEnv: 'preview' }).ok, true);
});
ok('unset VERCEL_ENV is treated as development (refuses prod room)', () => {
  assert.equal(collabAuthVerdict({ room: 'script-burma', vercelEnv: undefined }).ok, false);
});
ok('a malformed room is rejected regardless of env', () => {
  assert.equal(collabAuthVerdict({ room: 'nope!', vercelEnv: 'production' }).ok, false);
});

console.log(`\nliveblocks-auth-verdict: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
