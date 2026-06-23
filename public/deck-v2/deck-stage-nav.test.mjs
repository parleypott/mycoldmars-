// Verifier-layer LOCK for the <deck-stage> navigation + scaling cores
// (public/deck-v2/deck-stage.js) — one of Johnny's actual presentation tools,
// served live at /deck-v2/, previously ZERO assertion coverage.
//
// Four pure cores drive every deck:
//   clampSlideIndex(i,len)        — the slide-index clamp behind _go / next / prev /
//                                   goTo / Home / End / number keys
//   fitScale(vw,vh,dw,dh)         — the letterbox fit-scale behind _fit (every slide's
//                                   transform: scale())
//   parseRestoredIndex(raw,len)   — recovers the persisted slide index on refresh
//   digitJumpTarget(key,len)      — number-key jump (1-9 -> 0-8, 0 -> 9)
// A silent regression in any of these breaks navigation / scaling / refresh-restore
// on every deck, with no error.
//
// NO live bug — these are a behavior-identical extraction of the existing inline
// logic, so this is a verifier-layer LOCK (same standard as the walden-3d / westchester
// inline-page locks), NOT a fix. The test EXTRACTS the real shipped functions from
// deck-stage.js at runtime (brace-match + new Function), so it can't drift from a mirror.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('./deck-stage.js', import.meta.url), 'utf8');

// Brace-match a `function NAME(...) { ... }` out of the source.
function extractFn(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `could not find function ${name} in deck-stage.js`);
  const braceStart = source.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const NAMES = ['clampSlideIndex', 'fitScale', 'parseRestoredIndex', 'digitJumpTarget'];

function loadShipped(source = src) {
  const body = NAMES.map((n) => extractFn(source, n)).join('\n');
  const factory = new Function(body + '\nreturn { ' + NAMES.join(', ') + ' };');
  return factory();
}

// Rebuild the cores from a mutated copy of the real source (for mutation testing).
function mutate(from, to) {
  assert.ok(src.includes(from), `mutation anchor not found: ${from}`);
  return loadShipped(src.replace(from, to));
}

const { clampSlideIndex, fitScale, parseRestoredIndex, digitJumpTarget } = loadShipped();

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); }
}

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── inline RED proofs: prove the cores aren't no-ops ──────────────────────
check('RED proof: a naive clamp without the upper bound would over-run past the last slide', () => {
  const naive = (i, len) => Math.max(0, i); // no Math.min(len-1, …)
  assert.equal(naive(99, 5), 99, 'naive clamp lets index run past the deck');
  assert.equal(clampSlideIndex(99, 5), 4, 'shipped clamp pins to the last slide');
});
check('RED proof: a max-instead-of-min fit would overflow the viewport', () => {
  const naive = (vw, vh, dw, dh) => Math.max(vw / dw, vh / dh);
  // wide viewport, tall design: max picks the bigger ratio (overflow), min the smaller (fit)
  assert.ok(naive(1920, 400, 1920, 1080) > fitScale(1920, 400, 1920, 1080),
    'shipped fitScale takes the smaller (fitting) ratio');
});

// ── clampSlideIndex ───────────────────────────────────────────────────────
check('clamp: in-range index unchanged', () => {
  assert.equal(clampSlideIndex(3, 10), 3);
});
check('clamp: over-range pins to last slide', () => {
  assert.equal(clampSlideIndex(20, 5), 4);
  assert.equal(clampSlideIndex(5, 5), 4); // exactly length -> last
});
check('clamp: negative pins to first slide', () => {
  assert.equal(clampSlideIndex(-1, 5), 0);
  assert.equal(clampSlideIndex(-999, 5), 0);
});
check('clamp: first and last boundaries exact', () => {
  assert.equal(clampSlideIndex(0, 5), 0);
  assert.equal(clampSlideIndex(4, 5), 4);
});
check('clamp: single-slide deck always 0', () => {
  assert.equal(clampSlideIndex(0, 1), 0);
  assert.equal(clampSlideIndex(7, 1), 0);
  assert.equal(clampSlideIndex(-3, 1), 0);
});
check('clamp: empty/zero/negative length -> 0 (no slides, never NaN)', () => {
  assert.equal(clampSlideIndex(3, 0), 0);
  assert.equal(clampSlideIndex(0, 0), 0);
  assert.equal(clampSlideIndex(2, -1), 0);
});

// ── fitScale ──────────────────────────────────────────────────────────────
check('fit: exact-fit viewport -> scale 1', () => {
  assert.ok(near(fitScale(1920, 1080, 1920, 1080), 1));
});
check('fit: width-constrained picks the width ratio', () => {
  // 960 wide, plenty tall -> 0.5 from width is the limiting (smaller) ratio
  assert.ok(near(fitScale(960, 2000, 1920, 1080), 0.5));
});
check('fit: height-constrained picks the height ratio', () => {
  // 540 tall, plenty wide -> 0.5 from height is limiting
  assert.ok(near(fitScale(4000, 540, 1920, 1080), 0.5));
});
check('fit: never exceeds either axis (letterbox invariant)', () => {
  for (const [vw, vh] of [[1280, 720], [3000, 800], [500, 1600], [1920, 1080]]) {
    const s = fitScale(vw, vh, 1920, 1080);
    assert.ok(1920 * s <= vw + 1e-6 && 1080 * s <= vh + 1e-6, `scale ${s} fits ${vw}x${vh}`);
  }
});
check('fit: custom design size honored', () => {
  assert.ok(near(fitScale(800, 600, 1600, 1200), 0.5));
});

