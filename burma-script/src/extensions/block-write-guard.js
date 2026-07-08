// Read-mode write guard for BLOCK-HEAD controls (the ✓ done tick + the REC/VO status pill).
//
// Both controls dispatch a `setAttr` transaction on activation — a real doc write. Like the
// bubble-menu marks and the direction-chip (extensions/direction-chip.js), those transactions
// fire PAST the editor's `editable:false` flag: ProseMirror commands dispatch regardless of
// `editable`, so the flag alone does not stop them (see Editor.jsx "commands dispatch past
// editable:false"). Every sibling write control closes this in CODE with an explicit
// `isReadOnly() || !editor.view.editable` early-return; the done tick and REC pill were the two
// that DIDN'T — they leaned on doctrine.css hiding `.wp-rec`/`.wp-done` with `display:none`
// (which happens to drop them from the tab order too). That CSS is reversible chrome — the
// moment REC/DONE are un-hidden (a future episode, a style-hub toggle), the keyboard write path
// reopens silently. This predicate makes the guard match the sibling contract in code, so the
// write is refused in a `?read` share (readOnly) AND in the in-session READ latch (editable
// false), and can only fire when editing is truly armed.
//
// Pure(readOnly, editable) so the headless suite can mutation-lock the truth table. Fail-CLOSED
// on an unknown/undefined `editable` — mirrors direction-chip's `!editor.view.editable` guard.
export function blockHeadControlWritable({ readOnly, editable } = {}) {
  return !readOnly && !!editable;
}
