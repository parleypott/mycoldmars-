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

import { Mark, markInputRule, markPasteRule, getMarkRange } from '@tiptap/core';
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
// ── TIMECODE CHIP CONTEXT MENU (right-click → set shooting DAY / edit the timecode) ──────────────
// Johnny: right-click a timecode chip and pick DAY 1 / DAY 2 / DAY 3 (or clear it, or retype the
// code). The `day` + `tc` attrs already round-trip through the saved doc, so a change here flows
// straight into onUpdate → autosave → saveDoc and survives reload. Reuses the .wp-blockmenu chrome.
const TC_RE = /^\d{1,2}:\d{2}:\d{2}:\d{2}$/;
let openTcMenuEl = null;
function closeTcMenu() {
  if (!openTcMenuEl) return;
  openTcMenuEl.remove();
  openTcMenuEl = null;
  document.removeEventListener('mousedown', onTcDocDown, true);
}
function onTcDocDown(e) { if (openTcMenuEl && !openTcMenuEl.contains(e.target)) closeTcMenu(); }

// Resolve the whole timecode mark covering `pos` and read its current attrs. Robust to boundary
// positions by reading the marks off the text node at range.from rather than $pos.marks().
function timecodeMarkAt(state, pos) {
  const markType = state.schema.marks.timecode;
  if (!markType) return null;
  const range = getMarkRange(state.doc.resolve(pos), markType);
  if (!range) return null;
  const node = state.doc.nodeAt(range.from);
  const mark = node && node.marks.find((m) => m.type === markType);
  return { markType, range, mark };
}

// Apply { day } and/or { tc } to the WHOLE timecode mark covering `pos`, preserving the other attr.
// When tc changes we also replace the visible text (the chip wraps the bare code) so body prose +
// the integrity audit stay in sync. One dispatch → onUpdate → autosave. Returns true on success.
function patchTimecodeAt(view, pos, patch) {
  const found = timecodeMarkAt(view.state, pos);
  if (!found) return false;
  const { markType, range, mark } = found;
  const attrs = { tc: mark?.attrs.tc || '', day: mark?.attrs.day ?? null, ...patch };
  let tr = view.state.tr;
  const newTc = patch.tc;
  if (newTc !== undefined && newTc !== (mark?.attrs.tc || '')) {
    tr = tr.insertText(newTc, range.from, range.to);
    const to2 = range.from + newTc.length;
    tr = tr.removeMark(range.from, to2, markType).addMark(range.from, to2, markType.create(attrs));
  } else {
    tr = tr.removeMark(range.from, range.to, markType).addMark(range.from, range.to, markType.create(attrs));
  }
  view.dispatch(tr);
  return true;
}

function openTimecodeMenu(view, pos, anchorRect) {
  closeTcMenu();
  const found = timecodeMarkAt(view.state, pos);
  const curDay = found?.mark?.attrs.day ?? null;
  const curTc = found?.mark?.attrs.tc || '';

  const menu = document.createElement('div');
  menu.className = 'wp-blockmenu wp-tcmenu';
  menu.setAttribute('contenteditable', 'false');

  const head = document.createElement('div');
  head.className = 'wp-bm-head';
  head.textContent = 'Shooting day';
  menu.appendChild(head);

  const addItem = (label, isCurrent, onPick) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'wp-bm-item' + (isCurrent ? ' is-current' : '');
    item.textContent = label;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(); closeTcMenu(); view.focus(); });
    menu.appendChild(item);
  };

  [1, 2, 3].forEach((d) => addItem('DAY ' + d, curDay === d, () => patchTimecodeAt(view, pos, { day: d })));
  addItem('No day', curDay == null, () => patchTimecodeAt(view, pos, { day: null }));

  const sep = document.createElement('div'); sep.className = 'wp-bm-sep'; menu.appendChild(sep);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'wp-bm-item';
  edit.textContent = 'Edit timecode…';
  edit.addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeTcMenu();
    const next = (window.prompt('Timecode (HH:MM:SS:FF)', curTc) || '').trim();
    if (!next || next === curTc) { view.focus(); return; }
    if (!TC_RE.test(next)) {
      window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tc: 'not a valid timecode (HH:MM:SS:FF)' } }));
      view.focus();
      return;
    }
    patchTimecodeAt(view, pos, { tc: next });
    view.focus();
  });
  menu.appendChild(edit);

  document.body.appendChild(menu);
  menu.style.position = 'fixed';
  menu.style.top = `${anchorRect.bottom + 4}px`;
  menu.style.left = `${anchorRect.left}px`;
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
  if (r.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, anchorRect.top - r.height - 4)}px`;

  openTcMenuEl = menu;
  setTimeout(() => document.addEventListener('mousedown', onTcDocDown, true), 0);
}

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
    return ['span', { ...HTMLAttributes, class: 'wp-tc-tag', title: 'click to copy · right-click to set day', role: 'button', tabindex: '-1' }, 0];
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
  // Left-click a timecode chip → copy it (flash + toast), exactly like the SOT LCD. Right-click →
  // the DAY / edit-timecode menu (the left-click guard keeps copy on button 0 only).
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            if (event.button !== 0) return false; // right/middle → contextmenu handles it
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
          contextmenu: (view, event) => {
            const target = event.target.closest('span.wp-tc-tag, span[data-tc]');
            if (!target) return false;
            event.preventDefault();
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const pos = coords ? coords.pos : view.posAtDOM(target, 0);
            if (typeof pos !== 'number' || pos < 0) return false;
            openTimecodeMenu(view, pos, target.getBoundingClientRect());
            return true;
          },
        },
      },
    })];
  },
});

export const BURMA_MARKS = [TkSpan, FactCheckSpan, VisualSpan, TimecodeMark];
