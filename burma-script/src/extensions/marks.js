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
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { contiguousMarkRun } from './mark-run.js';
import { isReadOnly } from '../read-mode.js';
import { attachMenuKeynav, makeItemKeyActivatable } from './menu-kbd.js';
import { getEpisode, episodeFlag } from '../episode-config.js';

// Find the marked span the user clicked, resolve its text + range, and emit the
// workshop event. Returns true if a span was hit (so PM stops default handling).
function openWorkshop(view, event, markName, kind) {
  // READ-ONLY SHARE: the Workshop is edit-only chrome (and isn't even mounted for a reader).
  // Don't intercept the click — let the {tk}/[visual] span read as plain styled text.
  if (isReadOnly()) return false;
  const target = event.target.closest(`span[data-${kind}]`);
  if (!target) return false;
  event.preventDefault();

  const pos = view.posAtDOM(target, 0);
  return emitWorkshopAt(view, markName, kind, pos);
}

// Resolve the full contiguous run of `markName` around a position inside it, then emit the
// wp-open-workshop event with the run's text + range + context. Shared by openWorkshop
// (span click, {TK}) and the fact-check FLAG widget (the red square at the end of a pending
// assertion — the fc spans themselves are no longer click targets). Returns true when a run
// was found and the event fired.
function emitWorkshopAt(view, markName, kind, pos) {
  const $pos = view.state.doc.resolve(pos);
  const mark = view.state.schema.marks[markName];

  // Expand to the full contiguous run of this mark around the click. A {tk …}/{fc …} span
  // that contains an embedded timecode is split into multiple text-node fragments (the
  // timecode fragment carries an extra chip mark) — but every fragment still carries the span
  // mark. Gather all fragments, then expand across the whole run so a click on ANY fragment
  // (e.g. after the timecode) captures the ENTIRE ask, not just the clicked piece. (The old
  // single-fragment loop kept only the clicked piece → truncated text + a too-narrow write-back
  // range that shattered the span. Same fragmentation class as the nodeText export bug.)
  const parent = $pos.parent;
  const start = $pos.start();
  const fragments = [];
  parent.forEach((child, offset) => {
    const cFrom = start + offset;
    fragments.push({
      from: cFrom,
      to: cFrom + child.nodeSize,
      hasMark: child.isText && child.marks.some((m) => m.type === mark),
    });
  });
  const run = contiguousMarkRun(fragments, pos);
  const from = run.from, to = run.to;

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
//
// THE FLAG MODEL (Johnny 2026-07-07, superseding both the chip treatment and whole-span
// clicking): the assertion itself is QUIET, EDITABLE PROSE — a subtle red wash + dashed
// underline (styles.css), caret lands on plain click, edits adopt the formatting
// (`inclusive: true`). The ONLY click target is the little RED SQUARE FLAG rendered at the
// end of each unverified assertion (a widget decoration — fcFlagPlugin below, never doc
// content). Clicking the flag opens the Workshop VERIFY dock for that claim. Once the
// fact-check receipt lands (wp-create-footnote → status:'checked' in the same transaction),
// the wash turns green, the red flag disappears, and the existing circular green ✓
// (fcFootnote atom) takes its place — still clickable for lineage / editing / more sources.
export const FactCheckSpan = Mark.create({
  name: 'factCheckSpan',
  inclusive: true,
  addAttributes() {
    return {
      // 'pending' (unverified — red wash + red flag) | 'solid' (feels right, not fully
      // checked — amber wash + yellow flag) | 'checked' (receipt landed — green, no flag).
      status: {
        default: 'pending',
        parseHTML: (el) => {
          const s = el.getAttribute('data-fc-status');
          return s === 'checked' || s === 'solid' ? s : 'pending';
        },
        renderHTML: (attrs) => ({
          'data-fc-status': attrs.status === 'checked' || attrs.status === 'solid' ? attrs.status : 'pending',
        }),
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-fc]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', { 'data-fc': '', class: 'wp-fc', ...HTMLAttributes }, 0]; },
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
    return [fcFlagPlugin(this.type)];
  },
});

// ── FACT-CHECK FLAGS — the red square at the end of every unverified assertion ────────────
// Widget decorations (never doc content: no history step, no autosave, no collab payload).
// Rebuilt on every doc change from the CURRENT mark runs, so flags follow edits, appear the
// moment an {fc} span is created, and vanish the moment its status flips to 'checked'.

// All contiguous factCheckSpan runs still awaiting verification (pending OR solid — both
// keep a flag; only 'checked' retires it). Contiguous marked text nodes merge into one run
// (a claim fragmented by an embedded timecode chip is ONE claim); run.status is the first
// fragment's — statuses are set via addMark over the whole run, so mixes are transient.
export function findPendingFcRuns(doc, markType) {
  const runs = [];
  let open = null;
  doc.descendants((node, pos) => {
    if (!node.isText) { if (!node.isInline) open = null; return; }
    const m = node.marks.find((mk) => mk.type === markType);
    if (m && m.attrs.status !== 'checked') {
      if (open && open.to === pos) open.to = pos + node.nodeSize;
      else { open = { from: pos, to: pos + node.nodeSize, status: m.attrs.status === 'solid' ? 'solid' : 'pending' }; runs.push(open); }
    } else {
      open = null;
    }
  });
  return runs;
}

function fcFlagDom(status) {
  const b = document.createElement('button');
  b.className = 'wp-fc-flag';
  b.type = 'button';
  b.setAttribute('contenteditable', 'false');
  b.dataset.status = status || 'pending';
  b.title = status === 'solid'
    ? 'feels solid — not fully checked yet. click to verify'
    : 'not fact-checked yet — click to verify';
  b.setAttribute('aria-label', 'fact-check this claim');
  return b;
}

function buildFcFlagDecos(state, markType) {
  // Read-only shares get no flags: the verify dock is edit chrome; the wash alone tells the story.
  if (isReadOnly()) return DecorationSet.empty;
  const runs = findPendingFcRuns(state.doc, markType);
  if (!runs.length) return DecorationSet.empty;
  return DecorationSet.create(state.doc, runs.map((run) => {
    const dom = fcFlagDom(run.status);
    // A probe INSIDE the run, refreshed on every rebuild — the click handler re-derives the
    // full current run from it (same fragment walk the {TK} span click uses).
    dom.dataset.fcProbe = String(run.to - 1);
    // side:1 = the flag sits AFTER the assertion's last character; spec.key keeps PM from
    // tearing down/rebuilding the DOM node when nothing about the run moved (the checkbox
    // widgets' missing-key rebuild churn is a known perf trap under y-sync echoes).
    return Decoration.widget(run.to, dom, { side: 1, key: 'fcflag:' + run.from + ':' + run.to + ':' + run.status });
  }));
}

function fcFlagPlugin(markType) {
  const key = new PluginKey('wpFcFlags');
  return new Plugin({
    key,
    state: {
      init(_, state) { return buildFcFlagDecos(state, markType); },
      apply(tr, decos, _old, newState) {
        // Any doc change can create/extend/verify/delete an assertion — rebuild from truth.
        // (Cheap: one text-node walk; assertions are sparse.)
        if (tr.docChanged) return buildFcFlagDecos(newState, markType);
        return decos.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) { return key.getState(state); },
      handleDOMEvents: {
        mousedown(view, event) {
          const flag = event.target && event.target.closest && event.target.closest('.wp-fc-flag');
          if (!flag) return false;
          event.preventDefault();
          if (isReadOnly()) return true;
          const probe = Number(flag.dataset.fcProbe);
          if (!Number.isFinite(probe)) return true;
          const clamped = Math.max(0, Math.min(probe, view.state.doc.content.size - 1));
          try { return emitWorkshopAt(view, 'factCheckSpan', 'fc', clamped) || true; } catch { return true; }
        },
      },
    },
  });
}

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

// TRIM mark — preserved strikethrough. Johnny strikes copy he is CUTTING but refuses to lose (the
// tool is data-loss-proof): the words stay on the page, struck and dimmed, never deleted. Rendered
// line-through + opacity .5 and INERT like visualSpan (no Workshop click). Round-trips as literal
// ~~…~~ via document-builder nodeText/wrapToken. Owns ~~ (StarterKit's strike is disabled in the
// editor + schema so this is the single ~~ handler).
export const TrimSpan = Mark.create({
  name: 'trimSpan',
  inclusive: false,
  parseHTML() { return [{ tag: 'span[data-trim]' }]; },
  renderHTML() { return ['span', { 'data-trim': '', class: 'wp-trim' }, 0]; },
  addCommands() {
    return {
      setTrimSpan: () => ({ commands }) => commands.setMark('trimSpan'),
      unsetTrimSpan: () => ({ commands }) => commands.unsetMark('trimSpan'),
      toggleTrimSpan: () => ({ commands }) => commands.toggleMark('trimSpan'),
    };
  },
  // Live self-mark: ~~struck~~ wraps the moment the closing ~~ lands. The input rule replaces the
  // match with the captured group, stripping the literal ~~ (mirrors visualSpan stripping []),
  // exactly how document-builder stores loaded trims — so no double ~~~~ on a live-typed trim.
  addInputRules() { return [markInputRule({ find: /~~([^~]+)~~$/, type: this.type })]; },
  addPasteRules() { return [markPasteRule({ find: /~~([^~]+)~~/g, type: this.type })]; },
  // NO addProseMirrorPlugins: trims are deliberately INERT — they render struck and round-trip, but
  // a click does NOTHING.
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
// Canonical zero-padded HH:MM:SS:FF (matches parser.ts's TC + document-builder's TIMECODE_RE) — a
// manually-typed code must be in the same form the parser routes, or it'd chip but never become a SOT.
const TC_RE = /^\d{2}:\d{2}:\d{2}:\d{2}$/;

// Copy a timecode chip's code to the clipboard + flash + toast. Shared by the mouse (mousedown) and
// keyboard (Enter/Space on a focused chip) paths so both do EXACTLY the same primary action.
// PREMIERE PRO paste format = HH:MM:SS:FF. A 3-part broadcast code "00:04:30" must copy as
// "00:04:30:00" (append :00 frames); a 4-part "00:27:04:17" copies verbatim. This is a COPY-TIME
// transform only — it never touches the shared TC regex, the chip's stored data-tc, or the audit
// (which reads data-tc / textContent). The 4-part detection is byte-identical to TC_RE above.
function toPremiereTimecode(tc) {
  const raw = String(tc || '').trim();
  if (/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;   // 4-part → as-is
  if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw + ':00';  // 3-part → pad frames
  return raw;
}

function copyTimecodeChip(target) {
  const raw = target.getAttribute('data-tc') || target.textContent || '';
  if (!raw) return;
  const tc = toPremiereTimecode(raw);
  navigator.clipboard?.writeText(tc).catch(() => {});
  window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tc, tone: 'ok' } }));
  target.classList.add('copied');
  setTimeout(() => target.classList.remove('copied'), 700);
}

let openTcMenuEl = null;
let openTcReposition = null;   // ux-04 — re-pin on scroll/resize/layout-shift
let openTcKeydown = null;      // ux-02 — Escape-to-close + arrow nav
let openTcReturnFocus = null;  // restore focus to the chip on close
function closeTcMenu() {
  if (!openTcMenuEl) return;
  openTcMenuEl.remove();
  openTcMenuEl = null;
  document.removeEventListener('mousedown', onTcDocDown, true);
  if (openTcReposition) {
    window.removeEventListener('scroll', openTcReposition, true);
    window.removeEventListener('resize', openTcReposition);
    openTcReposition = null;
  }
  if (openTcKeydown) {
    document.removeEventListener('keydown', openTcKeydown, true);
    openTcKeydown = null;
  }
  const back = openTcReturnFocus; openTcReturnFocus = null;
  if (back && typeof back.focus === 'function') { try { back.focus(); } catch {} }
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
  const attrs = { tc: mark?.attrs.tc || '', day: mark?.attrs.day ?? null, seq: mark?.attrs.seq ?? null, ...patch };
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

// Does the live episode use the SEQUENCE picker (`sequencePicker` flag — Palau opts in)?
// The right-click menu becomes a SEQUENCE picker there (Burma keeps DAY).
function isPalauEpisode() {
  return episodeFlag('sequencePicker');
}

// Normalize a speaker/seq string to a single clean line (drop leading bullets, collapse whitespace)
// so the SOT speaker attr and a chip's stored seq attr dedupe to the SAME registry entry.
function cleanSeqLabel(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\u2022\u25cf\u2219-]+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

// A "real" sequence for the picker is EITHER a full interview slug (a date-coded name ending in a
// colon — "20260311-James Porter - Interview:", "260328-02-108- TARO-TINA:") OR a shoot-day string-out
// "DAY 1".."DAY 7". The parser leaves bare fragments lying around ("PORTER", "Expert", "20260311-James
// Porter" with no "- Interview:", a doubled "DAY 2") — those are NOT sequences and must not clutter
// the picker. Keep only the canonical forms.
const DAY_SEQ_RE = /^DAY\s*[1-7]$/i;
const FULL_INTERVIEW_RE = /^\d{6,}.*:$/;
function isRealSequence(label) {
  return DAY_SEQ_RE.test(label) || FULL_INTERVIEW_RE.test(label);
}

// Build a LIVE registry of every sequence in the doc for the Palau picker: the union of
// (a) every sot/broll block's speaker and (b) every timecode mark's seq attr. Deduped
// case-insensitively and filtered to real sequences only, in doc order.
function collectSequences(state) {
  const seen = new Set();   // case-insensitive dedupe key
  const out = [];
  const add = (raw) => {
    const label = cleanSeqLabel(raw);
    if (!label || !isRealSequence(label)) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };
  state.doc.descendants((node) => {
    const name = node.type?.name;
    if (name === 'sotBlock' || name === 'brollBlock') add(node.attrs?.speaker);
    if (node.isText) {
      for (const m of node.marks) if (m.type?.name === 'timecode' && m.attrs?.seq) add(m.attrs.seq);
    }
    return true;
  });
  return out;
}

function openTimecodeMenu(view, pos, anchorRect) {
  closeTcMenu();
  const found = timecodeMarkAt(view.state, pos);
  const curDay = found?.mark?.attrs.day ?? null;
  const curSeq = found?.mark?.attrs.seq ?? null;
  const curTc = found?.mark?.attrs.tc || '';
  const palau = isPalauEpisode();

  const menu = document.createElement('div');
  menu.className = 'wp-blockmenu wp-tcmenu';
  menu.setAttribute('contenteditable', 'false');
  menu.setAttribute('role', 'menu');

  const head = document.createElement('div');
  head.className = 'wp-bm-head';
  head.textContent = palau ? 'Sequence' : 'Shooting day';
  menu.appendChild(head);

  const addItem = (label, isCurrent, onPick) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'wp-bm-item' + (isCurrent ? ' is-current' : '');
    item.textContent = label;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(); closeTcMenu(); view.focus(); });
    makeItemKeyActivatable(item); // ux-02 — Enter/Space activates a focused item
    menu.appendChild(item);
  };

  if (palau) {
    // PALAU — SEQUENCE picker. Lists every sequence the doc knows (all interview speakers + all
    // DAY string-outs), marks the chip's current one, and offers a free-typed new name. Setting one
    // writes the chip's `seq` attr → onUpdate → autosave → survives reload (mirrors the DAY path).
    // The list scrolls when long (.wp-tcmenu max-height). Replaces the DAY 1/2/3 menu on Palau.
    const seqs = collectSequences(view.state);
    // Surface the current seq even if it somehow isn't in the scanned registry, so it's selectable.
    if (curSeq && !seqs.includes(cleanSeqLabel(curSeq))) seqs.unshift(cleanSeqLabel(curSeq));
    const curSeqLabel = curSeq ? cleanSeqLabel(curSeq) : null;
    seqs.forEach((sq) => addItem(sq, curSeqLabel === sq, () => patchTimecodeAt(view, pos, { seq: sq })));
    addItem('No sequence', curSeq == null, () => patchTimecodeAt(view, pos, { seq: null }));

    const sepNew = document.createElement('div'); sepNew.className = 'wp-bm-sep'; menu.appendChild(sepNew);
    const addNew = document.createElement('button');
    addNew.type = 'button';
    addNew.className = 'wp-bm-item';
    addNew.textContent = 'New sequence…';
    addNew.addEventListener('mousedown', (e) => {
      e.preventDefault();
      closeTcMenu();
      const name = cleanSeqLabel(window.prompt('Sequence name', curSeq || '') || '');
      if (name) patchTimecodeAt(view, pos, { seq: name });
      view.focus();
    });
    makeItemKeyActivatable(addNew);
    menu.appendChild(addNew);
  } else {
    (getEpisode()?.days || [1, 2, 3]).forEach((d) => addItem('DAY ' + d, curDay === d, () => patchTimecodeAt(view, pos, { day: d })));
    addItem('No day', curDay == null, () => patchTimecodeAt(view, pos, { day: null }));
  }

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
      // ux-01 — a REJECTED edit must NOT look like a success. The toast was hardcoded to a green
      // "COPIED" label, so a bad timecode read "COPIED — not a valid timecode" the moment Johnny made
      // a mistake. Send an explicit error tone; CopyToast renders an "INVALID" red state for it.
      window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone: 'error', msg: 'not a valid timecode (HH:MM:SS:FF)' } }));
      view.focus();
      return;
    }
    patchTimecodeAt(view, pos, { tc: next });
    view.focus();
  });
  makeItemKeyActivatable(edit); // ux-02 — keyboard-activatable
  menu.appendChild(edit);

  document.body.appendChild(menu);
  menu.style.position = 'fixed';
  // ux-04 — this menu used to position ONCE and never re-pin; if the doc scrolled (or a save banner
  // mounted at the top and pushed everything down) it floated detached from its chip. Re-pin to the
  // LIVE chip rect on scroll/resize, and close if the chip scrolls out of view.
  const place = () => {
    // Re-derive the chip's current rect each tick so layout shifts (banner mount, scroll) track it.
    const live = findTcChipRect(view, pos) || anchorRect;
    if (live.bottom < 0 || live.top > window.innerHeight) { closeTcMenu(); return; }
    menu.style.top = `${live.bottom + 4}px`;
    menu.style.left = `${live.left}px`;
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
    if (r.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, live.top - r.height - 4)}px`;
  };
  place();

  openTcMenuEl = menu;
  openTcReposition = place;
  openTcReturnFocus = (typeof document !== 'undefined') ? document.activeElement : null;
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  openTcKeydown = attachMenuKeynav(menu, closeTcMenu); // ux-02 — Escape + arrow nav
  setTimeout(() => document.addEventListener('mousedown', onTcDocDown, true), 0);
}

// ux-04 — find the LIVE bounding rect of the timecode chip covering `pos`, so the menu re-pins to it
// as the layout shifts. Falls back to null (caller uses the original anchorRect) if it can't resolve.
function findTcChipRect(view, pos) {
  try {
    const dom = view.nodeDOM ? view.nodeDOM(pos) : null;
    const node = (dom && dom.nodeType === 1 ? dom : (dom && dom.parentElement)) || null;
    const chip = node && node.closest ? node.closest('span.wp-tc-tag, span[data-tc]') : null;
    if (chip) return chip.getBoundingClientRect();
    // Fall back to the coords of the position itself.
    const c = view.coordsAtPos(pos);
    return { left: c.left, top: c.top, bottom: c.bottom, right: c.left };
  } catch { return null; }
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
        parseHTML: (el) => el.getAttribute('data-tc') || (el.textContent || '').match(/\d{2}:\d{2}:\d{2}:\d{2}/)?.[0] || '',
        renderHTML: (attrs) => (attrs.tc ? { 'data-tc': attrs.tc } : {}),
      },
      // The running DAY this timecode belongs to (1|2|3 or null). Folded into the chip at
      // BUILD time from the surrounding contextDay / block day (#2). When known the chip reads
      // "DAY N · HH:MM:SS:FF" with the DAY prominent; when null it shows just the timecode
      // (NEVER "DAY null"). Preserved through parse/serialize so it round-trips.
      day: {
        default: null,
        // Normalize to a clean integer on BOTH parse and render. Some Palau blocks stored the day as
        // the string "DAY 4" (not the number 4), and an already-saved doc can carry that verbatim in a
        // mark's attrs; a legacy Number("DAY 4") also yields NaN. Since the Palau chip now DISPLAYS
        // "DAY N · " from data-day (CSS attr()), a dirty value would read "DAY DAY 4"/"DAY NaN". Pulling
        // the digits here keeps data-day a bare integer for every doc — fresh or cached — at render
        // time. Burma days are already integers (1|2|3), so this is byte-identical there.
        parseHTML: (el) => {
          const d = el.getAttribute('data-day');
          const n = d ? d.match(/\d+/)?.[0] : null;
          return n != null ? Number(n) : null;
        },
        renderHTML: (attrs) => {
          if (attrs.day == null) return {};
          const n = String(attrs.day).match(/\d+/)?.[0];
          return n != null ? { 'data-day': n } : {};
        },
      },
      // The SEQUENCE this timecode belongs to — an interview/sequence NAME string
      // ("20260311-James Porter - Interview:") for a named SOT, or a "DAY N" string-out label for a
      // loose day-based SOT. Derived at BUILD time from the block's speaker/day context in
      // document-builder (the same running context that sets `day`). On Palau the chip DISPLAYS only
      // the bare code; the seq rides in data-seq purely for the right-click SEQUENCE picker + context.
      // Burma never sets it (default null → no data-seq → chip HTML + integrity audit byte-unchanged).
      // migrate-doc's buildSchema imports BURMA_MARKS, so this attr flows into the read-back schema in
      // lockstep automatically; default null keeps every already-saved doc round-tripping untouched.
      seq: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-seq') || null,
        renderHTML: (attrs) => (attrs.seq ? { 'data-seq': attrs.seq } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-tc]' }]; },
  renderHTML({ HTMLAttributes }) {
    // The chip's VISIBLE text is supplied by CSS (::before = "DAY N · " when data-day is set);
    // the editable text node it wraps is the bare timecode, so the body prose still reads the
    // raw HH:MM:SS:FF and the audit counts it on-page. data-day drives the DAY prefix display.
    // L6 — copying a timecode is the editor's PRIMARY action; it was mouse-only (tabindex -1, no key
    // handler). The chip is now keyboard-focusable (tabindex 0) and Enter/Space copies it (handled in
    // the plugin keydown below), so a keyboard user can copy a timecode. aria-label spells the action.
    return ['span', { ...HTMLAttributes, class: 'wp-tc-tag', title: 'copy timecode · right-click to tag sequence', role: 'button', 'aria-label': 'copy timecode', tabindex: '0' }, 0];
  },
  addCommands() {
    return {
      setTimecode: (attrs) => ({ commands }) => commands.setMark('timecode', attrs),
      unsetTimecode: () => ({ commands }) => commands.unsetMark('timecode'),
    };
  },
  // Live self-mark: a timecode typed into the prose chips itself the moment it's complete —
  // even when GLUED to a letter/@/bracket/punct with no leading space. TRULY MIRRORS parser.ts's TC
  // and document-builder.js's TIMECODE_RE: the hour is EXACTLY two digits (\d{2}, zero-padded
  // broadcast form), a non-\b detector with a lookbehind rejecting a longer numeric run and a
  // lookahead rejecting a 5th :FF field. So "ON CAM02:17:09:07" and "03:49:59:08@" chip correctly.
  // The hour was \d{1,2} here — broader than the parser's \d{2} — so a single-digit-hour code
  // ("2:02:01:07") self-chipped in the editor but never routed as a SOT in the parser. \d{2} closes
  // that divergence; the three sites (parser TC, builder TIMECODE_RE, these rules) now agree.
  addInputRules() {
    return [markInputRule({ find: /((?<!\d)(?<!\d:)\d{2}:\d{2}:\d{2}:\d{2}(?!:?\d))$/, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /((?<!\d)(?<!\d:)\d{2}:\d{2}:\d{2}:\d{2}(?!:?\d))/g, type: this.type })];
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
            copyTimecodeChip(target);
            return true;
          },
          // L6 — keyboard copy: when a timecode chip is focused, Enter or Space copies it (the same
          // primary action as a click). Other keys pass through so the chip text stays editable.
          keydown: (view, event) => {
            if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return false;
            const active = document.activeElement;
            const target = active && active.closest && active.closest('span.wp-tc-tag, span[data-tc]');
            if (!target) return false;
            event.preventDefault();
            copyTimecodeChip(target);
            return true;
          },
          contextmenu: (view, event) => {
            // READ-ONLY SHARE: the right-click DAY menu mutates the doc (sets the shooting day),
            // which a reader must never do. Let the browser's native menu through, change nothing.
            if (isReadOnly()) return false;
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

export const BURMA_MARKS = [TkSpan, FactCheckSpan, VisualSpan, TimecodeMark, TrimSpan];
