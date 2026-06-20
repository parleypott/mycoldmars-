/**
 * READ-ONLY SHARE — ZERO-WRITE INVARIANT (vector: read-only-share).
 *
 * The whole point of the `?read` / `?view` share link is that a recipient can READ Johnny's live
 * script but can NEVER write to his canonical doc. That safety promise rests on TWO structural
 * guards, and this suite makes both load-bearing by asserting that, in a mounted read-only session:
 *
 *   1. saveDoc()  — the ONLY localStorage LS_DOC write path — performs ZERO localStorage.setItem
 *                   calls against LS_DOC (or its version stamp), fires NO wp-saved, and returns a
 *                   clean no-op { ok:false, reason:'read-only' }.
 *   2. pushDoc()  — the cloud PUT path — makes ZERO network calls (no PUT fired) and returns a
 *                   skipped no-op. A reader's browser is incapable of advancing the cloud doc.
 *
 * To prove the GUARD is the cause (not some unrelated short-circuit), each case also runs a CONTROL
 * with read-only OFF and asserts the very same call DOES write / DOES PUT. If the control didn't
 * write, the test would be vacuously green — so the control is what makes this real.
 *
 * Run: bun src/read-mode.test.mjs   (auto-discovered by `bun run test`)
 */

import { __setReadOnlyForTest } from './read-mode.js';

// ---- recording localStorage shim --------------------------------------------------------------
const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
const store = new Map();
let setItemCalls = []; // every (key) written, in order

globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { setItemCalls.push(k); store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
};

// ---- window + event capture -------------------------------------------------------------------
const events = [];
globalThis.window = {
  location: { search: '', hash: '' },
  dispatchEvent: (e) => { events.push(e?.type); return true; },
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

// ---- tiny assert harness ----------------------------------------------------------------------
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ ' + msg); } }
function reset() { setItemCalls = []; events.length = 0; }

// A minimal but schema-VALID doc (one full-width row holding a chapter cartridge). saveDoc round-trips
// it through the live ProseMirror schema, so it must be a real document, not a stub.
const DOC = {
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1 },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{ type: 'chapterBlock', attrs: { blockId: 'blk_test1', genre: 'history' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cold open' }] }] }],
    }],
  }],
};

const main = async () => {
  const { saveDoc } = await import('./migrate-doc.js');
  const { pushDoc } = await import('./cloud-sync.js');

  // ============================================================================================
  // GUARD 1 — saveDoc writes NOTHING in read-only mode.
  // ============================================================================================
  __setReadOnlyForTest(true);
  reset();
  const ro = saveDoc(DOC);
  ok(ro && ro.ok === false && ro.reason === 'read-only', 'read-only saveDoc returns {ok:false, reason:"read-only"}');
  ok(!setItemCalls.includes(LS_DOC), 'read-only saveDoc performs ZERO localStorage.setItem(LS_DOC)');
  ok(!setItemCalls.includes(LS_DOC_VER), 'read-only saveDoc performs ZERO localStorage.setItem(LS_DOC_VER)');
  ok(setItemCalls.length === 0, 'read-only saveDoc performs ZERO localStorage writes of ANY key');
  ok(!events.includes('wp-saved'), 'read-only saveDoc fires NO wp-saved (never claims a save landed)');

  // CONTROL — same call, read-only OFF, MUST write. Proves the guard above is what stops the write.
  __setReadOnlyForTest(false);
  reset();
  const rw = saveDoc(DOC);
  ok(rw && rw.ok === true, 'control (editable) saveDoc returns ok:true');
  ok(setItemCalls.includes(LS_DOC), 'control (editable) saveDoc DID write LS_DOC — guard is load-bearing');

  // ============================================================================================
  // GUARD 2 — pushDoc makes NO network call in read-only mode.
  // ============================================================================================
  let putCount = 0, getCount = 0;
  const fetchSpy = async (_url, opts) => {
    const m = (opts?.method || 'GET').toUpperCase();
    if (m === 'PUT') putCount++; else getCount++;
    return { ok: true, status: 200, json: async () => ({ version: 99 }) };
  };

  __setReadOnlyForTest(true);
  reset();
  putCount = 0; getCount = 0;
  const rop = await pushDoc(DOC, 5, fetchSpy);
  ok(rop && rop.ok === false && rop.skipped === true, 'read-only pushDoc returns a skipped no-op');
  ok(putCount === 0 && getCount === 0, 'read-only pushDoc makes ZERO network calls (no cloud PUT)');
  ok(!events.includes('wp-cloud-saved'), 'read-only pushDoc fires NO wp-cloud-saved');

  // CONTROL — same call, read-only OFF, MUST PUT. Proves the cloud guard is load-bearing.
  __setReadOnlyForTest(false);
  reset();
  putCount = 0; getCount = 0;
  const rwp = await pushDoc(DOC, 5, fetchSpy);
  ok(rwp && rwp.ok === true, 'control (editable) pushDoc returns ok:true');
  ok(putCount === 1, 'control (editable) pushDoc DID PUT the cloud — guard is load-bearing');

  // ============================================================================================
  // URL SIGNAL — `?read` and `?view` both arm read-only; a bare URL does not.
  // ============================================================================================
  const arm = (search, hash = '') => { globalThis.window.location = { search, hash }; return __setReadOnlyForTest(); };
  ok(arm('?read') === true, '?read arms read-only mode');
  ok(arm('?view') === true, '?view arms read-only mode');
  ok(arm('?read=1&x=2') === true, '?read=1 (with other params) arms read-only mode');
  ok(arm('') === false, 'bare URL (no query) is NOT read-only — Johnny\'s edit URL is unchanged');
  ok(arm('?foo=bar') === false, 'unrelated query is NOT read-only');
  ok(arm('', '#?view') === true, 'hash-routed #?view arms read-only mode');

  console.log(`\nread-mode.test.mjs — ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
};

main().catch((e) => { console.error(e); process.exit(1); });
