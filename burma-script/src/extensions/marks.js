// Burma Script Tool — inline MARKS for {TK research} and [visual] direction.
// MIRRORS translation/src/editor/extensions/HighlightMark.js (Mark.create + class +
// addCommands) and InterestPlugin.js (a ProseMirror plugin that intercepts clicks on
// marked spans). A click on a {TK} or [visual] span opens the margin WORKSHOP HUB — we
// dispatch a CustomEvent the Editor listens for, exactly like SpeakerBlock's overlay flow.
//
// LIVE AUTHORING (the high-priority fix): the marks now (1) expose real setMark/unsetMark
// commands the BubbleMenu calls, and (2) self-apply via input rules so a writer typing
// {tk ...} or [visual] in the prose gets the Swiss-red span the instant they close the
// brace — no rebuild-from-source needed. The literal braces stay IN the text so the
// blocks export round-trips faithfully (see document-builder.nodeText).

import { Mark, markInputRule, markPasteRule } from '@tiptap/core';
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

  // Context for the writing helper: the block the span lives in (so the model completes the
  // sentence in place) + a window of nearby script (voice/rhythm). textBetween over a span
  // around the click keeps it cheap; the endpoint caps lengths anyway.
  const block = parent.textBetween(0, parent.content.size, ' ', ' ').trim();
  const ctxFrom = Math.max(0, from - 700);
  const ctxTo = Math.min(view.state.doc.content.size, to + 700);
  const context = view.state.doc.textBetween(ctxFrom, ctxTo, ' ', ' ').trim();

  window.dispatchEvent(new CustomEvent('wp-open-workshop', {
    detail: { kind, text, from, to, block, context },
  }));
  return true;
}

export const TkSpan = Mark.create({
  name: 'tkSpan',
  inclusive: false,
  parseHTML() { return [{ tag: 'span[data-tk]' }]; },
  renderHTML() { return ['span', { 'data-tk': '', class: 'wp-tk' }, 0]; },
  addCommands() {
    return {
      setTkSpan: () => ({ commands }) => commands.setMark('tkSpan'),
      unsetTkSpan: () => ({ commands }) => commands.unsetMark('tkSpan'),
      toggleTkSpan: () => ({ commands }) => commands.toggleMark('tkSpan'),
    };
  },
  // Live self-mark: as soon as the writer closes a {tk ...} token, wrap it.
  addInputRules() {
    return [markInputRule({ find: /(\{tk[^{}]*\})$/i, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /(\{tk[^{}]*\})/gi, type: this.type })];
  },
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

// FACT-CHECK span — the SECOND kind of squiggly-bracket marker, visually distinct from
// {tk} (writing helper). Authors flag a claim that needs verifying with {fc …} or {fact …}.
// Renders amber + dotted underline (vs the Swiss-red {tk}); clicking branches the Workshop
// hub into VERIFY mode (verdict + source + suggested edit) rather than the 5-option writer.
export const FactCheckSpan = Mark.create({
  name: 'factCheckSpan',
  inclusive: false,
  parseHTML() { return [{ tag: 'span[data-fc]' }]; },
  renderHTML() { return ['span', { 'data-fc': '', class: 'wp-fc' }, 0]; },
  addCommands() {
    return {
      setFactCheckSpan: () => ({ commands }) => commands.setMark('factCheckSpan'),
      unsetFactCheckSpan: () => ({ commands }) => commands.unsetMark('factCheckSpan'),
      toggleFactCheckSpan: () => ({ commands }) => commands.toggleMark('factCheckSpan'),
    };
  },
  // Live self-mark: a {fc …}/{fact …} token wraps the instant the brace closes.
  addInputRules() {
    return [markInputRule({ find: /(\{(?:fc|fact)\b[^{}]*\})$/i, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /(\{(?:fc|fact)\b[^{}]*\})/gi, type: this.type })];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => openWorkshop(view, event, 'factCheckSpan', 'fc'),
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
  addCommands() {
    return {
      setVisualSpan: () => ({ commands }) => commands.setMark('visualSpan'),
      unsetVisualSpan: () => ({ commands }) => commands.unsetMark('visualSpan'),
      toggleVisualSpan: () => ({ commands }) => commands.toggleMark('visualSpan'),
    };
  },
  // Live self-mark: a [visual] direction wraps the moment the bracket closes. ONE source of
  // truth for the brackets: the CSS chip supplies them via ::before/::after, so we capture
  // only the INNER text here (the markInputRule replaces the match with the captured group),
  // stripping the literal brackets — exactly how document-builder stores loaded chips. This
  // kills the double-bracket [[montage]] a live-typed [montage] used to produce.
  addInputRules() {
    return [markInputRule({ find: /\[([^\[\]]+)\]$/, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /\[([^\[\]]+)\]/g, type: this.type })];
  },
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

export const BURMA_MARKS = [TkSpan, FactCheckSpan, VisualSpan];
