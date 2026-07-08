// Burma Script Tool — CHAPTER FOCUS (full-screen single-chapter editing).
//
// Johnny: "next to each chapter i want an icon that brings me into an isolated full screen
// that I can work on that chapter and only that — but I want to very easily be able to get
// back to the main script without having to reload. Seamless."
//
// HOW IT WORKS — decoration-only, zero doc mutation, zero reload:
//   • The chapter cartridge's ⛶ button dispatches `wp-chapter-focus` with the chapter's
//     blockId. main.jsx catches it, flips the page chrome into focus dress (masthead/header/
//     footer/rails hidden via CSS) and feeds the id into THIS plugin as a transaction meta.
//   • The plugin walks the TOP-LEVEL rows once and node-decorates every row that does NOT
//     belong to the focused chapter's run with `wp-focus-out` (CSS: display none). A chapter's
//     run = its own row plus every following row until the next row that starts a chapter —
//     the same run model chapter-frames.js draws its frames around.
//   • Exiting clears the meta → decorations empty → the full script is back, same editor,
//     same scroll machinery, same collab session. Nothing was ever unmounted.
//
// COLLAB LOOP LAW: this plugin dispatches NOTHING — it only maps a meta flag to decorations.
// Remote y-sync transactions merely rebuild the decoration set (pure compute), so there is no
// auto-dispatch path that could echo (see repo CLAUDE.md).

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const chapterFocusKey = new PluginKey('wpChapterFocus');

const EMPTY = { focusId: null, decorations: DecorationSet.empty };

// The chapterBlock blockId that a row STARTS, or null. Descends the whole row (Palau nests
// rows inside cells) so a chapter anywhere in the row opens the run — mirrors the reading
// model: the chapter heading's row is the first row of that chapter.
export function rowChapterStartId(row) {
  let found = null;
  row.descendants((node) => {
    if (found) return false;
    if (node.type?.name === 'chapterBlock') {
      found = node.attrs?.blockId || null;
      return false;
    }
    return true;
  });
  return found;
}

// Exported for the headless suite — the wp-focus-out node decorations a doc should carry when
// `focusId` is the focused chapter. Contract:
//   • focusId null/absent-from-doc → EMPTY set (never hide the whole script behind a stale id —
//     a chapter deleted mid-focus degrades to "everything visible", not a blank page).
//   • rows BEFORE the first chapter, rows of OTHER chapters, and bare top-level nodes outside
//     the focused run are hidden; the focused chapter's row + its following body rows are not.
export function buildFocusDecorations(doc, focusId) {
  if (!focusId) return DecorationSet.empty;
  let exists = false;
  doc.descendants((node) => {
    if (exists) return false;
    if (node.type?.name === 'chapterBlock' && node.attrs?.blockId === focusId) exists = true;
    return !exists;
  });
  if (!exists) return DecorationSet.empty;

  const decos = [];
  let current = null; // the chapter id owning the current run (null = pre-script rows)
  doc.forEach((child, pos) => {
    if (child.type?.name === 'tableRow') {
      const startId = rowChapterStartId(child);
      if (startId) current = startId;
    }
    // Bare top-level nodes (the trailing-paragraph peace treaty, scriptStart strays) belong to
    // whatever run is open — so the focused chapter keeps its own trailing space.
    if (current !== focusId) {
      decos.push(Decoration.node(pos, pos + child.nodeSize, { class: 'wp-focus-out' }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const ChapterFocus = Extension.create({
  name: 'chapterFocus',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: chapterFocusKey,
      state: {
        init: () => EMPTY,
        apply(tr, prev) {
          const meta = tr.getMeta(chapterFocusKey);
          const focusId = meta !== undefined ? (meta && meta.id) || null : prev.focusId;
          if (!focusId) return prev === EMPTY ? prev : EMPTY;
          // Rebuild on an explicit meta change OR any doc change while focused (rows can be
          // added/removed/reordered under the focus — including by a collab teammate — and the
          // run boundaries must follow). Selection-only transactions just map the existing set.
          if (meta === undefined && !tr.docChanged) {
            const mapped = prev.decorations.map(tr.mapping, tr.doc);
            return mapped === prev.decorations ? prev : { ...prev, decorations: mapped };
          }
          return { focusId, decorations: buildFocusDecorations(tr.doc, focusId) };
        },
      },
      props: {
        decorations(state) {
          return chapterFocusKey.getState(state)?.decorations || DecorationSet.empty;
        },
      },
    })];
  },
});
