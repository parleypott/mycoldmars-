import assert from 'node:assert/strict';
import { SLASH_ITEMS } from './extensions/slash-menu.js';

// Lock the burma-script "/" slash-command contract — the menu Johnny types into to
// drop director marks (oncam / factcheck / animation / 3d / broll / archive / direction /
// break) while editing scripts. SLASH_ITEMS + its per-item match() are imported LIVE (not
// re-implemented), so this test tracks the real shipped object and cannot drift from it.
//
// Two things get locked:
//   1. The command SET + the shortcut ALIASES Johnny relies on (/fc, /anim, /threed, …) —
//      so a rename or an accidental deletion of a command/alias fails the suite.
//   2. The match() semantics: PREFIX match (startsWith), case-insensitive, trimmed. This is
//      the load-bearing behavior — a regression to substring (includes) matching would make
//      "/cam" surface "oncam" and turn the menu noisy, and dropping trim/lowercase would make
//      "/FC " (a realistic keystroke) match nothing.

let pass = 0;
function ok(label, fn) { fn(); pass++; }

// --- 1. Command set is exactly the eight director marks, in order ---------------------
ok('SLASH_ITEMS is the eight commands in order', () => {
  assert.deepEqual(
    SLASH_ITEMS.map((i) => i.title),
    ['archive', 'oncam', 'factcheck', 'animation', '3d', 'broll', 'direction', 'break'],
  );
});

ok('every item is well-formed (title / aliases / run / match)', () => {
  for (const it of SLASH_ITEMS) {
    assert.ok(typeof it.title === 'string' && it.title.length, `bad title: ${it.title}`);
    assert.ok(Array.isArray(it.aliases), `aliases not array on ${it.title}`);
    assert.equal(typeof it.run, 'function', `run not fn on ${it.title}`);
    assert.equal(typeof it.match, 'function', `match not fn on ${it.title}`);
  }
});

ok('titles are unique (every command is distinctly reachable)', () => {
  const titles = SLASH_ITEMS.map((i) => i.title);
  assert.equal(new Set(titles).size, titles.length);
});

// --- 2. Shortcut aliases resolve to the right command ---------------------------------
const find = (t) => SLASH_ITEMS.find((i) => i.title === t);

ok('the shortcut aliases Johnny types resolve to their command', () => {
  const cases = [
    ['fc', 'factcheck'],
    ['source', 'factcheck'],
    ['anim', 'animation'],
    ['threed', '3d'],
    ['3d animation', '3d'],
    ['on cam', 'oncam'],
    ['on cam to film', 'oncam'],
  ];
  for (const [query, title] of cases) {
    assert.ok(find(title).match(query), `alias "${query}" should match ${title}`);
  }
});

// --- 3. match() is a PREFIX match, not a substring match (the mutation lock) -----------
ok('match is prefix-only: an interior substring does NOT match', () => {
  // If match() ever regressed startsWith -> includes, each of these would wrongly match.
  assert.equal(find('oncam').match('cam'), false, '"cam" must not match oncam/on cam');
  assert.equal(find('factcheck').match('heck'), false, '"heck" must not match factcheck');
  assert.equal(find('broll').match('roll'), false, '"roll" must not match broll');
  assert.equal(find('animation').match('nim'), false, '"nim" must not match anim/animation');
});

ok('a real prefix DOES match', () => {
  assert.ok(find('factcheck').match('fac'));
  assert.ok(find('broll').match('br'));
  assert.ok(find('archive').match('arch'));
  assert.ok(find('3d').match('3'));
});

// --- 4. Empty query shows the whole menu; matching is trimmed + case-insensitive -------
ok('empty / whitespace query surfaces every command', () => {
  for (const it of SLASH_ITEMS) {
    assert.ok(it.match(''), `empty query should match ${it.title}`);
    assert.ok(it.match('   '), `blank query should match ${it.title}`);
  }
});

ok('match trims and lowercases the query', () => {
  assert.ok(find('factcheck').match('  FC '), 'padded upper "  FC " should match factcheck');
  assert.ok(find('archive').match('ARCH'), 'upper "ARCH" should match archive');
  assert.ok(find('animation').match('  Anim  '));
});

console.log(`slash-menu-items.test.mjs: ${pass} assertions passed`);
