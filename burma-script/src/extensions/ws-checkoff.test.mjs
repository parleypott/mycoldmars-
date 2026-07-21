/*
 * ws-checkoff.test.mjs — the per-workspace row CHECK-OFF store contract (ws-checkoff.js).
 *
 * Proves the PURE surface the plugin leans on:
 *   1. KEY NAMESPACE — wsDoneStorageKey derives a clean per-project token off WORKSHOP
 *      (then DOC, then the burma default), never hardcodes 'burma', never coerces a keyless
 *      config to "undefined"; two projects get two different keys; two crafts in one project
 *      get two different keys.
 *   2. READ / WRITE — a Set round-trips through localStorage; an empty set REMOVES the key;
 *      a corrupt / locked-down store degrades to an empty set, never a throw.
 *   3. PRUNE — a checked id whose row is gone is dropped; a still-present row (member OR not)
 *      is kept; a no-op prune returns the SAME Set (so the plugin skips a needless re-persist).
 *
 * (countCheckedMembers, which needs a live PM doc, is pinned in workspace-filter.test.mjs
 * alongside the schema + doc fixture it shares.)
 *
 * Run: bun src/extensions/ws-checkoff.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { wsDoneStorageKey, readChecked, writeChecked, pruneChecked } from './ws-checkoff.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

// ── localStorage stub (Node has none) ────────────────────────────────────────
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

// ── 1. KEY NAMESPACE ─────────────────────────────────────────────────────────
ok('key: WORKSHOP → clean per-project token, per craft', () => {
  const burma = { WORKSHOP: 'wp01_burma_workshop_v1', DOC: 'wp01_burma_doc_v1' };
  assert.equal(wsDoneStorageKey(burma, 'broll'), 'wp_wsdone_wp01_burma_broll');
  assert.equal(wsDoneStorageKey(burma, '3d'), 'wp_wsdone_wp01_burma_3d');
  // two crafts in ONE project never collide
  assert.notEqual(wsDoneStorageKey(burma, 'broll'), wsDoneStorageKey(burma, '3d'));
});

ok('key: two projects → two different namespaces (isolation)', () => {
  const palau = wsDoneStorageKey({ WORKSHOP: 'script_palau_workshop_v1' }, 'vo');
  const palau2 = wsDoneStorageKey({ WORKSHOP: 'script_palau2_workshop_v1' }, 'vo');
  assert.equal(palau, 'wp_wsdone_script_palau_vo');
  assert.equal(palau2, 'wp_wsdone_script_palau2_vo');
  assert.notEqual(palau, palau2);
});

ok('key: DOC fallback when no WORKSHOP; burma default when neither — never "undefined"', () => {
  assert.equal(wsDoneStorageKey({ DOC: 'script_x_doc_v1' }, 'animation'), 'wp_wsdone_script_x_animation');
  assert.equal(wsDoneStorageKey({}, 'broll'), 'wp_wsdone_wp01_burma_broll');
  assert.equal(wsDoneStorageKey(undefined, 'broll'), 'wp_wsdone_wp01_burma_broll');
  for (const k of Object.keys({ ...{} })) void k; // no accidental literal "undefined" token
  assert.ok(!wsDoneStorageKey({}, 'broll').includes('undefined'));
});

// ── 2. READ / WRITE ──────────────────────────────────────────────────────────
ok('io: a Set round-trips through localStorage', () => {
  const storage = { WORKSHOP: 'wp01_burma_workshop_v1' };
  writeChecked(storage, 'broll', new Set(['b2', 'b7']));
  const back = readChecked(storage, 'broll');
  assert.ok(back instanceof Set);
  assert.deepEqual([...back].sort(), ['b2', 'b7']);
  // it landed under the derived key, nowhere else
  assert.equal(mem.has('wp_wsdone_wp01_burma_broll'), true);
});

ok('io: an empty set REMOVES the key (no orphan)', () => {
  const storage = { WORKSHOP: 'wp01_burma_workshop_v1' };
  writeChecked(storage, 'broll', new Set(['b2']));
  assert.equal(mem.has('wp_wsdone_wp01_burma_broll'), true);
  writeChecked(storage, 'broll', new Set());
  assert.equal(mem.has('wp_wsdone_wp01_burma_broll'), false);
  assert.equal(readChecked(storage, 'broll').size, 0);
});

ok('io: a corrupt value degrades to an empty set (never throws)', () => {
  const storage = { WORKSHOP: 'wp01_burma_workshop_v1' };
  mem.set(wsDoneStorageKey(storage, 'broll'), 'not json {[');
  assert.doesNotThrow(() => readChecked(storage, 'broll'));
  assert.equal(readChecked(storage, 'broll').size, 0);
  // a non-array JSON value is ignored too
  mem.set(wsDoneStorageKey(storage, 'broll'), '{"a":1}');
  assert.equal(readChecked(storage, 'broll').size, 0);
});

ok('io: a thrown localStorage (locked-down / private mode) is a silent no-op', () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  assert.doesNotThrow(() => readChecked({ WORKSHOP: 'x_workshop_v1' }, 'broll'));
  assert.equal(readChecked({ WORKSHOP: 'x_workshop_v1' }, 'broll').size, 0);
  assert.doesNotThrow(() => writeChecked({ WORKSHOP: 'x_workshop_v1' }, 'broll', new Set(['a'])));
  globalThis.localStorage = saved;
});

// ── 3. PRUNE ─────────────────────────────────────────────────────────────────
ok('prune: drops ids whose row is gone; keeps present rows; a no-op returns the SAME set', () => {
  const checked = new Set(['a', 'b', 'c']);
  const pruned = pruneChecked(checked, ['a', 'c']); // b's row vanished
  assert.deepEqual([...pruned].sort(), ['a', 'c']);
  assert.notEqual(pruned, checked, 'a real prune returns a NEW set');

  const live = new Set(['a', 'c']);
  const same = pruneChecked(new Set(['a', 'c']), live);
  // nothing to drop → identity preserved so the plugin can skip re-persisting
  const src = new Set(['a', 'c']);
  assert.equal(pruneChecked(src, ['a', 'c', 'z']), src, 'no-op prune keeps the same Set object');
  assert.deepEqual([...same].sort(), ['a', 'c']);

  assert.equal(pruneChecked(new Set(), ['a']).size, 0);
  assert.equal(pruneChecked(null, ['a']).size, 0);
});

console.log(`ws-checkoff: ${pass} passed, 0 failed`);
