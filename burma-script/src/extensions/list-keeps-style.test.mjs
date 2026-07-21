/*
 * list-keeps-style.test.mjs — list toggles PRESERVE the caret's role styling
 * (list-style-preserve.js: activeStyleMarks + toggleListPreservingStyle).
 *
 * Johnny 2026-07-21: "on b-roll and all other formats when I hit cmd+shift+8 to make a bullet
 * point I need the styling to stay. right now it goes back to plain style."
 *
 * ROOT CAUSE (proved below): a directionMark run reaching the end of a line arms the next line via
 * the caret's storedMarks (inclusive:true → placeholder chip + inherited style). toggleBulletList /
 * toggleOrderedList wrap that line in a list, and ProseMirror clears storedMarks to null on ANY
 * transaction that adds steps — so the armed empty bullet types PLAIN. Existing marked TEXT survives
 * the wrap (paragraph allows all marks), so ONLY the armed empty-caret case bites (the screenshot).
 *
 * Proves:
 *   1. FAILING-FIRST regression: a vanilla wrapInList on an armed empty caret DROPS storedMarks to
 *      null (the bug). The fix's capture→wrap→setStoredMarks on ONE transaction keeps them.
 *   2. Typed text after the fixed bullet toggle carries the directionMark (end-to-end: the view
 *      types with state.storedMarks).
 *   3. Ordered list (//number) behaves identically.
 *   4. Toggling BACK OUT of a list (lift) on an armed empty caret keeps the marks too.
 *   5. Existing marked TEXT survives the wrap with no schema change (shape 1 is not the bug).
 *   6. activeStyleMarks capture rule: storedMarks > marks-at-collapsed-caret > null for a ranged or
 *      plain selection (so plain/unmarked toggling stays byte-identical — no stored-mark pinning).
 *
 * Run: bun src/extensions/list-keeps-style.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { wrapInList, liftListItem } from '@tiptap/pm/schema-list';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { activeStyleMarks } from './list-style-preserve.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

// Schema built exactly like Editor.jsx (lists ON, our nodes + marks + the DirectionMark).
const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, strike: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const mt = schema.marks.directionMark;
const brollMark = () => mt.create({ kind: 'broll', status: 'unchecked' });
const hasBroll = (marks) => (marks || []).some((m) => m.type === mt && m.attrs.kind === 'broll');

// A single-cell table row holding one paragraph. text null → empty paragraph.
const rowDoc = (text, marked) => ({
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'paragraph',
        content: text == null ? [] : [{
          type: 'text', text,
          marks: marked ? [{ type: 'directionMark', attrs: { kind: 'broll', status: 'unchecked' } }] : [],
        }],
      }],
    }],
  }],
});

// caret at the END of the first paragraph's content
const caretAtParaEnd = (docJson) => {
  const doc = PMNode.fromJSON(schema, docJson);
  let pos = null;
  doc.descendants((n, p) => { if (n.type.name === 'paragraph' && pos == null) pos = p + 1 + n.content.size; });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });
};

// Emulate toggleListPreservingStyle's TRANSACTION at the state level (no DOM for a real Editor):
// capture active marks BEFORE, run the wrap/lift command capturing its tr, re-assert storedMarks on
// that SAME tr, apply. `command` is a raw PM command (wrapInList/liftListItem-derived).
function toggleWithFix(state, command) {
  const marks = activeStyleMarks(state);
  let captured = null;
  command(state, (tr) => { captured = tr; });
  assert.ok(captured, 'the list command produced a transaction');
  if (marks && marks.length) captured.setStoredMarks(marks);
  return state.apply(captured);
}

// what the VIEW would type next: text takes state.storedMarks (falling back to marks at the caret).
function typeChar(state, ch) {
  const marks = state.storedMarks || state.selection.$from.marks();
  const tr = state.tr.replaceSelectionWith(schema.text(ch, marks), false);
  return state.apply(tr);
}
const lastTextMarks = (doc) => { let m = null; doc.descendants((n) => { if (n.isText) m = n.marks; }); return m; };

// ── 1: FAILING-FIRST — vanilla wrap drops storedMarks; the fix keeps them ───────────────────────
ok('vanilla wrapInList DROPS the armed storedMarks (the bug); the fix preserves them', () => {
  const armed = caretAtParaEnd(rowDoc(null, false));
  const state = armed.apply(armed.tr.setStoredMarks([brollMark()]));
  assert.ok(hasBroll(state.storedMarks), 'precondition: caret is armed b-roll');

  // BUG shape: no restore → storedMarks null after the wrap.
  let vanilla = null;
  wrapInList(schema.nodes.bulletList)(state, (tr) => { vanilla = tr; });
  assert.equal(state.apply(vanilla).storedMarks, null, 'vanilla toggle clears storedMarks → types plain');

  // FIX: capture + re-assert on the same tr.
  const fixed = toggleWithFix(state, wrapInList(schema.nodes.bulletList));
  assert.ok(hasBroll(fixed.storedMarks), 'fixed toggle keeps the armed b-roll mark');
  let wrapped = false; fixed.doc.descendants((n) => { if (n.type.name === 'listItem') wrapped = true; });
  assert.ok(wrapped, 'the line really did wrap into a bullet list');
});

// ── 2: end-to-end — text typed after the fixed bullet toggle carries the mark ───────────────────
ok('typing after a style-preserving BULLET toggle carries the b-roll mark', () => {
  const armed = caretAtParaEnd(rowDoc(null, false));
  const state = armed.apply(armed.tr.setStoredMarks([brollMark()]));
  const fixed = toggleWithFix(state, wrapInList(schema.nodes.bulletList));
  const typed = typeChar(fixed, 'x');
  assert.ok(hasBroll(lastTextMarks(typed.doc)), 'the typed character is b-roll styled, not plain');
});

// ── 3: ordered list (//number) behaves identically ─────────────────────────────────────────────
ok('typing after a style-preserving ORDERED toggle carries the b-roll mark', () => {
  const armed = caretAtParaEnd(rowDoc(null, false));
  const state = armed.apply(armed.tr.setStoredMarks([brollMark()]));
  const fixed = toggleWithFix(state, wrapInList(schema.nodes.orderedList));
  assert.ok(hasBroll(fixed.storedMarks), 'ordered toggle keeps the armed mark');
  assert.ok(hasBroll(lastTextMarks(typeChar(fixed, '1').doc)), 'typed char is b-roll styled');
});

// ── 4: toggling BACK OUT of a list (lift) keeps the armed marks too ─────────────────────────────
ok('lifting an armed empty caret OUT of a bullet keeps the marks', () => {
  // Start already inside a bullet: wrap an empty para, then arm the caret.
  const base = caretAtParaEnd(rowDoc(null, false));
  let inList = null;
  wrapInList(schema.nodes.bulletList)(base, (tr) => { inList = tr; });
  let state = base.apply(inList);
  state = state.apply(state.tr.setStoredMarks([brollMark()]));
  assert.ok(hasBroll(state.storedMarks), 'precondition: armed caret inside a bullet');

  const lifted = toggleWithFix(state, liftListItem(schema.nodes.listItem));
  let stillList = false; lifted.doc.descendants((n) => { if (n.type.name === 'listItem') stillList = true; });
  assert.equal(stillList, false, 'the item lifted back out to a plain paragraph');
  assert.ok(hasBroll(lifted.storedMarks), 'the mark survived the lift → still styled');
});

// ── 5: existing marked TEXT survives the wrap (shape 1 is NOT the bug; no schema change) ─────────
ok('toggling a bullet on existing b-roll TEXT keeps the text marks', () => {
  const state = caretAtParaEnd(rowDoc('roll the drone shot', true));
  const fixed = toggleWithFix(state, wrapInList(schema.nodes.bulletList));
  assert.ok(hasBroll(lastTextMarks(fixed.doc)), 'the marked text is still b-roll after wrapping');
});

// ── 6: activeStyleMarks capture rule ────────────────────────────────────────────────────────────
ok('activeStyleMarks: storedMarks win', () => {
  const armed = caretAtParaEnd(rowDoc(null, false));
  const state = armed.apply(armed.tr.setStoredMarks([brollMark()]));
  assert.ok(hasBroll(activeStyleMarks(state)), 'armed storedMarks are captured');
});
ok('activeStyleMarks: collapsed caret inside marked text falls back to marks-at-caret', () => {
  // caret in the MIDDLE of marked text (no storedMarks) → marks() has broll.
  const doc = PMNode.fromJSON(schema, rowDoc('drone', true));
  let mid = null;
  doc.descendants((n, p) => { if (n.type.name === 'paragraph') mid = p + 1 + 2; });
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, mid) });
  assert.ok(hasBroll(activeStyleMarks(state)), 'marks-at-caret captured when no storedMarks');
});
ok('activeStyleMarks: ranged selection captures nothing (text keeps its own marks natively)', () => {
  const doc = PMNode.fromJSON(schema, rowDoc('drone', true));
  let a = null, b = null;
  doc.descendants((n, p) => { if (n.type.name === 'paragraph') { a = p + 1; b = p + 1 + n.content.size; } });
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, a, b) });
  assert.equal(activeStyleMarks(state), null, 'ranged selection → null (no stored-mark pinning)');
});
ok('activeStyleMarks: plain unmarked caret captures nothing → toggling stays byte-identical', () => {
  const state = caretAtParaEnd(rowDoc('plain narration', false));
  assert.equal(activeStyleMarks(state), null, 'unmarked caret → null');
});

console.log(`list-keeps-style: ${pass} passed, 0 failed`);
