// Tests for The Hunter's cross-tier matching cores (cross-tier-core.js) —
// parseEmbedding + cosineSimilarity, the pure heart of the script→raw,
// raw→selects, and selects→finished match ranking (every `.sort((a,b)=>
// b.similarity-a.similarity)` in cross-tier-matching.mjs).
//
// THE BUG (memory obs 3578/3579 flagged the area; the precise bug is narrower
// and real): the inline parseEmbedding returned a NaN/Infinity-bearing array
// verbatim, and cosineSimilarity's `denom > 0 ? dot/denom : 0` guard caught the
// NaN-from-non-numeric-token case (NaN > 0 === false → 0) BUT NOT the
// Infinity-from-overflow case: an embedding with an overflow token ("1e999")
// or a JS Infinity gives denom = Infinity, `Infinity > 0` is true, and
// `Infinity / Infinity = NaN`. That NaN similarity then poisons V8's TimSort
// comparator in every match `.sort(...)`, silently scrambling the ranking —
// not just the bad row. The fix hardens parseEmbedding to GUARANTEE a non-empty
// array of FINITE numbers (drop the whole vector to null on any non-finite
// value), mirroring the already-hardened api/_lib/semantic-search.js (commit
// 2dfe675). cosineSimilarity's existing `!va` guard then returns 0 → the corrupt
// embedding sorts to the bottom instead of poisoning the sort.
//
// Byte-identical for clean finite embeddings (the universal real case); only
// corrupt inputs change, to the strictly-safer null→0 path. The functions were
// extracted VERBATIM from cross-tier-matching.mjs (which reads .env + builds the
// Supabase client + runs main() at module load, so it can't be imported
// headlessly); the inline copies are deleted; the worker imports cosineSimilarity
// from here.

