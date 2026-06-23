// cookie-read.test.mjs
//
// THE CLASS (cookie-regex-injection, obs 4098): three QSS gate pages read the access cookie by building
// a RegExp from the cookie NAME unescaped —
//   document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'))
// — so a cookie name carrying regex metacharacters (. * + ? [ ] etc.) is compiled as a PATTERN, not a
// literal, and can match/shadow the WRONG cookie. The earlier shared/cookie.js fix (4de2570) closed this
// in research/app.js + translation/src/gate.js but its grep was scoped to research/ + translation/ +
// public/ and MISSED these three inline copies under queen-scarlet-school/:
//   • library/index.html  getCookie   (the gate that unlocks the story library)
//   • cast/index.html      getCookie   (the gate that unlocks the character manager)
//   • index.html           getC        (the WRITE app's cosmetic gate — Henry's primary tool)
// LATENT today (the only caller passes the constant 'qss_access'), but the surviving divergent copies of
// a class the rest of the codebase handles safely. Same hardening register as the prior cookie fix.
//
// THE FIX (all three): replace the dynamic-RegExp match with a regex-free parse matching shared/cookie.js
// parseCookieValue — split on "; ", exact key match, decode (raw fallback on malformed %-encoding). There
// is NO pattern to inject into → the class is closed STRUCTURALLY, not just escaped. Byte-identical to the
// old regex for the real 'qss_access' lookup + encoded values → zero regression.
//
// This test EXTRACTS the real shipped readers from all three files at runtime (no hand-copied mirror,
// can't drift), runs them against an injected document.cookie, carries an inline RED proof reconstructing
// the OLD dynamic-RegExp form (proving it INJECTS while the shipped readers do not), binds to the fix at
// the source level, and asserts all three copies agree (divergent-copy guard).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY = readFileSync(join(HERE, 'library', 'index.html'), 'utf8');
const CAST = readFileSync(join(HERE, 'cast', 'index.html'), 'utf8');
const WRITE = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// brace-match extractor — the reader has balanced braces and no string-literal braces.
function sliceBraces(src, fromIdx) {
  let depth = 0;
  for (let i = fromIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(fromIdx, i + 1); }
  }
  throw new Error('unbalanced braces from ' + fromIdx);
}
// Build a tester for the shipped reader. The reader is `function NAME(n){ ... document.cookie ... }`,
// taking the cookie NAME as its arg and reading the global `document`. We inject `document` via a
// Function param, then call the built reader with the name. Returns (cookieString, name) → value|null.
function extractCookieReader(html, fnName) {
  const at = html.indexOf(`function ${fnName}(`);
  if (at < 0) throw new Error(`${fnName} not found`);
  const braceAt = html.indexOf('{', at);
  const src = `${html.slice(at, braceAt)}${sliceBraces(html, braceAt)}`;
  return (cookieString, name = 'qss_access') => {
    const built = new Function('document', `${src}\nreturn ${fnName};`)({ cookie: cookieString });
    return built(name);
  };
}

const libGet = extractCookieReader(LIBRARY, 'getCookie');
const castGet = extractCookieReader(CAST, 'getCookie');
const writeGet = extractCookieReader(WRITE, 'getC');
const ALL = [['library', libGet], ['cast', castGet], ['write', writeGet]];

