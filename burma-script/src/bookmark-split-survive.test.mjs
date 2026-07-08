/**
 * bookmark-split-survive.test.mjs — locks the KEEP-ME survival of a bookmark through the Palau
 * full-width row SPLIT (document-builder.js splitPalauFullWidthRow, run inside the
 * normalizeTableRows load pass via ensureTableDoc).
 *
 * The bug (audit 2026-07-07 follow-up): tonight's audit taught the empty-row CULLER to keep a
 * bookmarked row (hasBookmarkedRow). But the SAME normalize pass ALSO splits a stale full-width
 * cell that stacked multiple cartridges — and it re-wrapped each block with fullWidthRow(), which
 * mints fresh {cols:1} attrs and therefore DROPPED the row's bookmarkId. So a bookmarked stacked
 * row silently lost its ⚑ (a visible glyph AND the ?bm deep-link target) on the next load — the
 * exact data-loss the culler fix was meant to prevent, one code path over.
 *
 * Contract:
 *   SURVIVE — a bookmarked stacked full-width row splits into one row per block, and the FIRST
 *             split row carries the original bookmarkId (findable → glyph paints, deep link lands).
 *   UNIQUE  — exactly ONE resulting row carries that bookmarkId (a duplicate data-bookmark-id
 *             would make the ?bm deep link ambiguous).
 *   INERT   — an UN-bookmarked stacked row still splits with NO bookmarkId on any split row
 *             (the fix is byte-identical for the overwhelmingly common case).
 *
 * Run: bun burma-script/src/bookmark-split-survive.test.mjs  (auto-discovered by run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { setEpisode } from './episode-config.js';
import { PALAU2 } from '../../palau2-script/config.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };
const clone = (x) => JSON.parse(JSON.stringify(x));

// Palau2 is the episode whose config flips normalizeTableRows ON (so splitPalauFullWidthRow runs).
// Set it BEFORE importing document-builder — episode-derived regexes/flags read at import.
setEpisode(PALAU2);
const { ensureTableDoc } = await import('./document-builder.js');

// A voBlock carrying visible words — so the split rows survive the empty-row culler on their own
// merits and the ONLY thing under test is bookmark survival, not culling.
const vo = (id, text) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

// A STALE stacked full-width row: one tableRow (cols:1) whose single cell holds MULTIPLE blocks —
// the shape splitPalauFullWidthRow exists to un-stack. attrs optionally carry a bookmarkId.
const stackedRow = (attrs) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, ...(attrs || {}) },
  content: [{
    type: 'tableCell', attrs: { role: 'full' },
    content: [vo('blk_a', 'first stacked line'), vo('blk_b', 'second stacked line')],
  }],
});

const rowsOf = (doc) => doc.content.filter((r) => r.type === 'tableRow');
const bookmarkIds = (doc) => rowsOf(doc).map((r) => r.attrs?.bookmarkId || null).filter(Boolean);

ok('SURVIVE + UNIQUE: a bookmarked stacked row splits, first split row keeps the bookmarkId (exactly once)', () => {
  const doc = { type: 'doc', content: [stackedRow({ bookmarkId: 'bm_survive_me' })] };
  const out = ensureTableDoc(clone(doc));
  const rows = rowsOf(out);
  // it actually split — the stacked cell became >1 top-level rows
  assert.ok(rows.length >= 2, `stacked cell un-stacked into separate rows (got ${rows.length})`);
  // the bookmark survived — and is present exactly once (unique deep-link target)
  const ids = bookmarkIds(out);
  assert.deepEqual(ids, ['bm_survive_me'], `bookmark survives the split exactly once, got ${JSON.stringify(ids)}`);
  // and it rode the FIRST split row (the natural anchor / where the glyph was)
  assert.equal(rows[0].attrs.bookmarkId, 'bm_survive_me', 'bookmark lands on the first split row');
  // both words are still present — no text lost in the split
  const text = JSON.stringify(out);
  assert.ok(text.includes('first stacked line') && text.includes('second stacked line'), 'both stacked lines survived');
});

ok('INERT: an un-bookmarked stacked row splits with NO bookmarkId on any split row (byte-identical common case)', () => {
  const doc = { type: 'doc', content: [stackedRow()] };
  const out = ensureTableDoc(clone(doc));
  assert.ok(rowsOf(out).length >= 2, 'still splits');
  assert.deepEqual(bookmarkIds(out), [], 'no phantom bookmark introduced');
});

console.log(`bookmark-split-survive: ${pass} sections green`);
