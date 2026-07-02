import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { episodeFlag } from '../episode-config.js';

// DAY DE-DUPE (render layer). The build-time fold in document-builder strips a literal "DAY N"
// sitting right before a timecode for FRESH seeds — but the tool persists the built ProseMirror
// doc, so a doc that was seeded BEFORE that fix still carries the duplicate "DAY N" text node
// (the chip already displays "DAY N · …"). This plugin hides that redundant "DAY N" at render
// time on ANY doc — existing or fresh — WITHOUT deleting a character (non-destructive, round-trips
// intact, undo-safe). Palau only. On a fresh doc there's nothing to hide, so it's a no-op there.

const dayFoldKey = new PluginKey('dayFold');
const DAY_BEFORE = /(\bDAY\s*\d+\b)[ \t]*$/i;

function isPalau() {
  return episodeFlag('dayFold');
}

function buildDayFoldDecorations(doc) {
  if (!isPalau()) return DecorationSet.empty;
  const decos = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.marks.length) return;
    // Any timecode chip — the DAY-style ones DISPLAY "DAY N · code" from the chip itself (#1), so a
    // literal "DAY N" sitting right before ANY chip is a visible duplicate. Hide it regardless of the
    // chip's day attr (a cached doc's chip may carry a dirty/absent day), matching the fresh-build
    // strip in document-builder so existing and new docs read the same.
    const isTc = node.marks.some((m) => m.type.name === 'timecode');
    if (!isTc) return;
    let $pos;
    try { $pos = doc.resolve(pos); } catch (_e) { return; }
    // text immediately preceding this timecode chip within the same textblock
    let before = '';
    try { before = $pos.parent.textBetween(0, $pos.parentOffset); } catch (_e) { return; }
    const mm = before.match(DAY_BEFORE);
    if (!mm) return;
    const start = $pos.start();
    const from = start + mm.index;
    const to = start + mm.index + mm[1].length;
    if (to > from) decos.push(Decoration.inline(from, to, { class: 'wp-day-hidden' }));
  });
  return DecorationSet.create(doc, decos);
}

export const DayFold = Extension.create({
  name: 'dayFold',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: dayFoldKey,
      state: {
        init: (_config, state) => buildDayFoldDecorations(state.doc),
        apply: (tr, prev) => (tr.docChanged ? buildDayFoldDecorations(tr.doc) : prev),
      },
      props: {
        decorations(state) { return dayFoldKey.getState(state) || DecorationSet.empty; },
      },
    })];
  },
});
