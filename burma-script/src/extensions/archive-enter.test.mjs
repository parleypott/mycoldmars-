/*
 * archive-enter.test.mjs — the archive checklist's Enter behavior
 * (direction-chip.js doArchiveChecklistEnter).
 *
 * Johnny 2026-07-08: "/archive + Enter always makes a paragraph break which I don't want."
 * An archive that leads its own line is a CHECKLIST item, so Enter should continue the list,
 * and Enter on the freshly-continued EMPTY line should exit to a plain paragraph — one Enter
 * out, no stray blank paragraph, no orphan red chip.
 *
 * Proves:
 *   1. CONTINUE — Enter on a NON-empty archive line splits and arms the new empty line as a
 *      fresh archive item (storedMarks carries the archive directionMark); handler returns true.
 *   2. EXIT — Enter on that freshly-continued EMPTY archive line clears the stored archive mark
 *      (dropping the placeholder red chip → plain paragraph) and returns true, WITHOUT adding a
 *      paragraph. This is the load-bearing regression: the prior code keyed EXIT off the empty
 *      line's first child being archive-marked *text*, which an empty line never has, so EXIT was
 *      unreachable and the second Enter fell through to a default paragraph break.
 *   3. An EMPTY line NOT armed as archive (no archive stored mark) → returns false (default Enter
 *      handles plain empty paragraphs).
 *   4. A NON-empty, NON-archive line → returns false (plain prose / VO writing untouched).
 *   5. A non-collapsed selection → returns false.
 *   6. Dry probe (no dispatch) returns the same verdict without mutating state.
 *
 * Run: bun src/extensions/archive-enter.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark, doArchiveChecklistEnter } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const markType = schema.marks.directionMark;
const archiveOf = (marks) => (marks || []).find((m) => m.type === markType && m.attrs.kind === 'archive');
const countParas = (doc) => { let n = 0; doc.descendants((x) => { if (x.type.name === 'paragraph') n++; }); return n; };

// A single-cell table row holding one paragraph. `text` null → an empty paragraph;
// `archive` true → the text is wrapped in an archive directionMark.
const rowDoc = (text, archive) => ({
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'paragraph',
        content: text == null ? [] : [{
          type: 'text',
          text,
          marks: archive ? [{ type: 'directionMark', attrs: { kind: 'archive', status: 'needed' } }] : [],
        }],
      }],
    }],
  }],
});

// caret at the END of the first paragraph's content
const stateAtParaEnd = (docJson) => {
  const doc = PMNode.fromJSON(schema, docJson);
  let pos = null;
  doc.descendants((n, p) => { if (n.type.name === 'paragraph' && pos == null) pos = p + 1 + n.content.size; });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });
};

// ── 1 + 2: CONTINUE then EXIT, the real end-to-end ─────────────────────────────────────────────
ok('CONTINUE arms a fresh archive line; the next Enter on that empty line EXITS (no new para, chip gone)', () => {
  let state = stateAtParaEnd(rowDoc('check the archive footage', true));
  const dispatch = (tr) => { state = state.apply(tr); };

  // Enter #1 — non-empty archive line → CONTINUE.
  assert.equal(doArchiveChecklistEnter(state, markType, dispatch), true, 'continue handled');
  assert.equal(countParas(state.doc), 2, 'a fresh checklist line was split in');
  assert.equal(state.selection.$from.parent.content.size, 0, 'caret sits in the new EMPTY line');
  assert.ok(archiveOf(state.storedMarks), 'the new empty line is armed archive (storedMarks) → red chip shows');

  // Enter #2 — the freshly-continued EMPTY archive line → EXIT.
  const pasBefore = countParas(state.doc);
  assert.equal(doArchiveChecklistEnter(state, markType, dispatch), true, 'exit handled (NOT a fall-through)');
  assert.equal(countParas(state.doc), pasBefore, 'EXIT adds NO paragraph — no stray blank line');
  assert.equal(archiveOf(state.storedMarks), undefined, 'stored archive mark cleared → orphan red chip gone');
});

// ── 3: an empty line that was never armed as archive → not ours ────────────────────────────────
ok('empty line with no archive stored mark → false (default Enter owns plain empty paragraphs)', () => {
  const state = stateAtParaEnd(rowDoc(null, false)); // empty paragraph, no stored marks
  assert.equal(doArchiveChecklistEnter(state, markType, null), false);
});

// ── 4: a non-empty, non-archive line → untouched ───────────────────────────────────────────────
ok('non-archive prose line → false (plain split / VO writing untouched)', () => {
  const state = stateAtParaEnd(rowDoc('just some narration', false));
  assert.equal(doArchiveChecklistEnter(state, markType, null), false);
});

// ── 5: a ranged (non-collapsed) selection is never a checklist Enter ────────────────────────────
ok('non-collapsed selection → false', () => {
  const doc = PMNode.fromJSON(schema, rowDoc('check the archive footage', true));
  let a = null, b = null;
  doc.descendants((n, p) => { if (n.type.name === 'paragraph') { a = p + 1; b = p + 1 + n.content.size; } });
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, a, b) });
  assert.equal(doArchiveChecklistEnter(state, markType, null), false);
});

// ── 6: dry probe never mutates ─────────────────────────────────────────────────────────────────
ok('dry probe (no dispatch) returns true on a continue-able line without mutating', () => {
  const state = stateAtParaEnd(rowDoc('check the archive footage', true));
  const before = JSON.stringify(state.doc.toJSON());
  assert.equal(doArchiveChecklistEnter(state, markType, null), true, 'probe reports it would handle');
  assert.equal(JSON.stringify(state.doc.toJSON()), before, 'no dispatch → doc unchanged');
});

// ── guard: a null markType is a no-op, never a throw ───────────────────────────────────────────
ok('null markType → false, no throw', () => {
  const state = stateAtParaEnd(rowDoc('check the archive footage', true));
  assert.equal(doArchiveChecklistEnter(state, null, null), false);
});

console.log(`archive-enter: ${pass} passed, 0 failed`);
