/*
 * prod-write-guard.test.mjs — locks the dev→prod write guard (2026-07-08 data-loss audit, rank 5).
 * Local dev must refuse a data-mutating /api call whose proxy target is production, unless
 * MCM_ALLOW_PROD_WRITES=1. Reads (GET) and non-data endpoints always pass.
 */
import assert from 'node:assert/strict';
import { shouldBlockProdWrite } from '../../vite.config.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };
const PROD = 'https://mycoldmars.vercel.app';

ok('BLOCKS a PUT to script-doc against prod (the cloud-sync clobber channel)', () => {
  assert.equal(shouldBlockProdWrite({ method: 'PUT', path: '/api/script-doc?project=burma', target: PROD, allow: false }), true);
});
ok('BLOCKS a POST to script-projects against prod', () => {
  assert.equal(shouldBlockProdWrite({ method: 'POST', path: '/api/script-projects', target: PROD, allow: false }), true);
});
ok('ALLOWS a GET (reads + ?read shares need it)', () => {
  assert.equal(shouldBlockProdWrite({ method: 'GET', path: '/api/script-doc?project=burma', target: PROD, allow: false }), false);
});
ok('ALLOWS when MCM_ALLOW_PROD_WRITES=1 (explicit override)', () => {
  assert.equal(shouldBlockProdWrite({ method: 'PUT', path: '/api/script-doc', target: PROD, allow: '1' }), false);
});
ok('ALLOWS a write when the target is NOT production (a preview branch)', () => {
  assert.equal(shouldBlockProdWrite({ method: 'PUT', path: '/api/script-doc', target: 'https://preview-xyz.vercel.app', allow: false }), false);
});
ok('ALLOWS a write to a non-data endpoint (e.g. /api/claude)', () => {
  assert.equal(shouldBlockProdWrite({ method: 'POST', path: '/api/claude', target: PROD, allow: false }), false);
});
ok('covers newpress.press + mycoldmars.com as prod hosts', () => {
  assert.equal(shouldBlockProdWrite({ method: 'PUT', path: '/api/script-doc', target: 'https://newpress.press', allow: false }), true);
  assert.equal(shouldBlockProdWrite({ method: 'DELETE', path: '/api/script-projects', target: 'https://mycoldmars.com', allow: false }), true);
});

console.log(`\nprod-write-guard: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
