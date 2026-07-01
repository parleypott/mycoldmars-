/**
 * Twin-lock: QSS avatar-monogram `initials(name)` must stay identical AND null-safe
 * across its two inline copies.
 * Run: bun queen-scarlet-school/initials-twinlock.test.mjs
 *
 * Henry's character cards render a two-letter corner monogram computed by an inline
 * `initials(name)` helper. It lives TWICE, hand-copied, in two independent QSS pages:
 *
 *   1. queen-scarlet-school/index.html      — the in-tutor cast modal (cardMarkup)
 *   2. queen-scarlet-school/cast/index.html — the standalone cast page
 *
 * They MUST agree byte-for-byte on every input, and BOTH must be null-safe at the
 * source (the cast copy already coerced with String(name || ''); index.html called
 * `.split()` on a raw name and would throw TypeError on a null/undefined name — inert
 * today because its caller keys off string card-names, but a latent footgun and a real
 * divergence). This is the same divergent-copy class the loop consolidated in the
 * Interpreter (initialsOf, commit a0c3759); here the two copies can't share an ESM
 * import (inline HTML on the auth-gated tutor, no build), so a grep-extract twin-lock
 * is the enforcement.
 *
 * The test (a) proves both copies are behavior-identical across a shared input space,
 * (b) proves both are null-safe, and (c) mutation-locks the canonical BEHAVIOR so
 * "both agree on the wrong thing" can't pass silently.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${g}\n   want: ${w}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// --- Extract the inline `function initials(name) { ... }` body from a page ----
// Matches from `function initials(name) {` up to the matching close of that block.
// The body is exactly two statements (const parts = ...; return ...;), so a
// non-greedy grab up to the first `}` on its own indentation is safe and precise.
//
// CONCURRENCY NOTE: `cast/index.html` and `index.html` are TEMPORARILY rewritten
// in place by their own mutation-harness tests (cast-render / write-render mutate a
// line, spawn a child to prove it goes RED, then restore). Those tests hold the
// mutated file across a *synchronous* child spawn — a multi-hundred-ms window. Under
// `bun run test`'s parallel pool, a naive read here can land inside that window and
// see, e.g., `.slice(0, 1)` instead of `.slice(0, 2)`. So we read with a bounded
// retry until the file is in its CANONICAL (restored) shape, identified by the two
// markers this twin-lock is asserting: the null-safe `String(name` coercion and the
// two-initial `.slice(0, 2)` cap. The mutation harnesses always restore, so this
// converges; if it never does, that's a real regression and we throw.
const CANON_MARKERS = ['String(name', '.slice(0, 2)'];
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function readCanonicalInitialsBody(file) {
  const path = join(HERE, file);
  for (let attempt = 0; attempt < 120; attempt++) {
    const src = readFileSync(path, 'utf8');
    const m = src.match(/function initials\(name\)\s*\{([\s\S]*?)\n\s*\}/);
    if (m && CANON_MARKERS.every(marker => m[1].includes(marker))) return m[1];
    sleepMs(50); // wait out a concurrent mutation-harness window, then re-read
  }
  throw new Error(`could not read a canonical initials() from ${file} after retries — real regression, or its mutation harness never restored`);
}
function extractInitials(file) {
  // eslint-disable-next-line no-new-func
  return new Function('name', readCanonicalInitialsBody(file));
}

const idxInitials = extractInitials('index.html');
const castInitials = extractInitials('cast/index.html');

// --- Twin-lock: both copies agree on every input ------------------------------
const INPUTS = [
  'Queen Scarlet',
  'Max',
  'John Adam Smith',
  '  leading  spaces  ',
  'bob jones',
  'ó blade',        // non-ASCII first glyph
  'X',
  '',
  '   ',
  null,
  undefined,
  42,               // numeric — String() coerces to "42" -> "4"
];
for (const inp of INPUTS) {
  eq(idxInitials(inp), castInitials(inp), `twin-lock disagreement on input ${JSON.stringify(inp)}`);
}

// --- Behavior lock (canonical) ------------------------------------------------
eq(idxInitials('Queen Scarlet'), 'QS', 'two-word name -> first letters, uppercased');
eq(idxInitials('John Adam Smith'), 'JA', 'three-word name -> first TWO initials only (slice 0,2)');
eq(idxInitials('bob jones'), 'BJ', 'lowercase input is uppercased');
eq(idxInitials('  leading  spaces  '), 'LS', 'collapses runs of whitespace, ignores leading/trailing');
eq(idxInitials('Max'), 'M', 'single-word name -> one initial');
eq(idxInitials(''), '?', 'empty string -> ? fallback');
eq(idxInitials('   '), '?', 'all-whitespace -> ? fallback');

// --- Null-safety lock (the actual divergence this closes) ---------------------
eq(idxInitials(null), '?', 'index.html: null name -> ? (not a throw)');
eq(idxInitials(undefined), '?', 'index.html: undefined name -> ? (not a throw)');
eq(castInitials(null), '?', 'cast: null name -> ?');
// Prove the OLD raw form would actually throw on null (so the null-safety is real,
// not incidental) — mirrors the raw pre-consolidation body index.html used to carry.
let threw = false;
try { (new Function('name', 'const parts = name.split(/\\s+/).filter(Boolean); return parts.map(p => p[0]?.toUpperCase()).slice(0,2).join("") || "?";'))(null); }
catch { threw = true; }
ok(threw, 'the raw (pre-fix) form throws on null — confirming the String() coercion is load-bearing');

// --- Mutation guards ----------------------------------------------------------
// Drop the slice(0,2): 'John Adam Smith' would become 'JAS'.
eq(idxInitials('John Adam Smith') === 'JAS', false, 'mutation: slice(0,2) cap is enforced (not JAS)');
// Drop the toUpperCase: 'bob jones' would become 'bj'.
eq(idxInitials('bob jones') === 'bj', false, 'mutation: toUpperCase is enforced (not bj)');
// Drop the ||"?": '' would become '' not '?'.
eq(idxInitials('') === '', false, "mutation: ||'?' fallback is enforced (empty -> ?)");

console.log(`\ninitials twin-lock: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
