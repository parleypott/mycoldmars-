// Tests for the V-Dem sandbox shareable URL state parser.
// Bug fixed: readURL's `parseInt(x,10) || 50` turned a hand-set slider value
// of 0 into 50 on a shared link (truthy-zero trap), flipping the regime.
import { parseAxisState, clampAxis } from './url-state.js';
import assert from 'node:assert';

const AXES = ['elections', 'power', 'rights', 'equality', 'participation'];
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n    ${e.message}`); } };

// ── Inline RED proof: the OLD inline parse corrupts a shared 0 ──
const oldParse = (q) => q.split(',').map(x => Math.max(0, Math.min(100, parseInt(x, 10) || 50)));
t('RED proof: old parse turns a shared 0 into 50 (the bug)', () => {
  assert.deepStrictEqual(oldParse('0,6,4,26,4'), [50, 6, 4, 26, 4],
    'old parse should reproduce the truthy-zero bug');
  // the fixed parser keeps the 0
  const st = parseAxisState('0,6,4,26,4', AXES);
  assert.strictEqual(st.elections, 0, 'fixed parser must keep a shared 0 as 0');
});
t('RED proof: old parse turns an all-zero share into all-50 (regime flip)', () => {
  assert.deepStrictEqual(oldParse('0,0,0,0,0'), [50, 50, 50, 50, 50]);
  assert.deepStrictEqual(parseAxisState('0,0,0,0,0', AXES),
    { elections: 0, power: 0, rights: 0, equality: 0, participation: 0 });
});

// ── The fix: 0 round-trips on every axis ──
for (let i = 0; i < AXES.length; i++) {
  t(`zero on axis ${AXES[i]} round-trips as 0`, () => {
    const vals = [50, 50, 50, 50, 50];
    vals[i] = 0;
    const st = parseAxisState(vals.join(','), AXES);
    assert.strictEqual(st[AXES[i]], 0, `${AXES[i]} should be 0, got ${st[AXES[i]]}`);
  });
}

// ── No-regression: every non-zero value 1..100 is preserved exactly ──
t('no-regression: a mid share round-trips byte-for-byte', () => {
  assert.deepStrictEqual(parseAxisState('82,52,78,56,64', AXES),
    { elections: 82, power: 52, rights: 78, equality: 56, participation: 64 });
});
t('no-regression: parseAxisState matches old parse for all non-zero inputs', () => {
  for (const q of ['96,78,95,90,86', '38,22,30,40,36', '100,1,99,2,50', '24,24,22,38,64']) {
    const fixed = AXES.map(a => parseAxisState(q, AXES)[a]);
    assert.deepStrictEqual(fixed, oldParse(q), `mismatch for ${q}`);
  }
});

// ── clampAxis units ──
t('clampAxis: 0 stays 0 (the fix)', () => assert.strictEqual(clampAxis('0'), 0));
t('clampAxis: numeric string preserved', () => assert.strictEqual(clampAxis('73'), 73));
t('clampAxis: > 100 clamps to 100', () => assert.strictEqual(clampAxis('250'), 100));
t('clampAxis: negative clamps to 0', () => assert.strictEqual(clampAxis('-5'), 0));
t('clampAxis: garbage falls back to 50', () => assert.strictEqual(clampAxis('abc'), 50));
t('clampAxis: empty falls back to 50', () => assert.strictEqual(clampAxis(''), 50));
t('clampAxis: decimal truncates via parseInt', () => assert.strictEqual(clampAxis('50.9'), 50));
t('clampAxis: leading-number string parses', () => assert.strictEqual(clampAxis('42px'), 42));
t('clampAxis: custom fallback honored', () => assert.strictEqual(clampAxis('x', 0), 0));
t('clampAxis: garbage default is NOT 0 (still midpoint)', () => assert.strictEqual(clampAxis('???'), 50));

// ── parseAxisState structure / guards ──
t('exactly 5 valid parts → object', () => {
  assert.deepStrictEqual(parseAxisState('10,20,30,40,50', AXES),
    { elections: 10, power: 20, rights: 30, equality: 40, participation: 50 });
});
t('wrong count (4 parts) → null', () => assert.strictEqual(parseAxisState('10,20,30,40', AXES), null));
t('wrong count (6 parts / trailing comma) → null', () => assert.strictEqual(parseAxisState('10,20,30,40,50,', AXES), null));
t('empty string → null', () => assert.strictEqual(parseAxisState('', AXES), null));
t('null query → null', () => assert.strictEqual(parseAxisState(null, AXES), null));
t('undefined query → null', () => assert.strictEqual(parseAxisState(undefined, AXES), null));
t('non-string query → null', () => assert.strictEqual(parseAxisState(12345, AXES), null));
t('empty axes → null', () => assert.strictEqual(parseAxisState('1,2,3', []), null));
t('garbage parts default to 50, count still honored', () => {
  assert.deepStrictEqual(parseAxisState('a,b,c,d,e', AXES),
    { elections: 50, power: 50, rights: 50, equality: 50, participation: 50 });
});
t('mixed garbage + real + zero', () => {
  assert.deepStrictEqual(parseAxisState('0,abc,100,-9,55', AXES),
    { elections: 0, power: 50, rights: 100, equality: 0, participation: 55 });
});

// ── End-to-end regime-relevant lock: a shared closed-autocracy preset ──
t('North Korea-ish share (low extremes incl. near-zero) round-trips faithfully', () => {
  // Saudi/NK preset territory: a user could push elections to 0 and share it.
  assert.deepStrictEqual(parseAxisState('0,6,4,26,4', AXES),
    { elections: 0, power: 6, rights: 4, equality: 26, participation: 4 });
});

console.log(`\nurl-state: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
