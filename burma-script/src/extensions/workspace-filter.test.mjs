/*
 * workspace-filter.test.mjs — the WORKSPACE CUTOUT filter contract (workspace-filter.js).
 *
 * Proves:
 *   1. OFF — unknown/absent role key → empty classification, EMPTY plugin state.
 *   2. STANDALONE CARDS — by default member / hidden over top-level rows; NO ghost,
 *      NO context classes exist; bare top-level strays (trailing paragraph) hide; a
 *      single row pinched between two sections is HIDDEN (no half-visible atmosphere).
 *   3. CARDS — wp-ws-first/wp-ws-last on each section's outer rows (single-row
 *      sections wear both).
 *   4. NESTED ROWS (Palau) — a craft surface inside a nested row lights the WRAPPER
 *      top-level row; the neighbours hide (no ghost).
 *   5. STICKY — entering snapshots member identities (firstBlockIds). A row whose
 *      surface is edited away stays visible with wp-ws-left; a newly-matching row
 *      joins live AND grows the snapshot; re-entering (fresh snapshot) drops left rows.
 *   6. SECTIONS META — master row indices + chapter attribution + firstBlockId anchor;
 *      sectionLabel renders "CH 01 — TITLE · ROWS a–b" / "ROW n" shapes; the honest
 *      aboveCount/belowCount reveal counts (clamped to EXPAND_STEP, to the real gap).
 *   7. EXPANSION — expand reveals up to EXPAND_STEP flat-gray CONTEXT rows inside the
 *      card walls (wp-ws-context is-above/is-below), repeatable, clamped at doc/section
 *      edges and the midpoint between two facing sections; the member row that meets
 *      context wears the ownership hairline; collapse folds it back; re-entry resets.
 *   8. PLUGIN FLOW — real EditorState transactions: meta {key} enters (decorations
 *      populate, expansions reset), a doc change reclassifies (sticky row survives),
 *      an expand meta reveals context, a collapse meta folds it, re-entry drops both
 *      sticky and expansion, selection-only transactions keep the same DecorationSet,
 *      meta null exits to EMPTY.
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
  classifyRows, buildWorkspaceDecorations, sectionLabel, EXPAND_STEP,
  createWorkspaceFilterPlugin, workspaceFilterKey,
} from './workspace-filter.js';
import { countCheckedMembers } from './ws-checkoff.js';
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
const secById = (sections, id) => sections.find((s) => s.id === id);

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
//   broll members → run A (rows 2-3), run B (row 7).
//   gaps: 1 hidden above A · 3 hidden between A and B · 1 hidden below B.
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

// ── 2 + 3. STANDALONE CARDS + CORNERS (no ghost, no context by default) ───────
ok('default: clean member/hidden classification, card corners, stray hidden, NO ghost/context', () => {
  const res = classifyRows(doc8, 'broll', null);
  const by = Object.fromEntries(res.rows.map((r) => [r.firstBlockId, r]));
  // section A: rows 2-3; section B: row 7
  assert.equal(by.b2.member && by.b3.member && by.b7.member, true);
  assert.equal(by.b2.first, true);
  assert.equal(by.b3.last, true);
  assert.equal(by.b7.first && by.b7.last, true, 'single-row section wears both corners');
  // no ghost, no context anywhere — neighbours are simply hidden
  assert.equal(res.rows.some((r) => r.context), false, 'no context rows by default');
  assert.equal(by.b1.hidden, true, 'row above section A hides (was a ghost)');
  assert.equal(by.b4.hidden && by.b5.hidden && by.b6.hidden, true, 'the between-gap hides');
  assert.equal(by.b8.hidden, true, 'row below section B hides');
  // decoration classes carry the same story — NO wp-ws-ghost token exists
  const built = buildWorkspaceDecorations(doc8, 'broll', null);
  const rowsByIdx = Object.fromEntries(res.rows.map((r) => [r.index, r]));
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[2].pos), 'wp-ws-member wp-ws-first');
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[3].pos), 'wp-ws-member wp-ws-last');
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[1].pos), 'wp-ws-hidden');
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[5].pos), 'wp-ws-hidden');
  assert.equal(clsAt(built.decorations, doc8, rowsByIdx[7].pos), 'wp-ws-member wp-ws-first wp-ws-last');
  assert.equal(built.decorations.find().every((d) => !d.spec || !/wp-ws-ghost/.test(d.spec.wsCls || '')), true,
    'the ghost class is gone entirely');
  // trailing bare paragraph hides
  const last = doc8.child(doc8.childCount - 1);
  let strayPos = 0;
  doc8.forEach((child, pos) => { if (child === last) strayPos = pos; });
  assert.equal(clsAt(built.decorations, doc8, strayPos), 'wp-ws-hidden');
});

ok('a single row between two sections HIDES by default (no half-visible atmosphere)', () => {
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
  assert.equal(by.p2.hidden, true, 'the pinched row is simply hidden');
  assert.equal(by.p2.context, false);
  assert.equal(by.p1.first && by.p1.last, true);
  assert.equal(by.p3.first && by.p3.last, true);
  // honesty: p1 is doc-top (no above button), p3 is doc-bottom (no below button); the
  // ONE row between them is offered as 1-more on each facing side.
  const sA = secById(res.sections, 'p1');
  const sB = secById(res.sections, 'p3');
  assert.equal(sA.aboveCount, 0, 'nothing above the first section');
  assert.equal(sA.belowCount, 1, 'exactly one hidden row below section A');
  assert.equal(sB.aboveCount, 1, 'exactly one hidden row above section B');
  assert.equal(sB.belowCount, 0, 'nothing below the last section');
});

// ── 4. NESTED ROWS ───────────────────────────────────────────────────────────
ok('a craft surface inside a NESTED row lights the wrapper top-level row; neighbours hide', () => {
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
  assert.equal(by.n1.hidden, true);
  assert.equal(by.n3.hidden, true);
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
  // RE-ENTER (fresh snapshot): b2 drops out and simply hides (no ghost)
  const fresh = classifyRows(docShift, 'broll', null);
  const byF = Object.fromEntries(fresh.rows.map((r) => [r.firstBlockId, r]));
  assert.equal(byF.b2.left, false);
  assert.equal(byF.b2.hidden, true, 'b2 hides after re-entry — no ghost fallback');
  assert.ok(!fresh.snapshot.has('b2'));
});

ok('an unchanged recompute reuses the SAME snapshot Set (no churn)', () => {
  const enter = classifyRows(doc8, 'broll', null);
  const again = classifyRows(doc8, 'broll', enter.snapshot);
  assert.equal(again.snapshot, enter.snapshot);
});

// ── 6. SECTIONS META ─────────────────────────────────────────────────────────
ok('sections carry master indices, chapter attribution, firstBlockId anchor, honest reveal counts', () => {
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
  assert.equal(s.id, 'm2');
  assert.equal(s.chapter.ord, '01');
  assert.equal(s.chapter.title, 'The Crossing');
  assert.equal(sectionLabel(s), 'CH 01 — THE CROSSING · ROWS 3–4');
  assert.equal(sectionLabel({ startIndex: 7, endIndex: 7, chapter: null }), 'ROW 7');
  // honest counts: 2 hidden rows above (chapter + m1), 1 below (m4)
  assert.equal(s.aboveCount, 2);
  assert.equal(s.belowCount, 1);
  assert.equal(s.aboveExpanded, false);
  assert.equal(s.belowExpanded, false);
  // exactly one TOP-BAR widget per section; a BOTTOM-BAR too (it has a below button).
  // (Filter to the section BARS by key — per-member-row check controls are widgets too.)
  const built = buildWorkspaceDecorations(docCh, 'broll', null);
  const barWidgets = built.decorations.find()
    .filter((d) => d.from === d.to && /^ws(top|bot):/.test((d.spec && d.spec.key) || ''));
  assert.equal(barWidgets.length, 2, 'one top bar + one bottom bar for the one section');
});

ok('doc8 default reveal counts are honest and clamped to EXPAND_STEP', () => {
  const res = classifyRows(doc8, 'broll', null);
  const A = secById(res.sections, 'b2');
  const B = secById(res.sections, 'b7');
  assert.equal(A.aboveCount, 1, 'one hidden row above section A');
  assert.equal(A.belowCount, EXPAND_STEP, 'three between → clamped to the step');
  assert.equal(B.aboveCount, EXPAND_STEP, 'the same between-gap, from section B');
  assert.equal(B.belowCount, 1, 'one hidden row below section B');
});

// ── 7. EXPANSION ─────────────────────────────────────────────────────────────
ok('expand reveals flat-gray context INSIDE the walls; hairline marks ownership; counts stay honest', () => {
  const exp = new Map([['b2', { above: 0, below: EXPAND_STEP }]]);
  const res = classifyRows(doc8, 'broll', null, exp);
  const by = Object.fromEntries(res.rows.map((r) => [r.firstBlockId, r]));
  // the three between-rows become context BELOW section A, inside its card
  assert.equal(by.b4.context && by.b4.contextBelow, true);
  assert.equal(by.b5.context && by.b5.contextBelow, true);
  assert.equal(by.b6.context && by.b6.contextBelow, true);
  // the card grew: first stays b2, last is now b6; b3 (last member) wears the hairline
  assert.equal(by.b2.first, true);
  assert.equal(by.b6.last, true);
  assert.equal(by.b3.last, false, 'the corner moved off the member row onto the context');
  assert.equal(by.b3.bodyBot, true, 'the last member row meets context → ownership hairline');
  const built = buildWorkspaceDecorations(doc8, 'broll', null, exp);
  assert.equal(clsAt(built.decorations, doc8, by.b4.pos), 'wp-ws-context is-below');
  assert.equal(clsAt(built.decorations, doc8, by.b6.pos), 'wp-ws-context is-below wp-ws-last');
  assert.equal(clsAt(built.decorations, doc8, by.b3.pos), 'wp-ws-member wp-ws-bodybot');
  // section A's below button is now spent; COLLAPSE is offered; section B's facing
  // above-count fell to 0 (the shared gap is consumed).
  const A = secById(res.sections, 'b2');
  const B = secById(res.sections, 'b7');
  assert.equal(A.belowCount, 0);
  assert.equal(A.belowExpanded, true);
  assert.equal(B.aboveCount, 0);
});

ok('expansion is clamped at the doc edge and idempotent past the max', () => {
  const one = classifyRows(doc8, 'broll', null, new Map([['b7', { above: 0, below: EXPAND_STEP }]]));
  const many = classifyRows(doc8, 'broll', null, new Map([['b7', { above: 0, below: 99 }]]));
  const oneBy = Object.fromEntries(one.rows.map((r) => [r.firstBlockId, r]));
  const manyBy = Object.fromEntries(many.rows.map((r) => [r.firstBlockId, r]));
  // only ONE row exists below section B — both requests reveal exactly it
  assert.equal(oneBy.b8.context && oneBy.b8.contextBelow, true);
  assert.equal(manyBy.b8.context && manyBy.b8.contextBelow, true);
  assert.equal(secById(one.sections, 'b7').belowCount, 0, 'nothing more to reveal');
  assert.equal(secById(many.sections, 'b7').belowCount, 0);
});

ok('two facing sections expanding into one gap CLAMP at the midpoint', () => {
  // A (rows 2-3) and B (row 8) with a 4-row gap between (rows 4-7).
  const docGap = docFrom({
    type: 'doc',
    content: [
      row([vo('g1', 'x')]),
      row([broll('g2', 'A1')]),
      row([broll('g3', 'A2')]),
      row([vo('g4', 'c1')]),
      row([vo('g5', 'c2')]),
      row([vo('g6', 'c3')]),
      row([vo('g7', 'c4')]),
      row([broll('g8', 'B1')]),
    ],
  });
  // both sections ask for the whole gap (99 each) → 4 rows split 2/2 at the midpoint
  const exp = new Map([['g2', { above: 0, below: 99 }], ['g8', { above: 99, below: 0 }]]);
  const res = classifyRows(docGap, 'broll', null, exp);
  const by = Object.fromEntries(res.rows.map((r) => [r.firstBlockId, r]));
  assert.equal(by.g4.contextBelow && by.g5.contextBelow, true, 'A took the top two');
  assert.equal(by.g6.contextAbove && by.g7.contextAbove, true, 'B took the bottom two');
  assert.equal(by.g4.contextAbove, false);
  assert.equal(by.g7.contextBelow, false);
  const A = secById(res.sections, 'g2');
  const B = secById(res.sections, 'g8');
  assert.equal(A.belowCount, 0, 'gap fully consumed → no button between');
  assert.equal(B.aboveCount, 0);
  assert.equal(A.belowExpanded && B.aboveExpanded, true);
});

// ── 8. PLUGIN FLOW (real EditorState transactions) ───────────────────────────
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
  assert.equal(ps.expansions.size, 0, 'entry resets expansions');

  // SELECTION-ONLY transaction → the very same DecorationSet object (no rebuild)
  const selTr = state.tr.setSelection(TextSelection.atStart(state.doc));
  const state2 = state.apply(selTr);
  assert.equal(workspaceFilterKey.getState(state2).decorations, ps.decorations);
  state = state2;

  // DOC CHANGE: delete row 2 (b2, the broll) entirely → b3 remains the section.
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

ok('plugin: expand meta reveals context, collapse folds it, re-entry resets expansions', () => {
  const plugin = createWorkspaceFilterPlugin();
  let state = EditorState.create({ doc: doc8, plugins: [plugin] });
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));

  const ctxCount = (st) => classifyRows(st.doc, 'broll',
    workspaceFilterKey.getState(st).snapshot,
    workspaceFilterKey.getState(st).expansions).rows.filter((r) => r.context).length;
  assert.equal(ctxCount(state), 0, 'no context on entry');

  // EXPAND section A (id b2) below by one step
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { expand: { id: 'b2', side: 'below' } }));
  let ps = workspaceFilterKey.getState(state);
  assert.equal(ps.expansions.get('b2').below, EXPAND_STEP);
  assert.equal(ctxCount(state), EXPAND_STEP, 'three context rows revealed inside the card');
  // a wp-ws-context decoration now exists
  assert.ok(ps.decorations.find().some((d) => d.spec && /wp-ws-context/.test(d.spec.wsCls || '')),
    'context decoration present');

  // COLLAPSE section A below → back to a clean card
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { collapse: { id: 'b2', side: 'below' } }));
  ps = workspaceFilterKey.getState(state);
  assert.equal(ps.expansions.get('b2').below, 0);
  assert.equal(ctxCount(state), 0, 'context folded back');

  // EXPAND again, then RE-ENTER → expansions reset to empty
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { expand: { id: 'b2', side: 'below' } }));
  assert.equal(ctxCount(state), EXPAND_STEP);
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));
  ps = workspaceFilterKey.getState(state);
  assert.equal(ps.expansions.size, 0, 're-entry drops all expansions');
  assert.equal(ctxCount(state), 0, 'clean standalone cards again');
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

// ── 9. CHECK-OFF (view-local per-workspace row "done") ───────────────────────
// An in-memory store stub standing in for localStorage; keyed by wsKey (the plugin passes
// prev.wsKey), so it doubles as the per-workspace isolation proof.
const makeStore = (seed) => {
  const mem = new Map(seed || []);
  return {
    mem,
    load: (k) => new Set(mem.get(k) || []),
    save: (k, s) => { mem.set(k, [...s]); },
  };
};
const hasDone = (ps, present = true) =>
  assert.equal(ps.decorations.find().some((d) => d.spec && /\bwp-ws-done\b/.test(d.spec.wsCls || '')), present);

ok('check: toggle adds wp-ws-done + persists; toggle again removes + persists empty', () => {
  const store = makeStore();
  const plugin = createWorkspaceFilterPlugin(store);
  let state = EditorState.create({ doc: doc8, plugins: [plugin] });
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));
  let ps = workspaceFilterKey.getState(state);
  assert.equal(ps.checked.size, 0, 'no checks on entry');
  hasDone(ps, false);

  // CHECK b2 (a broll member)
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { toggleCheck: { id: 'b2' } }));
  ps = workspaceFilterKey.getState(state);
  assert.deepEqual([...ps.checked], ['b2'], 'b2 now checked in plugin state');
  assert.deepEqual(store.mem.get('broll'), ['b2'], 'persisted to the broll store key');
  hasDone(ps, true);
  assert.equal(countCheckedMembers(state.doc, 'broll', ps.checked), 1, 'hub count n = 1');
  // NO doc change — the check never mutates the script
  assert.equal(state.doc.eq(doc8), true, 'document is byte-identical (decoration-only)');

  // UNCHECK b2
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { toggleCheck: { id: 'b2' } }));
  ps = workspaceFilterKey.getState(state);
  assert.equal(ps.checked.size, 0, 'b2 unchecked');
  assert.deepEqual(store.mem.get('broll'), [], 'empty set persisted');
  hasDone(ps, false);
  assert.equal(countCheckedMembers(state.doc, 'broll', ps.checked), 0);
});

ok('check: prune on entry drops a ghost id, keeps a present (even non-member) row', () => {
  // seed: b2 (a real broll member) + b1 (a real row, but a VO — not a broll member) + a ghost
  const store = makeStore([['broll', ['b2', 'b1', 'ghost_gone']]]);
  const plugin = createWorkspaceFilterPlugin(store);
  let state = EditorState.create({ doc: doc8, plugins: [plugin] });
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));
  const ps = workspaceFilterKey.getState(state);
  // ghost (no such row) pruned; b1 kept though it is NOT a broll member (prune is by row
  // EXISTENCE, not membership — a row that merely lost the craft tag keeps its check).
  assert.deepEqual([...ps.checked].sort(), ['b1', 'b2']);
  assert.deepEqual(store.mem.get('broll').sort(), ['b1', 'b2'], 'the prune was persisted');
  // n counts only checked MEMBERS in view → b2 (b1 is a non-member VO row)
  assert.equal(countCheckedMembers(state.doc, 'broll', ps.checked), 1);
});

ok('check: per-workspace isolation — a check in broll is invisible to 3d, restored on return', () => {
  const store = makeStore();
  const plugin = createWorkspaceFilterPlugin(store);
  let state = EditorState.create({ doc: doc8, plugins: [plugin] });
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { toggleCheck: { id: 'b2' } }));
  assert.deepEqual(store.mem.get('broll'), ['b2']);

  // switch to a DIFFERENT craft — its own (empty) set, broll's check untouched
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: '3d' }));
  let ps = workspaceFilterKey.getState(state);
  assert.equal(ps.checked.size, 0, '3d carries its own empty check set');
  assert.deepEqual(store.mem.get('broll'), ['b2'], 'broll storage is undisturbed');

  // back to broll — the check reloads
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));
  ps = workspaceFilterKey.getState(state);
  assert.deepEqual([...ps.checked], ['b2'], 'broll check restored on return');
});

ok('check: coexists with expansion + sticky, survives doc change and selection; clears on exit', () => {
  const store = makeStore();
  const plugin = createWorkspaceFilterPlugin(store);
  let state = EditorState.create({ doc: doc8, plugins: [plugin] });
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { toggleCheck: { id: 'b2' } }));

  // EXPAND still works, and the check rides through it
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { expand: { id: 'b2', side: 'below' } }));
  let ps = workspaceFilterKey.getState(state);
  assert.equal(ps.expansions.get('b2').below, EXPAND_STEP, 'expansion machinery unaffected');
  assert.equal(ps.checked.has('b2'), true, 'check survives an expand');

  // SELECTION-ONLY reuses the same set object (check + expansion decorations intact)
  const selState = state.apply(state.tr.setSelection(TextSelection.atStart(state.doc)));
  assert.equal(workspaceFilterKey.getState(selState).decorations, ps.decorations, 'selection maps, no rebuild');
  state = selState;

  // DOC CHANGE: insert text into b7 (a different member) — b2's check persists.
  // Position inside b7's paragraph: tableRow → tableCell → brollBlock → paragraph = 4 opens.
  const r7 = classifyRows(state.doc, 'broll', null).rows.find((r) => r.firstBlockId === 'b7');
  state = state.apply(state.tr.insertText('x', r7.pos + 4));
  ps = workspaceFilterKey.getState(state);
  assert.equal(ps.checked.has('b2'), true, 'check survives a doc change');
  hasDone(ps, true);

  // EXIT clears everything back to EMPTY (storage keeps the durable check for next time)
  state = state.apply(state.tr.setMeta(workspaceFilterKey, null));
  ps = workspaceFilterKey.getState(state);
  assert.equal(ps.wsKey, null);
  assert.equal(ps.checked, null, 'exit returns EMPTY (checked null)');
  assert.deepEqual(store.mem.get('broll'), ['b2'], 'the durable check remains in storage after exit');
});

console.log(`workspace-filter: ${pass} passed, 0 failed`);
