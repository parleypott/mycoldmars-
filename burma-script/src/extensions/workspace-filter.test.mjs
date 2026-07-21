/*
 * workspace-filter.test.mjs — the WORKSPACE CUTOUT filter contract (workspace-filter.js).
 *
 * Proves:
 *   1. OFF — unknown/absent role key → empty classification, EMPTY plugin state.
 *   2. CLASSES — member / ghost(is-above,is-below) / hidden over top-level rows;
 *      bare top-level strays (trailing paragraph) always hide; a single row pinched
 *      between two sections is BOTH ghosts; doc-edge sections have no outer ghost.
 *   3. CARDS — wp-ws-first/wp-ws-last on each section's outer rows (single-row
 *      sections wear both).
 *   4. NESTED ROWS (Palau) — a craft surface inside a nested row lights the WRAPPER
 *      top-level row (it inherits its wrapper's fate; it is never classified itself).
 *   5. STICKY — entering snapshots member identities (firstBlockIds). A row whose
 *      surface is edited away stays visible with wp-ws-left; a newly-matching row
 *      joins live AND grows the snapshot; re-entering (fresh snapshot) drops left rows.
 *   6. SECTIONS META — master row indices + chapter attribution + firstBlockId anchor;
 *      sectionLabel renders "CH 01 — TITLE · ROWS a–b" / "ROW n" shapes.
 *   7. PLUGIN FLOW — real EditorState transactions: meta {key} enters (decorations
 *      populate), a doc change reclassifies (sticky row survives), selection-only
 *      transactions keep the same DecorationSet object, meta null exits to EMPTY.
 *
 * Run: bun src/extensions/workspace-filter.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import {
  classifyRows, buildWorkspaceDecorations, sectionLabel,
  createWorkspaceFilterPlugin, workspaceFilterKey,
} from './workspace-filter.js';
import { doDeleteRows } from './table.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
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
const cell = (blocks, role = 'full') => ({ type: 'tableCell', attrs: { role }, content: blocks });
const row = (blocks) => ({ type: 'tableRow', attrs: { cols: 1, pairId: null }, content: [cell(blocks)] });
const txt = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const para = (...inline) => ({ type: 'paragraph', content: inline });
const dhl = (kind, text) => txt(text, [{ type: 'directionMark', attrs: { kind, status: 'static' } }]);

const block = (type, id, content, extra) => ({ type, attrs: { blockId: id, ...(extra || {}) }, content });
const vo = (id, text) => block('voBlock', id, [para(txt(text))], { status: 'todo' });
const bin = (id, ...inline) => block('binBlock', id, [para(...inline)]);
const broll = (id, text) => block('brollBlock', id, [para(txt(text))]);
const chapterBlk = (id, title) => block('chapterBlock', id, [para(txt(title))], { genre: 'other' });

// Palau-legal nested rows: wrapper row > full cell > nested tableRow.
const nestedRow = (said, shown) => ({
  type: 'tableRow', attrs: { cols: 2, pairId: 'pair_n' },
  content: [cell(said, 'said'), cell(shown, 'shown')],
});
const wrapperRow = (id, inner) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [cell([bin(id, txt('wrapper prose')), inner])],
});

// Read classification back out of a decoration set via the wsCls spec.
function clsAt(decorations, doc, pos) {
  const node = doc.nodeAt(pos);
  const found = decorations.find(pos, pos + (node ? node.nodeSize : 1))
    .filter((d) => d.from === pos && d.spec && d.spec.wsCls);
  return found.length ? found[0].spec.wsCls : null;
}

// ── fixture: 8 rows + trailing stray ─────────────────────────────────────────
// r1 vo · r2 broll · r3 broll · r4 vo · r5 vo · r6 vo · r7 broll · r8 vo · <p>
const doc8 = docFrom({
  type: 'doc',
  content: [
    row([vo('b1', 'one')]),
    row([broll('b2', 'city drone')]),
    row([broll('b3', 'market pans')]),
    row([vo('b4', 'four')]),
    row([vo('b5', 'five')]),
    row([vo('b6', 'six')]),
    row([broll('b7', 'harbor')]),
    row([vo('b8', 'eight')]),
    { type: 'paragraph', content: [txt('trailing stray')] },
  ],
});

// ── 1. OFF ───────────────────────────────────────────────────────────────────
ok('unknown role key → empty classification + empty decorations', () => {
  const res = classifyRows(doc8, 'nope', null);
  assert.deepEqual(res, { rows: [], snapshot: null, sections: [] });
  const built = buildWorkspaceDecorations(doc8, 'nope', null);
  assert.equal(built.decorations.find().length, 0);
});

// ── 2 + 3. CLASSES + CARDS ───────────────────────────────────────────────────
ok('member/ghost/hidden classification, card corners, stray hidden', () => {
  const res = classifyRows(doc8, 'broll', null);
  const by = Object.fromEntries(res.rows.map((r) => [r.firstBlockId, r]));
  // section 1: rows 2-3; section 2: row 7
  assert.equal(by.b2.member && by.b3.member && by.b7.member, true);
  assert.equal(by.b2.first, true);
  assert.equal(by.b3.last, true);
  assert.equal(by.b7.first && by.b7.last, true, 'single-row section wears both corners');
  // ghosts hug each section edge
  assert.equal(by.b1.ghostAbove, true, 'row above section 1');
  assert.equal(by.b4.ghostBelow, true, 'row below section 1');
  assert.equal(by.b6.ghostAbove, true, 'row above section 2');
  assert.equal(by.b8.ghostBelow, true, 'row below section 2');
  // everything else hides
  assert.equal(by.b5.hidden, true);
  // decoration classes carry the same story
  const built = buildWorkspaceDecorations(doc8, 'broll', null);
  const rowsByIdx = Object.fromEntries(res.rows.map((r) => [r.index, r]));
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[2].pos), 'wp-ws-member wp-ws-first');
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[3].pos), 'wp-ws-member wp-ws-last');
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[1].pos), 'wp-ws-ghost is-above');
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[4].pos), 'wp-ws-ghost is-below');
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[5].pos), 'wp-ws-hidden');
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[7].pos), 'wp-ws-member wp-ws-first wp-ws-last');
  // trailing bare paragraph hides
  const last = doc8.child(doc8.childCount - 1);
  let strayPos = 0;
  doc8.forEach((child, pos) => { if (child === last) strayPos = pos; });
  assert.equal(clsAt(built.decorations, doc8, strayPos), 'wp-ws-hidden');
});

ok('a single row between two sections is BOTH ghosts; doc-edge sections have no outer ghost', () => {
  const docPinch = docFrom({
    type: 'doc',
    content: [
      row([broll('p1', 'a')]),
      row([vo('p2', 'between')]),
      row([broll('p3', 'b')]),
    ],
  });
  const res = classifyRows(docPinch, 'broll', null);
  const by = Object.fromEntries(res.rows.map((r) => [r.firstBlockId, r]));
  assert.equal(by.p2.ghostAbove && by.p2.ghostBelow, true, 'pinched row feathers from both edges');
  assert.equal(by.p1.first && by.p1.last, true);
  // p1 starts the doc — nothing above it to ghost; p3 ends it — nothing below.
  const built = buildWorkspaceDecorations(docPinch, 'broll', null);
  assert.equal(clsAt(built.decorations, docPinch, by.p2.pos), 'wp-ws-ghost is-above is-below');
});

// ── 4. NESTED ROWS ───────────────────────────────────────────────────────────
ok('a craft surface inside a NESTED row lights the wrapper top-level row', () => {
  const docNested = docFrom({
    type: 'doc',
    content: [
      row([vo('n1', 'plain')]),
      wrapperRow('n2', nestedRow([para(dhl('mapdata', 'the border line'))], [para(txt('viz'))])),
      row([vo('n3', 'plain')]),
    ],
  });
  const res = classifyRows(docNested, 'mapdata', null);
  assert.equal(res.rows.length, 3, 'only top-level rows are classified');
  const by = Object.fromEntries(res.rows.map((r) => [r.firstBlockId, r]));
  assert.equal(by.n2.member, true, 'wrapper is the member — nested rows inherit its fate');
  assert.equal(by.n1.ghostAbove, true);
  assert.equal(by.n3.ghostBelow, true);
});

// ── 5. STICKY ────────────────────────────────────────────────────────────────
ok('sticky: edited-away row stays as wp-ws-left; joiners grow the snapshot; re-enter resets', () => {
  const enter = classifyRows(doc8, 'broll', null);
  assert.deepEqual([...enter.snapshot].sort(), ['b2', 'b3', 'b7']);

  // b2's broll becomes a vo (surface gone) and b5 gains a broll (joiner).
  const docShift = docFrom({
    type: 'doc',
    content: [
      row([vo('b1', 'one')]),
      row([vo('b2', 'no longer broll')]),
      row([broll('b3', 'market pans')]),
      row([vo('b4', 'four')]),
      row([broll('b5', 'new shot')]),
      row([vo('b6', 'six')]),
      row([broll('b7', 'harbor')]),
      row([vo('b8', 'eight')]),
    ],
  });
  const re = classifyRows(docShift, 'broll', enter.snapshot);
  const by = Object.fromEntries(re.rows.map((r) => [r.firstBlockId, r]));
  assert.equal(by.b2.left, true, 'snapshot row that stopped matching stays visible');
  assert.equal(by.b2.member, false);
  assert.equal(by.b5.member, true, 'newly matching row joins live');
  assert.ok(re.snapshot.has('b5'), 'the snapshot GROWS with joiners');
  assert.ok(re.snapshot.has('b2'), 'the left row keeps its snapshot claim until re-entry');
  assert.notEqual(re.snapshot, enter.snapshot, 'grown snapshot is a fresh Set (copy-on-grow)');
  // b2+b3 stay ONE contiguous card (left rows are visible members of the run)
  assert.equal(by.b2.first, true);
  assert.equal(by.b3.last, true);
  const built = buildWorkspaceDecorations(docShift, 'broll', enter.snapshot);
  assert.equal(clsAt(built.decorations, docShift, by.b2.pos), 'wp-ws-member wp-ws-left wp-ws-first');
  // RE-ENTER (fresh snapshot): b2 drops out
  const fresh = classifyRows(docShift, 'broll', null);
  const byF = Object.fromEntries(fresh.rows.map((r) => [r.firstBlockId, r]));
  assert.equal(byF.b2.left, false);
  assert.equal(byF.b2.ghostAbove, true, 'b2 degrades to section-1 ghost after re-entry');
  assert.ok(!fresh.snapshot.has('b2'));
});

ok('an unchanged recompute reuses the SAME snapshot Set (no churn)', () => {
  const enter = classifyRows(doc8, 'broll', null);
  const again = classifyRows(doc8, 'broll', enter.snapshot);
  assert.equal(again.snapshot, enter.snapshot);
});

// ── 6. SECTIONS META ─────────────────────────────────────────────────────────
ok('sections carry master indices, chapter attribution and the firstBlockId anchor', () => {
  const docCh = docFrom({
    type: 'doc',
    content: [
      row([chapterBlk('c1', 'The Crossing')]),
      row([vo('m1', 'one')]),
      row([broll('m2', 'drone')]),
      row([broll('m3', 'pans')]),
      row([vo('m4', 'four')]),
    ],
  });
  const res = classifyRows(docCh, 'broll', null);
  assert.equal(res.sections.length, 1);
  const s = res.sections[0];
  assert.equal(s.startIndex, 3);
  assert.equal(s.endIndex, 4);
  assert.equal(s.rowCount, 2);
  assert.equal(s.firstBlockId, 'm2');
  assert.equal(s.chapter.ord, '01');
  assert.equal(s.chapter.title, 'The Crossing');
  assert.equal(sectionLabel(s), 'CH 01 — THE CROSSING · ROWS 3–4');
  assert.equal(sectionLabel({ startIndex: 7, endIndex: 7, chapter: null }), 'ROW 7');
  // one widget decoration per section rides the built set
  const built = buildWorkspaceDecorations(docCh, 'broll', null);
  const widgets = built.decorations.find().filter((d) => d.from === d.to);
  assert.equal(widgets.length, 1, 'exactly one meta-pill widget for the one section');
  assert.equal(widgets[0].from, s.pos, 'pill anchors at the section’s first row');
});

// ── 7. PLUGIN FLOW (real EditorState transactions) ───────────────────────────
ok('plugin: meta enters, doc change reclassifies (sticky), selection maps, meta null exits', () => {
  const plugin = createWorkspaceFilterPlugin();
  let state = EditorState.create({ doc: doc8, plugins: [plugin] });
  assert.equal(workspaceFilterKey.getState(state).wsKey, null);

  // ENTER
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));
  let ps = workspaceFilterKey.getState(state);
  assert.equal(ps.wsKey, 'broll');
  assert.ok(ps.decorations.find().length > 0, 'decorations populate on entry');
  assert.deepEqual([...ps.snapshot].sort(), ['b2', 'b3', 'b7']);

  // SELECTION-ONLY transaction → the very same DecorationSet object (no rebuild)
  const selTr = state.tr.setSelection(TextSelection.atStart(state.doc));
  const state2 = state.apply(selTr);
  assert.equal(workspaceFilterKey.getState(state2).decorations, ps.decorations);
  state = state2;

  // DOC CHANGE: delete row 2 (b2, the broll) entirely → sticky has nothing to hold
  // (row identity gone), b3 remains the section. Then TYPE into b3's row — b3 stays.
  const r2 = classifyRows(state.doc, 'broll', null).rows[1];
  state = state.apply(state.tr.delete(r2.pos, r2.pos + r2.node.nodeSize));
  ps = workspaceFilterKey.getState(state);
  assert.equal(ps.wsKey, 'broll');
  const ids = new Set(classifyRows(state.doc, 'broll', ps.snapshot).rows
    .filter((r) => r.member || r.left).map((r) => r.firstBlockId));
  assert.deepEqual([...ids].sort(), ['b3', 'b7'], 'deleted row is gone; sections re-derive');

  // UNKNOWN key → EMPTY (never trust a stale meta)
  const bad = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'zzz' }));
  assert.equal(workspaceFilterKey.getState(bad).wsKey, null);

  // EXIT
  state = state.apply(state.tr.setMeta(workspaceFilterKey, null));
  ps = workspaceFilterKey.getState(state);
  assert.equal(ps.wsKey, null);
  assert.equal(ps.decorations.find().length, 0);
});

ok('plugin: sticky survives a real in-place edit (surface removed, row kept)', () => {
  const plugin = createWorkspaceFilterPlugin();
  let state = EditorState.create({ doc: doc8, plugins: [plugin] });
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));
  // Replace b2's brollBlock with a voBlock IN PLACE (row + firstBlockId kept: same id).
  const r2 = classifyRows(state.doc, 'broll', null).rows[1];
  const cellNode = r2.node.firstChild;
  const blockPos = r2.pos + 1 + 1; // row -> cell -> first block
  const voNode = PMNode.fromJSON(schema, vo('b2', 'now narration'));
  state = state.apply(state.tr.replaceWith(blockPos, blockPos + cellNode.firstChild.nodeSize, voNode));
  const ps = workspaceFilterKey.getState(state);
  const by = Object.fromEntries(classifyRows(state.doc, 'broll', ps.snapshot).rows.map((r) => [r.firstBlockId, r]));
  assert.equal(by.b2.left, true, 'row stays on the card wearing wp-ws-left');
});

// PLUGIN FLOW — a BULK delete (the select→right-click "DELETE N ROWS" path, doDeleteRows) that
// removes SEVERAL member rows in one transaction must not crash the workspace decorations: the
// apply() rebuilds the DecorationSet from the post-delete doc rather than mapping a stale set onto
// vanished positions. (Cross-lineage check: main's bulk-row menu × workspaces' cutout decorations.)
ok('plugin: a bulk DELETE N ROWS of member rows rebuilds decorations without crashing', () => {
  const plugin = createWorkspaceFilterPlugin();
  let state = EditorState.create({ doc: doc8, plugins: [plugin] });
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));
  assert.deepEqual(
    classifyRows(state.doc, 'broll', null).rows.filter((r) => r.member).map((r) => r.firstBlockId).sort(),
    ['b2', 'b3', 'b7'], 'three broll members before the delete');

  // Delete TWO member rows (b2 + b3) in ONE transaction via the real bulk-menu delete.
  const rows = classifyRows(state.doc, 'broll', null).rows;
  let bulkTr = null;
  const dispatched = doDeleteRows(state, (tr) => { bulkTr = tr; }, [rows[1].pos, rows[2].pos]);
  assert.equal(dispatched, true, 'bulk delete produced a transaction');
  assert.doesNotThrow(() => { state = state.apply(bulkTr); }, 'workspace decorations rebuild across a multi-row delete');

  const ps = workspaceFilterKey.getState(state);
  assert.equal(ps.wsKey, 'broll', 'still in the broll workspace after the bulk delete');
  assert.deepEqual(
    classifyRows(state.doc, 'broll', ps.snapshot).rows.filter((r) => r.member || r.left).map((r) => r.firstBlockId).sort(),
    ['b7'], 'the two deleted members are gone; b7 survives as the lone section');
  assert.doesNotThrow(() => ps.decorations.find(0, state.doc.content.size), 'rebuilt DecorationSet is consistent with the new doc');
});

console.log(`workspace-filter: ${pass} passed, 0 failed`);
