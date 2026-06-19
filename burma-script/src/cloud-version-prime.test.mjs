/**
 * Tests for primeVersionFloor (added for cloud sync) + proof the saveDoc invariant/read-back is
 * INTACT through it — deliverable (d). primeVersionFloor raises the on-disk LS_DOC_VER to a floor
 * (cloud version) so the immediately-following saveDoc stamps floor+1 and its cloud push is accepted
 * by the optimistic-concurrency guard rather than bouncing as stale. It must be monotonic (never
 * lower the version) and must not disturb saveDoc's read-back invariant.
 *
 * Run: bun src/cloud-version-prime.test.mjs   (auto-discovered by `bun run test`)
 */

// shared browser shims (same shape the crosstab test uses)
const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
const elShim = () => ({ setAttribute() {}, appendChild() {}, className: '', style: {} });
globalThis.document = globalThis.document || {
  createElement: elShim, createTextNode: () => ({}), addEventListener() {}, removeEventListener() {},
  body: elShim(), documentElement: { style: {} },
};
globalThis.navigator = globalThis.navigator || { platform: 'Linux', userAgent: 'node', maxTouchPoints: 0 };
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = globalThis.window.dispatchEvent || (() => true);
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';

const M = await import('./migrate-doc.js?prime=1');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
const verNum = () => parseInt(String(localStorage.getItem(LS_DOC_VER)).split('|')[0], 10);

const docWith = (text) => ({ type: 'doc', content: [
  { type: 'tableRow', attrs: { cols: 1 }, content: [
    { type: 'tableCell', attrs: { role: 'full' }, content: [
      { type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' }, content: [
        { type: 'paragraph', content: [{ type: 'text', text }] } ] } ] } ] },
] });

// fresh origin, adopt base 0
store.clear();
M.syncBaseVersion();

// prime to cloud version 8 -> on-disk version becomes 8
const primed = M.primeVersionFloor(8);
eq(primed, 8, '1. primeVersionFloor raises on-disk version to the cloud floor');
eq(verNum(), 8, '1b. LS_DOC_VER stamped to 8');

// a save now stamps 9 (floor+1) so a push of v9 beats cloud v8 -> not stale
const res = M.saveDoc(docWith('ADOPTED-FROM-CLOUD'));
ok(res.ok, '2. saveDoc after prime succeeds');
eq(res.version, 9, '2b. saveDoc stamps cloud+1 (so the next push is accepted, not stale)');

// READ-BACK INVARIANT intact: on-disk doc round-trips to exactly what we wrote
const readBack = JSON.parse(localStorage.getItem(LS_DOC));
eq(readBack.content[0].content[0].content[0].content[0].content[0].text, 'ADOPTED-FROM-CLOUD',
  '3. read-back invariant intact — stored doc equals written doc');
eq(verNum(), 9, '3b. on-disk version advanced to 9 after save');

// MONOTONIC: priming to a LOWER floor must NOT lower the version
const lower = M.primeVersionFloor(2);
eq(lower, 9, '4. priming to a lower floor never lowers the version (monotonic)');
eq(verNum(), 9, '4b. on-disk version unchanged by a lower floor');

// priming with garbage is a safe no-op
const garbage = M.primeVersionFloor('not-a-number');
eq(garbage, 9, '5. priming with NaN is a safe no-op (returns current)');

console.log(`\ncloud-version-prime: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
