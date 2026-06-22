// Lock for matrixBands (public/westchester/index.html) — the quintile rank-coloring
// behind the DECISION MATRIX, the side-by-side top-5 home comparison Johnny uses on
// his ACTIVE house hunt. For each criterion row (14 of them) it colors every cell by
// where that home ranks vs the others: '5'=best … '1'=worst, null=no data.
// lowerIsBetter inverts the rank (price / commute / monthly: smaller wins). A silent
// regression here mis-colors which home "looks best" on a row — wrong visual signal on
// a real buy decision, no error.
//
// EXTRACTS the real shipped matrixBands from index.html at runtime (brace-match +
// new Function) so the lock can't drift from a mirror. The function references only
// parseFloat / Number / Math, so it materializes self-contained.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

function loadReal(src) {
  const fnStart = src.indexOf('function matrixBands(rawValues, lowerIsBetter) {');
  assert.ok(fnStart >= 0, 'matrixBands not found');
  let i = src.indexOf('{', fnStart);
  let depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, 'could not brace-match matrixBands');
  const fnSrc = src.slice(fnStart, end);
  return new Function(`${fnSrc}\n return matrixBands;`)();
}

const matrixBands = loadReal(html);

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('✗', name, '—', e.message); } };

// ─────────────────────────────────────────────────────────────────────────────
// Inline RED proof: a rank-blind bander (one that gives every numeric cell the same
// band, or ignores lowerIsBetter) would FAIL to distinguish best from worst. The
// shipped matrixBands must produce a strict best→worst gradient for distinct values.
// ─────────────────────────────────────────────────────────────────────────────
t('RED-proof: distinct values get a strict best→worst gradient (not all one band)', () => {
  const bands = matrixBands([90, 80, 70, 60, 50], false); // higher is better
  // 5 distinct values → 5 distinct bands, best first
  assert.deepStrictEqual(bands, ['5', '4', '3', '2', '1']);
  // a rank-blind implementation would return e.g. all '5' or all '3' — explicitly not this
  assert.notDeepStrictEqual(bands, ['5', '5', '5', '5', '5']);
});

t('RED-proof: lowerIsBetter inverts the gradient', () => {
  // same values, but smaller wins (price/commute/monthly)
  const bands = matrixBands([90, 80, 70, 60, 50], true);
  assert.deepStrictEqual(bands, ['1', '2', '3', '4', '5']); // 50 is best now
});

// ── Core gradient (higher-is-better) ──
t('5 distinct values → 5,4,3,2,1 in input order', () => {
  assert.deepStrictEqual(matrixBands([50, 90, 60, 80, 70], false), ['1', '5', '2', '4', '3']);
});

t('2 values → best/worst (5,1)', () => {
  assert.deepStrictEqual(matrixBands([80, 40], false), ['5', '1']);
});

t('3 values → 5,3,1', () => {
  assert.deepStrictEqual(matrixBands([100, 50, 10], false), ['5', '3', '1']);
});

// ── lowerIsBetter ──
t('lowerIsBetter: smallest gets band 5', () => {
  // price-like: 500k, 800k, 1.2M
  const bands = matrixBands([500000, 800000, 1200000], true);
  assert.strictEqual(bands[0], '5'); // cheapest = best
  assert.strictEqual(bands[2], '1'); // priciest = worst
});

t('lowerIsBetter two values → smaller is 5', () => {
  assert.deepStrictEqual(matrixBands([30, 12], true), ['1', '5']); // 12 wins
});

// ── Null / missing data ──
t('fewer than 2 numeric values → all null (no banding)', () => {
  assert.deepStrictEqual(matrixBands([42, null, null], false), [null, null, null]);
  assert.deepStrictEqual(matrixBands([null, null], false), [null, null]);
  assert.deepStrictEqual(matrixBands([], false), []);
});

t('null/undefined cells stay null; numeric cells still banded among themselves', () => {
  const bands = matrixBands([90, null, 50, undefined, 70], false);
  assert.strictEqual(bands[1], null);
  assert.strictEqual(bands[3], null);
  // 90,50,70 banded: 90→5, 70→3, 50→1
  assert.strictEqual(bands[0], '5');
  assert.strictEqual(bands[4], '3');
  assert.strictEqual(bands[2], '1');
});

// ── Numeric strings coerced (the matrix feeds raw values that can be strings) ──
t('numeric strings are coerced and banded', () => {
  assert.deepStrictEqual(matrixBands(['90', '50'], false), ['5', '1']);
});

t('non-numeric strings → null (treated as no data)', () => {
  const bands = matrixBands(['90', 'foo', '50'], false);
  assert.strictEqual(bands[1], null);
  assert.deepStrictEqual([bands[0], bands[2]], ['5', '1']);
});

// ── Ties: equal values share the same band (indexOf = first rank) ──
t('tied values share the top band', () => {
  // two 80s + lower values, higher-is-better → both 80s get band 5
  const bands = matrixBands([80, 80, 70, 60, 50], false);
  assert.strictEqual(bands[0], '5');
  assert.strictEqual(bands[1], '5');
});

t('all-equal values → all same band 5', () => {
  assert.deepStrictEqual(matrixBands([70, 70, 70], false), ['5', '5', '5']);
});

// ── Quintile boundaries for exactly-5 (the matrix cap) ──
t('exactly 5 distinct values map to the full 5..1 quintile set', () => {
  const bands = matrixBands([5, 4, 3, 2, 1], false);
  assert.deepStrictEqual(bands, ['5', '4', '3', '2', '1']);
});

// ── Robustness ──
t('zero is a valid numeric value (not treated as null)', () => {
  // 0 vs 10, higher-is-better → 0 is worst, 10 is best
  const bands = matrixBands([0, 10], false);
  assert.deepStrictEqual(bands, ['1', '5']);
});

t('negative values band correctly', () => {
  const bands = matrixBands([-5, -1, -10], false); // higher (closer to 0) better
  assert.strictEqual(bands[1], '5'); // -1 best
  assert.strictEqual(bands[2], '1'); // -10 worst
});

console.log(`\nwestchester-matrix-bands: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
