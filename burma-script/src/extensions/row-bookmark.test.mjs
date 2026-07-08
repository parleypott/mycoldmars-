/*
 * row-bookmark.test.mjs — locks the BOOKMARK feature's two pure cores in table.js:
 * doSetRowBookmark (the attr transaction behind right-click → Bookmark / Remove bookmark) and
 * buildBookmarkUrl (the deep link the ⚑ glyph copies). The contract:
 *
 *   SET    — doSetRowBookmark stamps bookmarkId on the row, content byte-identical; clears
 *            with null; refuses a non-row position; the attr survives a JSON round-trip
 *            through the live schema (PMNode.fromJSON — the save/read-back shape).
 *   MINT   — mintBookmarkId yields unique, prefixed ids.
 *   LINK   — buildBookmarkUrl puts `bm` INSIDE the hash-query when a hash exists (the library
 *            router keeps the slug in the hash and strips hash-queries), in the search when
 *            not; REPLACES an existing bm instead of stacking; preserves other params
 *            (`?read`, `backups`) so a link keeps the access mode it was minted from; and
 *            never leaves a duplicate bm in the search when the hash carries one.
 *
 * Run: bun src/extensions/row-bookmark.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { doSetRowBookmark, mintBookmarkId, buildBookmarkUrl, BURMA_TABLE_NODES } from './table.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, strike: false, dropcursor: false, gapcursor: false,
    history: { depth: 100, newGroupDelay: 750 },
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const docFrom = (json) => PMNode.fromJSON(schema, json);
const row = (blocks, attrs) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, ...(attrs || {}) },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
const vo = (id, text) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

function apply(doc, fn) {
  let state = EditorState.create({ schema, doc });
  let applied = false;
  const dispatch = (tr) => { state = state.apply(tr); applied = true; };
  const returned = fn(state, dispatch);
  return { state, returned, applied };
}

ok('SET stamps the attr, content byte-identical; CLEAR removes it', () => {
  const doc = docFrom({ type: 'doc', content: [row([vo('a', 'first')]), row([vo('b', 'second')])] });
  const r1 = apply(doc, (s, d) => doSetRowBookmark(s, d, 0, 'bm_test1'));
  assert.equal(r1.returned, true);
  const after = r1.state.doc;
  assert.equal(after.child(0).attrs.bookmarkId, 'bm_test1');
  assert.equal(after.child(1).attrs.bookmarkId, null);
  // content untouched — only the attr moved
  assert.deepEqual(after.child(0).child(0).toJSON(), doc.child(0).child(0).toJSON());

  const r2 = apply(after, (s, d) => doSetRowBookmark(s, d, 0, null));
  assert.equal(r2.state.doc.child(0).attrs.bookmarkId, null);
});

ok('SET refuses a non-row position and out-of-range without dispatching', () => {
  const doc = docFrom({ type: 'doc', content: [row([vo('a', 'first')])] });
  const inner = apply(doc, (s, d) => doSetRowBookmark(s, d, 2, 'bm_x')); // inside the cell
  assert.equal(inner.returned, false);
  assert.equal(inner.applied, false);
  const oob = apply(doc, (s, d) => doSetRowBookmark(s, d, 9999, 'bm_x'));
  assert.equal(oob.returned, false);
  assert.equal(oob.applied, false);
});

ok('attr round-trips the live schema (save shape)', () => {
  const doc = docFrom({ type: 'doc', content: [row([vo('a', 'first')], { bookmarkId: 'bm_keep' })] });
  const back = docFrom(doc.toJSON());
  assert.equal(back.child(0).attrs.bookmarkId, 'bm_keep');
});

ok('MINT ids are unique + prefixed', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const id = mintBookmarkId();
    assert.match(id, /^bm_/);
    assert.equal(seen.has(id), false);
    seen.add(id);
  }
});

ok('LINK rides the hash-query when a hash exists', () => {
  const url = buildBookmarkUrl('bm_1', {
    origin: 'https://www.newpress.press', pathname: '/scripts-library/', search: '', hash: '#burma',
  });
  assert.equal(url, 'https://www.newpress.press/scripts-library/#burma?bm=bm_1');
});

ok('LINK preserves existing hash-query params and replaces an old bm', () => {
  const url = buildBookmarkUrl('bm_new', {
    origin: 'https://www.newpress.press', pathname: '/scripts-library/', search: '',
    hash: '#burma?backups&bm=bm_old',
  });
  assert.ok(url.includes('#burma?'), url);
  assert.ok(url.includes('backups'), 'other hash params survive');
  assert.ok(url.includes('bm=bm_new'), 'new bm present');
  assert.ok(!url.includes('bm_old'), 'old bm replaced, never stacked');
});

ok('LINK uses the search when there is no hash, preserving ?read', () => {
  const url = buildBookmarkUrl('bm_2', {
    origin: 'https://example.com', pathname: '/scripts/burma', search: '?read', hash: '',
  });
  assert.ok(url.startsWith('https://example.com/scripts/burma?'), url);
  assert.ok(/[?&]read(=|&|$)/.test(url), 'read flag survives: ' + url);
  assert.ok(url.includes('bm=bm_2'), url);
});

ok('LINK strips a stray search bm when the hash carries the real one', () => {
  const url = buildBookmarkUrl('bm_3', {
    origin: 'https://example.com', pathname: '/x/', search: '?bm=stale&read', hash: '#burma',
  });
  assert.ok(url.includes('#burma?bm=bm_3'), url);
  assert.ok(!url.includes('bm=stale'), 'stale search bm removed: ' + url);
  assert.ok(/[?&]read(=|&|#|$)/.test(url), 'read flag survives: ' + url);
});

console.log(`row-bookmark: ${pass} sections green`);
