// Burma Script Tool — inline MARKS for {TK research} and [visual] direction.
// MIRRORS translation/src/editor/extensions/HighlightMark.js (Mark.create + class) and
// InterestPlugin.js (a ProseMirror plugin that intercepts clicks on marked spans). A
// click on a {TK} or [visual] span opens the margin WORKSHOP HUB — we dispatch a
// CustomEvent the Editor listens for, exactly like SpeakerBlock's rename overlay flow.

import { Mark } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

// Find the marked span the user clicked, resolve its text + range, and emit the
// workshop event. Returns true if a span was hit (so PM stops default handling).
function openWorkshop(view, event, markName, kind) {
  const target = event.target.closest(`span[data-${kind}]`);
  if (!target) return false;
  event.preventDefault();

  const pos = view.posAtDOM(target, 0);
  const $pos = view.state.doc.resolve(pos);
  const mark = view.state.schema.marks[markName];

  // Expand to the full contiguous run of this mark around the click.
  let from = pos, to = pos;
  const parent = $pos.parent;
  const start = $pos.start();
  parent.forEach((child, offset) => {
    if (child.isText && child.marks.some((m) => m.type === mark)) {
      const cFrom = start + offset;
      const cTo = cFrom + child.nodeSize;
      if (cFrom <= pos && pos <= cTo) { from = cFrom; to = cTo; }
    }
  });

  const text = view.state.doc.textBetween(from, to, '');
  window.dispatchEvent(new CustomEvent('wp-open-workshop', {
    detail: { kind, text, from, to },
  }));
  return true;
}

export const TkSpan = Mark.create({
  name: 'tkSpan',
  inclusive: false,
  parseHTML() { return [{ tag: 'span[data-tk]' }]; },
  renderHTML() { return ['span', { 'data-tk': '', class: 'wp-tk' }, 0]; },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => openWorkshop(view, event, 'tkSpan', 'tk'),
        },
      },
    })];
  },
});

export const VisualSpan = Mark.create({
  name: 'visualSpan',
  inclusive: false,
  parseHTML() { return [{ tag: 'span[data-visual]' }]; },
  renderHTML() { return ['span', { 'data-visual': '', class: 'wp-visual' }, 0]; },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => openWorkshop(view, event, 'visualSpan', 'visual'),
        },
      },
    })];
  },
});

export const BURMA_MARKS = [TkSpan, VisualSpan];
