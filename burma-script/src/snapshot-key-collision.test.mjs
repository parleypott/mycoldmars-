/**
 * Tests for COLLISION-PROOF SNAPSHOT KEYS (vector: snapshot-key-collision).
 *
 * Recovery snapshot keys used to be PREFIX + Date.now(): two snapshots in the SAME millisecond
 * produced the SAME key and the second setItem silently overwrote the first, losing a recovery copy.
 * The fix appends a monotonic per-process counter (PREFIX + ms + '-' + zero-padded-seq) so every
 * snapshot key is unique even within one millisecond, while the fixed-width ms prefix keeps a
 * lexical sort chronological for the pruneBackups/listBackupKeys tooling.
 *
 * We freeze Date.now() so EVERY call lands in the "same millisecond", then assert backupRaw()
 * produces distinct keys whose lexical order matches write order.
 *
 * Run: bun src/snapshot-key-collision.test.mjs   (auto-discovered by `bun run test`)
 */

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
  createElement: elShim, createTextNode: () => ({}),
  addEventListener() {}, removeEventListener() {},
  body: elShim(), documentElement: { style: {} },
};
globalThis.navigator = globalThis.navigator || { platform: 'Linux', userAgent: 'node', maxTouchPoints: 0 };
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = globalThis.window.dispatchEvent || (() => true);
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const LS_DOC = 'wp01_burma_doc_v1';
const BAK_PREFIX = LS_DOC + '.bak.';

// FREEZE the clock so every call is in the "same millisecond" — the collision scenario.
const FIXED = 1750000000000;
const realNow = Date.now;
Date.now = () => FIXED;

const M = await import('./migrate-doc.js?snapkey');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };

store.clear();
const bakKeys = () => Array.from(store.keys()).filter((k) => k.startsWith(BAK_PREFIX));

// Write 3 backups in the SAME frozen millisecond. BAK_KEEP is 3 so none are pruned here — this
// isolates the collision behaviour (the whole point of the fix) from the prune behaviour.
const N = 3;
const keys = [];
for (let i = 0; i < N; i++) keys.push(M.backupRaw('snapshot-' + i));

ok(keys.every((k) => k != null), `1. all ${N} same-ms backups returned a key (none refused)`);
ok(new Set(keys).size === N, `2. all ${N} keys are DISTINCT despite the identical millisecond`);
ok(bakKeys().length === N, `3. ${N} distinct backup entries actually persisted (no silent overwrite)`);

// Each entry holds its OWN distinct content — the heart of the bug (second used to clobber first).
const stored = bakKeys().sort().map((k) => store.get(k));
ok(new Set(stored).size === N, `4. all ${N} stored payloads are distinct (no copy was overwritten)`);

// Lexical sort is chronological: the sorted keys map back to snapshot-0..N in write order.
const sortedContents = bakKeys().sort().map((k) => store.get(k));
const expected = Array.from({ length: N }, (_, i) => 'snapshot-' + i);
ok(JSON.stringify(sortedContents) === JSON.stringify(expected),
  '5. lexical key order matches chronological write order (prune/list tooling stays correct)');

// Keys keep the fixed-width ms prefix so the chronological-sort invariant survives across ms too.
ok(keys.every((k) => k.startsWith(BAK_PREFIX + FIXED + '-')),
  '6. keys are PREFIX + ms + "-" + seq (fixed-width ms prefix preserved)');

// PRUNE CAP (storage-budget / PERF-1): even with same-ms keys, pruneBackups keeps only the newest
// BAK_KEEP (3). Write 3 MORE same-ms backups (6 total) and assert exactly 3 survive — the 3 newest.
for (let i = N; i < N + 3; i++) M.backupRaw('snapshot-' + i);
ok(bakKeys().length === 3, '7. pruneBackups caps backups at BAK_KEEP=3 even with same-ms keys (storage budget)');
const survivors = bakKeys().sort().map((k) => store.get(k));
ok(JSON.stringify(survivors) === JSON.stringify(['snapshot-3', 'snapshot-4', 'snapshot-5']),
  '8. the 3 NEWEST same-ms backups survive pruning (chronological order preserved within a ms)');

Date.now = realNow;
console.log(`\nsnapshot-key-collision: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
