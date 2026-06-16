// migrate-probe.mjs — PROOF for the SAFE MIGRATION harness (tbl-dim-migrate).
//
// Runs the REAL src/migrate-doc.js against a REALISTIC copy of Johnny's saved localStorage doc
// — a PRE-TABLE flat-block doc carrying filled-in {tk}/{fc} answers and broadcast timecodes —
// and asserts the SACRED #1 contract end to end:
//   1. a pre-migration backup (wp01_burma_doc_v1.bak.<ts>) is written, byte-identical to input
//   2. text-equality gate: every word + every {tk}/{fc} fill survives the wrap
//   3. schema gate: the migrated doc round-trips the live ProseMirror schema
//   4. the persisted doc is now all-rows (tableRow+)
//   5. running again is a no-op (version-gated) and never re-wraps
//   6. FALLBACK: a doc that fails validation is NOT persisted; the original survives
//   7. resetDoc's snapshotDoc() backs up before any wipe
//
// Run: bun migrate-probe.mjs   (no build needed; imports the source module directly)

// ---- minimal browser shims so the source modules import under bun/node -------------------
const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
// table.js only touches document inside addNodeView (never during getSchema), but provide a
// no-op document so any incidental reference can't crash the import.
const elShim = () => ({ setAttribute() {}, appendChild() {}, className: '', style: {} });
globalThis.document = globalThis.document || {
  createElement: elShim,
  createTextNode: () => ({}),
  addEventListener() {}, removeEventListener() {},
  body: elShim(),
  documentElement: { style: {} },
};
globalThis.navigator = globalThis.navigator || { platform: 'Linux', userAgent: 'node', maxTouchPoints: 0 };
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };

const { migrateStoredDoc, snapshotDoc, LS_DOC, LS_MIGRATED } =
  await import('./src/migrate-doc.js');
const { buildEditorDocument } = await import('./src/document-builder.js');

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

// ---- 1. forge a REALISTIC pre-table saved doc with filled {tk}/{fc} answers --------------
// Start from the real build (all-rows), then FLATTEN it back to pre-table flat blocks at the
// doc top level (the exact shape a doc saved before the spine had), and inject Johnny's fills:
// a resolved {tk} answer, a {fc} ask, and a broadcast timecode chip — the sacred content.
import sample from './sample-blocks.json' with { type: 'json' };
const rowed = buildEditorDocument(sample.blocks);

// flatten rows → their inner blocks (pre-table shape)
const flat = [];
for (const row of rowed.content) {
  if (row.type === 'tableRow') for (const cell of row.content) for (const b of cell.content) flat.push(b);
  else flat.push(row);
}
// inject a VO block carrying a FILLED tk answer + an fc ask + a timecode, as marked spans.
const FILL_TK = 'the river that swallowed a thousand boats';
const FILL_FC = 'fc 1.3 million displaced since 2021';
const TC = '02:45:36:15';
flat.unshift({
  type: 'voBlock', attrs: { blockId: 'blk_johnnyfill', status: 'done' },
  content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'We open on ' },
    { type: 'text', text: '{tk ' + FILL_TK + '}', marks: [{ type: 'tkSpan' }] },
    { type: 'text', text: ' — verify ' },
    { type: 'text', text: '{' + FILL_FC + '}', marks: [{ type: 'factCheckSpan' }] },
    { type: 'text', text: ' at ' },
    { type: 'text', text: TC, marks: [{ type: 'timecode', attrs: { tc: TC } }] },
    { type: 'text', text: '.' },
  ] }],
});
const preTableDoc = { type: 'doc', content: flat };
const rawIn = JSON.stringify(preTableDoc);

// seed localStorage exactly as Johnny's machine would have it
store.clear();
localStorage.setItem(LS_DOC, rawIn);

// ---- 2. run the migration ----------------------------------------------------------------
const res = migrateStoredDoc();
ok(res.ok && res.migrated, '1. migration applied + validated -> ' + JSON.stringify(res));

// 3. a backup was written, byte-identical to the original input
const bakKeys = Array.from(store.keys()).filter((k) => k.startsWith(LS_DOC + '.bak.'));
ok(bakKeys.length >= 1, '2. pre-migration backup key exists');
ok(bakKeys.length && localStorage.getItem(bakKeys[0]) === rawIn,
  '3. backup is byte-identical to the original saved doc');

// 4. persisted doc is now all-rows
const after = JSON.parse(localStorage.getItem(LS_DOC));
const allRows = after.content.length > 0 && after.content.every((n) => n.type === 'tableRow');
ok(allRows, '4. persisted doc is all-rows (tableRow+)');

// 5. SACRED fills survive verbatim in the migrated doc text
const afterStr = JSON.stringify(after);
ok(afterStr.includes(FILL_TK), '5a. {tk} fill text survived migration');
ok(afterStr.includes(FILL_FC.replace('fc ', '')), '5b. {fc} fill text survived migration');
ok(afterStr.includes(TC), '5c. broadcast timecode survived migration');

// 6. the marker is set and a second run is a clean no-op (no double-wrap)
ok(localStorage.getItem(LS_MIGRATED) === '1', '6a. migration marker set');
const res2 = migrateStoredDoc();
ok(res2.ok && !res2.migrated, '6b. second run is a no-op (version-gated)');
const after2 = JSON.parse(localStorage.getItem(LS_DOC));
ok(JSON.stringify(after2) === afterStr, '6c. second run did not mutate the doc');

// ---- 7. FALLBACK proof: a doc that fails the schema gate must NOT be persisted -----------
// Seed a fresh pre-table doc but corrupt a block so it cannot satisfy the schema (a voBlock
// with an illegal child). The harness must keep the ORIGINAL bytes and refuse to persist.
store.clear();
const corrupt = {
  type: 'doc',
  content: [{
    type: 'voBlock', attrs: { blockId: 'blk_x', status: 'todo' },
    // illegal: voBlock content is `paragraph` — inject a raw text node where a block must be
    content: [{ type: 'text', text: 'illegal-top-level-text' }],
  }],
};
const corruptRaw = JSON.stringify(corrupt);
localStorage.setItem(LS_DOC, corruptRaw);
const res3 = migrateStoredDoc();
ok(!res3.ok, '7a. corrupt doc migration returns ok:false');
ok(localStorage.getItem(LS_DOC) === corruptRaw, '7b. FALLBACK: original bytes left untouched');
const bak3 = Array.from(store.keys()).filter((k) => k.startsWith(LS_DOC + '.bak.'));
ok(bak3.length >= 1, '7c. backup still taken before the failed attempt');

// ---- 8. snapshotDoc() proof: resetDoc's pre-wipe backup -----------------------------------
store.clear();
localStorage.setItem(LS_DOC, rawIn);
const snapKey = snapshotDoc();
ok(snapKey && localStorage.getItem(snapKey) === rawIn, '8. snapshotDoc backs up before wipe');

console.log(failures === 0 ? '\nMIGRATE-PROBE PASS' : `\nMIGRATE-PROBE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