// ── parseRestoredIndex ──────────────────────────────────────────────────────
check('restore: valid in-range string -> that index', () => {
  assert.equal(parseRestoredIndex('3', 10), 3);
  assert.equal(parseRestoredIndex('0', 10), 0);
});
check('restore: null/absent -> null (keep default)', () => {
  assert.equal(parseRestoredIndex(null, 10), null);
  assert.equal(parseRestoredIndex(undefined, 10), null);
});
check('restore: out-of-range -> null (do not jump past the deck)', () => {
  assert.equal(parseRestoredIndex('10', 10), null); // == length
  assert.equal(parseRestoredIndex('99', 10), null);
  assert.equal(parseRestoredIndex('-1', 10), null);
});
check('restore: non-numeric / garbage -> null', () => {
  assert.equal(parseRestoredIndex('abc', 10), null);
  assert.equal(parseRestoredIndex('', 10), null);
  assert.equal(parseRestoredIndex('  ', 10), null);
});
check('restore: parseInt-lenient leading number still bounds-checked', () => {
  assert.equal(parseRestoredIndex('2x', 10), 2);  // parseInt('2x')=2, in range
  assert.equal(parseRestoredIndex('50x', 10), null); // 50 out of range
});
check('restore: last valid index accepted, length boundary rejected', () => {
  assert.equal(parseRestoredIndex('9', 10), 9);
  assert.equal(parseRestoredIndex('10', 10), null);
});

// ── digitJumpTarget ─────────────────────────────────────────────────────────
check('digit: 1-9 map to index 0-8', () => {
  for (let d = 1; d <= 9; d++) assert.equal(digitJumpTarget(String(d), 20), d - 1);
});
check('digit: 0 maps to index 9 (the 10th slide)', () => {
  assert.equal(digitJumpTarget('0', 20), 9);
});
check('digit: target beyond deck length -> null', () => {
  assert.equal(digitJumpTarget('9', 5), null);   // index 8, deck of 5
  assert.equal(digitJumpTarget('0', 5), null);   // index 9, deck of 5
  assert.equal(digitJumpTarget('6', 5), null);   // index 5 == length
});
check('digit: target exactly within deck accepted', () => {
  assert.equal(digitJumpTarget('5', 5), 4);  // index 4, deck of 5 (last)
  assert.equal(digitJumpTarget('1', 1), 0);  // index 0, deck of 1
});
check('digit: non-digit keys -> null', () => {
  for (const k of ['a', 'Enter', 'ArrowRight', '', ' ', '10', '-1', '.']) {
    assert.equal(digitJumpTarget(k, 20), null, `non-digit ${JSON.stringify(k)} -> null`);
  }
});

// ── mutation proofs: each lock has teeth (revert source -> RED) ────────────
check('mutation: clamp without the upper bound runs past the last slide', () => {
  const m = mutate('return Math.max(0, Math.min(length - 1, i));', 'return Math.max(0, i);');
  assert.equal(m.clampSlideIndex(99, 5), 99, 'mutant over-runs; the real clamp pins to 4');
});
check('mutation: fitScale using max overflows the viewport', () => {
  const m = mutate('return Math.min(vw / designW, vh / designH);', 'return Math.max(vw / designW, vh / designH);');
  assert.ok(m.fitScale(1920, 400, 1920, 1080) > fitScale(1920, 400, 1920, 1080),
    'max-mutant scale exceeds the fitting scale');
});
check('mutation: parseRestoredIndex dropping the < length bound jumps past the deck', () => {
  const m = mutate('if (Number.isFinite(n) && n >= 0 && n < length) return n;',
                   'if (Number.isFinite(n) && n >= 0) return n;');
  assert.equal(m.parseRestoredIndex('99', 10), 99, 'mutant restores an out-of-range index; real returns null');
  assert.equal(parseRestoredIndex('99', 10), null);
});
check('mutation: digitJumpTarget without the < length guard returns an out-of-range index', () => {
  const m = mutate('return n < length ? n : null;', 'return n;');
  assert.equal(m.digitJumpTarget('9', 5), 8, 'mutant returns index 8 for a 5-slide deck; real returns null');
  assert.equal(digitJumpTarget('9', 5), null);
});

// ── source-binding: confirm the 4 cores ship + the methods call them ───────
check('source: the inline clamp/fit/restore/digit code was replaced by helper calls', () => {
  assert.ok(src.includes('clampSlideIndex(i, this._slides.length)'), '_go calls clampSlideIndex');
  assert.ok(src.includes('fitScale(vw, vh, this.designWidth, this.designHeight)'), '_fit calls fitScale');
  assert.ok(src.includes('parseRestoredIndex(localStorage.getItem(this._storageKey)'), '_restoreIndex calls parseRestoredIndex');
  assert.ok(src.includes('digitJumpTarget(key, this._slides.length)'), '_onKey calls digitJumpTarget');
  // the old inline forms are gone
  assert.ok(!src.includes('Math.max(0, Math.min(this._slides.length - 1, i))'), 'inline clamp removed');
  assert.ok(!src.includes('Math.min(vw / this.designWidth, vh / this.designHeight)'), 'inline fit removed');
});

console.log(`\ndeck-stage-nav: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
