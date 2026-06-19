// Coverage for the Interpreter command-palette pure cores: fuzzyScore (the ⌘K
// fuzzy ranker) + parseRecent (the hardened recents loader).
//
// fuzzyScore: verifier-layer LOCK (no live bug — every assertion is
// mutation-proven to fail if the scoring logic regresses).
// parseRecent: a REAL defensive fix — the old loadRecent returned a non-array
// (e.g. '{}') verbatim, and render()'s loadRecent().map(...) then threw,
// breaking ⌘K. Imports the REAL shipped functions (no mirror, can't drift).

import { fuzzyScore, parseRecent, escapeReg } from './command-palette-core.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// ─────────────────────────────────────────────────────────────────────────
// parseRecent — the bug fix
// ─────────────────────────────────────────────────────────────────────────

// INLINE RED PROOF: reconstruct the OLD loadRecent body and show it returns a
// non-array for valid-JSON-but-not-array, then crashes the render path.
const oldLoad = (raw) => JSON.parse((raw ?? null) || '[]');
{
  const oldOut = oldLoad('{}');
  ok(!Array.isArray(oldOut), 'RED proof: old logic returns a non-array for "{}"');
  let threw = false;
  try { oldOut.map(x => x); } catch { threw = true; }
  ok(threw, 'RED proof: old non-array result throws on .map (the ⌘K break)');
}

// The fix: every degenerate input degrades to an array.
ok(Array.isArray(parseRecent('{}')), 'parseRecent("{}") is an array');
eq(parseRecent('{}').length, 0, 'parseRecent("{}") → []');
ok(Array.isArray(parseRecent('null')), 'parseRecent("null") is an array');
eq(parseRecent('null').length, 0, 'parseRecent("null") → []');
ok(Array.isArray(parseRecent('42')), 'parseRecent("42") is an array');
eq(parseRecent('42').length, 0, 'parseRecent number → []');
ok(Array.isArray(parseRecent('"hi"')), 'parseRecent string → array');
eq(parseRecent('"hi"').length, 0, 'parseRecent string → []');
ok(Array.isArray(parseRecent('not json at all')), 'parseRecent malformed → array');
eq(parseRecent('not json at all').length, 0, 'parseRecent malformed → []');
ok(Array.isArray(parseRecent(null)), 'parseRecent(null) → array (missing key)');
eq(parseRecent(null).length, 0, 'parseRecent(null) → []');
ok(Array.isArray(parseRecent(undefined)), 'parseRecent(undefined) → array');
eq(parseRecent(undefined).length, 0, 'parseRecent(undefined) → []');
ok(Array.isArray(parseRecent('')), 'parseRecent("") → array');
eq(parseRecent('').length, 0, 'parseRecent("") → [] (empty string)');

// Valid arrays pass through, contents preserved.
{
  const arr = parseRecent('[{"id":"a:save","label":"Save"},{"id":"t:1","label":"Doc"}]');
  ok(Array.isArray(arr), 'parseRecent valid array → array');
  eq(arr.length, 2, 'parseRecent keeps both items');
  eq(arr[0].id, 'a:save', 'parseRecent preserves first id');
  eq(arr[1].label, 'Doc', 'parseRecent preserves second label');
}
eq(parseRecent('[]').length, 0, 'parseRecent("[]") → empty array');
// Result of every call is .map/.filter-safe (the property the render path needs).
for (const raw of ['{}', 'null', '42', 'x', null, undefined, '[1,2]']) {
  let threw = false;
  try { parseRecent(raw).map(x => x).filter(Boolean); } catch { threw = true; }
  ok(!threw, `parseRecent(${JSON.stringify(raw)}) result is .map/.filter-safe`);
}

// ─────────────────────────────────────────────────────────────────────────
// fuzzyScore — verifier-layer lock
// ─────────────────────────────────────────────────────────────────────────

// Empty query → constant 1 (everything shows, no ranking).
eq(fuzzyScore('', 'Translate', 'Actions', ''), 1, 'empty query → 1');

// Exact substring scores 100+; an exact prefix gets the +60 and +30 bonuses.
eq(fuzzyScore('translate', 'Translate', 'Actions', ''), 100 + 60 + 30 + 20, 'exact prefix label: 100+60+30+subseq(20)');
// substring not at start, but at a word boundary ("Export SRT" matches "srt" at a boundary)
{
  const s = fuzzyScore('srt', 'Export SRT', 'Actions', '');
  ok(s >= 100 + 30, 'mid-label word-boundary substring gets +100 and +30');
  ok(s < 100 + 60 + 30 + 20, 'non-prefix substring does NOT get the +60 starts-with bonus');
}
// substring present but NOT at a word boundary → no +30
{
  const s = fuzzyScore('ranslat', 'Translate', 'Actions', '');
  ok(s >= 100, 'interior substring scores at least 100');
  ok(s < 100 + 30, 'interior substring (no word boundary) gets no +30');
}

// group / hint substring adds +15 even when the label does not match.
{
  const s = fuzzyScore('action', 'Save', 'Actions', '');
  eq(s, 15, 'query matches group only → +15');
}
{
  const s = fuzzyScore('step 4', 'Doc', 'Go to', 'Step 4 · Translate');
  ok(s >= 15, 'query matches hint → at least +15');
}

// Subsequence (in-order, non-contiguous chars) gets up to +20, no substring 100.
{
  const s = fuzzyScore('tte', 'Translate', 'Actions', ''); // t..t..e in order, not contiguous
  ok(s > 0, 'subsequence match scores > 0');
  ok(s < 100, 'pure subsequence (not a substring) scores below 100');
}
// earlier first-char position → bigger subsequence bonus.
{
  const early = fuzzyScore('ae', 'Apple', 'g', ''); // a at index 0
  const late = fuzzyScore('ae', 'Grape', 'g', '');  // a at index 2
  ok(early > late, 'subsequence bonus larger when first char appears earlier');
}

// No match anywhere → 0 (item gets filtered out by the caller).
eq(fuzzyScore('zzz', 'Translate', 'Actions', 'Step 1'), 0, 'no match → 0');

// Regex-special query never throws and matches literally (escapeReg).
{
  let threw = false, s = 0;
  try { s = fuzzyScore('c++', 'c++ build', 'Actions', ''); } catch { threw = true; }
  ok(!threw, 'regex-special query does not throw');
  ok(s >= 100, 'regex-special query matches literally (substring)');
}
// escapeReg unit
eq(escapeReg('a.b*c'), 'a\\.b\\*c', 'escapeReg escapes regex metachars');
eq(escapeReg('plain'), 'plain', 'escapeReg leaves plain text');

// Case-insensitive.
ok(fuzzyScore('TRANS', 'translate', 'g', '') >= 100, 'matching is case-insensitive');

// ─────────────────────────────────────────────────────────────────────────
console.log(`command-palette-core: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
