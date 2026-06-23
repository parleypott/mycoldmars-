// hash-decode.test.mjs
//
// THE BUG (fresh class): two reachable URL-hash sites decoded a location.hash fragment with a BARE
// decodeURIComponent, which THROWS URIError on a malformed '%' — crashing the handler:
//   • commentbank/index.html  applyHash()  — runs on page LOAD + hashchange. A shared/tampered link
//     like  #ask/50%  made decodeURIComponent(detail) throw, crashing applyHash on load (the init
//     sequence at the bottom calls it directly), so the page broke for that link.
//   • queen-scarlet-school/cast/index.html  popstate handler — a malformed hash on back/forward
//     threw and the view never updated.
// Both WRITE the hash with encodeURIComponent (commentbank:1719, cast:2941), so the app's own links
// are safe — the decode-on-read is the correct intent; the only bug is that it throws on an
// external/tampered hash. A bare '%' in shared text is realistic ("50%", "100% sure"). decodeURIComponent
// throws "URIError: URI malformed" on a bare '%' or a truncated escape (verified in node).
//
// THE FIX: a tiny shared-pattern helper in BOTH files —
//   function safeDecodeURI(s) { try { return decodeURIComponent(s); } catch { return s; } }
// decode but fall back to the raw string on malformed input (graceful degrade: the commentbank ask
// input shows the raw text; the cast state.cards[name] lookup just misses → grid view). Byte-identical
// for every valid input → zero regression; only malformed/external hashes change, from crash → degrade.
//
// This test EXTRACTS the real shipped safeDecodeURI from BOTH index.html files at runtime (no
// hand-copied mirror, can't drift), locks the contract, proves the old raw-decode crash is gone, and
// asserts both copies ship the SAME helper (divergent-copy guard).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMENTBANK = readFileSync(join(HERE, 'index.html'), 'utf8');
const CAST = readFileSync(join(HERE, '..', 'queen-scarlet-school', 'cast', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// brace-match extractor — safeDecodeURI has balanced braces and no string-literal braces.
function sliceBraces(src, fromIdx) {
  let depth = 0;
  for (let i = fromIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(fromIdx, i + 1); }
  }
  throw new Error('unbalanced braces from ' + fromIdx);
}
function extractFn(html, name) {
  const at = html.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`${name} not found`);
  const braceAt = html.indexOf('{', at);
  const sig = html.slice(at, braceAt);
  const src = `${sig}${sliceBraces(html, braceAt)}`;
  return new Function(`${src}\nreturn ${name};`)();
}

const cbDecode = extractFn(COMMENTBANK, 'safeDecodeURI');
const castDecode = extractFn(CAST, 'safeDecodeURI');

// =====================================================================================
// 0. RED PROOF — the OLD raw decode throws URIError on a bare '%'; the shipped helper does not.
// =====================================================================================
function oldRawDecode(s) { return decodeURIComponent(s); }  // the pre-fix behavior
{
  let threw = false;
  try { oldRawDecode('50%'); } catch (e) { threw = e instanceof URIError; }
  ok(threw, 'RED proof: old raw decodeURIComponent THROWS URIError on a bare "%"');
  // shipped helper must NOT throw and must return the raw string
  ok(cbDecode('50%') === '50%', 'commentbank safeDecodeURI("50%") -> raw "50%" (no throw)');
  ok(castDecode('50%') === '50%', 'cast safeDecodeURI("50%") -> raw "50%" (no throw)');
}

// =====================================================================================
// 1. Malformed input never throws — across both copies — and returns the raw string.
// =====================================================================================
const malformed = ['50%', '100% sure', '%', '%E0%A4%A', 'a%', '%zz', '%%', 'q=50%&x'];
for (const fn of [['commentbank', cbDecode], ['cast', castDecode]]) {
  const [label, decode] = fn;
  for (const m of malformed) {
    let result, threw = false;
    try { result = decode(m); } catch { threw = true; }
    ok(!threw, `${label} safeDecodeURI never throws on malformed ${JSON.stringify(m)}`);
    eq(result, m, `${label} safeDecodeURI returns raw on malformed ${JSON.stringify(m)}`);
  }
}

// =====================================================================================
// 2. Valid encoded input is decoded correctly (the common, app-written case) — both copies.
// =====================================================================================
const valid = [
  ['hello%20world', 'hello world'],
  ['50%25', '50%'],                 // a properly-encoded percent
  ['Queen%20Scarlet', 'Queen Scarlet'],
  ['caf%C3%A9', 'café'],
  ['a%2Fb', 'a/b'],
  ['', ''],
  ['plain', 'plain'],               // already-clean text passes through
  ['no-special-chars_123', 'no-special-chars_123'],
];
for (const [label, decode] of [['commentbank', cbDecode], ['cast', castDecode]]) {
  for (const [enc, dec] of valid) {
    eq(decode(enc), dec, `${label} safeDecodeURI(${JSON.stringify(enc)}) -> ${JSON.stringify(dec)}`);
  }
}

// =====================================================================================
// 3. safeDecodeURI === a properly-encoded decodeURIComponent for VALID input (no-regression):
//    the helper must be byte-identical to the old decode on anything that decodes cleanly.
// =====================================================================================
for (const [enc] of valid) {
  let expected;
  try { expected = decodeURIComponent(enc); } catch { expected = enc; }
  eq(cbDecode(enc), expected, `commentbank no-regression on valid ${JSON.stringify(enc)}`);
  eq(castDecode(enc), expected, `cast no-regression on valid ${JSON.stringify(enc)}`);
}

// =====================================================================================
// 4. Divergent-copy guard — both files ship the IDENTICAL helper behavior across a hostile sweep,
//    so the class is closed in lockstep (if one copy drifts, this goes RED).
// =====================================================================================
const sweep = [...malformed, ...valid.map(v => v[0]), 'a%41b', '%E2%9C%93', 'tab%09here'];
for (const s of sweep) {
  let a, b;
  try { a = cbDecode(s); } catch { a = '__THREW__'; }
  try { b = castDecode(s); } catch { b = '__THREW__'; }
  eq(a, b, `both copies agree on ${JSON.stringify(s)}`);
  ok(a !== '__THREW__', `neither copy throws on ${JSON.stringify(s)}`);
}

console.log(`\nhash-decode.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
