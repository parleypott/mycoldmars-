// Burma Script Tool — STYLE-PRESERVING list toggles (Johnny 2026-07-21:
// "on b-roll and all other formats when I hit cmd+shift+8 to make a bullet point I need the
//  styling to stay. right now it goes back to plain style").
//
// ROOT CAUSE: a directionMark run reaching the end of a line arms the NEXT line via the caret's
// storedMarks (inclusive:true → the empty line shows the placeholder chip and typed text inherits
// the role style). toggleBulletList / toggleOrderedList wrap that line in a list, and ProseMirror
// clears storedMarks to null on ANY transaction that adds steps — so the caret lands in the new
// bullet with no armed mark and the next characters type PLAIN. (Existing marked TEXT survives the
// wrap fine — paragraph allows all marks — so this only bites the armed empty-caret case, which is
// exactly the screenshot: an empty bullet with a plain caret.)
//
// FIX: capture the caret's active marks BEFORE the toggle, then re-assert them with setStoredMarks
// on the SAME transaction AFTER the wrap/lift steps. One transaction, one undo. Shared by BOTH the
// Cmd/Ctrl+Shift+8/7 keymap (list-shortcuts.js) and the /bullet · //number slash items
// (slash-menu.js) so the behavior can't drift between the two entry points.
//
// COLLAB LOOP LAW: user-initiated only (keymap / slash click) — no auto-dispatching plugin.
import { isReadOnly } from '../read-mode.js';

// The marks that should ride through a list wrap/lift so the caret keeps its role styling.
//  • storedMarks — the load-bearing case. A slash-armed empty line (and an inclusive line-break)
//    carries its role style ONLY here; steps drop it to null, so we must restore it.
//  • marks-at-caret — a collapsed caret sitting inside already-styled text; re-asserting matches
//    what inclusive:true would have continued anyway.
//  • ranged selection — the text keeps its own marks through wrapInList natively, so capture nothing
//    (null) and leave plain/unmarked toggling byte-identical.
export function activeStyleMarks(state) {
  const stored = state.storedMarks;
  if (stored && stored.length) return stored;
  const sel = state.selection;
  if (sel.empty) {
    const marks = sel.$from.marks();
    if (marks && marks.length) return marks;
  }
  return null;
}

// Toggle a bullet/ordered list while preserving the caret's active role styling.
// `range` (optional) is the slash-trigger range to delete first (/bullet, //number). Returns the
// chain's boolean so callers can gate a follow-up focus exactly as before.
export function toggleListPreservingStyle(editor, kind, range) {
  if (isReadOnly()) return false;
  const view = editor.view;
  if (!view || !view.editable) return false; // editable is the real write gate, not just isReadOnly
  const marks = activeStyleMarks(editor.state); // capture BEFORE any step clears storedMarks
  let chain = editor.chain().focus();
  if (range) chain = chain.deleteRange(range);
  chain = kind === 'ordered' ? chain.toggleOrderedList() : chain.toggleBulletList();
  return chain
    .command(({ tr }) => {
      // Re-assert on the SAME accumulated transaction, AFTER the wrap/lift steps cleared it.
      // Only when there were marks to keep, so plain toggling never pins an empty stored-mark set.
      if (marks && marks.length) tr.setStoredMarks(marks);
      return true;
    })
    .run();
}
