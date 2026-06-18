// Tests for the QSS "Let's touch base" pure cores (api/_lib/touch-base-normalize.js).
// Imports the REAL shipped functions. Mutation-proven: each assertion is built
// to go RED if the corresponding logic regresses.
//
// run: node api/_lib/touch-base-normalize.test.mjs   (or via `bun run test`)

import { buildTrimmedBlocks, buildSpine, normalizeTouchBase } from './touch-base-normalize.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ── RED PROOF: the OLD inline normalizer (verbatim) crashed on a literal-null parse ──
function oldNormalize(parsed) {
  const ALLOWED_STATUS = new Set(['present', 'partial', 'missing']);
  const ingredients = Array.isArray(parsed.ingredients) ? parsed.ingredients : [];
  const safeIngredients = ingredients
    .filter(i => i && typeof i === 'object')
    .map(i => ({ key: String(i.key || '').slice(0, 32), name: String(i.name || '').slice(0, 80), status: ALLOWED_STATUS.has(i.status) ? i.status : 'partial', note: String(i.note || '').slice(0, 200) }))
    .slice(0, 12);
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const safeSuggestions = suggestions.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().slice(0, 300)).slice(0, 4);
  const summary = String(parsed.summary || '').slice(0, 1200);
  const concern = (typeof parsed.concern === 'string' && parsed.concern.trim()) ? parsed.concern.trim().slice(0, 400) : null;
  return { summary, concern, ingredients: safeIngredients, suggestions: safeSuggestions };
}

t('RED proof: old inline normalize THREW on JSON.parse("null")', () => {
  const parsed = JSON.parse('null'); // === null
  assert.throws(() => oldNormalize(parsed), TypeError, 'old code should crash on null parse');
});

t('RED proof: shipped normalizeTouchBase does NOT throw on null parse (the hardening)', () => {
  const out = normalizeTouchBase(JSON.parse('null'));
  assert.deepEqual(out, { summary: '', concern: null, ingredients: [], suggestions: [] });
});

// ── normalizeTouchBase: non-object parse hardening ──
t('null → all-defaults', () => {
  assert.deepEqual(normalizeTouchBase(null), { summary: '', concern: null, ingredients: [], suggestions: [] });
});
t('undefined → all-defaults', () => {
  assert.deepEqual(normalizeTouchBase(undefined), { summary: '', concern: null, ingredients: [], suggestions: [] });
});
t('number parse (42) → all-defaults, no throw', () => {
  assert.deepEqual(normalizeTouchBase(42), { summary: '', concern: null, ingredients: [], suggestions: [] });
});
t('array parse → all-defaults (arrays have no ingredients/suggestions keys)', () => {
  assert.deepEqual(normalizeTouchBase([1, 2, 3]), { summary: '', concern: null, ingredients: [], suggestions: [] });
});
t('string parse → all-defaults, no throw', () => {
  assert.deepEqual(normalizeTouchBase('hello'), { summary: '', concern: null, ingredients: [], suggestions: [] });
});

// ── normalizeTouchBase: summary ──
t('summary passes through', () => {
  assert.equal(normalizeTouchBase({ summary: 'we are in the cafeteria' }).summary, 'we are in the cafeteria');
});
t('summary capped at 1200', () => {
  const out = normalizeTouchBase({ summary: 'x'.repeat(5000) });
  assert.equal(out.summary.length, 1200);
});
t('missing summary → empty string', () => {
  assert.equal(normalizeTouchBase({}).summary, '');
});
t('non-string summary (number) coerced via String()', () => {
  assert.equal(normalizeTouchBase({ summary: 7 }).summary, '7');
});
t('null summary → empty string (|| guard)', () => {
  assert.equal(normalizeTouchBase({ summary: null }).summary, '');
});

// ── normalizeTouchBase: concern ──
t('concern passes through trimmed', () => {
  assert.equal(normalizeTouchBase({ concern: '  the dragon vanished  ' }).concern, 'the dragon vanished');
});
t('concern capped at 400', () => {
  assert.equal(normalizeTouchBase({ concern: 'y'.repeat(900) }).concern.length, 400);
});
t('empty/whitespace concern → null', () => {
  assert.equal(normalizeTouchBase({ concern: '   ' }).concern, null);
});
t('missing concern → null', () => {
  assert.equal(normalizeTouchBase({}).concern, null);
});
t('non-string concern → null (not coerced)', () => {
  assert.equal(normalizeTouchBase({ concern: 5 }).concern, null);
});

