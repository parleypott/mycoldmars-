/*
 * bookmark-roundtrip.test.mjs — the inline /bookmark (Johnny 2026-07-08) is an atom node whose only
 * payload is a bookmarkId. Like the fcFootnote receipt, it MUST survive the derived-blocks export
 * (nodeText → {bm <id>} token) and the rebuild (inlineContent → real bookmark node), or an
 * export/rebuild cycle would silently drop the place-mark and break its deep link. This locks that.
 */
import assert from 'node:assert/strict';
import { bookmarkToken, buildEditorDocument, docToBlocks } from './document-builder.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

// Round-trip a single authored block through the REAL builder (inlineContent parser) and REAL
// serializer (docToBlocks → nodeText), returning the re-derived block text. Unlike the
// mirror-the-regex checks below, this exercises the actual isBm parse branch AND the nodeText
// bookmark-export branch — so an edit that breaks EITHER side (the combined token regex, the isBm
// sniff, or the nodeText emit) fails here even though the mirror checks would stay green.
const rtText = (block) => {
  const out = docToBlocks(buildEditorDocument([block]));
  const b = out.find((x) => x.text !== undefined || x.title !== undefined) || out[0];
  return b?.text ?? b?.title ?? '';
};
// Count real bookmark atom nodes in a built ProseMirror doc — locks the PARSE side directly.
const countBookmarks = (doc, id) => {
  let n = 0;
  (function walk(node) {
    if (!node) return;
    if (node.type === 'bookmark' && (id == null || node.attrs?.bookmarkId === id)) n += 1;
    (node.content || []).forEach(walk);
  })(doc);
  return n;
};

// 1. token shape
ok('bookmarkToken emits {bm <id>}', () => {
  assert.equal(bookmarkToken({ bookmarkId: 'bm_abc123' }), '{bm bm_abc123}');
});
ok('bookmarkToken with no id emits nothing (a bookmark is pure place-mark)', () => {
  assert.equal(bookmarkToken({}), '');
  assert.equal(bookmarkToken({ bookmarkId: null }), '');
});
ok('bookmarkToken scrubs braces/whitespace so the token always re-parses', () => {
  assert.equal(bookmarkToken({ bookmarkId: 'bm_a b}c{' }), '{bm bm_abc}');
});

// 2. the token the inlineContent {bm} branch parses (mirror its regex + extraction here so a
//    change to either side that breaks the pair fails loudly).
ok('the {bm <id>} token round-trips through the documented parse', () => {
  const id = 'bm_l4k2_9z_qwert';
  const tok = bookmarkToken({ bookmarkId: id });
  assert.match(tok, /^\{\s*bm\b/i, 'token is recognized by the inlineContent isBm sniff');
  const parsed = tok.replace(/^\{\s*bm\s*/i, '').replace(/\}$/, '').trim();
  assert.equal(parsed, id, 'parsed id equals the original — deep link preserved');
});

// 3. END-TO-END through the real builder — the parser AND serializer, not a mirrored regex. This is
//    the guardrail the mirror checks above can't be: it fails if inlineContent's isBm branch, its
//    combined-token regex, or nodeText's bookmark emit ever drops/mangles the place-mark.
ok('a mid-sentence bookmark survives an export → rebuild cycle (real parser + serializer)', () => {
  assert.equal(
    rtText({ id: 'v1', type: 'vo', voStatus: 'todo', text: 'we filmed {bm bm_abc123} the border and moved on' }),
    'we filmed {bm bm_abc123} the border and moved on'
  );
});
ok('a LEADING bookmark survives (stripLead must not eat the {bm} token)', () => {
  assert.equal(
    rtText({ id: 'v2', type: 'vo', voStatus: 'todo', text: '{bm bm_start} leading bookmark then prose' }),
    '{bm bm_start} leading bookmark then prose'
  );
});
ok('a bookmark beside a visual span + embedded timecode survives (coalescing path)', () => {
  assert.equal(
    rtText({ id: 'b1', type: 'broll', timecode: { tc: '02:00:00:00', day: 2 },
      text: '[B roll of hotels on DAY 2 00:09:19:03] then {bm bm_x9} here' }),
    '[B roll of hotels on DAY 2 00:09:19:03] then {bm bm_x9} here'
  );
});
ok('the rebuilt doc holds a REAL bookmark atom node with the id (locks the parse side directly)', () => {
  const doc = buildEditorDocument([{ id: 'v3', type: 'vo', voStatus: 'todo', text: 'a {bm bm_qq} b' }]);
  assert.equal(countBookmarks(doc, 'bm_qq'), 1, 'exactly one bookmark node carrying the id');
});
ok('two bookmarks in one block both survive with distinct ids', () => {
  assert.equal(
    rtText({ id: 'v4', type: 'vo', voStatus: 'todo', text: 'start {bm bm_one} middle {bm bm_two} end' }),
    'start {bm bm_one} middle {bm bm_two} end'
  );
});

console.log(`\nbookmark-roundtrip: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
