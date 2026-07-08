// Burma Script Tool — READ / EDIT MODE (the sticky in-session switch).
//
// Johnny: "there should be a sticky button that allows one to toggle between edit mode and
// read mode, and it starts in read mode." This is DIFFERENT from read-mode.js (`?read` share
// links): that one makes a recipient's browser STRUCTURALLY incapable of writing. This one is
// an in-session courtesy latch for people with full edit rights — every load opens READ so a
// scroll-through can never accidentally type into the script; one click on the sticky switch
// arms editing.
//
// SINGLE SOURCE OF TRUTH for "is this session currently in edit mode?". Deliberately NOT
// persisted: the whole point is that every fresh load starts calm/read. State changes fan out
// through the `wp-edit-mode` window event so the editor surface (editable flag), the chrome
// (row spines, insert affordances) and the sticky switch itself all flip together.

let _editMode = false; // every session starts in READ mode — deliberate.

export function isEditMode() {
  return _editMode;
}

// Flip the mode and broadcast. Returns the (new) mode. A no-op set does not re-broadcast so
// listeners never see duplicate events for the same state.
export function setEditMode(v) {
  const next = !!v;
  if (next === _editMode) return _editMode;
  _editMode = next;
  try {
    window.dispatchEvent(new CustomEvent('wp-edit-mode', { detail: { edit: _editMode } }));
  } catch {}
  return _editMode;
}

// TEST SEAM ONLY — set the mode without broadcasting, so headless suites can pin a state
// deterministically. Never called by app code.
export function __setEditModeForTest(v) {
  _editMode = !!v;
  return _editMode;
}
