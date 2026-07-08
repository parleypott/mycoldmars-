// Burma Script Tool — CHAPTER FOCUS (full-screen single-chapter editing).
//
// Johnny: "next to each chapter i want an icon that brings me into an isolated full screen
// that I can work on that chapter and only that — but I want to very easily be able to get
// back to the main script without having to reload. Seamless." The chapter he means is the
// FRAMED BOOK SECTION (chapter-frames.js): the big header row plus every following row until
// the next chapter opens. Focus and frames therefore share ONE run model.
//
// HOW IT WORKS — decoration-only, zero doc mutation, zero reload:
//   • The chapter cartridge's ⛶ button dispatches `wp-chapter-focus` with the chapter's
//     blockId. main.jsx catches it, flips the page chrome into focus dress (masthead/header/
//     footer/rails hidden via CSS) and feeds the id into THIS plugin as a transaction meta.
//   • The plugin walks the TOP-LEVEL rows once and node-decorates every row that does NOT
//     belong to the focused chapter's run with `wp-focus-out` (CSS: display none).
//   • Exiting clears the meta → decorations empty → the full script is back, same editor,
//     same scroll machinery, same collab session. Nothing was ever unmounted.
//
// RUN MODEL = chapter-frames' (audit 2026-07-07): a run starts when a row's FIRST block (first
// cell) is a chapterBlock — the exact rule buildDecorations uses to draw the frame, so what
// you focus is byte-for-byte the framed section you see. This is also the perf fix: the first
// version descended every text node of every row per transaction; the first-block probe is
// O(top-level rows) with O(1) work per row.
//
// COLLAB LOOP LAW: this plugin dispatches NOTHING — it only maps a meta flag to decorations.
// Remote y-sync transactions merely rebuild the decoration set (pure compute), so there is no
// auto-dispatch path that could echo (see repo CLAUDE.md).

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const chapterFocusKey = new PluginKey('wpChapterFocus');

const EMPTY = { focusId: null, decorations: DecorationSet.empty };

// The chapterBlock blockId that a row STARTS, or null. FIRST BLOCK of the FIRST CELL only —
// the same probe as chapter-frames' chapterRunStartForRow, so the focused run is exactly the
// framed section. (Palau nests said|shown rows inside cells; a nested chapter would be a
// malformed doc and deliberately does not open a run — same as the frames.)
export function rowChapterStartId(row) {
  const cell = row?.firstChild;
  if (!cell || cell.type?.name !== 'tableCell') return null;
  const block = cell.firstChild;
  if (!block || block.type?.name !== 'chapterBlock') return null;
  return block.attrs?.blockId || null;
}

// Exported for the headless suite — the wp-focus-out node decorations a doc should carry when
// `focusId` is the focused chapter. Contract:
//   • focusId null/absent-from-doc → EMPTY set (never hide the whole script behind a stale id —
//     a chapter deleted mid-focus degrades to "everything visible", not a blank page).
//   • rows BEFORE the first chapter, rows of OTHER chapters, and bare top-level nodes outside
//     the focused run are hidden; the focused chapter's row + its following body rows are not.
export function buildFocusDecorations(doc, focusId) {
  if (!focusId) return DecorationSet.empty;

  // SINGLE PASS: collect would-be decorations while checking the focus id actually exists;
  // if it never shows up the stale-id contract wins and everything stays visible.
  const decos = [];
  let found = false;
  let current = null; // the chapter id owning the current run (null = pre-script rows)
  doc.forEach((child, pos) => {
    if (child.type?.name === 'tableRow') {
      const startId = rowChapterStartId(child);
      if (startId) {
        current = startId;
        if (startId === focusId) found = true;
      }
    }
    // Bare top-level nodes (the trailing-paragraph peace treaty, scriptStart strays) belong to
    // whatever run is open — so the focused chapter keeps its own trailing space.
    if (current !== focusId) {
      decos.push(Decoration.node(pos, pos + child.nodeSize, { class: 'wp-focus-out' }));
    }
  });
  if (!found) return DecorationSet.empty;
  return DecorationSet.create(doc, decos);
}

// The focused run's flat position range { from, to } (doc coordinates), or null when not
// focused / the chapter is gone. Drives the Mod-A fence below; exported for the suite.
export function focusRunRange(doc, focusId) {
  if (!focusId) return null;
  let from = null;
  let to = null;
  let current = null;
  doc.forEach((child, pos) => {
    if (child.type?.name === 'tableRow') {
      const startId = rowChapterStartId(child);
      if (startId) current = startId;
    }
    if (current === focusId) {
      if (from == null) from = pos;
      to = pos + child.nodeSize;
    }
  });
  return from == null ? null : { from, to };
}

export const ChapterFocus = Extension.create({
  name: 'chapterFocus',
  // MOD-A FENCE (audit 2026-07-07): with rows merely display:none'd, a native select-all in
  // focus grabbed the ENTIRE doc — one keystroke could replace every hidden chapter. While a
  // chapter has the screen, Cmd/Ctrl+A selects that chapter's run and nothing else.
  addKeyboardShortcuts() {
    return {
      'Mod-a': () => {
        const state = this.editor.state;
        const focusId = chapterFocusKey.getState(state)?.focusId;
        if (!focusId) return false; // not focused — native select-all
        const range = focusRunRange(state.doc, focusId);
        if (!range) return false;
        try {
          const sel = TextSelection.between(state.doc.resolve(range.from), state.doc.resolve(range.to));
          this.editor.view.dispatch(state.tr.setSelection(sel));
          return true;
        } catch {
          return false;
        }
      },
    };
  },
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
