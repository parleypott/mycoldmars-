// First coverage on the V-Dem democracy sandbox's BRAIN — classify() + democracyScore()
// inline in democracy/index.html. Only the URL parser was tested before (url-state.test.mjs);
// the regime classifier and the 0-100 score that drive the entire card had ZERO coverage.
//
// The risk this locks: classify() is an ordered if-chain of 10 regimes (9 named + a catch-all
// Hybrid). Branch ORDER is load-bearing — a more-specific regime sits ABOVE a broader one, so
// a future edit that reorders or broadens a condition can silently SHADOW a named regime,
// making a whole category permanently unreachable (a real, invisible bug: the slider would
// just never produce that label). This test proves every one of the 10 regimes is reachable
// from a concrete slider state, and is mutation-proven: break a branch and its case goes RED.
//
// It EXTRACTS the real shipped classify/democracyScore from index.html at runtime
// (brace-matching + new Function — the same no-drift pattern as flight/great-circle.test.mjs
// and newpress-deck/render-slide.test.mjs), so it cannot drift from a hand-copied mirror.
//
// run: node democracy/classify.test.mjs   (or via `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in index.html`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const CLASSIFY_SRC = extractFn(HTML, 'classify');
const SCORE_SRC = extractFn(HTML, 'democracyScore');

