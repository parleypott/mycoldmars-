// Burma Script Tool — Y-SYNC ECHO DETECTION (collab chunk). One question, answered in one place:
// "did THIS transaction originate from a remote teammate's edit arriving through the Yjs binding?"
//
// WHY IT MATTERS (enterprise-audit PERF finding): Editor.jsx's onUpdate treats every docChanged
// transaction as a local keystroke — dirty event, 300ms debounce, full-doc stringify into
// localStorage. Under active collab a teammate's typing arrives as y-sync transactions, so THEIR
// keystrokes drive YOUR tab's save cycle all session. Remote echoes change nothing this tab needs
// to persist (their tab saves their edits; the room is canonical), so onUpdate skips the save
// cycle for them.
//
// THE DISCRIMINATION (same ground truth as undo-viewport-guard.js): remote teammate updates carry
// ySync meta with isChangeOrigin and WITHOUT isUndoRedoOperation. Local undo/redo carries BOTH —
// and must keep saving (it changes the doc this user owns). Local typing carries neither.
//
// BUNDLE LAW: this module imports @tiptap/y-tiptap (ySyncPluginKey), so it may only be imported
// from the collab chunk (collab-runtime.js). Editor.jsx reaches it through the session object's
// isRemoteEcho() — never by importing this file.

import { ySyncPluginKey } from '@tiptap/y-tiptap';

export function isRemoteEchoTransaction(tr) {
  if (!tr) return false;
  try {
    const meta = tr.getMeta(ySyncPluginKey);
    return !!(meta && meta.isChangeOrigin && !meta.isUndoRedoOperation);
  } catch {
    return false;
  }
}
