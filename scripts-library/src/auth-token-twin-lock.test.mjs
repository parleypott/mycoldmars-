// TWIN-LOCK: readSupabaseAccessTokenSync lives in TWO separate module trees that
// cannot share an import — each app bundles its own src/ into a standalone Vite
// build:
//   • translation/src/auth-token.js     (the Interpreter — already unit-locked
//                                         by translation/src/auth-token.test.mjs)
//   • scripts-library/src/auth-token.js  (the Script Library — copied verbatim,
//                                         its own header says so)
//
// The scripts-library copy is byte-identical to the Interpreter's TODAY (comments
// aside), but it had NO test of its own — so if a future fix hardens ONE copy
// (say, the Interpreter's parser grows a new session-shape guard) and forgets the
// other, the Interpreter's test stays GREEN while the two silently DRIFT. This is
// the AUTH parser: it decides the `Authorization: Bearer <jwt>` header injected on
// every authed /api/* request. If the Script Library's copy picks the wrong field,
// matches the wrong key, or throws, every authed request in that tool silently
// loses its auth header → 401s across the whole Script Library.
//
// Two locks in one file:
//   (1) BEHAVIOR — run the Script Library's REAL shipped function through the same
//       battery of session shapes + degrade-to-null cases the Interpreter's test
//       uses, and assert it agrees with the Interpreter's copy on every input.
//   (2) SOURCE SAMENESS — strip comments/blanks from both source files and assert
//       the functional code is IDENTICAL, so drift in a branch the battery doesn't
//       hit still turns this RED and NAMES which copy moved.
//
// VERIFIER-LAYER lock (no live bug — the parser is correct for the real
// supabase-js v2 shape). Reads global `localStorage` at CALL time, so a static
// import is safe once the mock is installed.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

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

// Import BOTH real shipped copies (call-time localStorage read → safe now).
const { readSupabaseAccessTokenSync: fromSL } =
  await import('./auth-token.js');
const { readSupabaseAccessTokenSync: fromInterp } =
  await import('../../translation/src/auth-token.js');

const COPIES = [
  ['scripts-library', fromSL],
  ['interpreter', fromInterp],
];

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.sig';
const REF = 'sb-abcdefghij-auth-token';

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error('✗', name, '\n   ', e.message); }
}

// A seed installs a store shape; we then assert BOTH copies return `want` and
// AGREE with each other. Any drift where one copy diverges names the copy.
function agree(name, seed, want) {
  check(name, () => {
    const results = COPIES.map(([label, fn]) => {
      LS.clear();
      seed(LS);
      return [label, fn()];
    });
    for (const [label, got] of results) {
      assert.strictEqual(got, want, `${label} returned ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
    // explicit sameness assertion (redundant with the loop, but names drift)
    assert.strictEqual(results[0][1], results[1][1],
      `DRIFT: scripts-library=${JSON.stringify(results[0][1])} vs interpreter=${JSON.stringify(results[1][1])}`);
  });
}

// ── the three real session shapes MUST resolve (load-bearing) ───────────────
agree('v2 object {access_token} → JWT',
  ls => ls.setItem(REF, JSON.stringify({ access_token: JWT, refresh_token: 'r', expires_at: 1 })), JWT);

agree('array-wrapped: element 0 is the token string → JWT',
  ls => ls.setItem(REF, JSON.stringify([JWT, 'refresh', 0, null])), JWT);

agree('legacy currentSession.access_token → JWT',
  ls => ls.setItem('supabase.auth.token', JSON.stringify({ currentSession: { access_token: JWT } })), JWT);

agree('case-insensitive key (sb-...-AUTH-TOKEN) → JWT',
  ls => ls.setItem('sb-XYZ-AUTH-TOKEN', JSON.stringify({ access_token: JWT })), JWT);

agree('finds auth-token among unrelated keys → JWT',
  ls => { ls.setItem('a', '1'); ls.setItem(REF, JSON.stringify({ access_token: JWT })); ls.setItem('c', '3'); }, JWT);

// ── degrade-to-null safety (interceptor depends on no-throw) ────────────────
agree('empty store → null', () => {}, null);

agree('chunked key sb-ref-auth-token.0 NOT matched (anchored regex) → null',
  ls => ls.setItem('sb-ref-auth-token.0', JSON.stringify({ access_token: 'NOPE' })), null);

agree('unrelated keys only → null',
  ls => { ls.setItem('mcm_access_code', 'code'); ls.setItem('sb-ref-other', JSON.stringify({ access_token: 'NOPE' })); }, null);

agree('malformed JSON value → null (no throw)',
  ls => ls.setItem(REF, '{not valid json'), null);

agree('JSON null value → null (no throw)',
  ls => ls.setItem(REF, 'null'), null);

agree('object without access_token → null',
  ls => ls.setItem(REF, JSON.stringify({ refresh_token: 'r' })), null);

agree('array whose element 0 is NOT a string → null',
  ls => ls.setItem(REF, JSON.stringify([{ access_token: JWT }, 'r'])), null);

agree('number value → null (no throw)',
  ls => ls.setItem(REF, '42'), null);

agree('bare string value → null',
  ls => ls.setItem(REF, JSON.stringify('a-bare-string')), null);

agree('legacy currentSession without access_token → null',
  ls => ls.setItem(REF, JSON.stringify({ currentSession: { refresh_token: 'r' } })), null);

// ── tolerant of a wholly-broken localStorage (no throw escapes either copy) ──
check('throwing localStorage.length → null for BOTH copies', () => {
  const broken = { get length() { throw new Error('boom'); }, key: () => null, getItem: () => null };
  globalThis.localStorage = broken;
  try {
    for (const [label, fn] of COPIES) {
      assert.strictEqual(fn(), null, `${label} let a throw escape`);
    }
  } finally {
    globalThis.localStorage = LS;
  }
});

// ── (2) SOURCE SAMENESS: functional code is byte-identical across both files ─
check('source functional code is IDENTICAL across both copies', () => {
  const codeLines = (s) => s.split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('//')).join('\n');
  const sl = codeLines(readFileSync(join(HERE, 'auth-token.js'), 'utf8'));
  const interp = codeLines(readFileSync(join(HERE, '..', '..', 'translation', 'src', 'auth-token.js'), 'utf8'));
  assert.strictEqual(sl, interp,
    'DRIFT: scripts-library/src/auth-token.js and translation/src/auth-token.js functional code diverged — ' +
    're-sync them or split their tests intentionally.');
});

console.log(`\nauth-token-twin-lock: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