const classify = new Function(CLASSIFY_SRC + '\nreturn classify;')();
const democracyScore = new Function(SCORE_SRC + '\nreturn democracyScore;')();

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n    ${e.message}`); } };
const s = (elections, power, rights, equality, participation) =>
  ({ elections, power, rights, equality, participation });

// ── Reachability lock: every named regime must be produced by some slider state ──
// Each case is a distinct point in the 5-axis cube. If a branch is reordered/broadened so
// it shadows another, the shadowed regime's assertion fails here.
const REGIME_CASES = [
  ['Closed Autocracy',                 s(10, 10, 10, 10, 10)],
  ['Electoral Autocracy',              s(30, 50, 30, 50, 30)],
  ['Plebiscitary Populism',            s(60, 50, 30, 50, 70)],
  ['Oligarchic Democracy',             s(70, 50, 60, 20, 50)],
  ['Illiberal Democracy',              s(70, 50, 40, 50, 50)],
  ['Egalitarian Liberal Democracy',    s(85, 70, 85, 80, 75)],
  ['Consensual Liberal Democracy',     s(70, 65, 65, 50, 50)],
  ['Majoritarian Liberal Democracy',   s(70, 30, 60, 50, 50)],
  ['Liberal Democracy',                s(70, 50, 60, 50, 50)],
  ['Hybrid Regime',                    s(30, 50, 60, 50, 50)],
];

for (const [name, state] of REGIME_CASES) {
  t(`reachable: ${name}`, () => {
    const r = classify(state);
    assert.strictEqual(r.name, name, `expected "${name}", got "${r.name}"`);
  });
}

t('every regime returns a complete card (name/accent/blurb/examples)', () => {
  for (const [, state] of REGIME_CASES) {
    const r = classify(state);
    for (const k of ['name', 'accent', 'blurb', 'examples']) {
      assert.ok(typeof r[k] === 'string' && r[k].length > 0, `missing ${k}`);
    }
    assert.match(r.accent, /^#[0-9A-Fa-f]{6}$/, `accent not 6-hex: ${r.accent}`);
  }
});

t('classify never returns undefined across a 0..100 grid (catch-all always seats)', () => {
  for (let e = 0; e <= 100; e += 20)
    for (let p = 0; p <= 100; p += 25)
      for (let r = 0; r <= 100; r += 20)
        for (let q = 0; q <= 100; q += 50)
          for (let v = 0; v <= 100; v += 50) {
            const out = classify(s(e, p, r, q, v));
            assert.ok(out && typeof out.name === 'string', `no regime for ${[e, p, r, q, v]}`);
          }
});

// ── democracyScore: weighting (0.30e + 0.30r + 0.15p + 0.12q + 0.13v), bounds, rounding ──
t('all-100 scores 100', () => assert.strictEqual(democracyScore(s(100, 100, 100, 100, 100)), 100));
t('all-0 scores 0', () => assert.strictEqual(democracyScore(s(0, 0, 0, 0, 0)), 0));
t('all-50 scores 50 (weights sum to 1)', () => assert.strictEqual(democracyScore(s(50, 50, 50, 50, 50)), 50));
t('elections-only reflects its 0.30 weight', () => assert.strictEqual(democracyScore(s(100, 0, 0, 0, 0)), 30));
t('rights-only reflects its 0.30 weight', () => assert.strictEqual(democracyScore(s(0, 0, 100, 0, 0)), 30));
t('power-only reflects its 0.15 weight', () => assert.strictEqual(democracyScore(s(0, 100, 0, 0, 0)), 15));
t('equality-only reflects its 0.12 weight', () => assert.strictEqual(democracyScore(s(0, 0, 0, 100, 0)), 12));
t('participation-only reflects its 0.13 weight', () => assert.strictEqual(democracyScore(s(0, 0, 0, 0, 100)), 13));
t('elections+rights dominate over power/equality/participation', () => {
  const electoral = democracyScore(s(80, 0, 80, 0, 0));   // 0.30*80 + 0.30*80 = 48
  const procedural = democracyScore(s(0, 80, 0, 80, 80)); // 0.15*80 + 0.12*80 + 0.13*80 = 32
  assert.ok(electoral > procedural, `${electoral} should beat ${procedural}`);
});
t('score stays within 0..100 across a grid', () => {
  for (let e = 0; e <= 100; e += 25)
    for (let p = 0; p <= 100; p += 25)
      for (let r = 0; r <= 100; r += 25)
        for (let q = 0; q <= 100; q += 50)
          for (let v = 0; v <= 100; v += 50) {
            const sc = democracyScore(s(e, p, r, q, v));
            assert.ok(sc >= 0 && sc <= 100 && Number.isInteger(sc), `out of range: ${sc}`);
          }
});
t('score is an integer (Math.round applied)', () => {
  assert.strictEqual(democracyScore(s(33, 33, 33, 33, 33)), 33);
  assert.strictEqual(democracyScore(s(67, 51, 78, 42, 59)), Math.round(67 * 0.30 + 78 * 0.30 + 51 * 0.15 + 42 * 0.12 + 59 * 0.13));
});

// ── Mutation proofs: prove the reachability lock is load-bearing ──
// (1) Break the Egalitarian branch condition -> that regime becomes unreachable -> the
//     reachability assertion above would go RED. We simulate the broken edit on the REAL
//     extracted source and confirm no input can produce it.
t('MUTATION: nuking the Egalitarian condition makes it unreachable (lock catches it)', () => {
  const broken = CLASSIFY_SRC.replace(
    /if \(e > 0\.78 && r > 0\.78 && q > 0\.7 && v > 0\.65 && p > 0\.6\)/,
    'if (false)'
  );
  assert.notStrictEqual(broken, CLASSIFY_SRC, 'mutation regex must match the real source');
  const brokenClassify = new Function(broken + '\nreturn classify;')();
  const out = brokenClassify(s(85, 70, 85, 80, 75)); // the canonical Egalitarian point
  assert.notStrictEqual(out.name, 'Egalitarian Liberal Democracy',
    'with the condition nuked, the Egalitarian point must fall through to another regime');
});
// (2) Hoisting the generic "Liberal Democracy" check above the specific liberal regimes
//     shadows Consensual + Majoritarian + Egalitarian (a classic reorder bug).
t('MUTATION: hoisting generic Liberal above the specific ones shadows them', () => {
  const genericBlock = /\/\/ Generic liberal democracy\s*\n\s*if \(e > 0\.6 && r > 0\.55\) \{[\s\S]*?\n      \}/;
  const m = CLASSIFY_SRC.match(genericBlock);
  assert.ok(m, 'must locate the generic Liberal block');
  // Insert a copy of the generic check right after the opening of classify (before specifics).
  const hoisted = CLASSIFY_SRC.replace(
    /(const e = s\.elections \/ 100[^\n]*\n)/,
    `$1\n${m[0]}\n`
  );
  assert.notStrictEqual(hoisted, CLASSIFY_SRC, 'hoist mutation must apply');
  const hoistedClassify = new Function(hoisted + '\nreturn classify;')();
  // The Consensual point now hits generic Liberal first.
  assert.strictEqual(hoistedClassify(s(70, 65, 65, 50, 50)).name, 'Liberal Democracy',
    'hoisted generic check should shadow Consensual Liberal Democracy');
});

console.log(`\nclassify: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
