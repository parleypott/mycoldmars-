// Locks the gap-seconds truthy-zero fix in SacredSequencer/index.html.
//
// The SacredSequencer CEP panel is a standalone Premiere extension (inline
// scripts, no ESM import, runs inside Premiere — not on Vercel), so the two
// gap-resolution sites can't be imported. This test mirrors them BYTE-FOR-BYTE
// and proves the fix: an explicit gap of 0 (soundbites butted directly together,
// a legitimate tight-assembly choice) is honored instead of being eaten by the
// old `(...) || 0.5` truthy-zero trap. Same class as translation/src/seq-gap.js.
//
// If either inline site in index.html changes, update the mirror below to match.

import assert from 'node:assert';

// ── Mirror of index.html line ~876 (panel-side resolution from JSON) ──
function resolveGapSeconds(soundbiteData) {
  var gapSeconds = 0.5;
  if (!Array.isArray(soundbiteData) && typeof soundbiteData.gapSeconds === 'number' && isFinite(soundbiteData.gapSeconds)) {
    gapSeconds = soundbiteData.gapSeconds;
  }
  return gapSeconds;
}

// ── Mirror of index.html line ~991 (JSX-side header parse: hdr[1] is a string) ──
function parseGapHeader(raw) {
  var gapSeconds = parseFloat(raw);
  if (isNaN(gapSeconds)) gapSeconds = 0.5;
  return gapSeconds;
}

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// ── resolveGapSeconds (the bug the trap ate) ──
t('explicit 0 gap is honored (tight assembly), NOT replaced by 0.5', () => {
  assert.strictEqual(resolveGapSeconds({ gapSeconds: 0 }), 0);
});
t('explicit positive gap honored', () => {
  assert.strictEqual(resolveGapSeconds({ gapSeconds: 2 }), 2);
  assert.strictEqual(resolveGapSeconds({ gapSeconds: 0.5 }), 0.5);
  assert.strictEqual(resolveGapSeconds({ gapSeconds: 1.25 }), 1.25);
});
t('missing gapSeconds falls back to 0.5 default', () => {
  assert.strictEqual(resolveGapSeconds({}), 0.5);
  assert.strictEqual(resolveGapSeconds({ gapSeconds: undefined }), 0.5);
  assert.strictEqual(resolveGapSeconds({ gapSeconds: null }), 0.5);
});
t('non-number gapSeconds (string/NaN) falls back to default', () => {
  assert.strictEqual(resolveGapSeconds({ gapSeconds: '0' }), 0.5);
  assert.strictEqual(resolveGapSeconds({ gapSeconds: 'abc' }), 0.5);
  assert.strictEqual(resolveGapSeconds({ gapSeconds: NaN }), 0.5);
  assert.strictEqual(resolveGapSeconds({ gapSeconds: Infinity }), 0.5);
});
t('array soundbiteData (legacy shape) uses default — no gapSeconds field', () => {
  assert.strictEqual(resolveGapSeconds([{ inSec: 1, outSec: 2 }]), 0.5);
  assert.strictEqual(resolveGapSeconds([]), 0.5);
});

// ── parseGapHeader (the JSX-side twin) ──
t('header "0" honored as 0 gap, not 0.5', () => {
  assert.strictEqual(parseGapHeader('0'), 0);
});
t('header positive values honored', () => {
  assert.strictEqual(parseGapHeader('0.5'), 0.5);
  assert.strictEqual(parseGapHeader('3'), 3);
});
t('header empty/garbage falls back to 0.5', () => {
  assert.strictEqual(parseGapHeader(''), 0.5);
  assert.strictEqual(parseGapHeader('xyz'), 0.5);
});

// ── Mutation guard: the OLD buggy forms must fail these ──
t('MUTATION: old `(...) || 0.5` form would turn the 0 case RED', () => {
  const buggy = (d) => ((!Array.isArray(d) && d.gapSeconds) || 0.5);
  assert.strictEqual(buggy({ gapSeconds: 0 }), 0.5); // proves the trap ate the 0
  assert.notStrictEqual(buggy({ gapSeconds: 0 }), resolveGapSeconds({ gapSeconds: 0 }));
});
t('MUTATION: old `parseFloat(hdr[1]) || 0.5` form would turn header "0" RED', () => {
  const buggy = (raw) => (parseFloat(raw) || 0.5);
  assert.strictEqual(buggy('0'), 0.5); // proves the trap ate the 0
  assert.notStrictEqual(buggy('0'), parseGapHeader('0'));
});

console.log(`gap-seconds.test.mjs: ${pass} assertions passed`);
