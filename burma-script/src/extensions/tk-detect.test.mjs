/*
 * tk-detect.test.mjs — the TK PLACEHOLDER contract (tk-pattern.js + tk-detect.js +
 * the workspaces.js 'tk' role).
 *
 * Proves:
 *   1. PATTERN — findTkRanges positives ("TK", "(TK musician's name)", two parens in
 *      one line, "TK name TK" = two hits) and negatives ("ATKINS", "TKO", lowercase
 *      "tk", "(taken)", "atk"); a bare TK inside a matched parenthetical is swallowed
 *      by the paren swoop (no double-paint).
 *   2. DECORATIONS — against real schema-built docs: inline decos cover exactly the
 *      matched text (doc.textBetween), spec.tkKind carries paren|bare; a parenthetical
 *      SPANNING a bold-split text-node boundary still paints as ONE range; text inside
 *      an existing tkSpan run gets NO loose paint (that surface has its own look).
 *   3. MEMBERSHIP — the TK workspace gathers BOTH surfaces: a row with the bare/paren
 *      pattern is a member, a row with only a tkSpan mark is a member (excluded from
 *      paint, INCLUDED in the drawer), a row with neither is not; flows through
 *      scanWorkspace like any craft.
 *   4. SINGLE SOURCE OF TRUTH — the workspace predicate IS tk-pattern.js
 *      textblockHasTk (function identity), and both tk-detect.js and workspaces.js
 *      import the shared module (source pin) — the paint and the drawer cannot drift.
 *   5. PLUGIN FLOW — real EditorState: init populates, docChanged rebuilds,
 *      selection-only transactions keep the same DecorationSet object; the builder
 *      memoizes by doc ref (same doc → same set object).
 *
 * Run: bun src/extensions/tk-detect.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { findTkRanges, textHasTk, textblockHasTk, textblockPositionalText, INLINE_LEAF_CHAR } from '../tk-pattern.js';
import { buildTkDecorations, createTkDetectPlugin, tkDetectKey } from './tk-detect.js';
import { workspaceRole, rowIsMember, scanWorkspace } from '../workspaces.js';
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
    horizontalRule: false, dropcursor: false, gapcursor: false,
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
const block = (type, id, content, extra) => ({ type, attrs: { blockId: id, ...(extra || {}) }, content });
const bin = (id, ...inline) => block('binBlock', id, [para(...inline)]);
const vo = (id, text) => block('voBlock', id, [para(txt(text))], { status: 'todo' });
const tkSpanTxt = (text) => txt(text, [{ type: 'tkSpan' }]);

// All inline tk decorations of a doc as { from, to, kind, text } sorted by position.
const paints = (doc) => buildTkDecorations(doc)
  .find()
  .map((d) => ({ from: d.from, to: d.to, kind: d.spec.tkKind, text: doc.textBetween(d.from, d.to) }))
  .sort((a, b) => a.from - b.from);

// ── 1. THE PATTERN (pure string layer) ───────────────────────────────────────
ok('positives: bare TK, whole-parens swoop, multiple hits per line', () => {
  assert.deepEqual(findTkRanges('TK'), [{ from: 0, to: 2, kind: 'bare' }]);
  assert.deepEqual(findTkRanges("and then I talked to (TK musician's name) for an hour"),
    [{ from: 21, to: 41, kind: 'paren' }]);
  assert.equal("and then I talked to (TK musician's name) for an hour".slice(21, 41), "(TK musician's name)",
    'the swoop takes the WHOLE (TK …) including both parens');
  assert.deepEqual(findTkRanges('we need (TK stat) and (TK date)').map((r) => r.kind), ['paren', 'paren']);
  assert.deepEqual(findTkRanges('TK name TK').map((r) => ({ from: r.from, kind: r.kind })),
    [{ from: 0, kind: 'bare' }, { from: 8, kind: 'bare' }], 'two bare hits');
});

ok('negatives: ATKINS, TKO, lowercase tk, (taken), atk never match — CASE-SENSITIVE upper only', () => {
  for (const s of ['ATKINS', 'TKO', 'tk', '(taken)', 'atk', 'a tk note', 'network', '(tko)', 'ATK']) {
    assert.deepEqual(findTkRanges(s), [], `"${s}" must not match`);
    assert.equal(textHasTk(s), false);
  }
});

ok('a bare TK inside a matched parenthetical is swallowed by the swoop (no double-paint)', () => {
  const r = findTkRanges('(TK stat, ask TK later) fine');
  assert.deepEqual(r.map((x) => x.kind), ['paren'], 'ONE paren range, no inner bare hit');
  assert.equal(textHasTk('(TK stat, ask TK later)'), true);
});

// ── 2. DECORATIONS (schema-built docs) ───────────────────────────────────────
ok('bare TK in a row paints exactly the two letters, kind bare', () => {
  const d = docFrom({ type: 'doc', content: [row([bin('b1', txt('call TK tomorrow'))])] });
  const p = paints(d);
  assert.equal(p.length, 1);
  assert.equal(p[0].text, 'TK');
  assert.equal(p[0].kind, 'bare');
});

ok('parenthetical paints the WHOLE (TK …), kind paren; two parens = two paints', () => {
  const d = docFrom({ type: 'doc', content: [row([bin('b1', txt('we need (TK stat) and (TK date) locked'))])] });
  const p = paints(d);
  assert.deepEqual(p.map((x) => x.text), ['(TK stat)', '(TK date)']);
  assert.deepEqual(p.map((x) => x.kind), ['paren', 'paren']);
});

ok('TK name TK = two paints in one block', () => {
  const d = docFrom({ type: 'doc', content: [row([bin('b1', txt('TK name TK'))])] });
  assert.deepEqual(paints(d).map((x) => ({ text: x.text, kind: x.kind })),
    [{ text: 'TK', kind: 'bare' }, { text: 'TK', kind: 'bare' }]);
});

ok('a parenthetical SPANNING a bold-split text-node boundary paints as ONE range', () => {
  const d = docFrom({
    type: 'doc',
    content: [row([bin('b1',
      txt('we need (TK '),
      txt("musician's", [{ type: 'bold' }]),
      txt(' name) today'))])],
  });
  const p = paints(d);
  assert.equal(p.length, 1, 'marks split text nodes — the per-TEXTBLOCK scan must not care');
  assert.equal(p[0].text, "(TK musician's name)");
  assert.equal(p[0].kind, 'paren');
});

ok('negatives in a doc paint NOTHING', () => {
  const d = docFrom({ type: 'doc', content: [row([bin('b1', txt('ATKINS beat the TKO with a tk and an atk (taken)'))])] });
  assert.deepEqual(paints(d), []);
});

ok('text inside an existing tkSpan run gets NO loose paint (its own look; no stacking)', () => {
  const d = docFrom({
    type: 'doc',
    content: [row([bin('b1', txt('before '), tkSpanTxt('{tk ask TK about the anthem}'), txt(' after'))])],
  });
  assert.deepEqual(paints(d), [], 'the bare TK inside the {tk} chip is the chip\'s business');
  // …but plain TKs OUTSIDE the span in the same block still paint.
  const d2 = docFrom({
    type: 'doc',
    content: [row([bin('b2', txt('TK first, then '), tkSpanTxt('{tk ask TK}'), txt(' and (TK last)'))])],
  });
  assert.deepEqual(paints(d2).map((x) => x.text), ['TK', '(TK last)']);
});

ok('positional text pads non-text inline leaves so offsets stay doc-true', () => {
  // A footnote atom (inline leaf, nodeSize 1) sits mid-block; the paint after it must
  // still land on the right characters.
  const d = docFrom({
    type: 'doc',
    content: [row([bin('b1',
      txt('note'),
      { type: 'fcFootnote', attrs: { noteId: 'n1' } },
      txt(' then (TK stat)'))])],
  });
  const blockPara = d.child(0).child(0).child(0).child(0);
  assert.ok(textblockPositionalText(blockPara).includes(INLINE_LEAF_CHAR), 'atom padded into the scan string');
  const p = paints(d);
  assert.equal(p.length, 1);
  assert.equal(p[0].text, '(TK stat)', 'offsets survive the atom');
});

// ── 3. MEMBERSHIP — the TK workspace drawer ──────────────────────────────────
ok('membership: bare/paren pattern rows and tkSpan-only rows are members; neither is not', () => {
  const bareRow = docFrom(row([bin('m1', txt('call TK tomorrow'))])).child(0);
  const parenRow = docFrom(row([vo('m2', 'we need (TK stat) here')])).child(0);
  const spanRow = docFrom(row([bin('m3', tkSpanTxt('{tk find the drummer}'))])).child(0);
  const plainRow = docFrom(row([bin('m4', txt('nothing to see, network attack, tko'))])).child(0);
  assert.equal(rowIsMember(bareRow, 'tk'), true, 'bare TK in a said cell → member');
  assert.equal(rowIsMember(parenRow, 'tk'), true, '(TK …) in a vo block → member');
  assert.equal(rowIsMember(spanRow, 'tk'), true, 'tkSpan only → member (excluded from paint, included in the drawer)');
  assert.equal(rowIsMember(plainRow, 'tk'), false, 'neither surface → not a member');
});

ok('the TK role flows through scanWorkspace like any craft (sections gather the loose ends)', () => {
  const d = docFrom({
    type: 'doc',
    content: [
      row([vo('s1', 'clean narration')]),
      row([bin('s2', txt('ask TK about the border'))]),        // member
      row([bin('s3', tkSpanTxt('{tk anthem history}'))]),      // member (contiguous)
      row([vo('s4', 'more clean narration')]),
      row([vo('s5', 'we still need (TK date) confirmed')]),    // member
    ],
  });
  const sections = scanWorkspace(d, 'tk');
  assert.deepEqual(
    sections.map(({ startIndex, endIndex, rowCount }) => ({ startIndex, endIndex, rowCount })),
    [{ startIndex: 2, endIndex: 3, rowCount: 2 }, { startIndex: 5, endIndex: 5, rowCount: 1 }],
  );
});

// ── 4. SINGLE SOURCE OF TRUTH — paint ⇄ drawer can never drift ───────────────
ok('the workspace predicate IS tk-pattern.js textblockHasTk (function identity)', () => {
  const role = workspaceRole('tk');
  assert.ok(role, 'the tk role exists in WORKSPACE_ROLES');
  assert.equal(role.label, 'TK');
  assert.equal(role.surfaces.textScan, textblockHasTk,
    'workspaces.js must use the EXACT shared probe — not a restated regex');
  assert.deepEqual(role.surfaces.markTypes, ['tkSpan'], 'the {tk} bracket surface aggregates too');
});

ok('both consumers import the ONE shared pattern module (source pin)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const detectSrc = readFileSync(join(HERE, 'tk-detect.js'), 'utf8');
  const wsSrc = readFileSync(join(HERE, '../workspaces.js'), 'utf8');
  assert.ok(detectSrc.includes("from '../tk-pattern.js'"), 'tk-detect.js imports the shared pattern module');
  assert.ok(wsSrc.includes("from './tk-pattern.js'"), 'workspaces.js imports the shared pattern module');
  // A restated pattern would appear as the ESCAPED regex forms — neither consumer may
  // carry them (the sources live in tk-pattern.js alone).
  for (const [name, src] of [['tk-detect.js', detectSrc], ['workspaces.js', wsSrc]]) {
    assert.ok(!src.includes(String.raw`\bTK\b`) && !src.includes(String.raw`\(TK`),
      `${name} must not restate the TK regex — tk-pattern.js is the single source of truth`);
  }
});

// ── 5. PLUGIN FLOW + MEMOIZATION ─────────────────────────────────────────────
ok('builder memoizes by doc ref: same doc → same DecorationSet object', () => {
  const d = docFrom({ type: 'doc', content: [row([bin('b1', txt('call TK now'))])] });
  assert.equal(buildTkDecorations(d), buildTkDecorations(d));
});

ok('plugin: init populates; selection-only keeps the SAME set; docChanged rebuilds', () => {
  const doc = docFrom({
    type: 'doc',
    content: [row([bin('b1', txt('call TK now'))]), row([vo('b2', 'clean line')]), { type: 'paragraph' }],
  });
  let state = EditorState.create({ schema, doc, plugins: [createTkDetectPlugin()] });
  const initial = tkDetectKey.getState(state);
  assert.equal(initial.find().length, 1, 'init paints the bare TK');

  // Selection-only transaction — the exact same DecorationSet object survives.
  state = state.apply(state.tr.setSelection(TextSelection.atStart(state.doc)));
  assert.equal(tkDetectKey.getState(state), initial, 'selection-only keeps the same set object');

  // Doc change: type a new (TK …) into the trailing paragraph → rebuild picks it up.
  const parPos = state.doc.content.size - 1; // inside the trailing empty paragraph
  state = state.apply(state.tr.insertText('now (TK date) too', parPos));
  const rebuilt = tkDetectKey.getState(state);
  assert.notEqual(rebuilt, initial, 'docChanged rebuilds');
  const texts = rebuilt.find().map((d) => state.doc.textBetween(d.from, d.to)).sort();
  assert.deepEqual(texts, ['(TK date)', 'TK']);
});

console.log(`tk-detect.test.mjs: ${pass} assertions passed`);
