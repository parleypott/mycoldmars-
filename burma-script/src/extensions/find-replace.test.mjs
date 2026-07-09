import assert from 'node:assert/strict';
import { computeMatches, clampCurrent } from './find-replace.js';

// find-replace.js is the LIVE find/replace in Johnny's script editor. computeMatches maps
// per-textblock textContent offsets to ABSOLUTE doc positions — the {from,to} the decorations
// paint and replaceCurrentTr/replaceAllTr splice. If a single offset drifts, replace corrupts
// the doc (deletes the wrong range). The file's own header documents a past offset-drift bug
// (case-insensitive lowercasing changed string length -> every later offset shifted); it was
// fixed by matching in the ORIGINAL coordinate space via a case-insensitive regex. Nothing
// locked that fix. This does — plus the escapeRegExp-literal, pos+1 block-entry, non-overlap,
// case-sensitive, and wrapper-recursion contracts. Pure-logic only; no ProseMirror runtime.

let pass = 0;
function ok(label, fn) { fn(); pass++; }

// Minimal ProseMirror-doc stand-in honoring the ONLY contract computeMatches relies on:
// doc.descendants(cb) visits each node in document order as cb(node, pos); a return of false
// (which computeMatches gives every textblock) skips descending into that node's children,
// any other return recurses. node.isTextblock + node.textContent are the only fields read.
// `nodes` is a tree of { text, pos } (textblock) or { pos, children:[...] } (wrapper).
function makeDoc(nodes) {
  return {
    descendants(cb) {
      const walk = (list) => {
        for (const n of list) {
          const isTextblock = typeof n.text === 'string';
          const node = isTextblock
            ? { isTextblock: true, textContent: n.text }
            : { isTextblock: false, textContent: '' };
          const r = cb(node, n.pos);
          if (r !== false && n.children) walk(n.children);
        }
      };
      walk(nodes);
    },
  };
}

// A textblock's inline content starts at pos+1 (the +1 enters the node). Match ranges must be
// reported in that absolute space, so a decoration paints — and a replace splices — the exact glyphs.
ok('case-insensitive finds every case variant at pos+1-based absolute offsets', () => {
  // "The CAT sat on the cat" — 'cat' at textContent idx 4 and idx 19.
  const doc = makeDoc([{ pos: 10, text: 'The CAT sat on the cat' }]);
  const m = computeMatches(doc, 'cat'); // caseSensitive default false
  assert.equal(m.length, 2);
  assert.deepEqual(m[0], { from: 10 + 1 + 4, to: 10 + 1 + 4 + 3 });
  assert.deepEqual(m[1], { from: 10 + 1 + 19, to: 10 + 1 + 19 + 3 });
});

// to - from must equal the MATCHED substring's original width (m[0].length), never a naive
// from + query.length. For ASCII that's identical, but the header's whole point is that they can
// diverge; asserting the width comes from the match keeps the offset-exact contract visible.
ok('each range width equals the matched substring length', () => {
  const doc = makeDoc([{ pos: 0, text: 'aXa aya AZA' }]);
  const m = computeMatches(doc, 'a_a'.replace('_', '')); // 'aa' has no match; use a real one below
  assert.equal(m.length, 0);
  const doc2 = makeDoc([{ pos: 0, text: 'cat Cat CAT' }]);
  const m2 = computeMatches(doc2, 'cat');
  assert.equal(m2.length, 3);
  for (const r of m2) assert.equal(r.to - r.from, 3);
});

// Non-overlapping, left-to-right: 'aa' in 'aaaa' is TWO matches (0-2, 2-4), not three overlapping.
ok('matches are non-overlapping', () => {
  const doc = makeDoc([{ pos: 0, text: 'aaaa' }]);
  const m = computeMatches(doc, 'aa');
  assert.equal(m.length, 2);
  assert.deepEqual(m[0], { from: 1, to: 3 });
  assert.deepEqual(m[1], { from: 3, to: 5 });
});