import { parseEmbedding, cosineSimilarity } from './cross-tier-core.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(`✗ ${msg}`); } }
function approx(a, b, msg, tol = 1e-9) { if (Math.abs(a - b) <= tol) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ~${b}\n    got      ${a}`); } }

// ─────────────────────────────────────────────────────────────────────────
// RED PROOF — reconstruct the OLD inline behavior and show the Infinity hole.
// The old parseEmbedding returned the array verbatim; with the denom>0 guard,
// an Infinity-bearing vector emitted NaN (Infinity/Infinity), and that NaN
// poisoned the sort. The SHIPPED hardened path returns 0 instead.
// ─────────────────────────────────────────────────────────────────────────
function oldParseEmbedding(emb) {
  if (Array.isArray(emb)) return emb;
  if (typeof emb === 'string') {
    try { return JSON.parse(emb); } catch {}
    return emb.replace(/[[\]()]/g, '').split(',').map(Number);
  }
  return null;
}
function cosineFrom(parse, a, b) {
  const va = parse(a), vb = parse(b);
  if (!va || !vb || va.length !== vb.length) return 0;
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < va.length; i++) { dot += va[i] * vb[i]; nA += va[i] * va[i]; nB += vb[i] * vb[i]; }
  const denom = Math.sqrt(nA) * Math.sqrt(nB);
  return denom > 0 ? dot / denom : 0;     // the SHIPPED cosine math, exact
}
const overflowVec = '(1e999,0.2,0.3)';     // overflow token → Infinity-bearing array
const goodVec = '[0.4,0.5,0.6]';
ok(Number.isNaN(cosineFrom(oldParseEmbedding, overflowVec, goodVec)),
   'RED proof: the OLD parse + the denom>0 guard STILL emits NaN on an overflow embedding');
ok(cosineSimilarity(overflowVec, goodVec) === 0,
   'FIX: the shipped (hardened) cosineSimilarity returns 0 on the same overflow embedding');
// And that NaN actually poisons a sort (why returning 0 matters):
const poisoned = [{ s: 0.9 }, { s: cosineFrom(oldParseEmbedding, overflowVec, goodVec) }, { s: 0.5 }, { s: 0.7 }];
poisoned.sort((a, b) => b.s - a.s);
ok(!(poisoned[0].s === 0.9 && poisoned[1].s === 0.7 && poisoned[2].s === 0.5),
   'RED proof: a NaN sim scrambles the ranking order (V8 TimSort poison)');

// ─────────────────────────────────────────────────────────────────────────
// parseEmbedding — coercion contract (hardened: always a finite array OR null)
// ─────────────────────────────────────────────────────────────────────────
eq(parseEmbedding([0.1, 0.2, 0.3]), [0.1, 0.2, 0.3], 'array passes through (finite)');
eq(parseEmbedding('[0.1,0.2,0.3]'), [0.1, 0.2, 0.3], 'JSON-array string parsed');
eq(parseEmbedding('(0.1,0.2,0.3)'), [0.1, 0.2, 0.3], 'paren pgvector string parsed');
eq(parseEmbedding(['0.1', '0.2']), [0.1, 0.2], 'numeric-string entries coerced (tolerance kept)');
eq(parseEmbedding(null), null, 'null → null');
eq(parseEmbedding(undefined), null, 'undefined → null');
eq(parseEmbedding(42), null, 'number → null');
eq(parseEmbedding({}), null, 'object → null');
eq(parseEmbedding('[]'), null, 'empty JSON array → null (no zero-length vector)');
eq(parseEmbedding([]), null, 'empty array → null');
// The hardening — corrupt vectors are DROPPED, not returned NaN/Infinity-bearing:
eq(parseEmbedding('(0.1,foo,0.3)'), null, 'malformed non-numeric token → null (was a NaN-bearing array)');
eq(parseEmbedding([0.1, NaN, 0.3]), null, 'a JS array carrying NaN → null');
eq(parseEmbedding('(1e999,0.2,0.3)'), null, 'overflow token (→Infinity) → null  ← the fix');
eq(parseEmbedding([Infinity, 0, 0]), null, 'a JS array carrying Infinity → null');
eq(parseEmbedding([0, -Infinity]), null, 'a JS array carrying -Infinity → null');

// ─────────────────────────────────────────────────────────────────────────
// cosineSimilarity — correctness on clean vectors (math unchanged)
// ─────────────────────────────────────────────────────────────────────────
approx(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1, 'identical unit vectors → 1');
approx(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0, 'orthogonal → 0');
approx(cosineSimilarity([1, 0, 0], [-1, 0, 0]), -1, 'opposite → -1');
approx(cosineSimilarity([1, 2, 3], [2, 4, 6]), 1, 'colinear (scaled) → 1');
approx(cosineSimilarity([1, 1], [1, 0]), 1 / Math.SQRT2, '45° vectors → 1/√2');
approx(cosineSimilarity('[1,0,0]', [1, 0, 0]), 1, 'string vs array, identical → 1');
approx(cosineSimilarity('(1,2,3)', '(2,4,6)'), 1, 'two paren-string vectors, scaled → 1');

// ─────────────────────────────────────────────────────────────────────────
// cosineSimilarity — the safety contract (returns 0, NEVER NaN)
// ─────────────────────────────────────────────────────────────────────────
ok(cosineSimilarity('(0.1,foo,0.3)', '[0.4,0.5,0.6]') === 0, 'malformed-string vector → 0');
ok(cosineSimilarity([0.1, NaN, 0.3], [0.4, 0.5, 0.6]) === 0, 'NaN-bearing array → 0');
ok(cosineSimilarity('(1e999,0.2,0.3)', '[0.4,0.5,0.6]') === 0, 'overflow→Infinity vector → 0 (not NaN)');
ok(cosineSimilarity([Infinity, 0, 0], [1, 0, 0]) === 0, 'Infinity-bearing array → 0 (not NaN)  ← the fix');
ok(cosineSimilarity([0, 0, 0], [1, 2, 3]) === 0, 'zero vector → 0 (denom 0, no divide-by-zero)');
ok(cosineSimilarity(null, [1, 2, 3]) === 0, 'null a → 0');
ok(cosineSimilarity([1, 2, 3], undefined) === 0, 'undefined b → 0');
ok(cosineSimilarity([1, 2, 3], [1, 2]) === 0, 'length mismatch → 0');
ok(cosineSimilarity([], []) === 0, 'two empty vectors → 0 (no NaN)');
// Every result must be a finite number (the sort invariant):
for (const [a, b] of [['(0.1,foo)', '[0.4,0.5]'], ['(1e999,1)', '[1,1]'], [[NaN], [1]], [[Infinity], [1]], [[0, 0], [0, 0]], [null, [1]], [[1, 2], [3, 4]]]) {
  ok(Number.isFinite(cosineSimilarity(a, b)), `cosineSimilarity always finite for ${JSON.stringify([a, b])}`);
}

// ─────────────────────────────────────────────────────────────────────────
// END-TO-END: a corrupt (overflow) embedding among real ones does NOT poison
// the ranking — mirrors scriptToRawMatching / selectsToFinishedAnalysis +
// `.sort((a,b)=>b.similarity-a.similarity)`.
// ─────────────────────────────────────────────────────────────────────────
const query = [1, 0, 0];
const candidates = [
  { id: 'far',     emb: [0, 1, 0] },           // sim 0
  { id: 'corrupt', emb: '(1e999,foo,0)' },     // Infinity/NaN → dropped → 0
  { id: 'best',    emb: [1, 0, 0] },           // sim 1
  { id: 'mid',     emb: [0.7, 0.7, 0] },       // ~0.707
];
const ranked = candidates
  .map(c => ({ id: c.id, sim: cosineSimilarity(query, c.emb) }))
  .sort((a, b) => b.sim - a.sim);
eq(ranked.map(r => r.id), ['best', 'mid', 'far', 'corrupt'],
   'corrupt embedding sinks to the bottom; real candidates stay correctly ranked');
ok(ranked.every(r => Number.isFinite(r.sim)), 'every ranked similarity is finite (no NaN in the sort)');

console.log(`cross-tier-core: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + fails.join('\n')); process.exit(1); }
