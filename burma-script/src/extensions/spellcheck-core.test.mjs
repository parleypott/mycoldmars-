import assert from 'node:assert/strict';
import {
  walkWord,
  resolveWord,
  spellDecision,
  shouldCheck,
  isWordChar,
  buildReplaceTr,
  PERSONAL_DICT_KEY,
  loadPersonalDict,
  addToPersonalDictStore,
  isInPersonalDict,
} from './spellcheck-core.js';

// spellcheck-core.js is the pure brain of the custom spellcheck menu: word-boundary resolution from
// a flattened paragraph, the misspelled→custom / no-suggestion→native / correct→no-menu decision,
// the personal-dictionary localStorage, and the single mark-preserving replace transaction. These
// are the pieces that, if they drift, either corrupt the doc (wrong replace range) or resurrect the
// timecode-menu hijack (wrong decision). No ProseMirror, no dictionary — pure logic only.

let pass = 0;
function ok(label, fn) { fn(); pass++; }

// ── in-memory localStorage shim (node/bun test has no DOM) ───────────────────────────────────────
function installStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
  return map;
}

// ── isWordChar ────────────────────────────────────────────────────────────────────────────────
ok('isWordChar: letters/apostrophe/hyphen yes; space/newline/chip/digit no', () => {
  for (const c of ['a', 'Z', 'é', 'ñ', "'", '’', '-']) assert.equal(isWordChar(c), true, c);
  for (const c of [' ', '\n', '￼', '.', ',']) assert.equal(isWordChar(c), false, JSON.stringify(c));
  // A digit is not a word char here (numbers/timecodes are never spellchecked words).
  assert.equal(isWordChar('5'), false);
});

// ── walkWord ──────────────────────────────────────────────────────────────────────────────────
ok('walkWord: plain word from a mid-word hint', () => {
  const t = 'the mediterreanean sea';
  const w = walkWord(t, 8); // inside "mediterreanean"
  assert.equal(w.word, 'mediterreanean');
  assert.equal(t.slice(w.lo, w.hi + 1), 'mediterreanean');
});

ok('walkWord: apostrophe stays interior (don\'t)', () => {
  const t = "I don't know";
  const w = walkWord(t, 4); // on the apostrophe / n
  assert.equal(w.word, "don't");
});

ok('walkWord: curly apostrophe (’) interior', () => {
  const t = 'it’s fine';
  const w = walkWord(t, 1);
  assert.equal(w.word, 'it’s');
});

ok('walkWord: hyphenated word kept whole', () => {
  const t = 'my mother-in-law left';
  const w = walkWord(t, 8); // inside the hyphenated run
  assert.equal(w.word, 'mother-in-law');
});

ok('walkWord: trailing apostrophe trimmed (dogs\')', () => {
  const t = "the dogs' bowls";
  const w = walkWord(t, 5); // inside "dogs"
  assert.equal(w.word, 'dogs');
});

ok('walkWord: leading hyphen trimmed', () => {
  const t = 'a -word here';
  const w = walkWord(t, 3); // on the 'w'
  assert.equal(w.word, 'word');
});

ok('walkWord: hint on whitespace with no word char on either side → null', () => {
  const t = 'hello   world'; // three spaces; index 6 is the MIDDLE space (neighbors also spaces)
  assert.equal(walkWord(t, 6), null);
});

ok('walkWord: hint on the space just after a word resolves that word (left edge)', () => {
  const t = 'hello world';
  // index 5 is the space; text[4]='o' is a word char, so a right-click at a word's trailing edge
  // resolves the word to its left.
  assert.equal(walkWord(t, 5).word, 'hello');
});

ok('walkWord: does NOT cross a chip sentinel (￼) or newline', () => {
  const t = 'foo￼bar\nbaz';
  assert.equal(walkWord(t, 0).word, 'foo'); // stops before ￼
  assert.equal(walkWord(t, 4).word, 'bar'); // between ￼ and \n
  assert.equal(walkWord(t, 8).word, 'baz'); // after \n
});

