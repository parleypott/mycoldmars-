// Burma Script Tool — UNDO VIEWPORT GUARD (collab-only). Fixes "Cmd+Z sometimes scrolls the
// viewport to the bottom of the whole script".
//
// WHY (upstream bug, @tiptap/y-tiptap 3.0.6 — we do NOT fork the package): in a collab session
// native history is OFF (Editor.jsx StarterKit `undoRedo: false`) and Cmd+Z belongs to the
// Collaboration extension's Y.UndoManager. y-tiptap applies every undo/redo to ProseMirror as a
// FULL-DOC replace (ProsemirrorBinding._typeChanged: `tr.replace(0, doc.content.size, rebuilt)`),
// then a best-effort restoreRelativeSelection(), then `tr.scrollIntoView()`. The restore can
// silently set NO selection: the stack item's stored Yjs relative positions resolve to null when
// their items were deleted / GC'd / recreated (node retype via setNodeMarkup, row drag-reorder,
// teammate remaps, merged undo groups), and the library's content fallback matches only TOP-LEVEL
// children by exact textContent — our top-level children are tableRows, so an undo that reverts
// text in the very row being edited guarantees a mismatch. With no selection set, ProseMirror maps
// the old selection through the whole-doc ReplaceStep (assoc 1) → DOC END, and the transaction's
// scrollIntoView slams the viewport to the bottom of the entire script.
//
// FIX (app layer): appendTransaction watches y-sync undo/redo dispatches and validates the
// restored selection against where the undo actually changed the doc (old-vs-new content diff).
// A correctly restored selection is ALWAYS at/near the diff region — the stored selection is
// captured immediately before its change happened there. A caret outside the region (typically
// the doc-end mapping artifact) is a failed restore, so we snap it to diffStart — the
// undone-change site, exactly where prosemirror-history puts the caret — and scrollIntoView the
// CORRECTED selection. Appended transactions apply in the same state.apply round, so the view
// scrolls ONCE, to the right place. NOT the blocks.js window.scrollY-pin trick: pinning the
// viewport would leave the caret at the doc bottom and the next keystroke would edit the wrong
// end of the script — the caret must be corrected, not just the scroll.
//
// DATA-LOSS LAW: the appended transaction is SELECTION-ONLY — zero steps, never touches the doc
// (undo-viewport-guard.test.mjs asserts docChanged === false and byte-identical doc JSON + Y.Doc
// state with the guard installed vs not).
//
// BUNDLE LAW: this module imports @tiptap/y-tiptap (ySyncPluginKey), which lives in the
// collab-vendor chunk. It must ONLY be imported from collab-runtime.js (reached via dynamic
// import) — never from Editor.jsx — or the realtime stack leaks into editor-vendor and re-opens
// the TDZ init-order crash documented in vite.config.js's manualChunks.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

// Positions within this many tokens of the diff region count as a sane restore. The stored
// selection is captured at the change site, so legitimate restores sit at/inside the region; the
// slack absorbs a boundary token either side without ever being wide enough to excuse a doc-end
// jump (a tableRow+cell+block+paragraph seam alone is 4 tokens).
const REGION_SLACK = 2;

// PURE. Where should the caret be after this undo/redo, or null when the restored position is
// already sane? `oldDoc` = the doc before the undo applied, `newDoc` = after, `newSelHead` = the
// selection head the y-sync dispatch left us with (restored or mapped-through).
//   • no diff → null (no-op undo, nothing to judge against);
//   • head inside [diffStart − slack, diffEnd + slack] → null (correct restore — this also covers
//     a legitimate edit at the true end of the doc, where "near the end" is the RIGHT answer);
//   • otherwise → diffStart, the undone-change site.
export function correctedUndoSelectionPos(oldDoc, newDoc, newSelHead) {
  if (typeof newSelHead !== 'number') return null;
  const diffStart = oldDoc.content.findDiffStart(newDoc.content);
  if (diffStart === null) return null;
  // findDiffEnd returns { a: old-doc pos, b: new-doc pos }; b is the region end in NEW
  // coordinates. Overlapping/repeated content can report b < diffStart — widen so the region
  // stays well-formed rather than empty.
  const diffEnd = oldDoc.content.findDiffEnd(newDoc.content);
  const regionStart = Math.max(0, diffStart - REGION_SLACK);
  const regionEnd = Math.min(
    newDoc.content.size,
    Math.max(diffStart, diffEnd ? diffEnd.b : diffStart) + REGION_SLACK
  );
  if (newSelHead >= regionStart && newSelHead <= regionEnd) return null;
  return Math.min(diffStart, newDoc.content.size);
}

const guardKey = new PluginKey('wpUndoViewportGuard');

// The raw ProseMirror plugin, exported separately so the headless test harness can compose it
// with ySyncPlugin/yUndoPlugin directly (no tiptap Editor, no DOM).
export function undoViewportGuardPlugin() {
  return new Plugin({
    key: guardKey,
    appendTransaction(transactions, oldState, newState) {
      // Only y-sync UNDO/REDO dispatches. Remote teammate updates carry isChangeOrigin WITHOUT
      // the undo flag and must never move the local caret; local typing carries neither.
      const isUndoRedo = transactions.some((tr) => {
        const meta = tr.getMeta(ySyncPluginKey);
        return !!(meta && meta.isChangeOrigin && meta.isUndoRedoOperation);
      });
      if (!isUndoRedo) return undefined;
      // Only judge plain text selections. A restored AllSelection's head IS the doc end
      // (collapsing it would be a regression), and a NodeSelection whose node vanished already
      // degrades to a TextSelection during mapping — so this filter loses nothing.
      if (!(newState.selection instanceof TextSelection)) return undefined;
      const pos = correctedUndoSelectionPos(oldState.doc, newState.doc, newState.selection.head);
      if (pos === null) return undefined;
      // Selection.near handles diffStart landing on a structural seam (between tableRows, where
      // a bare TextSelection would throw "not pointing into a node with inline content").
      // addToHistory:false keeps this out of every capture path; scrollIntoView on the APPENDED
      // tr makes the single view scroll target the corrected caret, not the doc bottom.
      return newState.tr
        .setSelection(Selection.near(newState.doc.resolve(pos), 1))
        .setMeta('addToHistory', false)
        .scrollIntoView();
    },
  });
}

// The tiptap wrapper collab-runtime.js adds alongside Collaboration/CollaborationCaret. Collab
// sessions only — non-collab episodes keep prosemirror-history, which restores correctly.
export const UndoViewportGuard = Extension.create({
  name: 'undoViewportGuard',
  addProseMirrorPlugins() {
    return [undoViewportGuardPlugin()];
  },
});
