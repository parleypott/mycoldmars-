/*
 * add-rows.test.mjs — the "+" row tool's transaction (table.js doAddRowsBelow) and its
 * data-loss guard (document-builder.js normalizePalauTableDoc keeps user-added empty rows).
 *
 * Proves:
 *   1. STRUCTURE — adding N rows below a 2-column said|shown row inserts N EMPTY PAIRED
 *      rows (cols:2, roles said|shown, one empty paragraph per cell) directly below, and
 *      the source row's own content is untouched.
 *   2. ONE TRANSACTION / UNDO — all N rows arrive in a single history step: one undo
 *      removes every inserted row and restores the original doc exactly.
 *   3. CURSOR — the selection lands inside the first inserted row's first (said) cell.
 *   4. 1-COL — below a full-width row the tool inserts a full-width (cols:1, role:full) row.
 *   5. CLAMP + VALIDATION — count is clamped to 1..50; a non-row position is a no-op.
 *   6. PAIRIDS — every inserted row carries a unique `pairu_` pairId (the user-added marker).
 *   7. CULLER GUARD — with the Palau normalizeTableRows flag ON, ensureTableDoc still KEEPS
 *      a word-less user-added (pairu_) row while continuing to drop legacy stray empty bands.
 *
 * Run: bun src/extensions/add-rows.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { doAddRowsBelow, mintUserPairId } from './table.js';
import { ensureTableDoc } from '../document-builder.js';
import { hasUserAddedRow } from '../migrate-doc.js';
import { hasUserAddedRow as hasUserAddedRowCanonical } from '../document-builder.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';
import { PALAU } from '../../../palau-script/config.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL', label); } };
const eq = (got, want, label) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`FAIL ${label}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};

// ── Minimal schema matching the engine's tableRow/tableCell shape ────────────────────────────
const schema = new Schema({
  nodes: {
    doc: { content: 'tableRow+' },
    tableRow: { content: 'tableCell+', group: 'block', attrs: { cols: { default: 1 }, pairId: { default: null } } },
    tableCell: { content: 'block+', isolating: true, attrs: { role: { default: 'full' } } },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
});
const p = (t) => schema.nodes.paragraph.create(null, t ? schema.text(t) : undefined);
const cell = (role, ...blocks) => schema.nodes.tableCell.create({ role }, blocks);
const row = (attrs, ...cells) => schema.nodes.tableRow.create(attrs, cells);

const makeState = (...rows) => EditorState.create({
  schema,
  doc: schema.nodes.doc.create(null, rows),
  plugins: [history()],
});

// ── 1+2+3+6: add 5 paired rows below a said|shown row ────────────────────────────────────────
{
  const src = row({ cols: 2, pairId: 'pair_orig' }, cell('said', p('what is said')), cell('shown', p('what is shown')));
  let state = makeState(src);
  const before = state.doc.toJSON();
  const dispatch = (tr) => { state = state.apply(tr); };

  ok(doAddRowsBelow(state, dispatch, 0, 5) === true, 'add-5 returns true');
  eq(state.doc.childCount, 6, 'doc has 1 source + 5 inserted rows');

  // Source row untouched, still first.
  eq(state.doc.child(0).toJSON(), before.content[0], 'source row content untouched');

  const pairIds = new Set();
  for (let i = 1; i <= 5; i++) {
    const r = state.doc.child(i);
    eq(r.attrs.cols, 2, `row ${i} is cols:2`);
    eq(r.childCount, 2, `row ${i} has two cells`);
    eq([r.child(0).attrs.role, r.child(1).attrs.role], ['said', 'shown'], `row ${i} roles said|shown`);
    ok(r.child(0).childCount === 1 && r.child(0).child(0).type.name === 'paragraph' && r.child(0).child(0).content.size === 0, `row ${i} said cell = one empty paragraph`);
    ok(r.child(1).childCount === 1 && r.child(1).child(0).type.name === 'paragraph' && r.child(1).child(0).content.size === 0, `row ${i} shown cell = one empty paragraph`);
    ok(typeof r.attrs.pairId === 'string' && r.attrs.pairId.startsWith('pairu_'), `row ${i} carries a pairu_ pairId`);
    pairIds.add(r.attrs.pairId);
  }
  eq(pairIds.size, 5, 'all 5 inserted pairIds are unique');

  // Cursor: inside the FIRST inserted row's FIRST (said) cell.
  const $from = state.selection.$from;
  ok($from.depth >= 2 && $from.node(1).type.name === 'tableRow' && $from.node(2).attrs.role === 'said', 'selection sits in a said cell');
  eq($from.before(1), src.nodeSize, 'selection sits in the FIRST inserted row (directly below source)');

  // ONE undo step removes all 5 rows and restores the original doc byte-identically.
  undo(state, dispatch);
  eq(state.doc.toJSON(), before, 'single undo restores the original doc (one transaction)');
}

// ── 4: add below a full-width row clones the 1-col structure ─────────────────────────────────
{
  const src = row({ cols: 1 }, cell('full', p('a full-width cartridge')));
  let state = makeState(src);
  const dispatch = (tr) => { state = state.apply(tr); };
  ok(doAddRowsBelow(state, dispatch, 0, 1) === true, '1-col add returns true');
  eq(state.doc.childCount, 2, '1-col: one row inserted');
  const r = state.doc.child(1);
  eq(r.attrs.cols, 1, '1-col: inserted row is cols:1');
  eq(r.childCount, 1, '1-col: inserted row has one cell');
  eq(r.child(0).attrs.role, 'full', '1-col: inserted cell role is full');
}

// ── 4b: NESTED rows (the real Palau saved-doc shape: tableRow > tableCell > tableRow) ────────
// Palau's shipped doc nests its said|shown rows inside a wrapper row's cell. Adding below a
// NESTED row must insert the new row as a SIBLING inside the same cell, not at top level.
{
  const inner = row({ cols: 2, pairId: 'pair_inner' }, cell('said', p('nested said')), cell('shown', p('nested shown')));
  const outer = row({ cols: 1 }, schema.nodes.tableCell.create({ role: 'full' }, [inner]));
  let state = makeState(outer);
  const dispatch = (tr) => { state = state.apply(tr); };
  const innerPos = 2; // outer row open (+1), cell open (+1) → just before the inner row
  ok(state.doc.nodeAt(innerPos)?.type.name === 'tableRow', 'sanity: innerPos resolves the nested row');
  ok(doAddRowsBelow(state, dispatch, innerPos, 2) === true, 'nested add returns true');
  eq(state.doc.childCount, 1, 'nested: still ONE top-level row (siblings went inside the cell)');
  const cellNode = state.doc.child(0).child(0);
  eq(cellNode.childCount, 3, 'nested: cell now holds inner row + 2 inserted rows');
  for (let i = 1; i <= 2; i++) {
    const r = cellNode.child(i);
    eq(r.type.name, 'tableRow', `nested: sibling ${i} is a tableRow`);
    eq(r.attrs.cols, 2, `nested: sibling ${i} is cols:2`);
    eq([r.child(0).attrs.role, r.child(1).attrs.role], ['said', 'shown'], `nested: sibling ${i} roles said|shown`);
    ok(String(r.attrs.pairId).startsWith('pairu_'), `nested: sibling ${i} carries pairu_ pairId`);
  }
}

// ── 5: clamp + validation ────────────────────────────────────────────────────────────────────
{
  const src = row({ cols: 2, pairId: 'pair_x' }, cell('said', p('s')), cell('shown', p('v')));
  let state = makeState(src);
  const dispatch = (tr) => { state = state.apply(tr); };
  ok(doAddRowsBelow(state, dispatch, 0, 0) === true, 'count 0 still adds (clamped up)');
  eq(state.doc.childCount, 2, 'count 0 clamps to 1 row');
  ok(doAddRowsBelow(state, dispatch, 0, 999) === true, 'count 999 accepted');
  eq(state.doc.childCount, 52, 'count 999 clamps to 50 rows');

  // Not a row position → no-op false, doc unchanged.
  const sizeBefore = state.doc.childCount;
  ok(doAddRowsBelow(state, dispatch, 1, 1) === false, 'non-row pos (inside a row) returns false');
  eq(state.doc.childCount, sizeBefore, 'failed add leaves doc unchanged');
}

// ── mintUserPairId shape ─────────────────────────────────────────────────────────────────────
{
  const a = mintUserPairId(), b = mintUserPairId();
  ok(a.startsWith('pairu_') && b.startsWith('pairu_'), 'minted ids carry the pairu_ prefix');
  ok(a !== b, 'minted ids are unique');
}

// ── 7: Palau load-culler KEEPS a word-less user-added row, still drops legacy bands ──────────
{
  const emptyPara = { type: 'paragraph' };
  const wordsRow = {
    type: 'tableRow', attrs: { cols: 1 },
    content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'real script words' }] }] }],
  };
  const userAddedEmpty = {
    type: 'tableRow', attrs: { cols: 2, pairId: 'pairu_test_row' },
    content: [
      { type: 'tableCell', attrs: { role: 'said' }, content: [emptyPara] },
      { type: 'tableCell', attrs: { role: 'shown' }, content: [emptyPara] },
    ],
  };
  const legacyEmpty = {
    type: 'tableRow', attrs: { cols: 2, pairId: 'pair_legacy' },
    content: [
      { type: 'tableCell', attrs: { role: 'said' }, content: [emptyPara] },
      { type: 'tableCell', attrs: { role: 'shown' }, content: [emptyPara] },
    ],
  };

  setEpisode(PALAU);   // normalizeTableRows ON → the culler runs
  const out = ensureTableDoc({ type: 'doc', content: [wordsRow, userAddedEmpty, legacyEmpty] });
  setEpisode(BURMA);   // restore for any later suites in this process

  eq(out.content.length, 2, 'culler kept 2 of 3 rows');
  ok(out.content.some((r) => r?.attrs?.pairId === 'pairu_test_row'), 'user-added empty row SURVIVES the culler');
  ok(!out.content.some((r) => r?.attrs?.pairId === 'pair_legacy'), 'legacy stray empty band is still dropped');
  ok(JSON.stringify(out.content[0]).includes('real script words'), 'row with words untouched');

  // And with Burma active (flag OFF) the same doc passes through un-culled.
  const outBurma = ensureTableDoc({ type: 'doc', content: [wordsRow, userAddedEmpty, legacyEmpty] });
  eq(outBurma.content.length, 3, 'Burma (flag off): no culling at all');

  // NESTED user-added row (the Palau shape): a word-less pairu_ row wrapped inside a
  // full-width row must ALSO survive — the culler judges the wrapper, so the marker
  // has to be found at depth.
  const nestedUserAdded = {
    type: 'tableRow', attrs: { cols: 1 },
    content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [userAddedEmpty] }],
  };
  setEpisode(PALAU);
  const outNested = ensureTableDoc({ type: 'doc', content: [wordsRow, nestedUserAdded] });
  setEpisode(BURMA);
  ok(JSON.stringify(outNested).includes('pairu_test_row'), 'NESTED user-added empty row survives the culler');
}

// ── 8: pristine-rebuild guard — a pairu_ row anywhere marks the doc as user-edited ───────────
{
  const emptyPairuRow = {
    type: 'tableRow', attrs: { cols: 2, pairId: 'pairu_fresh' },
    content: [
      { type: 'tableCell', attrs: { role: 'said' }, content: [{ type: 'paragraph' }] },
      { type: 'tableCell', attrs: { role: 'shown' }, content: [{ type: 'paragraph' }] },
    ],
  };
  const plainRow = {
    type: 'tableRow', attrs: { cols: 1, pairId: 'pair_old' },
    content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [{ type: 'paragraph' }] }],
  };
  ok(hasUserAddedRow({ type: 'doc', content: [plainRow, emptyPairuRow] }) === true, 'hasUserAddedRow: finds a top-level pairu_ row');
  const nested = { type: 'tableRow', attrs: { cols: 1 }, content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [emptyPairuRow] }] };
  ok(hasUserAddedRow({ type: 'doc', content: [nested] }) === true, 'hasUserAddedRow: finds a NESTED pairu_ row');
  ok(hasUserAddedRow({ type: 'doc', content: [plainRow] }) === false, 'hasUserAddedRow: legacy pairIds do not trip it');
  // TWIN-LOCK — the pristine-rebuild guard (migrate-doc) and the empty-band culler (document-builder)
  // MUST share ONE predicate, or the two data-loss guards can silently drift apart. Assert they are
  // the very same function object, not two hand-copied bodies. This goes RED the instant anyone
  // re-inlines a local copy in either file.
  ok(hasUserAddedRow === hasUserAddedRowCanonical, 'hasUserAddedRow: migrate-doc re-exports the ONE canonical predicate (no twin)');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
