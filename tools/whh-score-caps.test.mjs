// Lock for enforceScoreCaps (api/whh-score.js) — the deterministic guard that
// makes the documented HARD-RULE score caps actually hold on Johnny's ACTIVE
// Westchester house hunt.
//
// THE BUG IT GUARDS: whh-score's system prompt states two hard caps —
//   - villageConnectionFit < 40 → total capped at 65
//   - schoolFit            < 30 → total capped at 55
// — but it only ASKS Claude to apply them "in your head". LLMs are unreliable at
// arithmetic constraints, so a model that scores villageConnectionFit at 35 yet
// returns total 80 silently violates the doctrine, mis-ranking a disconnected
// house as a strong fit on a real-money decision. enforceScoreCaps applies the
// caps in code (on the fresh parse AND on every cache read), so the contract
// holds regardless of the model's arithmetic.
//
// Imports the REAL shipped function from the handler module so the lock can't
// drift from a mirror. Mutation-proven: the "no enforcement" form (return the
// payload verbatim) goes RED on the violating cases below.
import assert from 'node:assert';
import { enforceScoreCaps } from '../api/whh-score.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('✗', name, '—', e.message); } };

// Build a payload in the real OUTPUT FORMAT shape: each breakdown entry { score, note }.
function payload({ total, village, school, ...rest } = {}) {
  const mk = (s) => (s === undefined ? undefined : { score: s, note: 'n' });
  const breakdown = {
    villageConnectionFit: mk(village),
    schoolFit: mk(school),
    henryFit: { score: 70, note: 'n' },
    ollieFit: { score: 70, note: 'n' },
    creativeClassFit: { score: 70, note: 'n' },
    commuteFit: { score: 70, note: 'n' },
    priceFit: { score: 70, note: 'n' },
    lotFit: { score: 70, note: 'n' },
  };
  if (village === undefined) delete breakdown.villageConnectionFit;
  if (school === undefined) delete breakdown.schoolFit;
  return { total, breakdown, rationale: 'r', topStrength: 's', topConcern: 'c', ...rest };
}

// ── Village cap: villageConnectionFit < 40 → total ≤ 65 ──
t('village 35 + total 80 → capped to 65', () => {
  const out = enforceScoreCaps(payload({ total: 80, village: 35, school: 90 }));
  assert.strictEqual(out.total, 65);
});
t('village 39 (just under) caps; 40 (boundary) does not', () => {
  assert.strictEqual(enforceScoreCaps(payload({ total: 99, village: 39, school: 90 })).total, 65);
  assert.strictEqual(enforceScoreCaps(payload({ total: 99, village: 40, school: 90 })).total, 99);
});
t('village 35 but total already 60 → untouched (cap only lowers)', () => {
  const out = enforceScoreCaps(payload({ total: 60, village: 35, school: 90 }));
  assert.strictEqual(out.total, 60);
});

// ── School cap: schoolFit < 30 → total ≤ 55 ──
t('school 25 + total 90 → capped to 55', () => {
  const out = enforceScoreCaps(payload({ total: 90, village: 90, school: 25 }));
  assert.strictEqual(out.total, 55);
});
t('school 29 (just under) caps; 30 (boundary) does not', () => {
  assert.strictEqual(enforceScoreCaps(payload({ total: 88, village: 90, school: 29 })).total, 55);
  assert.strictEqual(enforceScoreCaps(payload({ total: 88, village: 90, school: 30 })).total, 88);
});

// ── Both caps fire → the LOWER cap (55) wins ──
t('village 10 + school 10 + total 95 → 55 (tighter cap dominates)', () => {
  const out = enforceScoreCaps(payload({ total: 95, village: 10, school: 10 }));
  assert.strictEqual(out.total, 55);
});

// ── Byte-identical pass-through for a compliant payload ──
t('compliant payload returned by identity (same object reference)', () => {
  const p = payload({ total: 82, village: 70, school: 80 });
  const out = enforceScoreCaps(p);
  assert.strictEqual(out, p, 'compliant payload must not be cloned/changed');
});
t('capped payload is a NEW object, original total preserved', () => {
  const p = payload({ total: 80, village: 35, school: 90 });
  const out = enforceScoreCaps(p);
  assert.notStrictEqual(out, p);
  assert.strictEqual(p.total, 80, 'must not mutate the input');
  assert.strictEqual(out.breakdown, p.breakdown, 'breakdown carried through');
});

// ── Conservative: never fabricate a cap from a bad/missing field ──
t('missing villageConnectionFit → no cap from it', () => {
  const out = enforceScoreCaps(payload({ total: 90, village: undefined, school: 90 }));
  assert.strictEqual(out.total, 90);
});
t('non-numeric village score → skipped (no false cap)', () => {
  const p = payload({ total: 90, village: 90, school: 90 });
  p.breakdown.villageConnectionFit.score = '35'; // string, not number
  assert.strictEqual(enforceScoreCaps(p).total, 90);
});
t('NaN total → returned untouched (no Math.min poisoning)', () => {
  const p = payload({ total: NaN, village: 10, school: 10 });
  const out = enforceScoreCaps(p);
  assert.ok(Number.isNaN(out.total));
});

// ── Defensive: garbage inputs never throw ──
t('null / non-object / no-breakdown inputs return as-is, no throw', () => {
  assert.strictEqual(enforceScoreCaps(null), null);
  assert.strictEqual(enforceScoreCaps(undefined), undefined);
  assert.strictEqual(enforceScoreCaps(5), 5);
  const noBreak = { total: 80 };
  assert.strictEqual(enforceScoreCaps(noBreak), noBreak);
});

// ── MUTATION PROOF: the old "no enforcement" form leaves violations uncapped ──
t('RED PROOF: identity (pre-fix behavior) leaves village-violating total at 80', () => {
  const buggy = (parsed) => parsed; // the behavior before enforceScoreCaps existed
  const p = payload({ total: 80, village: 35, school: 90 });
  assert.strictEqual(buggy(p).total, 80, 'sanity: pre-fix passes 80 through');
  // The shipped guard MUST correct it — proving the test would go RED on reversion.
  assert.strictEqual(enforceScoreCaps(p).total, 65);
  assert.notStrictEqual(enforceScoreCaps(p).total, buggy(p).total);
});
t('RED PROOF: identity leaves school-violating total at 90', () => {
  const buggy = (parsed) => parsed;
  const p = payload({ total: 90, village: 90, school: 25 });
  assert.strictEqual(buggy(p).total, 90);
  assert.strictEqual(enforceScoreCaps(p).total, 55);
});

console.log(`whh-score-caps: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
