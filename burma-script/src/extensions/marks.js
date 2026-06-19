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
  // NO addProseMirrorPlugins: [visual] / B-roll spans are deliberately INERT — they render
  // (the bracketed mono chip) and round-trip, but a click does NOTHING. Only {TK} and {fc}
  // spans open the Workshop dock; visual direction is reference, not an action.
});

// TIMECODE mark — the DATA-INTEGRITY chip. EVERY broadcast timecode (HH:MM:SS:FF) embedded
// anywhere in any block's prose becomes a small clickable tag that COPIES the timecode on
// click (Johnny: "a little tag you can click and it copies"). Mirrors the SOT LCD copy flow
// and the {tk} chip look — flat, mono, hairline. Multiple per block stack inline. The raw
// code rides in data-tc so the audit (.wp-tc-tag / [data-tc]) sees every one as TAGGED, and
// nodeText leaves the plain text in place so the timecode round-trips faithfully.
export const TimecodeMark = Mark.create({
  name: 'timecode',
  inclusive: false,
  // Lower priority so a {tk …}/[visual] span that happens to wrap a timecode wins the span.
  priority: 90,
  addAttributes() {
    return {
      tc: {
        default: '',
        // The BARE broadcast timecode (HH:MM:SS:FF). This is the ONLY thing a click copies —
        // never the day. Rides in data-tc so the integrity audit ([data-tc]) sees every chip
        // as TAGGED and the clipboard write copies exactly the code.
        parseHTML: (el) => el.getAttribute('data-tc') || (el.textContent || '').match(/\d{1,2}:\d{2}:\d{2}:\d{2}/)?.[0] || '',
        renderHTML: (attrs) => (attrs.tc ? { 'data-tc': attrs.tc } : {}),
      },
      // The running DAY this timecode belongs to (1|2|3 or null). Folded into the chip at
      // BUILD time from the surrounding contextDay / block day (#2). When known the chip reads
      // "DAY N · HH:MM:SS:FF" with the DAY prominent; when null it shows just the timecode
      // (NEVER "DAY null"). Preserved through parse/serialize so it round-trips.
      day: {
        default: null,
        parseHTML: (el) => {
          const d = el.getAttribute('data-day');
          return d ? Number(d) : null;
        },
        renderHTML: (attrs) => (attrs.day != null ? { 'data-day': String(attrs.day) } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-tc]' }]; },
  renderHTML({ HTMLAttributes }) {
    // The chip's VISIBLE text is supplied by CSS (::before = "DAY N · " when data-day is set);
    // the editable text node it wraps is the bare timecode, so the body prose still reads the
    // raw HH:MM:SS:FF and the audit counts it on-page. data-day drives the DAY prefix display.
    return ['span', { ...HTMLAttributes, class: 'wp-tc-tag', title: 'copy timecode', role: 'button', tabindex: '-1' }, 0];
  },
  addCommands() {
    return {
      setTimecode: (attrs) => ({ commands }) => commands.setMark('timecode', attrs),
      unsetTimecode: () => ({ commands }) => commands.unsetMark('timecode'),
    };
  },
  // Live self-mark: a timecode typed into the prose chips itself the moment it's complete —
  // even when GLUED to a letter/@/bracket/punct with no leading space (matches parser.ts's TC:
  // a non-\b detector with a lookbehind rejecting a longer numeric run and a lookahead rejecting
  // a 5th :FF field). So "ON CAM02:17:09:07" and "03:49:59:08@" chip correctly.
  addInputRules() {
    return [markInputRule({ find: /((?<!\d)(?<!\d:)\d{1,2}:\d{2}:\d{2}:\d{2}(?!:?\d))$/, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /((?<!\d)(?<!\d:)\d{1,2}:\d{2}:\d{2}:\d{2}(?!:?\d))/g, type: this.type })];
  },
  // Click a timecode chip → copy it to the clipboard + flash + toast, exactly like the SOT LCD.
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            const target = event.target.closest('span.wp-tc-tag, span[data-tc]');
            if (!target) return false;
            event.preventDefault();
            const tc = target.getAttribute('data-tc') || target.textContent || '';
            if (tc) {
              navigator.clipboard?.writeText(tc).catch(() => {});
              window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tc } }));
              target.classList.add('copied');
              setTimeout(() => target.classList.remove('copied'), 700);
            }
            return true;
          },
        },
      },
    })];
  },
});

export const BURMA_MARKS = [TkSpan, FactCheckSpan, VisualSpan, TimecodeMark];