// ── The OLD buggy form, reconstructed for the inline RED proof ──────────────────────────────
function oldRegexReader(cookieString, n) {
  const m = cookieString.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// ── RED proof: the OLD form INJECTS on a metachar name; the shipped readers do not ──────────
// A name like "qss.access" should match ONLY a cookie literally named "qss.access". The old regex
// treats '.' as "any char", so it ALSO matches a cookie named "qssXaccess".
ok(oldRegexReader('qssXaccess=leak', 'qss.access') === 'leak',
   'RED proof: old regex INJECTS (qss.access pattern matched qssXaccess)');
for (const [label, get] of ALL) {
  eq(get('qssXaccess=leak', 'qss.access'), null,
     `${label}: regex-free reader treats "qss.access" as a literal (no qss.access cookie → null)`);
}
// "ab*" old-regex matches "a" + any run of "b"; shipped must treat "ab*" as a literal name (absent → null).
ok(oldRegexReader('a=1', 'ab*') === '1', 'RED proof: old regex "ab*" wrongly matches cookie "a"');
for (const [label, get] of ALL) {
  eq(get('a=1', 'ab*'), null, `${label}: "ab*" is a literal name (no cookie named ab* → null)`);
}

// ── Correctness: the real lookup the app does ('qss_access') ────────────────────────────────
for (const [label, get] of ALL) {
  eq(get('qss_access=granted'), 'granted', `${label}: qss_access=granted → granted`);
  eq(get('other=x; qss_access=granted'), 'granted', `${label}: finds qss_access after "; " separator`);
  eq(get('qss_access=granted; other=x'), 'granted', `${label}: finds qss_access at the start`);
  eq(get('other=x'), null, `${label}: absent cookie → null`);
  eq(get(''), null, `${label}: empty cookie string → null`);
  eq(get('qss_access='), '', `${label}: present-but-empty value → ""`);
}

// ── No exact/partial-key confusion (a superset name must not shadow) ─────────────────────────
for (const [label, get] of ALL) {
  eq(get('qss_access_token=nope'), null,
     `${label}: prefix-superset "qss_access_token" does not shadow "qss_access"`);
  eq(get('xqss_access=nope'), null, `${label}: suffix-superset "xqss_access" does not match`);
}

// ── Decoding (matches shared/cookie.js: decode, raw fallback on malformed %) ─────────────────
for (const [label, get] of ALL) {
  eq(get('qss_access=hello%20world'), 'hello world', `${label}: %20 decoded`);
  eq(get('qss_access=a%2Fb'), 'a/b', `${label}: %2F decoded`);
  eq(get('qss_access=50%25'), '50%', `${label}: %25 → literal %`);
  // malformed %-encoding must NOT throw — return raw (the shared module's contract).
  let threw = false, val;
  try { val = get('qss_access=bad%'); } catch { threw = true; }
  ok(!threw, `${label}: malformed %-encoding does not throw`);
  eq(val, 'bad%', `${label}: malformed value returned raw`);
}

// ── Source binding: the dynamic-RegExp form is GONE and the regex-free parse is wired in all 3 ──
for (const [label, html] of [['library', LIBRARY], ['cast', CAST], ['write', WRITE]]) {
  ok(!/new RegExp\(\s*['"]\(\?:\^\|; \)['"]/.test(html),
     `${label}: old "new RegExp('(?:^|; )'...)" cookie pattern removed`);
  ok(html.includes("document.cookie.split('; ')"),
     `${label}: regex-free split('; ') parse present`);
}

// ── Divergent-copy guard: all three readers agree across a hostile sweep ─────────────────────
const SWEEP = [
  '', 'qss_access=granted', 'other=x', 'qss_access=', 'a=1; b=2; qss_access=granted',
  'qss_access=hello%20world', 'qss_access=bad%', 'qss_access_token=nope', 'QSS_ACCESS=granted',
];
for (const cookieString of SWEEP) {
  const l = libGet(cookieString), c = castGet(cookieString), w = writeGet(cookieString);
  ok(l === c && c === w,
     `divergent-copy: all three agree on ${JSON.stringify(cookieString)} (lib=${JSON.stringify(l)} cast=${JSON.stringify(c)} write=${JSON.stringify(w)})`);
}
// Case sensitivity: 'qss_access' must NOT match a 'QSS_ACCESS' cookie (exact key).
for (const [label, get] of ALL) {
  eq(get('QSS_ACCESS=granted'), null, `${label}: exact-case key (QSS_ACCESS ≠ qss_access)`);
}

console.log(`cookie-read.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.error('  ✗ ' + f); process.exit(1); }
