/**
 * CLOUD WRITE TOKEN — SHARE-SAFETY (client side).  vector: write-token / read-only-share (server gate)
 *
 * The server now refuses an un-tokened PUT (api/burma-script-doc.js, gate on BURMA_WRITE_TOKEN). The
 * client half is here: Johnny's EDIT device holds the secret in localStorage (provisioned once via
 * `?key=`), a `?read` recipient's device does NOT, and every push carries the token as a header. This
 * suite makes that load-bearing:
 *
 *   1. captureWriteTokenFromUrl: `?key=SECRET` (search OR hash) -> stored in localStorage AND scrubbed
 *      from the address bar; a bare URL captures nothing; a READ-ONLY session NEVER captures (so a
 *      crafted `?read&key=` link can't provision a recipient).
 *   2. getWriteToken / writeTokenHeaders: reflect the stored secret; empty header object when absent.
 *   3. pushDoc actually SENDS the X-Burma-Write-Token header when (and only when) a token is present —
 *      with a CONTROL (no token) proving the header is omitted, so an unconfigured server still works.
 *
 * Run: bun src/write-token.test.mjs
 */

// ---- localStorage shim ------------------------------------------------------------------------
const store = new Map();
let setItemCalls = [];
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { setItemCalls.push(k); store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
};

// ---- window + history shim (replaceState records the scrubbed URL) ------------------------------
let replacedUrl = null;
globalThis.window = {
  location: { href: 'https://x/burma-script/', search: '', hash: '' },
  history: { replaceState: (_s, _t, url) => { replacedUrl = url; } },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.document = undefined;

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ ' + msg); } }

const setLoc = (search, hash = '', href) => {
  globalThis.window.location = {
    href: href || ('https://x/burma-script/' + (search || '') + (hash || '')),
    search, hash,
  };
  replacedUrl = null;
};

const main = async () => {
  const wt = await import('./write-token.js');
  const {
    captureWriteTokenFromUrl, getWriteToken, hasWriteToken, writeTokenHeaders,
    __setWriteTokenForTest, WRITE_TOKEN_HEADER, LS_WRITE_TOKEN,
  } = wt;

  // ── 1. capture from search ──────────────────────────────────────────────────────────────────
  store.clear(); setItemCalls = []; __setWriteTokenForTest(null);
  setLoc('?key=abc123');
  const cap = captureWriteTokenFromUrl({ isReadOnly: () => false });
  ok(cap === true, 'captureWriteTokenFromUrl returns true when ?key= present');
  ok(store.get(LS_WRITE_TOKEN) === 'abc123', '?key= is persisted to localStorage');
  ok(getWriteToken() === 'abc123', 'getWriteToken reflects the captured token');
  ok(hasWriteToken() === true, 'hasWriteToken true after capture');
  ok(replacedUrl != null && !String(replacedUrl).includes('key='), 'the key is SCRUBBED from the address bar');

  // ── header shape ────────────────────────────────────────────────────────────────────────────
  ok(writeTokenHeaders()[WRITE_TOKEN_HEADER] === 'abc123', 'writeTokenHeaders carries the token');

  // ── 2. capture from HASH query ──────────────────────────────────────────────────────────────
  store.clear(); __setWriteTokenForTest(null);
  setLoc('', '#?key=hashtok', 'https://x/burma-script/#?key=hashtok');
  ok(captureWriteTokenFromUrl({ isReadOnly: () => false }) === true, 'hash ?key= is captured');
  ok(getWriteToken() === 'hashtok', 'hash token resolved');

  // ── bare URL captures nothing ───────────────────────────────────────────────────────────────
  store.clear(); __setWriteTokenForTest(null);
  setLoc('?foo=bar');
  ok(captureWriteTokenFromUrl({ isReadOnly: () => false }) === false, 'no ?key= -> nothing captured');
  ok(getWriteToken() === null, 'getWriteToken null when never provisioned');
  ok(Object.keys(writeTokenHeaders()).length === 0, 'writeTokenHeaders empty when no token');

  // ── 3. READ-ONLY never provisions (crafted ?read&key= link must not arm a recipient) ─────────
  store.clear(); __setWriteTokenForTest(null);
  setLoc('?read&key=stolen');
  ok(captureWriteTokenFromUrl({ isReadOnly: () => true }) === false, 'read-only session does NOT capture a key');
  ok(getWriteToken() === null, 'recipient device acquires NO write secret from a crafted link');

  // ── 4. pushDoc SENDS the header when a token is present; OMITS it otherwise ───────────────────
  const { pushDoc } = await import('./cloud-sync.js');
  const { __setReadOnlyForTest } = await import('./read-mode.js');
  __setReadOnlyForTest(false);

  const DOC = {
    type: 'doc',
    content: [{ type: 'tableRow', attrs: { cols: 1 },
      content: [{ type: 'tableCell', attrs: { role: 'full' },
        content: [{ type: 'chapterBlock', attrs: { blockId: 'blk_t', genre: 'history' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] }] }],
  };

  let seenHeaders = null;
  const fetchSpy = async (_url, opts) => {
    seenHeaders = opts?.headers || {};
    return { ok: true, status: 200, json: async () => ({ version: 7 }) };
  };

  // WITH token
  __setWriteTokenForTest('mysecret');
  seenHeaders = null;
  const r1 = await pushDoc(DOC, 5, fetchSpy);
  ok(r1 && r1.ok === true, 'pushDoc (token present) succeeds');
  ok(seenHeaders && seenHeaders[WRITE_TOKEN_HEADER] === 'mysecret', 'pushDoc SENDS X-Burma-Write-Token when present');

  // CONTROL — no token, header omitted (unconfigured server still works)
  __setWriteTokenForTest(null);
  seenHeaders = null;
  const r2 = await pushDoc(DOC, 6, fetchSpy);
  ok(r2 && r2.ok === true, 'pushDoc (no token) still succeeds');
  ok(seenHeaders && seenHeaders[WRITE_TOKEN_HEADER] === undefined, 'pushDoc OMITS the header when no token — graceful');

  console.log(`\nwrite-token.test.mjs — ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
};

main().catch((e) => { console.error(e); process.exit(1); });
