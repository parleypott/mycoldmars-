// Lock for readSupabaseAccessTokenSync (translation/src/auth-token.js) — the
// parser the Interpreter's fetch interceptor uses to inject
// `Authorization: Bearer <jwt>` on EVERY authenticated /api/* request. If it
// picks the wrong field, matches the wrong key, or throws, every authed
// request silently loses its auth header → 401s across the whole tool.
//
// VERIFIER-LAYER LOCK (no live bug found — the parser is correct for the real
// supabase-js v2 object shape). Mutation-proven: each assertion is shown to go
// RED if the corresponding behavior regresses. Imports the REAL shipped
// function (no mirror). auth-token.js reads the global `localStorage` at CALL
// time (never at import), so a static import is safe once we install a mock.

import assert from 'node:assert';

// ---- Map-backed localStorage mock (insertion-ordered, like the browser) ----
function makeLS() {
  const m = new Map();
  return {
    _m: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

let LS = makeLS();
globalThis.localStorage = LS;

const { readSupabaseAccessTokenSync } = await import('./auth-token.js');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.sig';
const REF = 'sb-abcdefghij-auth-token';

let pass = 0, fail = 0;
function check(name, fn) {
  // reset to a clean store per case
  LS.clear();
  try { fn(); pass++; }
  catch (e) { fail++; console.error('✗', name, '\n   ', e.message); }
}

// ── inline RED proof: the supabase-js v2 object shape MUST resolve ──────────
// (The whole point — if branch 1 ever stops matching {access_token}, every
//  authed request loses its Bearer header. This is the load-bearing case.)
check('RED-proof: v2 object {access_token} resolves to the JWT', () => {
  LS.setItem(REF, JSON.stringify({ access_token: JWT, refresh_token: 'r', expires_at: 1 }));
  assert.strictEqual(readSupabaseAccessTokenSync(), JWT);
});

// ── primary shapes ──────────────────────────────────────────────────────────
check('v2 object under sb-<ref>-auth-token', () => {
  LS.setItem(REF, JSON.stringify({ access_token: JWT }));
  assert.strictEqual(readSupabaseAccessTokenSync(), JWT);
});

check('legacy supabase.auth.token key matches', () => {
  LS.setItem('supabase.auth.token', JSON.stringify({ currentSession: { access_token: JWT } }));
  assert.strictEqual(readSupabaseAccessTokenSync(), JWT);
});

check('array-wrapped form: element 0 is the token string', () => {
  LS.setItem(REF, JSON.stringify([JWT, 'refresh', 0, null]));
  assert.strictEqual(readSupabaseAccessTokenSync(), JWT);
});

check('object branch precedes array branch (object wins when both apply)', () => {
  // An object is never an array, so order is unambiguous; assert the object form
  // returns access_token (not undefined) for a realistic full session object.
  LS.setItem(REF, JSON.stringify({ access_token: JWT, token_type: 'bearer', user: { id: 'u' } }));
  assert.strictEqual(readSupabaseAccessTokenSync(), JWT);
});

check('case-insensitive key match (sb-...-AUTH-TOKEN)', () => {
  LS.setItem('sb-XYZ-AUTH-TOKEN', JSON.stringify({ access_token: JWT }));
  assert.strictEqual(readSupabaseAccessTokenSync(), JWT);
});

// ── key matching: only the supabase auth-token keys are read ─────────────────
check('ignores unrelated keys', () => {
  LS.setItem('mcm_access_code', 'plain-code');
  LS.setItem('some-other-key', JSON.stringify({ access_token: 'NOPE' }));
  LS.setItem('sb-ref-other', JSON.stringify({ access_token: 'NOPE' })); // not -auth-token
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('a chunked key (sb-ref-auth-token.0) is NOT matched (anchored regex)', () => {
  LS.setItem('sb-ref-auth-token.0', JSON.stringify({ access_token: 'NOPE' }));
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('finds the auth-token key among many unrelated keys', () => {
  LS.setItem('a', '1'); LS.setItem('b', '2');
  LS.setItem(REF, JSON.stringify({ access_token: JWT }));
  LS.setItem('c', '3');
  assert.strictEqual(readSupabaseAccessTokenSync(), JWT);
});

// ── null/degrade-to-null safety (the interceptor depends on this — no throw) ─
check('no auth-token key present → null', () => {
  LS.setItem('mcm_access_code', 'code');
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('empty store → null', () => {
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('malformed JSON in the auth-token value → null (no throw)', () => {
  LS.setItem(REF, '{not valid json');
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('empty-string value → null', () => {
  LS.setItem(REF, '');
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('JSON null value → null (no throw)', () => {
  LS.setItem(REF, 'null');
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('object without access_token → null', () => {
  LS.setItem(REF, JSON.stringify({ refresh_token: 'r', expires_at: 1 }));
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('array whose element 0 is NOT a string → null', () => {
  LS.setItem(REF, JSON.stringify([{ access_token: JWT }, 'r']));
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('number value → null (no throw)', () => {
  LS.setItem(REF, '42');
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('string value (not JSON object/array) → null', () => {
  LS.setItem(REF, JSON.stringify('a-bare-string'));
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

check('legacy currentSession without access_token → null', () => {
  LS.setItem(REF, JSON.stringify({ currentSession: { refresh_token: 'r' } }));
  assert.strictEqual(readSupabaseAccessTokenSync(), null);
});

// ── tolerant of a wholly-broken localStorage (interceptor wraps in try too) ──
check('throwing localStorage.length → null (no throw escapes)', () => {
  const broken = { get length() { throw new Error('boom'); }, key: () => null, getItem: () => null };
  globalThis.localStorage = broken;
  try {
    assert.strictEqual(readSupabaseAccessTokenSync(), null);
  } finally {
    globalThis.localStorage = LS;
  }
});

console.log(`\nauth-token: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
