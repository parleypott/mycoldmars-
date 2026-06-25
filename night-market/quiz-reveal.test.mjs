// quiz-reveal.test.mjs
//
// Locks the name-quiz "reveal the correct answer" rule for the NIGHT-MARKET street-food
// study tool. night-market/src/ui.js is BYTE-IDENTICAL to hakka/src/ui.js, so the same
// substring-collision bug (and its fix) lives in both games — but the existing
// hakka/quiz-reveal.test.mjs imports only hakka's copy. A regression in
// night-market/src/ui.js (e.g. reverting revealCorrectChoices to a name-substring match)
// would leave that test GREEN. This file imports night-market's OWN copy so the fix is
// actually protected here too — closing a real verifier blind spot, not adding theatre.
//
// THE BUG (fixed): a wrong "what dish is this?" answer revealed the correct choice with
// `button.textContent.includes(correct.zhName)` — a SUBSTRING match on the Chinese name.
// When one dish's name is a clean substring of another shown choice, BOTH light up as
// "correct", teaching the wrong dish. Same class as the Hunter shoot-calendar
// `.includes('Jun 1')` collision.
//
// THE FIX: revealCorrectChoices() matches on the stable food `id`, never on name text.
//
// We import the SHIPPED function straight from night-market's live source (it has no DOM
// dependency at import time), so the lock can't drift. Real night-market data has no zhName
// substring pair TODAY, so the realistic checks use real foods and a CONSTRUCTED collision
// pair proves the id-contract resists the bug even if such a pair is ever added.

import assert from 'node:assert';
import { revealCorrectChoices } from './src/ui.js';
import foods from './src/data/foods.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

const byId = (id) => {
  const f = foods.find((x) => x.id === id);
  assert.ok(f, `fixture dish ${id} must exist in night-market foods data`);
  return f;
};

// ── Real-data behaviour: id-match reveals exactly the correct dish ──
const popcorn = byId('popcorn-chicken');
const cutlet = byId('chicken-cutlet');
const omelette = byId('oyster-omelette');
const squid = byId('fried-squid');
const choices = [popcorn, cutlet, omelette, squid];

const revealed = revealCorrectChoices(choices, omelette);
ok(revealed.length === 1, `exactly one choice revealed, got ${revealed.length}`);
ok(revealed[0].id === 'oyster-omelette', 'the revealed choice is the actual correct dish');

// A correct dish not among the shown choices reveals nothing.
const absentDish = foods.find((f) => !choices.some((c) => c.id === f.id));
ok(absentDish, 'precondition: night-market has more than 4 dishes');
const absent = revealCorrectChoices(choices, absentDish);
ok(absent.length === 0, 'a correct dish not shown reveals nothing');

// ── Constructed substring collision — proves the id-contract is load-bearing ──
// Two synthetic dishes where one zhName is a clean substring of the other (the exact
// shape the bug bit on in hakka: 粄條 ⊂ 炒粄條).
const shortDish = { id: 'syn-short', zhName: '魚', enName: 'Fish' };
const longDish = { id: 'syn-long', zhName: '炸魚', enName: 'Fried Fish' };
ok(longDish.zhName.includes(shortDish.zhName),
  'precondition: 魚 is a substring of 炸魚 (the collision shape)');

const synChoices = [shortDish, longDish, popcorn, cutlet];

// id-matching reveals EXACTLY the short dish — not the longer-named collider.
const synRevealed = revealCorrectChoices(synChoices, shortDish);
ok(synRevealed.length === 1, `collision: exactly one revealed, got ${synRevealed.length}`);
ok(synRevealed[0].id === 'syn-short', 'collision: the revealed choice is the correct dish');
ok(!synRevealed.some((f) => f.id === 'syn-long'),
  'collision: the longer-named collider 炸魚 is NOT falsely revealed');

// Control: the OLD buggy substring rule, reproduced inline, lights up BOTH — proving
// id-matching is what makes night-market correct. (Mutation: revert revealCorrectChoices
// in src/ui.js to this form and this game's reveal goes wrong.)
const oldBuggyReveal = synChoices.filter(
  (f) => `${f.zhName}  ${f.enName}`.includes(shortDish.zhName),
);
ok(oldBuggyReveal.length === 2,
  'control: the old substring rule lights up 2 buttons (the bug) — so id-matching is load-bearing');

// Reverse direction: when the longer-named dish is correct, the shorter must not reveal.
const synRevealedLong = revealCorrectChoices(synChoices, longDish);
ok(synRevealedLong.length === 1 && synRevealedLong[0].id === 'syn-long',
  'when 炸魚 is correct, only it is revealed');

console.log(`night-market quiz-reveal: ${passed} passed, 0 failed`);