ok('walkWord: empty string → null', () => {
  assert.equal(walkWord('', 0), null);
});

// ── resolveWord (index → doc positions) ─────────────────────────────────────────────────────────
// Simulate a flattened block "abc def" living at doc positions 10..16 (posOf[i] = 10 + i).
function contiguous(text, start) {
  return text.split('').map((_, i) => start + i);
}

ok('resolveWord: maps a mid-word click to [wordFrom, wordTo) doc positions', () => {
  const text = 'abc def';
  const posOf = contiguous(text, 10);
  const r = resolveWord(text, posOf, 11); // inside "abc"
  assert.deepEqual(r, { word: 'abc', wordFrom: 10, wordTo: 13 });
});

ok('resolveWord: click at a word\'s right edge (pos after last char) resolves that word', () => {
  const text = 'abc def';
  const posOf = contiguous(text, 10);
  // "abc" occupies 10,11,12; a right-click at its trailing edge resolves to pos 13 (== after 'c').
  const r = resolveWord(text, posOf, 13);
  assert.deepEqual(r, { word: 'abc', wordFrom: 10, wordTo: 13 });
});

ok('resolveWord: non-contiguous positions across a chip do not glue', () => {
  // "foo" at 5,6,7 then a chip node ￼ at 8 (nodeSize 1) then "bar" at 9,10,11.
  const text = 'foo￼bar';
  const posOf = [5, 6, 7, 8, 9, 10, 11];
  assert.deepEqual(resolveWord(text, posOf, 6), { word: 'foo', wordFrom: 5, wordTo: 8 });
  assert.deepEqual(resolveWord(text, posOf, 10), { word: 'bar', wordFrom: 9, wordTo: 12 });
});

ok('resolveWord: pos ON the chip sentinel falls back to the left word (right-edge rule)', () => {
  // A real right-click ON a chip is caught earlier by spellcheck.js's DOM chip guard (before
  // resolveWordAt runs), so this left-edge fallback never fires on an actual chip. Documenting the
  // pure mapping: pos 8 == the ￼ node; text[2]='o' is a word char, so it resolves "foo" to its left.
  const text = 'foo￼bar';
  const posOf = [5, 6, 7, 8, 9, 10, 11];
  assert.deepEqual(resolveWord(text, posOf, 8), { word: 'foo', wordFrom: 5, wordTo: 8 });
});

ok('resolveWord: pos in a gap with no adjacent word char → null', () => {
  const text = 'foo  bar'; // two spaces; pos on the second space, neighbors are space + b...
  const posOf = contiguous(text, 5);
  // index 3 is the first space (neighbor 'o' → resolves foo); index 4 is second space, left neighbor
  // is a space → but right neighbor 'b' is only checked via hint, not hint-1. So test a pure gap:
  const gapText = 'foo   bar';
  const gapPos = contiguous(gapText, 5);
  assert.equal(resolveWord(gapText, gapPos, 5 + 4), null); // middle of three spaces
});

ok('resolveWord: pos with no mapping → null', () => {
  const text = 'abc';
  const posOf = contiguous(text, 10);
  assert.equal(resolveWord(text, posOf, 99), null);
});

// ── shouldCheck ─────────────────────────────────────────────────────────────────────────────────
ok('shouldCheck: skips short / digit / no-letter, keeps real words', () => {
  assert.equal(shouldCheck('mediterreanean'), true);
  assert.equal(shouldCheck('a'), false);       // too short
  assert.equal(shouldCheck('h2o'), false);      // digit
  assert.equal(shouldCheck('00:12'), false);    // timecode fragment
  assert.equal(shouldCheck("''"), false);       // no letter
  assert.equal(shouldCheck(''), false);
  assert.equal(shouldCheck('Moharem'), true);
});

