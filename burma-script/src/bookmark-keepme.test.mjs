/**
 * bookmark-keepme.test.mjs — locks the KEEP-ME contract of a BOOKMARK against the two data-loss
 * culls the audit (2026-07-07) hardened: the Palau empty-row culler (document-builder.js
 * normalizePalauTableDoc) and the pristine-source rebuild veto (migrate-doc.js
 * palauSourceRebuildCandidate). Both call the SAME shared predicate — hasBookmarkedRow.
 *
 * Sibling coverage split: bookmark-split-survive.test.mjs locks the SPLIT path (a bookmark riding
 * the first split row of a stacked full-width cell). This file locks the OTHER two paths the audit
 * comment names — the ones that were left un-mutation-locked:
 *
 *   1. PREDICATE — hasBookmarkedRow is true for a bookmarked tableRow, true for a bookmark nested
 *      at ANY depth (Palau nests said|shown rows inside a full-width cell — the migrate-doc rebuild
 *      veto relies on the recursive find, exactly like hasUserAddedRow's pairu_ probe), and false
 *      for an un-bookmarked row / a non-object. This is the load-bearing surface both consumers share.
 *   2. CULL KEEP-ME — a bookmarked but WORD-LESS spacer row survives the empty-row culler
 *      (ensureTableDoc under Palau), while an identical PLAIN empty row is culled. Without the guard
 *      the bookmarked spacer row — the ⚑ glyph AND its ?bm deep-link target — silently vanishes on
 *      the next load. INERT: byte-identical for the common un-bookmarked case.
 *
 * MUTATION-PROVEN (manually, iteration #5): dropping `&& !hasBookmarkedRow(splitRow)` from the cull
 * condition drops the bookmarked spacer row (3 rows -> 2, bm_keep gone). Neutering the recursive
 * branch of hasBookmarkedRow makes the nested-depth assertion RED.
 *
 * Run: bun burma-script/src/bookmark-keepme.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { setEpisode } from './episode-config.js';
import { PALAU2 } from '../../palau2-script/config.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };
const clone = (x) => JSON.parse(JSON.stringify(x));

// Palau2 flips normalizeTableRows ON (so the empty-row culler runs). Set the episode BEFORE the
// dynamic import — episode-derived flags are read at import time.
setEpisode(PALAU2);
const { ensureTableDoc, hasBookmarkedRow } = await import('./document-builder.js');

const vo = (id, text) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const textRow = (id, t) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [vo(id, t)] }],
});
// A WORD-LESS spacer row (single empty paragraph) — the culler's prey unless something keeps it.
const emptyRow = (bookmarkId) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: bookmarkId || null },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [{ type: 'paragraph' }] }],
});

const rowsOf = (doc) => doc.content.filter((r) => r.type === 'tableRow');
const bookmarkIds = (doc) => rowsOf(doc).map((r) => r.attrs?.bookmarkId || null).filter(Boolean);

// ── §1 PREDICATE: hasBookmarkedRow — the shared surface both consumers call ────────────────────
ok('§1 hasBookmarkedRow — true on a bookmarked row, false on a plain row / non-object', () => {
  assert.equal(hasBookmarkedRow(emptyRow('bm_x')), true, 'bookmarked row → true');
  assert.equal(hasBookmarkedRow(emptyRow(null)), false, 'un-bookmarked row → false');
  assert.equal(hasBookmarkedRow(textRow('r', 'words')), false, 'no bookmark, has words → false');
  assert.equal(hasBookmarkedRow(null), false, 'null → false (never throws)');
  assert.equal(hasBookmarkedRow('a string'), false, 'non-object → false');
  // an empty-string bookmarkId is NOT a bookmark (falsy) — must not read as keep-me
  assert.equal(hasBookmarkedRow(emptyRow('')), false, 'empty-string bookmarkId → false');
});

ok('§1 hasBookmarkedRow — finds a bookmark nested at ANY depth (rebuild-veto relies on this)', () => {
  // Palau's stale shape nests rows inside a full-width cell; the rebuild veto (migrate-doc) must
  // still veto when the bookmark lives on a NESTED row — same any-depth contract as hasUserAddedRow.
  const nested = {
    type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [
        { type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: 'bm_deep' },
          content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [{ type: 'paragraph' }] }] },
      ],
    }],
  };
  assert.equal(hasBookmarkedRow(nested), true, 'wrapper answers to a nested bookmarked row');
  // a doc-level walk also finds it (both consumers pass whole subtrees)
  assert.equal(hasBookmarkedRow({ type: 'doc', content: [nested] }), true, 'doc → true via recursion');
});

// ── §2 CULL KEEP-ME: a bookmarked spacer row survives ensureTableDoc; a plain one is culled ────
ok('§2 CULL KEEP-ME — bookmarked WORD-LESS row survives the empty-row culler; plain empty row is culled', () => {
  const doc = {
    type: 'doc',
    content: [
      textRow('r1', 'real line one'),
      emptyRow('bm_keep'),   // deliberate bookmark on an empty spacer → must survive
      emptyRow(null),        // plain empty band → must be culled
      textRow('r2', 'real line two'),
    ],
  };
  const out = ensureTableDoc(clone(doc));
  const rows = rowsOf(out);
  // the plain empty row is gone (4 in → 3 out); the two text rows + the bookmarked spacer remain
  assert.equal(rows.length, 3, `plain empty band culled, bookmarked spacer kept (got ${rows.length})`);
  assert.deepEqual(bookmarkIds(out), ['bm_keep'], 'the bookmark survived exactly once');
  const text = JSON.stringify(out);
  assert.ok(text.includes('real line one') && text.includes('real line two'), 'no real text lost');
});

ok('§2 INERT — an un-bookmarked empty band is culled (fix is byte-identical for the common case)', () => {
  const doc = { type: 'doc', content: [textRow('r1', 'kept'), emptyRow(null)] };
  const out = ensureTableDoc(clone(doc));
  assert.equal(rowsOf(out).length, 1, 'only the text row survives');
  assert.deepEqual(bookmarkIds(out), [], 'no phantom bookmark');
});

// ── §3 INLINE BOOKMARK (Johnny 2026-07-08 /bookmark) — the node, not the row attr ──────────────
// The /bookmark command inserts an inline `bookmark` ATOM node (carries no text). It reported
// "appeared then vanished a second later": a row whose only content was the inline bookmark read as
// word-less to rowHasVisibleWords, and hasBookmarkedRow (row-attr only) didn't see it → the save
// normalize CULLED the row, taking the bookmark. §3 locks the fix at BOTH the predicate and the cull.
const inlineBookmarkPara = (id) => ({ type: 'paragraph', content: [{ type: 'bookmark', attrs: { bookmarkId: id } }] });
const inlineBookmarkRow = (id) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [inlineBookmarkPara(id)] }],
});

ok('§3 hasBookmarkedRow — true for the INLINE bookmark node at any depth (the /bookmark fix)', () => {
  assert.equal(hasBookmarkedRow({ type: 'bookmark', attrs: { bookmarkId: 'bm_i' } }), true, 'the node itself → true');
  assert.equal(hasBookmarkedRow(inlineBookmarkPara('bm_i')), true, 'a paragraph holding one → true');
  assert.equal(hasBookmarkedRow(inlineBookmarkRow('bm_i')), true, 'a row holding one → true');
  // mid-sentence: a bookmark among words is still keep-me
  const midPara = { type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'bookmark', attrs: { bookmarkId: 'bm_m' } }, { type: 'text', text: ' b' }] };
  assert.equal(hasBookmarkedRow(midPara), true, 'mid-sentence bookmark → true');
});

ok('§3 CULL KEEP-ME — a WORD-LESS row whose only content is an inline bookmark SURVIVES the culler', () => {
  const doc = {
    type: 'doc',
    content: [
      textRow('r1', 'real line one'),
      inlineBookmarkRow('bm_inline'), // the exact Johnny case — bookmark alone in a word-less row
      emptyRow(null),                 // a genuinely empty band → still culled
      textRow('r2', 'real line two'),
    ],
  };
  const out = ensureTableDoc(clone(doc));
  const rows = rowsOf(out);
  assert.equal(rows.length, 3, `plain empty band culled, inline-bookmark row kept (got ${rows.length})`);
  // the inline bookmark node itself survived, exactly once
  const json = JSON.stringify(out);
  const count = (json.match(/"bm_inline"/g) || []).length;
  assert.equal(count, 1, 'the inline bookmark survived exactly once');
  assert.ok(json.includes('real line one') && json.includes('real line two'), 'no real text lost');
});

console.log(`bookmark-keepme: ${pass} sections green`);
