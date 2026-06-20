/**
 * CH-02 — Workshop {tk}/{fc} pick STALE-RANGE GUARD.
 *
 * THE BUG (real, narrow, silent data loss): openWorkshop captures the {tk …}/{fc …} marker's
 * {from,to} at click time and stashes it. The Workshop dock then stays open over a FULLY-EDITABLE
 * editor (nothing locks it). If Johnny edits ABOVE the marker before picking a card, every position
 * after that edit shifts, so the cached range no longer covers the marker. The old wp-replace-span
 * handler only CLAMPED a/b to doc size — it never re-validated the marker still lived there — and
 * insertContentAt happily replaced whatever text now sat at those stale coordinates: the chosen
 * prose landed in the wrong place and good script got deleted, with no toast, no banner.
 *
 * THE FIX (findMarkRange, pure + exported from Editor.jsx): before inserting, re-resolve the span
 * mark's CURRENT contiguous range near the cached window. If the mark moved, we get its true bounds
 * back; if it's gone, the caller falls back to a marker-text equality check, and aborts + toasts if
 * neither holds.
 *
 * This proves findMarkRange against a REAL ProseMirror doc built from the live Burma schema — the
 * same schema the editor enforces — with the EXACT shift scenario: insert text above the marker,
 * then confirm the function re-finds the marker at its NEW position (not the stale one).
 *
 * Run: bun src/extensions/../ch02-stale-range.test.mjs (auto-discovered by run-tests.mjs)
 */
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { findMarkRange } from './Editor.jsx';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };
const eq = (got, want, label) => ok(JSON.stringify(got) === JSON.stringify(want), `${label} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);

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
]);

const tkType = schema.marks.tkSpan;
ok(!!tkType, 'tkSpan mark registered in schema');

// Build a doc: one oncamBlock with a paragraph "before {tk write a line} after".
// The {tk …} substring carries the tkSpan mark.
function buildDoc(prefix) {
  const before = prefix + 'before ';
  const marker = '{tk write a line}';
  const after = ' after';
  const para = schema.nodes.paragraph.create(null, [
    schema.text(before),
    schema.text(marker, [tkType.create()]),
    schema.text(after),
  ]);
  const block = schema.nodes.oncamBlock.create({ blockId: 'b1' }, para);
  const cell = schema.nodes.tableCell.create({ role: 'full' }, block);
  const row = schema.nodes.tableRow.create({ cols: 1 }, cell);
  const doc = schema.topNodeType.create(null, row);
  return { doc, before, marker, after };
}

// 1) Baseline: findMarkRange locates the tkSpan at its real coordinates.
{
  const { doc, before, marker } = buildDoc('');
  let state = EditorState.create({ schema, doc });
  // The marker's text starts after the paragraph-open (1) + cell-open (1) + block-open (1) + ... .
  // Rather than hardcode, scan for the marked text node position.
  let markFrom = -1, markTo = -1;
  state.doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((m) => m.type === tkType)) {
      if (markFrom < 0) markFrom = pos;
      markTo = pos + node.nodeSize;
    }
  });
  ok(markFrom > 0, 'baseline: found marked text node');
  const range = findMarkRange(state, tkType, markFrom, markTo);
  ok(range != null, 'baseline: findMarkRange returns a range');
  eq(state.doc.textBetween(range.from, range.to, ''), marker, 'baseline: range covers exactly the marker');
}

// 2) THE BUG SCENARIO: capture the marker range, then INSERT text ABOVE the marker (shifting it),
//    then prove findMarkRange re-finds the marker at its NEW position when probed with the STALE
//    (pre-edit) coordinates — i.e. the guard recovers the true range instead of corrupting text.
{
  const { doc, marker } = buildDoc('');
  let state = EditorState.create({ schema, doc });
  let staleFrom = -1, staleTo = -1;
  state.doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((m) => m.type === tkType)) {
      if (staleFrom < 0) staleFrom = pos;
      staleTo = pos + node.nodeSize;
    }
  });
  // Insert "XYZ " at the very start of the paragraph text (a position ABOVE the marker).
  // Find the first text position (start of "before ").
  let firstTextPos = -1;
  state.doc.descendants((node, pos) => {
    if (firstTextPos < 0 && node.isText) firstTextPos = pos;
  });
  const inserted = 'INSERTED ABOVE ';
  state = state.apply(state.tr.insertText(inserted, firstTextPos, firstTextPos));
  // The marker has now shifted RIGHT by inserted.length. The cached [staleFrom, staleTo] no longer
  // covers the marker — textBetween at the stale range is now wrong.
  const staleText = state.doc.textBetween(
    Math.min(staleFrom, state.doc.content.size),
    Math.min(staleTo, state.doc.content.size), '');
  ok(staleText !== marker, 'shift: stale range no longer reads as the marker (the corruption the old code would write into)');

  // findMarkRange probed with the STALE coordinates must re-find the marker at its true new bounds.
  const range = findMarkRange(state, tkType, staleFrom, staleTo);
  ok(range != null, 'shift: findMarkRange recovers a range from stale coords');
  eq(state.doc.textBetween(range.from, range.to, ''), marker, 'shift: recovered range covers exactly the (moved) marker');
}

// 3) MARKER GONE: if the span was removed entirely, findMarkRange returns null (caller then falls
//    back to marker-text equality, and aborts+toasts if that also fails).
{
  const { doc } = buildDoc('');
  let state = EditorState.create({ schema, doc });
  let from = -1, to = -1;
  state.doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((m) => m.type === tkType)) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
  });
  // Strip the tkSpan mark over its range.
  state = state.apply(state.tr.removeMark(from, to, tkType));
  const range = findMarkRange(state, tkType, from, to);
  ok(range == null, 'gone: findMarkRange returns null when the mark is removed');
}

console.log(`ch02-stale-range: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
