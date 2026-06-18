// Tests for Hunter's semantic-search fallback cores (api/_lib/semantic-search.js):
// parseEmbedding (PostgREST embedding → clean numeric vector or null) and
// cosineSim (ranking metric). Imports the REAL shipped functions.
//
// Run: bun api/_lib/semantic-search.test.mjs   (also auto-discovered by `bun run test`)

import { parseEmbedding, cosineSim } from './semantic-search.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; fails.push(msg); }
}
function near(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

// ── parseEmbedding: happy paths ──────────────────────────────────────────────

// pgvector usually arrives as a JSON string literal.
ok(JSON.stringify(parseEmbedding('[0.1,0.2,0.3]')) === JSON.stringify([0.1, 0.2, 0.3]),
  'JSON-string embedding parses to numeric array');

// Already an array of numbers → clean numeric array back.
ok(JSON.stringify(parseEmbedding([1, 2, 3])) === JSON.stringify([1, 2, 3]),
  'array embedding passes through as numbers');

// Negative + scientific notation survive.
{
  const r = parseEmbedding('[-0.5,1e-3,2.25]');
  ok(r && near(r[0], -0.5) && near(r[1], 0.001) && near(r[2], 2.25),
    'negatives and scientific notation parse correctly');
}

// Paren-wrapped literal (the reason the fallback regex strips parens).
{
  const r = parseEmbedding('(0.1,0.2,0.3)');
  ok(r && r.length === 3 && near(r[0], 0.1) && near(r[2], 0.3),
    'paren-wrapped literal parses via fallback');
}

// Bracketed literal that is also valid JSON.
{
  const r = parseEmbedding('[1, 2, 3]');
  ok(r && r.length === 3 && r[1] === 2, 'spaced bracket literal parses');
}

// Numeric strings inside an array are coerced (old behavior preserved).
{
  const r = parseEmbedding(['0.1', '0.2']);
  ok(r && near(r[0], 0.1) && near(r[1], 0.2), 'numeric-string array entries coerced to numbers');
  ok(typeof r[0] === 'number' && typeof r[1] === 'number', 'coerced entries are real numbers');
}

// A realistic 768-dim vector survives intact.
{
  const big = Array.from({ length: 768 }, (_, i) => (i % 7) * 0.013 - 0.04);
  const r = parseEmbedding(JSON.stringify(big));
  ok(r && r.length === 768 && near(r[100], big[100]) && near(r[767], big[767]),
    '768-dim embedding round-trips');
}

// ── parseEmbedding: the hardening (reject anything that would poison ranking) ─

// The core hardening: any vector that would carry a non-finite value into
// cosineSim (→ NaN similarity → scrambled sort) must be dropped to null.

// Arrays that directly contain non-finite values (the Array fast-path used to
// return these verbatim → NaN cosine → poisoned ranking).
ok(parseEmbedding([1, NaN, 3]) === null, 'array containing NaN → null');
ok(parseEmbedding([1, Infinity]) === null, 'array containing Infinity → null');
ok(parseEmbedding([1, -Infinity, 2]) === null, 'array containing -Infinity → null');

// Strings whose tokens are non-numeric used to yield [NaN,...] → now null.
ok(parseEmbedding('abc,def') === null, 'non-numeric CSV → null (was [NaN,NaN])');
ok(parseEmbedding('[0.1,foo,0.3]') === null, 'one bad token poisons the whole vector → null');
ok(parseEmbedding('[1,2,Infinity]') === null,
  'Infinity token → null (not valid JSON; fallback Number("Infinity") rejected)');

// JSON.parse yields a non-array that the fallback can't rescue → null.
ok(parseEmbedding('{}') === null, 'object literal string → null');
ok(parseEmbedding('"hi"') === null, 'JSON string literal → null');
ok(parseEmbedding('true') === null, 'boolean literal → null');
ok(parseEmbedding('null') === null, 'literal "null" → null');

// Empty containers → null.
ok(parseEmbedding('[]') === null, 'empty array string → null');
ok(parseEmbedding([]) === null, 'empty JS array → null');

// Non-string/array inputs → null.
ok(parseEmbedding(null) === null, 'null input → null');
ok(parseEmbedding(undefined) === null, 'undefined input → null');
ok(parseEmbedding(42) === null, 'number input → null');
ok(parseEmbedding({}) === null, 'object input → null');

// Harmless degenerate cases: a scalar numeric string becomes a length-1 vector
// (NOT null, but also NOT NaN) — cosineSim safely returns 0 on length mismatch,
// so it can't poison the ranking. Documented so the contract is explicit.
{
  const r = parseEmbedding('0.5');
  ok(Array.isArray(r) && r.length === 1 && r[0] === 0.5 && !Number.isNaN(r[0]),
    'scalar numeric string → harmless [0.5], never a bare scalar or NaN');
}

// ── parseEmbedding: RED proof — reconstruct the OLD function and show the gap ─
function oldParseEmbedding(emb) {
  if (Array.isArray(emb)) return emb;
  if (typeof emb === 'string') {
    try { return JSON.parse(emb); } catch {}
    return emb.replace(/[[\]()]/g, '').split(',').map(Number);
  }
  return null;
}
// The old code returned an array WITH a NaN, which the caller's `if (!emb)`
// guard could not catch (a populated array is truthy) — that NaN then reached
// cosineSim and produced a NaN similarity.
{
  const oldBad = oldParseEmbedding('[0.1,foo,0.3]');
  ok(Array.isArray(oldBad) && oldBad.some(Number.isNaN),
    'RED proof: old code returned a NaN-bearing array for a bad token');
  ok(parseEmbedding('[0.1,foo,0.3]') === null,
    'fix: new code rejects the NaN-bearing vector');
}
{
  const oldArr = oldParseEmbedding([1, NaN, 3]);
  ok(Array.isArray(oldArr) && oldArr.some(Number.isNaN),
    'RED proof: old code returned a NaN-bearing array verbatim (Array fast-path)');
  ok(parseEmbedding([1, NaN, 3]) === null, 'fix: new code rejects it');
}

// ── cosineSim: correctness ───────────────────────────────────────────────────

ok(cosineSim([1, 0], [1, 0]) === 1, 'identical unit vectors → 1');
ok(cosineSim([1, 0], [0, 1]) === 0, 'orthogonal vectors → 0');
ok(near(cosineSim([1, 0], [-1, 0]), -1), 'opposite vectors → -1');
ok(near(cosineSim([1, 1], [1, 1]), 1), 'parallel non-unit vectors → 1');
ok(near(cosineSim([2, 0], [5, 0]), 1), 'magnitude-invariant (both along x) → 1');
{
  // 45° between [1,0] and [1,1] → cos = 1/sqrt(2)
  ok(near(cosineSim([1, 0], [1, 1]), 1 / Math.sqrt(2)), '45° → 1/sqrt(2)');
}
ok(cosineSim([0, 0], [1, 1]) === 0, 'zero-magnitude vector → 0 (no divide-by-zero)');
ok(cosineSim([1, 2, 3], [1, 2]) === 0, 'length mismatch → 0');
ok(cosineSim(null, [1, 2]) === 0, 'null a → 0');
ok(cosineSim([1, 2], null) === 0, 'null b → 0');
ok(cosineSim([], []) === 0, 'empty vectors → 0');
// symmetry
ok(near(cosineSim([0.3, 0.5, 0.2], [0.1, 0.9, 0.4]), cosineSim([0.1, 0.9, 0.4], [0.3, 0.5, 0.2])),
  'cosineSim is symmetric');

// ── End-to-end: parseEmbedding → cosineSim ranking does not get poisoned ──────
// One malformed row must drop out (null) instead of injecting a NaN similarity
// that would scramble the sort of the good rows.
{
  const query = [1, 0, 0];
  const rows = [
    { id: 'a', embedding: '[1,0,0]' },     // perfect match → 1
    { id: 'b', embedding: '[0,1,0]' },     // orthogonal → 0
    { id: 'bad', embedding: '[1,oops,0]' },// malformed (NaN token) → must be skipped
    { id: 'c', embedding: '[0.9,0.1,0]' }, // close → high
  ];
  const results = [];
  for (const row of rows) {
    const emb = parseEmbedding(row.embedding);
    if (!emb) continue; // mirror the caller's guard
    results.push({ id: row.id, sim: cosineSim(query, emb) });
  }
  ok(results.length === 3, 'malformed row dropped (3 of 4 ranked)');
  ok(!results.some(r => Number.isNaN(r.sim)), 'no NaN similarity reached the result set');
  results.sort((x, y) => y.sim - x.sim);
  ok(results[0].id === 'a' && results[results.length - 1].id === 'b',
    'ranking is correct and stable with the bad row removed');
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`semantic-search: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of fails) console.log('  FAIL:', m); process.exit(1); }
