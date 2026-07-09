// Burma Script Tool — PASTE ADOPTS THE ACTIVE VIZ TAG.
//
// Johnny 2026-07-09: "when I slash in a viz tag and Cmd+V paste, I want the viztag styling to
// clothe everything I paste, even if there are paragraph breaks." After a `/viz` slash, `setMark`
// on the empty cursor leaves a STORED `directionMark` (see direction-chip.js comment ~line 211).
// Normally a paste carries its own marks and ignores that stored one, so the pasted text lands
// UN-styled. This plugin detects an active directionMark (stored, or on the run under the cursor)
// and blankets the ENTIRE pasted range with it — across paragraph breaks — so the whole paste
// wears the tag you slashed in.
//
// COLLAB-SAFE: fires only on an explicit user paste (handlePaste), one dispatch, no
// appendTransaction/normalizer — nothing that could echo-loop under Yjs. READ-safe: gated on
// view.editable && !isReadOnly().
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { isReadOnly } from '../read-mode.js';

// The directionMark that a fresh /viz slash leaves active: the stored mark if present (empty
// cursor right after slashing), else the directionMark on the run the cursor sits in. Pure, so a
// headless test can assert the detection without a DOM. Returns the Mark instance or null.
export function activeDirectionMark(state) {
  const dm = state.schema.marks.directionMark;
  if (!dm) return null;
  const marks = state.storedMarks || state.selection.$from.marks();
  return marks.find((m) => m.type === dm) || null;
}

export const VizPasteAdopt = Extension.create({
  name: 'vizPasteAdopt',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('wpVizPasteAdopt'),
      props: {
        handlePaste(view, _event, slice) {
          if (!view.editable || isReadOnly()) return false;
          const { state } = view;
          const mark = activeDirectionMark(state);
          if (!mark) return false;                       // no active tag → let the normal paste run
          if (!slice || slice.content.size === 0) return false;
          const start = state.selection.from;
          const tr = state.tr.replaceSelection(slice);   // slice is already sanitized by PasteSanitize
          const end = tr.selection.to;                   // end of the inserted content
          if (end > start) tr.addMark(start, end, mark);  // clothe every text node in the range
          tr.setStoredMarks([mark]);                     // keep typing inside the tag after the paste
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    })];
  },
});
