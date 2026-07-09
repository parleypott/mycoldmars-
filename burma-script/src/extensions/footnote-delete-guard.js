// FOOTNOTES RESIST DELETE (Johnny 2026-07-09).
//
// A fact-check footnote is an inline atom. Before this, a cursor sitting right after one +
// a single Backspace let the browser's native contentEditable delete nuke the whole receipt
// (note + sources + lineage) in ONE keystroke — far too easy to lose by accident. Johnny:
// "they should resist delete … I should have to click them and hit delete. they should be
// like any other character."
//
// So the FIRST Backspace/Delete adjacent to a footnote no longer removes it — it SELECTS the
// atom (a visible NodeSelection). Only a SECOND delete (now the selection is non-empty) runs
// the normal deleteSelection and removes it. Two deliberate steps instead of one stray one.
//
// COLLAB-SAFE & READ-SAFE: the resist step is a pure selection change (no doc write, nothing
// to echo-loop under Yjs); the destructive step rides the default deleteSelection command. In
// read mode (editor.isEditable === false) we bow out entirely so the default no-op stands.
// Priority 1001 so this beats StarterKit's Backspace/Delete keymap (same trick ListShortcuts
// uses) and intercepts the keydown before the native deletion can fire.

import { Extension } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

// Pure, testable: the doc position of a fcFootnote atom sitting immediately on the given side of
// an EMPTY cursor ('back' = just before it, 'fwd' = just after it), else null. Returns the atom's
// start position so a NodeSelection can wrap it.
export function footnoteAtCursor(state, side) {
  const { selection } = state;
  if (!selection.empty) return null;              // a real selection deletes normally
  const { $from, from } = selection;
  const node = side === 'back' ? $from.nodeBefore : $from.nodeAfter;
  if (!node || node.type.name !== 'fcFootnote') return null;
  return side === 'back' ? from - node.nodeSize : from;
}

function resist(editor, side) {
  if (!editor.isEditable) return false;
  const { state } = editor;
  const pos = footnoteAtCursor(state, side);
  if (pos == null) return false;
  editor.view.dispatch(
    state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView(),
  );
  return true;                                    // consume this press — the footnote resisted it
}

export const FootnoteDeleteGuard = Extension.create({
  name: 'footnoteDeleteGuard',
  priority: 1001,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => resist(editor, 'back'),
      Delete: ({ editor }) => resist(editor, 'fwd'),
    };
  },
});
