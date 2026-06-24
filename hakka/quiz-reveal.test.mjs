// quiz-reveal.test.mjs
//
// Locks the name-quiz "reveal the correct answer" rule shared by the hakka and
// night-market street-food study tools (both import the byte-identical src/ui.js).
//
// THE BUG (fixed): when a player answered "what dish is this?" wrong, ui.js revealed
// the correct choice with `button.textContent.includes(correct.zhName)`. Button text
// is `${zhName}  ${enName}`, so this is a SUBSTRING match on the Chinese name. One
// dish's name can be a clean substring of another's — in the real hakka data,
// 粄條 (ban-tiao, rice noodle) ⊂ 炒粄條 (stir-fried-ban-tiao). So whenever both were
// among the four shown choices, a wrong answer lit up BOTH buttons as "correct",
// teaching the wrong answer. Same substring-collision class as the Hunter shoot-
// calendar `.includes('Jun 1')` bug.
//
// THE FIX: revealCorrectChoices() matches on the stable food `id`, never on name text.
//
// We import the SHIPPED function straight from the live source (it only depends on
// foods data at module load, no DOM at import time), so the lock can't drift. Mutation-
// proven: revert revealCorrectChoices to the substring form and the collision case
// goes RED (returns 2 instead of 1).

import assert from 'node:assert';
import { revealCorrectChoices } from './src/ui.js';
import foods from './src/data/foods.js';

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

const byId = (id) => {
  const f = foods.find((x) => x.id === id);
  assert.ok(f, `fixture dish ${id} must exist in hakka foods data`);
  return f;
};

// The real collision pair this bug bit on.
const banTiao = byId('ban-tiao');           // 粄條
const stirFried = byId('stir-fried-ban-tiao'); // 炒粄條
ok(stirFried.zhName.includes(banTiao.zhName),
  'precondition: 粄條 is a substring of 炒粄條 (the collision the old code tripped on)');

// A plausible 4-choice set where the correct dish (粄條) collides with a decoy (炒粄條).
const choices = [banTiao, stirFried, byId('salt-baked-chicken'), byId('mei-cai-kou-rou')];

// id-matching reveals EXACTLY the correct dish — not the longer-named collider.
const revealed = revealCorrectChoices(choices, banTiao);
ok(revealed.length === 1, `exactly one choice revealed, got ${revealed.length}`);
ok(revealed[0].id === 'ban-tiao', 'the revealed choice is the actual correct dish');
ok(!revealed.some((f) => f.id === 'stir-fried-ban-tiao'),
  'the collider 炒粄條 is NOT falsely revealed');

// The OLD buggy approach, reproduced inline, would reveal BOTH — proving the fix matters.
const oldBuggyReveal = choices.filter(
  (f) => `${f.zhName}  ${f.enName}`.includes(banTiao.zhName),
);
ok(oldBuggyReveal.length === 2,
  'control: the old substring rule lights up 2 buttons (the bug) — so id-matching is load-bearing');

// Reverse-direction sanity: when the longer-named dish is correct, the shorter one
// must NOT be revealed either (substring would have been false here, but lock it).
const revealedStir = revealCorrectChoices(choices, stirFried);
ok(revealedStir.length === 1 && revealedStir[0].id === 'stir-fried-ban-tiao',
  'when 炒粄條 is correct, only it is revealed');

// Normal non-colliding case still works.
const plain = revealCorrectChoices(choices, byId('salt-baked-chicken'));
ok(plain.length === 1 && plain[0].id === 'salt-baked-chicken',
  'non-colliding correct dish reveals exactly itself');

// No false reveal when the correct dish isn't even among the displayed choices.
const absent = revealCorrectChoices(choices, byId('lei-cha'));
ok(absent.length === 0, 'a correct dish not shown reveals nothing');

console.log(`quiz-reveal: ${passed} passed, 0 failed`);
