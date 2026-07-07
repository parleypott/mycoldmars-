// Burma Script Tool — YJS RELATIVE-POSITION ANCHORS (collab chunk). The adapter image-drop.js
// uses to keep upload placeholders alive across y-sync applies (which land as FULL-DOC replaces
// and destroy numerically-mapped widget decorations — see COLLAB LOOP LAW).
//
// A Yjs RelativePosition pins to the CRDT item at a position, not to a numeric offset, so it
// survives any remote rewrite the same way collab carets do. toRel/toAbs read the live y-sync
// plugin state (binding mapping between Y types and PM positions); both return null when the
// binding isn't up or the anchored item was deleted — callers treat null as "site gone, abort".
//
// BUNDLE LAW: imports @tiptap/y-tiptap, so only collab-runtime.js may import this file.
// image-drop.js (core chunk) receives it via setImageDropCollabAnchors at session start.

import {
  ySyncPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap';
import { isRemoteEchoTransaction } from './collab-echo.js';

export function makeCollabAnchorAdapter() {
  return {
    isRemote: isRemoteEchoTransaction,
    toRel(state, pos) {
      try {
        const ys = ySyncPluginKey.getState(state);
        if (!ys || !ys.binding) return null;
        return absolutePositionToRelativePosition(pos, ys.type, ys.binding.mapping);
      } catch {
        return null;
      }
    },
    toAbs(state, anchor) {
      try {
        const ys = ySyncPluginKey.getState(state);
        if (!ys || !ys.binding) return null;
        const abs = relativePositionToAbsolutePosition(ys.doc, ys.type, anchor, ys.binding.mapping);
        return typeof abs === 'number' ? abs : null;
      } catch {
        return null;
      }
    },
  };
}