// ── normalizeTouchBase: ingredients ──
t('ingredient shape mapped + capped fields', () => {
  const out = normalizeTouchBase({ ingredients: [{ key: 'k'.repeat(40), name: 'n'.repeat(100), status: 'present', note: 'z'.repeat(300) }] });
  assert.equal(out.ingredients.length, 1);
  const ing = out.ingredients[0];
  assert.equal(ing.key.length, 32);
  assert.equal(ing.name.length, 80);
  assert.equal(ing.status, 'present');
  assert.equal(ing.note.length, 200);
});
t('valid statuses preserved', () => {
  for (const s of ['present', 'partial', 'missing']) {
    assert.equal(normalizeTouchBase({ ingredients: [{ status: s }] }).ingredients[0].status, s);
  }
});
t('invalid status → "partial" fallback', () => {
  assert.equal(normalizeTouchBase({ ingredients: [{ status: 'great' }] }).ingredients[0].status, 'partial');
  assert.equal(normalizeTouchBase({ ingredients: [{ status: 'PRESENT' }] }).ingredients[0].status, 'partial'); // case-sensitive
  assert.equal(normalizeTouchBase({ ingredients: [{}] }).ingredients[0].status, 'partial');
});
t('non-object ingredients filtered out', () => {
  const out = normalizeTouchBase({ ingredients: ['str', 5, null, { key: 'ok' }] });
  assert.equal(out.ingredients.length, 1);
  assert.equal(out.ingredients[0].key, 'ok');
});
t('ingredients capped at 12', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}` }));
  assert.equal(normalizeTouchBase({ ingredients: many }).ingredients.length, 12);
});
t('non-array ingredients → []', () => {
  assert.deepEqual(normalizeTouchBase({ ingredients: 'nope' }).ingredients, []);
  assert.deepEqual(normalizeTouchBase({ ingredients: { key: 'x' } }).ingredients, []);
});
t('missing ingredient fields default to empty strings', () => {
  const ing = normalizeTouchBase({ ingredients: [{}] }).ingredients[0];
  assert.deepEqual(ing, { key: '', name: '', status: 'partial', note: '' });
});

// ── normalizeTouchBase: suggestions ──
t('string suggestions trimmed + kept', () => {
  assert.deepEqual(normalizeTouchBase({ suggestions: ['  go deeper  ', 'add a villain'] }).suggestions, ['go deeper', 'add a villain']);
});
t('non-string + empty suggestions filtered', () => {
  assert.deepEqual(normalizeTouchBase({ suggestions: ['keep', 5, null, '   ', { x: 1 }] }).suggestions, ['keep']);
});
t('suggestion capped at 300', () => {
  assert.equal(normalizeTouchBase({ suggestions: ['s'.repeat(900)] }).suggestions[0].length, 300);
});
t('suggestions capped at 4', () => {
  const many = Array.from({ length: 10 }, (_, i) => `idea ${i}`);
  assert.equal(normalizeTouchBase({ suggestions: many }).suggestions.length, 4);
});
t('non-array suggestions → []', () => {
  assert.deepEqual(normalizeTouchBase({ suggestions: 'one' }).suggestions, []);
});

// ── buildSpine ──
t('spine numbers 1-based with summaries', () => {
  assert.equal(buildSpine([{ summary: 'kevin signs' }, { summary: 'drone arrives' }]), '1. kevin signs\n2. drone arrives');
});
t('spine missing/blank summary → "(no summary yet)"', () => {
  assert.equal(buildSpine([{ summary: '' }, {}, { summary: '   ' }]), '1. (no summary yet)\n2. (no summary yet)\n3. (no summary yet)');
});
t('spine trims summary whitespace', () => {
  assert.equal(buildSpine([{ summary: '  hi  ' }]), '1. hi');
});
t('spine empty array → empty string', () => {
  assert.equal(buildSpine([]), '');
});
t('spine non-array → empty string (no throw)', () => {
  assert.equal(buildSpine(null), '');
  assert.equal(buildSpine(undefined), '');
});
t('spine capped at 4000 chars', () => {
  const blocks = Array.from({ length: 500 }, () => ({ summary: 'a'.repeat(50) }));
  assert.ok(buildSpine(blocks).length <= 4000);
});

// ── buildTrimmedBlocks ──
t('trimmed: summary head when present', () => {
  assert.equal(buildTrimmedBlocks([{ text: 'the body', summary: 'kevin runs' }]), 'Block 1 (what happens: kevin runs): the body');
});
t('trimmed: no summary → bare "Block N" head', () => {
  assert.equal(buildTrimmedBlocks([{ text: 'the body' }]), 'Block 1: the body');
});
t('trimmed: blank/whitespace summary → bare head', () => {
  assert.equal(buildTrimmedBlocks([{ text: 'b', summary: '   ' }]), 'Block 1: b');
});
t('trimmed: per-block text capped at 800', () => {
  const out = buildTrimmedBlocks([{ text: 'x'.repeat(2000) }]);
  // "Block 1: " (9) + 800 chars
  assert.equal(out.length, 9 + 800);
});
t('trimmed: joins blocks with double-newline, 1-based numbering', () => {
  assert.equal(buildTrimmedBlocks([{ text: 'a' }, { text: 'b' }]), 'Block 1: a\n\nBlock 2: b');
});
t('trimmed: missing text → empty body', () => {
  assert.equal(buildTrimmedBlocks([{}]), 'Block 1: ');
});
t('trimmed: empty array → empty string', () => {
  assert.equal(buildTrimmedBlocks([]), '');
});
t('trimmed: non-array → empty string (no throw)', () => {
  assert.equal(buildTrimmedBlocks(null), '');
  assert.equal(buildTrimmedBlocks(undefined), '');
});
t('trimmed: whole view capped at 30000 chars', () => {
  const blocks = Array.from({ length: 100 }, () => ({ text: 'z'.repeat(800) }));
  assert.ok(buildTrimmedBlocks(blocks).length <= 30_000);
});

console.log(`\ntouch-base-normalize: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