// ── spellDecision (the fallback contract) ───────────────────────────────────────────────────────
ok('spellDecision: misspelled+suggestions → custom', () => {
  assert.equal(spellDecision(true, 3), 'custom');
  assert.equal(spellDecision(true, 1), 'custom');
});
ok('spellDecision: misspelled + NO suggestion → native (passthrough, no dead end)', () => {
  assert.equal(spellDecision(true, 0), 'native');
});
ok('spellDecision: correctly spelled → none (no takeover)', () => {
  assert.equal(spellDecision(false, 0), 'none');
  assert.equal(spellDecision(false, 5), 'none'); // count irrelevant when not misspelled
});

// ── personal dictionary (localStorage, namespaced, dedupe, live isIn) ────────────────────────────
ok('personal dict: add/persist/dedupe under the wp01_ namespaced key', () => {
  const map = installStorage();
  assert.equal(PERSONAL_DICT_KEY, 'wp01_spell_dict_v1');
  assert.deepEqual(loadPersonalDict(), []);
  addToPersonalDictStore('Moharem');
  addToPersonalDictStore('Aswan');
  addToPersonalDictStore('moharem'); // case-insensitive dupe → not added again
  const list = loadPersonalDict();
  assert.deepEqual(list, ['Moharem', 'Aswan']);
  assert.equal(isInPersonalDict('MOHAREM'), true);
  assert.equal(isInPersonalDict('Nile'), false);
  // Persisted under the exact namespaced key.
  assert.equal(JSON.parse(map.get('wp01_spell_dict_v1')).length, 2);
});

ok('personal dict: corrupt/missing storage degrades to []', () => {
  const map = installStorage();
  map.set('wp01_spell_dict_v1', '{not json');
  assert.deepEqual(loadPersonalDict(), []);
  map.set('wp01_spell_dict_v1', JSON.stringify(['ok', 5, null, 'yes']));
  assert.deepEqual(loadPersonalDict(), ['ok', 'yes']); // non-strings filtered
});

// ── buildReplaceTr (ONE transaction, marks preserved, collab-stale guard) ────────────────────────
function fakeState(textAtRange, marksAtFrom) {
  const ops = [];
  return {
    ops,
    doc: {
      textBetween: () => textAtRange,
      nodeAt: () => (marksAtFrom ? { marks: marksAtFrom } : null),
    },
    schema: { text: (s, m) => ({ type: 'text', text: s, marks: m }) },
    tr: {
      replaceWith(from, to, node) { ops.push(['replaceWith', from, to, node]); return this; },
    },
  };
}

ok('buildReplaceTr: one replaceWith carrying the word\'s own marks', () => {
  const boldMark = { type: 'bold' };
  const st = fakeState('mediterreanean', [boldMark]);
  const tr = buildReplaceTr(st, 10, 24, 'mediterreanean', 'Mediterranean');
  assert.notEqual(tr, null);
  assert.equal(st.ops.length, 1);
  const [op, from, to, node] = st.ops[0];
  assert.equal(op, 'replaceWith');
  assert.equal(from, 10);
  assert.equal(to, 24);
  assert.equal(node.text, 'Mediterranean');
  assert.deepEqual(node.marks, [boldMark]); // surrounding bold/span run preserved
});

ok('buildReplaceTr: no marks on node → empty marks array (never throws)', () => {
  const st = fakeState('teh', null);
  const tr = buildReplaceTr(st, 3, 6, 'teh', 'the');
  assert.notEqual(tr, null);
  assert.deepEqual(st.ops[0][3].marks, []);
});

ok('buildReplaceTr: collab-stale range (live text != expected) → null, no op', () => {
  const st = fakeState('SOMETHING ELSE', [{ type: 'bold' }]);
  const tr = buildReplaceTr(st, 10, 24, 'mediterreanean', 'Mediterranean');
  assert.equal(tr, null);
  assert.equal(st.ops.length, 0); // never spliced a stale range
});

ok('buildReplaceTr: expectedWord null skips the guard (defensive callers)', () => {
  const st = fakeState('anything', []);
  const tr = buildReplaceTr(st, 1, 2, null, 'x');
  assert.notEqual(tr, null);
  assert.equal(st.ops.length, 1);
});

console.log(`spellcheck-core.test.mjs: ${pass} assertions passed`);