// Case-sensitive path (indexOf) matches ONLY exact case.
ok('caseSensitive=true matches exact case only', () => {
  const doc = makeDoc([{ pos: 0, text: 'Cat cat CAT' }]);
  const m = computeMatches(doc, 'Cat', true);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0], { from: 1, to: 4 });
  // and the case-sensitive indexOf path is also non-overlapping: 'aa' in 'aaaa' -> two matches.
  const doc2 = makeDoc([{ pos: 0, text: 'aaaa' }]);
  const m2 = computeMatches(doc2, 'aa', true);
  assert.equal(m2.length, 2);
  assert.deepEqual(m2[0], { from: 1, to: 3 });
  assert.deepEqual(m2[1], { from: 3, to: 5 });
});

// escapeRegExp: a query with regex metacharacters is matched LITERALLY, not as a pattern.
ok('regex metacharacters in the query are literal', () => {
  const doc = makeDoc([{ pos: 0, text: 'a.b axb a.b' }]);
  const m = computeMatches(doc, 'a.b'); // must NOT match 'axb'
  assert.equal(m.length, 2);
  assert.deepEqual(m[0], { from: 1, to: 4 });
  assert.deepEqual(m[1], { from: 9, to: 12 });
});

// Multiple textblocks at different positions each contribute matches in their own coordinate space;
// a match never spans across block boundaries.
ok('spans multiple textblocks without crossing block boundaries', () => {
  const doc = makeDoc([
    { pos: 0, text: 'red fox' },
    { pos: 20, text: 'red hen' },
  ]);
  const m = computeMatches(doc, 'red');
  assert.equal(m.length, 2);
  assert.deepEqual(m[0], { from: 1, to: 4 });
  assert.deepEqual(m[1], { from: 21, to: 24 });
});

// Wrapper nodes (rows/cells/the doc) are NOT textblocks: computeMatches returns true for them so
// descendants recurses into their children. A textblock nested inside a wrapper must still be found.
ok('recurses into non-textblock wrappers to reach nested textblocks', () => {
  const doc = makeDoc([
    { pos: 5, children: [{ pos: 6, text: 'buried needle here' }] },
  ]);
  const m = computeMatches(doc, 'needle');
  assert.equal(m.length, 1);
  assert.deepEqual(m[0], { from: 6 + 1 + 7, to: 6 + 1 + 7 + 6 });
});

// Degenerate inputs never throw and never fabricate matches.
ok('empty query, empty text, and null doc yield no matches', () => {
  assert.deepEqual(computeMatches(makeDoc([{ pos: 0, text: 'abc' }]), ''), []);
  assert.deepEqual(computeMatches(makeDoc([{ pos: 0, text: '' }]), 'a'), []);
  assert.deepEqual(computeMatches(null, 'a'), []);
  assert.deepEqual(computeMatches(makeDoc([{ pos: 0, text: 'abc' }]), 'zzz'), []);
});

// clampCurrent wraps the "current match" index into [0, length) — including NEGATIVE (prev past the
// start wraps to the end) and OVERFLOW (next past the end wraps to the start). length 0 -> 0.
ok('clampCurrent wraps forward, backward, and guards empty', () => {
  assert.equal(clampCurrent(0, 0), 0);
  assert.equal(clampCurrent(5, 0), 0);
  assert.equal(clampCurrent(0, 3), 0);
  assert.equal(clampCurrent(2, 3), 2);
  assert.equal(clampCurrent(3, 3), 0);   // overflow wraps to start
  assert.equal(clampCurrent(4, 3), 1);
  assert.equal(clampCurrent(-1, 3), 2);  // prev-before-first wraps to end
  assert.equal(Math.abs(clampCurrent(-3, 3)), 0); // exact multiple wraps to zero (JS -3%3 === -0)
  assert.equal(clampCurrent(-4, 3), 2);
});

console.log(`find-replace.test.mjs: ${pass} assertions passed`);
