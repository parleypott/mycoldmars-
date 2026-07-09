/*
 * roles.test.mjs — the ROLE FOCUS HUB's data model (Johnny 2026-07-08).
 *
 * The hub is pure CSS driven by ONE attribute (.wp-page[data-roles="…"]) whose value is
 * produced by roles.js. If serialize/parse ever drift from the ROLE_DEFS selectors, the
 * stylesheet silently stops matching and a teammate's lens quietly does nothing. These lock:
 *   1. ROLE_DEFS integrity — every craft has an id, label, tint, and a real CSS selector,
 *      and every id is a legal `data-roles` token (matchable by CSS `~=`, no spaces).
 *   2. parse ⇄ serialize round-trip — including de-dupe, unknown-token rejection (a
 *      hand-edited / renamed LS value can only ever under-filter, never crash), and order.
 *   3. toggleRole — multi-hat add/remove, normalization, and unknown-id safety.
 */
import assert from 'node:assert/strict';
import { ROLE_DEFS, ROLE_IDS, parseRoles, serializeRoles, toggleRole, rolesStorageKey } from './roles.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

ok('every ROLE_DEF has id, label, tint, and a real selector', () => {
  assert.ok(ROLE_DEFS.length >= 5, 'at least the five crafts');
  for (const r of ROLE_DEFS) {
    assert.ok(r.id && typeof r.id === 'string', `id present: ${JSON.stringify(r)}`);
    assert.ok(r.label && typeof r.label === 'string', `label present for ${r.id}`);
    assert.match(r.tint, /^#[0-9a-f]{6}$/i, `tint is a hex color for ${r.id}`);
    assert.ok(r.sel.includes('[data-'), `selector targets a data attr for ${r.id}: ${r.sel}`);
  }
});

ok('the six expected crafts are present and no other', () => {
  assert.deepEqual([...ROLE_IDS].sort(), ['3d', 'animation', 'archive', 'broll', 'cartography', 'factcheck', 'vo']);
});

ok('every id is a legal single CSS token (no whitespace — CSS ~= must match it)', () => {
  for (const id of ROLE_IDS) assert.doesNotMatch(id, /\s/, `id "${id}" has no whitespace`);
});

ok('the fail-generous crafts keep BOTH surfaces in their selector (union)', () => {
  const fc = ROLE_DEFS.find((r) => r.id === 'factcheck');
  assert.ok(fc.sel.includes('data-kind="factcheck"') && fc.sel.includes('[data-fc]'), 'factcheck = chip ∪ span');
  const br = ROLE_DEFS.find((r) => r.id === 'broll');
  assert.ok(br.sel.includes('data-kind="broll"') && br.sel.includes('[data-broll]'), 'broll = chip ∪ block');
});

ok('parse → serialize round-trips a clean multi-role string', () => {
  assert.equal(serializeRoles(parseRoles('animation broll')), 'animation broll');
  assert.deepEqual(parseRoles('animation broll'), ['animation', 'broll']);
});

ok('parse drops unknown tokens and de-dupes, never throwing', () => {
  assert.deepEqual(parseRoles('animation bogus animation 3d oncam'), ['animation', '3d']);
  assert.deepEqual(parseRoles(''), []);
  assert.deepEqual(parseRoles('   '), []);
  assert.deepEqual(parseRoles(null), []);
  assert.deepEqual(parseRoles(undefined), []);
});

ok('serialize filters junk and de-dupes so we never write a token CSS cannot act on', () => {
  assert.equal(serializeRoles(['animation', 'animation', 'nope', '3d']), 'animation 3d');
  assert.equal(serializeRoles([]), '');
  assert.equal(serializeRoles('not an array'), '');
});

ok('toggleRole adds, removes, normalizes, and rejects unknown ids', () => {
  assert.deepEqual(toggleRole([], 'archive'), ['archive']);          // add to empty
  assert.deepEqual(toggleRole(['archive'], 'broll'), ['archive', 'broll']); // multi-hat add
  assert.deepEqual(toggleRole(['archive', 'broll'], 'archive'), ['broll']); // remove
  assert.deepEqual(toggleRole(['archive', 'archive'], 'broll'), ['archive', 'broll']); // normalizes dupes
  assert.deepEqual(toggleRole(['archive'], 'bogus'), ['archive']);   // unknown id is a no-op
});

// rolesStorageKey — resolves the per-project LS key. The load-bearing case: a config that
// PREDATES the ROLES key (palau/palau2, every scripts-library project) must NOT fall through to
// the literal "undefined" localStorage key (which localStorage coerces an undefined key into),
// which would silently share one lens across every such project. It must instead derive that
// project's OWN namespaced key off its WORKSHOP key.
ok('rolesStorageKey prefers an explicit storage.ROLES', () => {
  assert.equal(rolesStorageKey({ ROLES: 'wp01_burma_roles_v1', WORKSHOP: 'wp01_burma_workshop_v1' }), 'wp01_burma_roles_v1');
});

ok('rolesStorageKey DERIVES a namespaced key when ROLES is missing (the palau/library gap)', () => {
  // These are the real keyless configs — palau, palau2, and a scripts-library `${ns}` project.
  assert.equal(rolesStorageKey({ WORKSHOP: 'script_palau_workshop_v1' }), 'script_palau_roles_v1');
  assert.equal(rolesStorageKey({ WORKSHOP: 'script_palau2_workshop_v1' }), 'script_palau2_roles_v1');
  assert.equal(rolesStorageKey({ WORKSHOP: 'script_local_aaa_workshop_v1' }), 'script_local_aaa_roles_v1');
  // Never the literal "undefined", and always project-distinct (no cross-project bleed).
  const palau = rolesStorageKey({ WORKSHOP: 'script_palau_workshop_v1' });
  const palau2 = rolesStorageKey({ WORKSHOP: 'script_palau2_workshop_v1' });
  assert.notEqual(palau, 'undefined');
  assert.notEqual(palau, palau2);
});

ok('rolesStorageKey never returns "undefined" for a degenerate/absent storage', () => {
  // No ROLES and no usable WORKSHOP → the burma default, never the string "undefined".
  for (const s of [undefined, null, {}, { WORKSHOP: '' }, { WORKSHOP: 42 }, { ROLES: '' }]) {
    const k = rolesStorageKey(s);
    assert.ok(typeof k === 'string' && k && k !== 'undefined', `must be a real key, got ${JSON.stringify(k)}`);
  }
});

console.log(`\nroles: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
