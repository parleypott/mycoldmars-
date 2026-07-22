// Burma Script Tool — custom ProseMirror NODES, one per block type.
// CARTRIDGES direction (WP-01 fig.03): every block renders as a tactile hardware
// CARTRIDGE — a flat outlined module (border 1.5px #1f1d18, radius 11px, NO shadow)
// with a 30px left SPINE (knurled repeating-gradient texture + a numbered cap in the
// block's KIND COLOUR + a ⠿ drag grip) and a BODY. Each NodeView OWNS its chrome and
// dispatches real ProseMirror transactions — the grip is PM's native drag handle, the
// controls (REC toggle, done-tick, copy) dispatch setNodeMarkup / clipboard writes.
//
// DESIGN LAW: FLAT. No drop shadow, no bevel, no gradients-as-shadow. The knurl is a
// flat repeating-linear-gradient texture and is the only gradient allowed.

import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection as PMTextSelection } from '@tiptap/pm/state';
import { isReadOnly } from '../read-mode.js';
import { getEpisode, episodeFlag } from '../episode-config.js';
import { attachMenuKeynav, makeItemKeyActivatable } from './menu-kbd.js';
import { blockHeadControlWritable } from './block-write-guard.js';
import { DirectionChip, DirectionBreak } from './direction-chip.js';
import { FcFootnote } from './footnote.js';
// Paste-placeholder session state (image-drop.js owns the upload lifecycle). blocks.js does not
// import anything back into image-drop.js, so there is no cycle. In a non-collab / headless mount
// these resolve to their safe defaults (no active upload, no retryable bytes).
import {
  mediaUploadIsActive, mediaUploadCanRetry, mediaUploadLabel,
  retryMediaUpload, removeMediaBlock, MEDIA_PROGRESS_EVENT,
} from './image-drop.js';

// WP-13 — reconstruction data lives in ATTRIBUTES, never in derived/decoration state, so a block
// carries everything it needs to rebuild itself through a JSON (and clipboard) round-trip.
//   • blockId   — stable identity. Deliberately has NO parseHTML: a clipboard paste of a copied
//                 block must NOT resurrect a duplicate id (integrity-check asserts ids are unique);
//                 JSON persistence (localStorage/cloud) is the identity home, paste mints a fresh id.
//   • flavor    — per-block accent (episode `flavors`), round-trips via data-flavor.
//   • chapterId — stable chapter membership. Today the chapter RUN is derived at render time by the
//                 ChapterFrames decoration (chapter-frames.js); this attribute is the forward-compat
//                 slot rec #23 asks for so a future flat-plus-attribute chapter model (rec #10) — or a
//                 CRDT/merge layer — has a stable key to write to. Default null (unpopulated today),
//                 round-trips via data-chapter-id, and is provably additive (existing docs get null).
//   • pendingViz — the /pending "PENDING VISUAL PLAN" flag: true = this cell's material has no
//                 visual plan yet (styles.css paints the whole host cell alert red via :has()).
//                 Cleared ONLY by explicit action (re-running /pending, deleting the content, or
//                 running a visual slash command — slash-menu.js PENDING_CLEARING_KINDS). Default
//                 null (additive), round-trips via data-pending-viz.
const baseAttrs = () => ({ blockId: { default: null }, flavor: { default: null }, chapterId: { default: null }, pendingViz: { default: null } });

// WP-09 — EXPLICIT marks allowlist per block node, replacing ProseMirror's allow-all default. The
// live schema registers the five Burma spans + StarterKit bold/italic/link (v3 StarterKit ships a
// link mark; Cmd+K applies it — see link-kbd.js), so this list is COMPLETE — nothing a saved doc
// already carries is ever dropped (zero-loss). It is the
// lossless-paste BACKSTOP behind transformPastedHTML (paste-sanitize.js): ProseMirror silently
// conforms nonconforming content to the schema, so anything a paste smuggles past the sanitizer that
// isn't one of these gets dropped rather than corrupting the block. Kept identical across every
// script block so the rack is uniform. (Editor.jsx + migrate-doc.js both import these nodes, so the
// allowlist stays in lockstep automatically — no second edit site to drift.)
const MARKS_ALLOWLIST = 'timecode tkSpan factCheckSpan visualSpan trimSpan bold italic link';

// chapter genre → ACT tag shown top-right of a chapter cartridge body.
const ACT_TAG_FALLBACK = { coldopen: 'HISTORY', history: 'HISTORY', ground: 'GROUND', inquiry: 'GROUND', latm: 'GROUND', other: '' };
const ACT_TAG = (() => {
  const map = { ...ACT_TAG_FALLBACK };
  const genres = getEpisode()?.genres;
  if (!Array.isArray(genres)) return map;
  for (const genre of genres) {
    if (!genre?.id) continue;
    map[genre.id] = genre.label || '';
  }
  return map;
})();

// ---------------------------------------------------------------------------
// NodeView toolkit. A NodeView returns { dom, contentDOM } where `dom` is the whole
// cartridge and `contentDOM` is the editable hole ProseMirror fills. We build the spine
// + chrome with plain DOM, mark the grip draggable so PM's drag machinery moves the
// whole node, and wire control buttons to transactions via the editor instance.
// ---------------------------------------------------------------------------

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function maybeDataAttr(attrs, name, value) {
  if (value === undefined || value === null || value === '') return attrs;
  return { ...attrs, [name]: value };
}

function syncNullableAttr(dom, name, value) {
  if (value === undefined || value === null || value === '') dom.removeAttribute(name);
  else dom.setAttribute(name, value);
}

function syncSharedDomAttrs(dom, attrs) {
  syncNullableAttr(dom, 'data-flavor', attrs?.flavor);
  syncNullableAttr(dom, 'data-chapter-id', attrs?.chapterId);
  // '1' when pending, attribute ABSENT when not — the CSS keys on bare [data-pending-viz]
  // presence, and syncing here means a remote y-sync stamp/clear repaints without a rebuild.
  syncNullableAttr(dom, 'data-pending-viz', attrs?.pendingViz ? '1' : null);
}

function appendIfChildren(head, child) {
  if (child && child.childNodes.length) head.push(child);
}

function sharedRenderAttrs(node, attrs) {
  let out = maybeDataAttr(attrs, 'data-flavor', node.attrs.flavor);
  out = maybeDataAttr(out, 'data-chapter-id', node.attrs.chapterId);
  out = maybeDataAttr(out, 'data-pending-viz', node.attrs.pendingViz ? '1' : null);
  return out;
}

function isPalauChromeEnabled() {
  return episodeFlag('chipChrome');
}

export function timecodeLabel(attrs) {
  const tc = attrs?.timecode;
  if (tc && typeof tc === 'object') return tc.tc || '';
  return tc || attrs?.rawTimecode || '';
}

function collapseTagWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function dedupeRepeatedSpeaker(text) {
  const clean = collapseTagWhitespace(text);
  const parts = clean.split(' ');
  const canon = (value) => collapseTagWhitespace(value).replace(/[:;,.]+$/g, '').toUpperCase();
  for (let size = Math.floor(parts.length / 2); size >= 1; size -= 1) {
    const left = parts.slice(0, size).join(' ');
    const right = parts.slice(size).join(' ');
    if (canon(left) && canon(left) === canon(right)) return right;
  }
  return clean;
}

function sequenceSpeakerLabel(attrs) {
  const raw = String(attrs?.speaker || '');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => collapseTagWhitespace(line.replace(/^[\s●•-]+/, '')))
    .filter(Boolean);
  const speaker = lines.length ? lines[lines.length - 1] : raw;
  return dedupeRepeatedSpeaker(speaker);
}

// The sequence tag copies a REAL timecode only. timecodeLabel()'s rawTimecode fallback is the
// first 200 chars of the raw SOT body (stored as timecode.raw by build-blocks.mjs), so a SOT with
// NO parsed timecode fell back to its own body text — rendering "SPEAKER <whole quote>" beside the
// speaker, which read as a doubled/mangled tag ("Expert Expert: “calcium…”"). The clean fix: the tag
// (and its show-gate) key off the parsed `timecode` attr ONLY; a timecode-less SOT shows no tag.
export function sequenceTimecode(attrs) {
  const tc = attrs?.timecode;
  if (tc && typeof tc === 'object') return collapseTagWhitespace(tc.tc || '');
  return collapseTagWhitespace(tc || '');
}

export function sequenceTagText(attrs) {
  const tc = sequenceTimecode(attrs);
  if (!tc) return '';
  return [sequenceSpeakerLabel(attrs), tc].filter(Boolean).join(' ').trim();
}

// The SPINE: a 30px left rail. Knurled texture (CSS), a numbered cap (CSS counter colours
// per kind), and the ⠿ drag grip. The grip is PM's native drag handle (data-drag-handle +
// draggable) — a plain click opens the block menu (change type / delete); a drag reorders.
function makeSpine(editor, getPos) {
  const spine = el('div', 'wp-spine', { contenteditable: 'false' });

  // numbered cap — the two-digit index is painted by a CSS counter (::before) so it
  // tracks reorder/insert without us threading an index through the NodeView.
  const cap = el('div', 'wp-cap-num');

  // ⠿ grip — the real drag handle. A plain click opens the block menu (change type /
  // insert below / delete); a drag reorders. The spine stays clean (just the grip glyph).
  // L6/ux-02 — the grip is the ONLY route to the block menu (turn-into / insert / delete), the most-
  // used structural action on a 225-block doc. It was tabindex=-1 (mouse-only). In edit mode it is
  // now keyboard-focusable (tabindex 0) and opens the menu on Enter/Space, so a keyboard user can
  // change a block's type without a mouse. (Read-only hides the grip in CSS, so keep it out of the
  // tab order there.) aria-haspopup advertises the menu to assistive tech.
  const grip = el('button', 'wp-grip', {
    type: 'button', contenteditable: 'false', 'data-drag-handle': '', draggable: 'true',
    title: 'Drag to move · click or Enter for menu', 'aria-label': 'Move or open block menu',
    'aria-haspopup': 'menu', tabindex: isReadOnly() ? '-1' : '0',
  });
  grip.textContent = '⠿';
  let dragged = false;
  grip.addEventListener('dragstart', () => { dragged = true; });
  grip.addEventListener('mousedown', () => { dragged = false; });
  grip.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (dragged) { dragged = false; return; }
    // READ-ONLY SHARE: the block menu (change type / insert / delete) is edit-only. CSS also hides
    // the grip in read-only, but gate the handler too so no mutation menu can ever open for a reader.
    if (isReadOnly()) return;
    openBlockMenu(editor, getPos, grip);
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault(); e.stopPropagation();
    if (isReadOnly()) return;
    openBlockMenu(editor, getPos, grip);
  });

  spine.appendChild(cap);
  spine.appendChild(grip);
  return spine;
}

// Insert a fresh block below `getPos`. New blocks are BORN as a `none` block — a chrome-less
// editable line with a faint "pick a type" hint — until the writer opens the grip menu and
// chooses a real type (or just starts writing).
function insertBlockBelow(editor, getPos) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (typeof pos !== 'number') return;
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const after = pos + node.nodeSize;
  const fresh = state.schema.nodes.noneBlock.createAndFill({ blockId: 'blk_' + Math.random().toString(36).slice(2, 9) });
  if (!fresh) return;
  let tr = state.tr.insert(after, fresh);
  try {
    const Selection = state.selection.constructor;
    tr = tr.setSelection(Selection.near(tr.doc.resolve(after + 2)));
  } catch {}
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

// Change a block's TYPE in place — preserves its editable content + blockId + hero datum.
// COLLAPSED PICKER (#3): the old per-type menu (SOT / B-roll / On camera / Bin) is gone —
// they all render as ONE generic "DIRECTION" block now, so the writer only ever picks between
// Chapter / Direction / VO / Scene / Note. "Direction" maps to oncamBlock (the neutral
// direction node with no hero-timecode attrs to lose). The sot/broll/bin node types stay
// REGISTERED in the schema (Johnny's saved doc + the migration still use them); they simply
// share the unified DIRECTION NodeView, and a writer turning a block INTO a direction lands on
// oncamBlock.
const TYPE_MENU = [
  ['chapterBlock', 'CHAPTER'],
  ['voBlock', 'VO — narration'],
  ['montageBlock', 'Montage'],
  ['oncamBlock', 'Direction'],
  ['sceneBlock', 'Scene heading'],
  ['noteBlock', 'Note'],
];
// Structured attrs that carry real producer DATA (not just rendering state) — if the SOURCE block
// has any of these populated but the TARGET node spec can't hold them, the conversion DROPS them
// (changeBlockType only copies attrs present on the target spec). For a SOT, that silently strips
// the structured timecode/speaker/done AND removes the quote from the translation worklist
// (buildWorklists filters strictly on type==='sot'). So a single misclick on a SOT quietly erases
// it from the producer handoff. We surface that as a confirm rather than corrupting silently.
const STRUCTURED_DATA_ATTRS = ['timecode', 'tcOut', 'speaker', 'done', 'rawTimecode'];
function attrHasData(v) { return v !== undefined && v !== null && v !== '' && v !== false; }

// Pure: which STRUCTURED data attrs the SOURCE carries would be DROPPED converting to a node whose
// spec attrs are `targetSpecAttrs`. Exported so the data-loss guard is unit-testable headless.
export function attrsDroppedOnTypeChange(sourceAttrs, targetSpecAttrs) {
  const specAttrs = targetSpecAttrs || {};
  return STRUCTURED_DATA_ATTRS.filter(
    (k) => attrHasData((sourceAttrs || {})[k]) && !(k in specAttrs),
  );
}

function changeBlockType(editor, getPos, typeName) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (typeof pos !== 'number') return;
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const target = state.schema.nodes[typeName];
  if (!target) return;
  const specAttrs = target.spec.attrs || {};

  // RT-06 — DATA-LOSS GUARD on the type change. Find structured attrs the SOURCE carries that the
  // TARGET can't hold; those will be dropped. If any are populated, confirm before proceeding so a
  // misclick can't silently strip a SOT's timecode/speaker (and drop it from the worklist).
  const dropping = attrsDroppedOnTypeChange(node.attrs, specAttrs);
  if (dropping.length) {
    const tc = node.attrs.timecode ? ` (timecode ${node.attrs.timecode}${node.attrs.speaker ? `, ${node.attrs.speaker}` : ''})` : '';
    const confirmFn = (typeof window !== 'undefined' && window.confirm) ? window.confirm.bind(window) : () => true;
    const okToDrop = confirmFn(
      `This block carries structured data${tc} that "${typeName === 'oncamBlock' ? 'Direction' : typeName}" can't hold — ` +
      `changing its type will drop the ${dropping.join(', ')} and remove it from the translation worklist. Continue?`,
    );
    if (!okToDrop) return; // keep the SOT intact
  }

  const defaults = {};
  for (const k in specAttrs) defaults[k] = specAttrs[k].default ?? null;
  const next = { ...defaults, blockId: node.attrs.blockId };
  for (const k in specAttrs) {
    if (k === 'blockId') continue;
    const v = node.attrs[k];
    if (v !== undefined && v !== null && v !== '') next[k] = v;
  }
  view.dispatch(state.tr.setNodeMarkup(pos, target, next));
}

// SCROLL-SNAP-ON-DELETE FIX (#6). Deleting a block/row at the TOP of the doc used to snap the
// viewport DOWN to the prior edit spot: the transaction carried .scrollIntoView(), which scrolls
// the doc so the NEW selection (which PM places near where content was, i.e. the previous edit
// position) is in view. The user is acting at the top; the viewport should STAY at the top.
// Fix: never .scrollIntoView() on a delete, and pin window.scrollY across the dispatch +
// focus() (focus() alone can also nudge the scroll). The page scrolls on window (.wp-page has
// no overflow container), so window.scrollY is the source of truth.
function deleteBlock(editor, getPos) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (typeof pos !== 'number') return;
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  if (state.doc.childCount <= 1) return;
  const savedY = window.scrollY;
  // NO .scrollIntoView() — that's what snapped the viewport to the old edit spot.
  // ux-08 — set an EXPLICIT caret after the delete so it lands predictably, mirroring
  // insertBlockBelow's Selection.near pattern. Before this, view.focus() let PM map the caret to
  // wherever its position-mapping landed — often silently inside an unrelated neighbour, which is
  // disorienting (especially for a dyslexic user). Place it at the START of the block now occupying
  // the deleted slot (`pos`), or — if we deleted the LAST block — just before what's there now.
  let tr = state.tr.delete(pos, pos + node.nodeSize);
  try {
    const Selection = state.selection.constructor;
    const target = Math.min(pos, Math.max(0, tr.doc.content.size - 1));
    tr = tr.setSelection(Selection.near(tr.doc.resolve(target), pos >= tr.doc.content.size ? -1 : 1));
  } catch {}
  view.dispatch(tr);
  // Restore the viewport: focus() and PM's selection sync can both nudge scroll; pin it now and
  // again on the next frame (after layout settles) so the user stays exactly where they acted.
  view.focus();
  window.scrollTo(window.scrollX, savedY);
  requestAnimationFrame(() => window.scrollTo(window.scrollX, savedY));
}

// A tiny floating menu anchored to the grip. Plain DOM (NodeView-owned), one open at a
// time. Insert-below + change-type list + delete.
let openMenuEl = null;
let openMenuReposition = null;
let openMenuKeydown = null;
let openMenuReturnFocus = null;
function closeBlockMenu() {
  if (!openMenuEl) return;
  openMenuEl.remove(); openMenuEl = null;
  document.removeEventListener('mousedown', onDocDown, true);
  if (openMenuReposition) {
    window.removeEventListener('scroll', openMenuReposition, true);
    window.removeEventListener('resize', openMenuReposition);
    openMenuReposition = null;
  }
  if (openMenuKeydown) {
    document.removeEventListener('keydown', openMenuKeydown, true);
    openMenuKeydown = null;
  }
  // L6/ux-02 — return focus to the grip that opened the menu so keyboard focus isn't stranded.
  const back = openMenuReturnFocus; openMenuReturnFocus = null;
  if (back && typeof back.focus === 'function') { try { back.focus(); } catch {} }
}
function onDocDown(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeBlockMenu(); }
function openBlockMenu(editor, getPos, anchor) {
  closeBlockMenu();
  const menu = el('div', 'wp-blockmenu', { contenteditable: 'false' });
  const curPos = typeof getPos === 'function' ? getPos() : getPos;
  const curNode = editor.state.doc.nodeAt(curPos);
  const curType = curNode?.type.name;

  menu.setAttribute('role', 'menu');
  const head = el('div', 'wp-bm-head'); head.textContent = 'Turn into';
  menu.appendChild(head);
  TYPE_MENU.forEach(([name, label]) => {
    const item = el('button', 'wp-bm-item' + (name === curType ? ' is-current' : ''), { type: 'button' });
    item.textContent = label;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); changeBlockType(editor, getPos, name); closeBlockMenu(); });
    makeItemKeyActivatable(item);
    menu.appendChild(item);
  });
  const flavors = Array.isArray(getEpisode()?.flavors) ? getEpisode().flavors.filter((f) => f?.id) : [];
  if (flavors.length) {
    const flavorSep = el('div', 'wp-bm-sep'); menu.appendChild(flavorSep);
    const flavorHead = el('div', 'wp-bm-head'); flavorHead.textContent = 'Flavor ▸';
    menu.appendChild(flavorHead);
    flavors.forEach((flavor) => {
      const item = el('button', 'wp-bm-item', { type: 'button' });
      item.textContent = flavor.label || flavor.id;
      item.addEventListener('mousedown', (e) => { e.preventDefault(); setAttr(editor, getPos, { flavor: flavor.id }); closeBlockMenu(); });
      makeItemKeyActivatable(item);
      menu.appendChild(item);
    });
  }
  const sep = el('div', 'wp-bm-sep'); menu.appendChild(sep);
  const ins = el('button', 'wp-bm-item', { type: 'button' });
  ins.textContent = 'Insert block below';
  ins.addEventListener('mousedown', (e) => { e.preventDefault(); insertBlockBelow(editor, getPos); closeBlockMenu(); });
  makeItemKeyActivatable(ins);
  menu.appendChild(ins);
  const del = el('button', 'wp-bm-item wp-bm-del', { type: 'button' });
  del.textContent = 'Delete block';
  del.addEventListener('mousedown', (e) => { e.preventDefault(); deleteBlock(editor, getPos); closeBlockMenu(); });
  makeItemKeyActivatable(del);
  menu.appendChild(del);

  document.body.appendChild(menu);
  menu.style.position = 'fixed';
  // ux-04 — also re-pin while the doc layout shifts under the menu (e.g. the red SAVE-FAILED banner
  // mounting at the top pushes everything down ~40px). We listen on capture-phase scroll + resize AND
  // observe the body's size; if the anchor leaves the viewport the menu closes rather than detaching.
  const place = () => {
    const r = anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { closeBlockMenu(); return; }
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${r.left}px`;
  };
  place();
  openMenuEl = menu;
  openMenuReposition = place;
  openMenuReturnFocus = anchor;
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  openMenuKeydown = attachMenuKeynav(menu, closeBlockMenu);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}

// Position the node, then dispatch a markup change to its attrs.
// READ MODE (audit 2026-07-07): every NodeView attr control (done tick, REC cycle, …) funnels
// through here, and NodeView handlers dispatch straight past the editable flag — so the live
// `view.editable` check has to live at this choke point.
function setAttr(editor, getPos, patch) {
  if (!editor.view.editable) return;
  const pos = getPos();
  if (typeof pos !== 'number') return;
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  view.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }));
}

// Shared cartridge shell: [spine][ ...head/body ]. `headChildren` are non-editable chrome
// rows prepended inside the body before the editable contentDOM (the REC row, the kind
// label). The editable hole is always `.wp-body`.
function cartridge({ blockClass, dataAttr, node, editor, getPos, headChildren, bodyClass }) {
  const dom = el('div', 'wp-cart ' + blockClass);
  dom.setAttribute(dataAttr, '');
  if (node.attrs.blockId) dom.setAttribute('data-block-id', node.attrs.blockId);
  syncSharedDomAttrs(dom, node.attrs);

  dom.appendChild(makeSpine(editor, getPos));

  const body = el('div', 'wp-cart-body' + (bodyClass ? ' ' + bodyClass : ''));
  (headChildren || []).forEach((c) => body.appendChild(c));
  const prose = el('div', 'wp-body');
  body.appendChild(prose);
  dom.appendChild(body);

  return { dom, contentDOM: prose, body };
}

// ---------------------------------------------------------------------------
// UNIFIED DIRECTION NodeView (#3). sot / broll / oncam / bin all collapse into ONE generic
// "DIRECTION" cartridge — SAME flat chrome, NO type-specific badge/colour, NO hero timecode and
// NO recessed LCD (#1). Timecodes appear ONLY as inline chips in the body prose (the body routes
// through inlineContent which tags every one). The node TYPES stay registered + keep their attrs
// (day/timecode/speaker/done/scaffold) so the saved doc + migration still round-trip — we simply
// render them identically. A `done` toggle is shown only when the node carries a `done` attr
// (sot/broll), rendered the same flat tick used before, with no colour distinction.
function directionNodeView({ node, editor, getPos }) {
  const a = node.attrs;
  const hasDone = Object.prototype.hasOwnProperty.call(node.type.spec.attrs || {}, 'done');
  const isPalauChrome = isPalauChromeEnabled();
  const isPalauSot = isPalauChrome && node.type.name === 'sotBlock';
  // PALAU (#2): the SOT's sequence NAME now renders bold INLINE at the head of the body prose
  // (document-builder.boldSequenceName) so it flows right before the timecodes + quote on the same
  // line, instead of sitting in a separate stacked chrome row. So the head seq-tag is retired — the
  // name is no longer its own paragraph. (The machinery below stays dormant behind this flag.)
  const showSequenceTag = false;

  const head = el('div', 'wp-dir-head', { contenteditable: 'false' });
  if (!isPalauChrome) {
    head.appendChild(Object.assign(el('span', 'wp-dir-kind'), { textContent: 'DIRECTION' }));
  }

  let seqTag = null;
  let seqTagTimer = null;
  let cleanupSequenceTag = null;
  const paintSequenceTag = (attrs) => {
    if (!seqTag) return;
    // JUST the sequence name (speaker) — the timecodes are the bracketed body chips, shown once here.
    const text = sequenceSpeakerLabel(attrs);
    seqTag.textContent = text;
    seqTag.hidden = !text;
    seqTag.setAttribute('aria-label', text ? `copy sequence name ${text}` : 'copy sequence name');
  };
  if (showSequenceTag) {
    seqTag = el('button', 'wp-seq-tag', {
      type: 'button',
      contenteditable: 'false',
      title: 'Copy sequence name',
    });
    const copySequenceTag = () => {
      const cur = editor.state.doc.nodeAt(getPos());
      const text = sequenceSpeakerLabel(cur?.attrs || a);
      if (!text) return;
      navigator.clipboard?.writeText(text).catch(() => {});
      seqTag.classList.remove('is-copied');
      void seqTag.offsetWidth;
      seqTag.classList.add('is-copied');
      if (seqTagTimer) clearTimeout(seqTagTimer);
      seqTagTimer = setTimeout(() => {
        seqTagTimer = null;
        seqTag?.classList.remove('is-copied');
      }, 900);
    };
    seqTag.addEventListener('click', copySequenceTag);
    paintSequenceTag(a);
    head.appendChild(seqTag);
    cleanupSequenceTag = () => {
      seqTag.removeEventListener('click', copySequenceTag);
      if (seqTagTimer) clearTimeout(seqTagTimer);
      seqTagTimer = null;
    };
  }

  let done = null;
  if (hasDone) {
    // L6/L8 — the mark-done tick is a real interactive control; make it keyboard-focusable
    // (tabindex 0, read-only excluded) with aria-pressed reflecting state, and activate on Enter/Space.
    done = el('button', 'wp-done' + (a.done ? ' is-done' : ''), {
      type: 'button', contenteditable: 'false', title: 'mark done', 'aria-label': 'mark done',
      'aria-pressed': a.done ? 'true' : 'false', tabindex: isReadOnly() ? '-1' : '0',
    });
    done.textContent = '✓';
    const toggleDone = () => {
      // READ MODE / share: a done toggle is a doc write — refuse it in code, not by CSS alone
      // (the keyboard path fires past `editable:false`). Mirrors the direction-chip guard.
      if (!blockHeadControlWritable({ readOnly: isReadOnly(), editable: editor.view.editable })) return;
      const cur = editor.state.doc.nodeAt(getPos());
      setAttr(editor, getPos, { done: !cur?.attrs.done });
    };
    done.addEventListener('mousedown', (e) => { e.preventDefault(); toggleDone(); });
    done.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggleDone(); }
    });
    head.appendChild(done);
  }

  const headChildren = [];
  appendIfChildren(headChildren, head);
  const view = cartridge({ blockClass: 'wp-dir', dataAttr: 'data-direction', node, editor, getPos, headChildren });
  if (isPalauSot) {
    view.dom.classList.add('wp-sot-cart');
    view.dom.setAttribute('data-sot-signature', '1');
  }
  if (hasDone) view.dom.setAttribute('data-done', a.done ? '1' : '0');
  return {
    ...view,
    update(updated) {
      if (updated.type.name !== node.type.name) return false;
      paintSequenceTag(updated.attrs);
      if (hasDone) {
        view.dom.classList.toggle('is-done', !!updated.attrs.done);
        view.dom.setAttribute('data-done', updated.attrs.done ? '1' : '0');
        if (done) { done.classList.toggle('is-done', !!updated.attrs.done); done.setAttribute('aria-pressed', updated.attrs.done ? 'true' : 'false'); }
      }
      syncSharedDomAttrs(view.dom, updated.attrs);
      return true;
    },
    destroy() {
      cleanupSequenceTag?.();
    },
  };
}

// --- CHAPTER — inverted dark cartridge, ivory cap, ACT tag ---
export const ChapterBlock = Node.create({
  name: 'chapterBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  marks: MARKS_ALLOWLIST,
  defining: true,
  draggable: true,
  addAttributes() {
    return { ...baseAttrs(), genre: { default: 'other' } };
  },
  parseHTML() { return [{ tag: 'section[data-chapter]' }]; },
  renderHTML({ node }) {
    return ['section', mergeAttributes(sharedRenderAttrs(node, {
      'data-chapter': '', 'data-genre': node.attrs.genre || 'other',
      'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-chapter',
    })), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const head = el('div', 'wp-ch-head', { contenteditable: 'false' });
      // Kind label reads "CH" (the act semantic is still carried by the genre tag on the right,
      // e.g. HISTORY/GROUND). Keeping it to a bare "CH" places it immediately before the act
      // heading in the reading order so the chapter line reads contiguously — and the
      // integrity audit sees the original "CH: HISTORY 1 …" line as present on the page.
      const kind = Object.assign(el('span', 'wp-ch-kind'), { textContent: 'CH' });
      head.appendChild(kind);
      // CHAPTER FOCUS (Johnny: "next to each chapter i want an icon that brings me into an
      // isolated full screen"). The ⛶ dispatches `wp-chapter-focus` with this chapter's
      // blockId; main.jsx flips the page into focus dress and the chapter-focus plugin hides
      // every other chapter's rows. Pure event dispatch — no transaction, so it is safe in
      // every session (collab, read mode, `?read` shares — focusing is a reading gesture too).
      const focusBtn = el('button', 'wp-ch-focus', {
        type: 'button', contenteditable: 'false',
        title: 'Work on this chapter full screen', 'aria-label': 'open chapter full screen',
      });
      focusBtn.textContent = '⛶';
      const fireFocus = () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        const cur = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
        const id = cur?.attrs?.blockId || node.attrs?.blockId;
        if (id) window.dispatchEvent(new CustomEvent('wp-chapter-focus', { detail: { id } }));
      };
      focusBtn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        fireFocus();
      });
      // Keyboard path (audit: mousedown-only made a focusable button dead to Enter/Space).
      focusBtn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        e.preventDefault();
        e.stopPropagation();
        fireFocus();
      });
      head.appendChild(focusBtn);
      const tag = Object.assign(el('span', 'wp-ch-tag'), { textContent: ACT_TAG[node.attrs.genre || 'other'] || '' });
      const view = cartridge({ blockClass: 'wp-chapter', dataAttr: 'data-chapter', node, editor, getPos, headChildren: [head] });
      // Place the genre ACT tag AFTER the editable content in DOM/reading order (it's pinned
      // top-right visually via CSS) so it doesn't split "CH" from the act heading — keeps the
      // chapter line contiguous ("CH HISTORY 1 …") for the integrity audit + the reading flow.
      view.body.appendChild(tag);
      view.dom.setAttribute('data-genre', node.attrs.genre || 'other');
      return {
        ...view,
        update(updated) {
          if (updated.type.name !== 'chapterBlock') return false;
          tag.textContent = ACT_TAG[updated.attrs.genre || 'other'] || '';
          view.dom.setAttribute('data-genre', updated.attrs.genre || 'other');
          syncSharedDomAttrs(view.dom, updated.attrs);
          return true;
        },
      };
    };
  },
});

// --- SCENE — light cartridge, kind cap, sub-heading ---
export const SceneBlock = Node.create({
  name: 'sceneBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  marks: MARKS_ALLOWLIST,
  defining: true,
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'section[data-scene]' }]; },
  renderHTML({ node }) {
    return ['section', mergeAttributes(sharedRenderAttrs(node, {
      'data-scene': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-scene',
    })), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const head = el('div', 'wp-sc-head', { contenteditable: 'false' });
      head.appendChild(Object.assign(el('span', 'wp-sc-kind'), { textContent: 'SCENE' }));
      return cartridge({ blockClass: 'wp-scene', dataAttr: 'data-scene', node, editor, getPos, headChildren: [head] });
    };
  },
});

// --- VO — blue cap, REC toggle, prose with {tk}/[visual] chips ---
const VO_ORDER = ['todo', 'recorded', 'in-edit']; // OFF → ARM → REC
const VO_LABEL = { todo: 'OFF', recorded: 'ARM', 'in-edit': 'REC' };

// DOUBLE-RETURN EXIT (Johnny: "i hit return twice and another VO tag emerges — nix that").
// Default PM Enter handling on a VO's trailing EMPTY paragraph split the voBlock into TWO
// voBlocks — a second corner tag with nothing under it. Instead, Enter on an empty LAST
// paragraph (that isn't the block's only one) EXITS the VO: the empty paragraph is removed
// and the caret lands in a fresh bare paragraph right after the block — one transaction,
// one undo. Multi-paragraph VO stays fully supported (Enter mid-block is untouched).
// Pure (state, dispatch) -> boolean, exported for the headless suite.
export function doExitVoOnEmptyTail(state, dispatch) {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const para = $from.parent;
  if (para.type.name !== 'paragraph' || para.content.size !== 0) return false;
  const d = $from.depth;
  const host = d > 0 ? $from.node(d - 1) : null;
  if (!host || host.type.name !== 'voBlock') return false;
  if ($from.index(d - 1) !== host.childCount - 1) return false; // only the TRAILING empty line exits
  if (host.childCount === 1) return false;                      // a fresh empty VO keeps normal Enter

  const paraType = state.schema.nodes.paragraph;
  if (!paraType) return false;
  const tr = state.tr;
  const paraStart = $from.before(d);
  const afterVo = $from.after(d - 1);
  tr.delete(paraStart, paraStart + para.nodeSize);
  const insertAt = tr.mapping.map(afterVo);
  tr.insert(insertAt, paraType.createAndFill());
  try { tr.setSelection(PMTextSelection.create(tr.doc, insertAt + 1)); } catch {}
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}
export const VoBlock = Node.create({
  name: 'voBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  marks: MARKS_ALLOWLIST,
  defining: true,
  draggable: true,
  addAttributes() {
    return { ...baseAttrs(), status: { default: 'todo' } };
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => doExitVoOnEmptyTail(this.editor.state, this.editor.view.dispatch),
    };
  },
  parseHTML() { return [{ tag: 'div[data-vo]' }]; },
  renderHTML({ node }) {
    const status = node.attrs.status || 'todo';
    return ['div', mergeAttributes(sharedRenderAttrs(node, {
      'data-vo': '', 'data-status': status,
      'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-vo',
    })), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const status0 = node.attrs.status || 'todo';
      const isPalauChrome = isPalauChromeEnabled();
      const head = el('div', 'wp-vo-head', { contenteditable: 'false' });
      let voTag = null;
      if (!isPalauChrome) {
        head.appendChild(Object.assign(el('span', 'wp-vo-kind'), { textContent: 'VO · NARRATION' }));
      } else {
        // Chip chrome (Burma / Palau / library): the shouty label is gone, so the block's one
        // identity mark is a small boxed "VO" tag pinned upper-left — doctrine cap ink on
        // cream, never red. The head is flex-end; margin-right:auto pushes the tag left.
        // CLICK-TO-RECORD (Johnny 2026-07-08): clicking the tag flips it black→green to mark
        // the VO as recorded, and green→black to un-mark — a one-click binary twin of the REC
        // pill's OFF/ARM/REC cycle. Both write the SAME `status` attr, so the tag colour and the
        // pill always agree: green tag ⇔ status is 'recorded' or 'in-edit', black ⇔ 'todo'.
        voTag = Object.assign(
          el('span', 'wp-vo-tag', { role: 'button', tabindex: isReadOnly() ? '-1' : '0', title: 'click to mark recorded (green) / not recorded (black)', 'aria-label': 'toggle recorded' }),
          { textContent: 'VO' },
        );
        head.appendChild(voTag);
      }

      // REC control: word REC + 3-position pill (3 pips) + state label.
      // L6 — keyboard-operable: focusable in edit mode (read-only excluded) + Enter/Space cycles state.
      const rec = el('div', 'wp-rec', {
        title: 'cycle record state', role: 'button', 'aria-label': 'cycle record state',
        tabindex: isReadOnly() ? '-1' : '0',
      });
      rec.appendChild(Object.assign(el('span', 'wp-rec-word'), { textContent: 'REC' }));
      const pill = el('span', 'wp-rec-pill');
      const pips = [el('i', 'wp-rec-pip'), el('i', 'wp-rec-pip'), el('i', 'wp-rec-pip')];
      pips.forEach((p) => pill.appendChild(p));
      rec.appendChild(pill);
      const label = Object.assign(el('span', 'wp-rec-label'), { textContent: VO_LABEL[status0] });
      rec.appendChild(label);
      const paint = (st) => {
        const idx = VO_ORDER.indexOf(st);
        pips.forEach((p, i) => p.classList.toggle('on', i === idx));
        label.textContent = VO_LABEL[st];
        rec.setAttribute('data-status', st);
        if (voTag) {
          const recorded = st !== 'todo';
          voTag.classList.toggle('is-recorded', recorded);
          voTag.setAttribute('aria-pressed', recorded ? 'true' : 'false');
        }
      };
      paint(status0);
      const cycle = (e) => {
        e.preventDefault();
        // READ MODE / share: cycling REC state writes to the doc — same guard as the done tick.
        if (!blockHeadControlWritable({ readOnly: isReadOnly(), editable: editor.view.editable })) return;
        const cur = editor.state.doc.nodeAt(getPos())?.attrs.status || 'todo';
        setAttr(editor, getPos, { status: VO_ORDER[(VO_ORDER.indexOf(cur) + 1) % VO_ORDER.length] });
      };
      // mousedown for the snappy feel; click as a fallback so programmatic / AT-driven
      // activation (a synthetic click with no preceding mousedown) can't be dropped.
      rec.addEventListener('mousedown', cycle);
      rec.addEventListener('click', (e) => { e.preventDefault(); });
      rec.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') cycle(e);
      });
      head.appendChild(rec);

      // VO-tag binary toggle: black ⇄ green. 'todo' ↔ 'recorded' (never lands on 'in-edit' — the
      // pill owns that nuance). Same write-guard as the pill so read/share sessions stay frozen.
      if (voTag) {
        const toggleRecorded = (e) => {
          e.preventDefault();
          if (!blockHeadControlWritable({ readOnly: isReadOnly(), editable: editor.view.editable })) return;
          const cur = editor.state.doc.nodeAt(getPos())?.attrs.status || 'todo';
          setAttr(editor, getPos, { status: cur === 'todo' ? 'recorded' : 'todo' });
        };
        voTag.addEventListener('mousedown', toggleRecorded);
        voTag.addEventListener('click', (e) => { e.preventDefault(); });
        voTag.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') toggleRecorded(e);
        });
      }

      const headChildren = [];
      appendIfChildren(headChildren, head);
      const view = cartridge({ blockClass: 'wp-vo', dataAttr: 'data-vo', node, editor, getPos, headChildren });
      view.dom.setAttribute('data-status', status0);
      return {
        ...view,
        update(updated) {
          if (updated.type.name !== 'voBlock') return false;
          const st = updated.attrs.status || 'todo';
          view.dom.setAttribute('data-status', st);
          paint(st);
          syncSharedDomAttrs(view.dom, updated.attrs);
          return true;
        },
      };
    };
  },
});

// --- ONCAM — editable prose, marked on-camera (light cartridge, blue cap) ---
export const OncamBlock = Node.create({
  name: 'oncamBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  marks: MARKS_ALLOWLIST,
  defining: true,
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-oncam]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes(sharedRenderAttrs(node, {
      'data-oncam': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-oncam',
    })), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  // Unified DIRECTION rendering (#3) — flat, no type badge/colour, no hero timecode.
  addNodeView() {
    return directionNodeView;
  },
});

// --- SOT — orange cap, recessed LCD timecode window + speaker + quote + done toggle ---
export const SotBlock = Node.create({
  name: 'sotBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  marks: MARKS_ALLOWLIST,
  defining: true,
  draggable: true,
  addAttributes() {
    return {
      ...baseAttrs(),
      timecode: { default: '' }, tcOut: { default: '' }, day: { default: null }, ambiguous: { default: false },
      speaker: { default: '' }, done: { default: false }, rawTimecode: { default: '' },
    };
  },
  parseHTML() { return [{ tag: 'div[data-sot]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['div', mergeAttributes(sharedRenderAttrs(node, {
      'data-sot': '', 'data-block-id': a.blockId || '', 'data-done': a.done ? '1' : '0',
      class: 'wp-cart wp-sot' + (a.done ? ' is-done' : ''),
    })), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  // Unified DIRECTION rendering (#1 + #3): NO recessed LCD / hero timecode, NO speaker badge,
  // NO type-specific colour — same flat DIRECTION chrome as every other direction block. The
  // timecode + speaker still live in attrs (round-trip), but timecodes are surfaced ONLY as
  // inline chips in the body prose; the done toggle is kept (flat, uniform).
  addNodeView() {
    return directionNodeView;
  },
});

// --- B-ROLL — burgundy cap, copy-timecode string + mono desc + [visual] chip ---
export const BrollBlock = Node.create({
  name: 'brollBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  marks: MARKS_ALLOWLIST,
  defining: true,
  draggable: true,
  addAttributes() {
    return {
      ...baseAttrs(),
      timecode: { default: '' }, tcOut: { default: '' }, day: { default: null }, ambiguous: { default: false },
      // speaker carried through (some b-roll strings attribute an on-cam speaker, e.g. "JH"/"Drew").
      // Not rendered in the flat DIRECTION view, but preserved so it round-trips losslessly.
      speaker: { default: '' }, done: { default: false }, rawTimecode: { default: '' },
    };
  },
  parseHTML() { return [{ tag: 'div[data-broll]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['div', mergeAttributes(sharedRenderAttrs(node, {
      'data-broll': '', 'data-block-id': a.blockId || '', 'data-done': a.done ? '1' : '0',
      class: 'wp-cart wp-broll' + (a.done ? ' is-done' : ''),
    })), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  // Unified DIRECTION rendering (#1 + #3): NO hero copy-timecode string — timecodes appear only
  // as inline chips in the body prose. Same flat DIRECTION chrome, no burgundy badge/colour.
  addNodeView() {
    return directionNodeView;
  },
});

// --- MONTAGE — first-class block type, flat cartridge, MONTAGE kind label ---
// A sequence of shots. Mirrors VO/Scene chrome: a cartridge with a non-editable kind head and
// editable prose body. Its own cap colour (teal) so the rack stays legible against VO blue.
export const MontageBlock = Node.create({
  name: 'montageBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  marks: MARKS_ALLOWLIST,
  defining: true,
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-montage]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes(sharedRenderAttrs(node, {
      'data-montage': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-montage',
    })), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const head = el('div', 'wp-montage-head', { contenteditable: 'false' });
      head.appendChild(Object.assign(el('span', 'wp-mtg-kind'), { textContent: 'MONTAGE' }));
      return cartridge({ blockClass: 'wp-montage', dataAttr: 'data-montage', node, editor, getPos, headChildren: [head] });
    };
  },
});

// --- NONE — the "born" block: a chrome-less editable line, no cartridge. ----
// A new block is born as `none`: no border, no cap, no kind label — just an editable line with
// a faint "press to pick a type" hint and the grip to open the block menu. The moment the writer
// picks a type from the grip menu, changeBlockType converts it to a real cartridge. The node has
// a hand-built MINIMAL NodeView (NOT the cartridge shell) so it carries no wp-cart chrome.
export const NoneBlock = Node.create({
  name: 'noneBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  marks: MARKS_ALLOWLIST,
  // NOT defining: the `none` block is the transient "born" line meant to be converted into a real
  // cartridge (or merged away) the instant the writer picks a type — it should NOT resist joins.
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-none]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes(sharedRenderAttrs(node, {
      'data-none': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-none',
    })), ['div', { class: 'wp-none-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = el('div', 'wp-none');
      dom.setAttribute('data-none', '');
      if (node.attrs.blockId) dom.setAttribute('data-block-id', node.attrs.blockId);
      syncSharedDomAttrs(dom, node.attrs);
      // The grip still opens the block menu (press-to-pick-a-type), but the spine renders
      // chrome-less via CSS (.wp-none .wp-spine) — no knurl, no numbered cap.
      dom.appendChild(makeSpine(editor, getPos));
      const body = el('div', 'wp-none-body');
      // faint, non-editable hint sitting behind the caret.
      const hint = el('span', 'wp-none-hint', { contenteditable: 'false' });
      hint.textContent = 'press the grip to pick a type — or just start writing';
      body.appendChild(hint);
      const prose = el('div', 'wp-body');
      body.appendChild(prose);
      dom.appendChild(body);
      return { dom, contentDOM: prose };
    };
  },
});

// --- SCRIPT BEGINS divider (feature B) — a flat marker row that visually starts the
// script after the pre-script (masthead + setup NOTE boxes). Atom, non-editable. ---
export const ScriptStart = Node.create({
  name: 'scriptStart',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,
  parseHTML() { return [{ tag: 'div[data-script-start]' }]; },
  renderHTML() {
    return ['div', { 'data-script-start': '', class: 'wp-script-begins', contenteditable: 'false' },
      ['span', { class: 'wp-script-begins-mark' }, '▸ SCRIPT BEGINS']];
  },
  addNodeView() {
    return () => {
      const dom = el('div', 'wp-script-begins', { contenteditable: 'false' });
      const mark = el('span', 'wp-script-begins-mark');
      mark.textContent = '▸ SCRIPT BEGINS';
      dom.appendChild(mark);
      return { dom };
    };
  },
});

// --- NOTE / JH-NOTE — yellow cap, tinted cartridge, italic note ---
export const NoteBlock = Node.create({
  name: 'noteBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  marks: MARKS_ALLOWLIST,
  defining: true,
  draggable: true,
  addAttributes() { return { ...baseAttrs(), kind: { default: 'note' } }; },
  parseHTML() { return [{ tag: 'div[data-note]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['div', mergeAttributes(sharedRenderAttrs(node, {
      'data-note': '', 'data-kind': a.kind, 'data-block-id': a.blockId || '', class: 'wp-cart wp-note',
    })), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const head = el('div', 'wp-note-head', { contenteditable: 'false' });
      head.appendChild(Object.assign(el('span', 'wp-note-kind'), { textContent: node.attrs.kind === 'jh-note' ? 'JH NOTE' : 'EDITOR NOTE' }));
      const view = cartridge({ blockClass: 'wp-note', dataAttr: 'data-note', node, editor, getPos, headChildren: [head] });
      view.dom.setAttribute('data-kind', node.attrs.kind);
      return {
        ...view,
        update(updated) {
          if (updated.type.name !== 'noteBlock') return false;
          view.dom.setAttribute('data-kind', updated.attrs.kind);
          syncSharedDomAttrs(view.dom, updated.attrs);
          return true;
        },
      };
    };
  },
});

// --- BIN — unplaced holding material (light cartridge, quietest) ---
export const BinBlock = Node.create({
  name: 'binBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  marks: MARKS_ALLOWLIST,
  defining: true,
  draggable: true,
  addAttributes() { return { ...baseAttrs(), scaffold: { default: false } }; },
  parseHTML() { return [{ tag: 'div[data-bin]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes(sharedRenderAttrs(node, {
      'data-bin': '', 'data-block-id': node.attrs.blockId || '',
      'data-scaffold': node.attrs.scaffold ? '1' : '0',
      class: 'wp-cart wp-bin' + (node.attrs.scaffold ? ' is-scaffold' : ''),
    })), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  // Unified DIRECTION rendering (#3). A normal bin collapses into the generic DIRECTION
  // cartridge. A SCAFFOLD bin (pre-script author setup that sits BEFORE the first chapter) keeps
  // its quiet SETUP treatment — that's a pre-script-vs-script distinction, not a type
  // badge/colour, so it stays so the script still opens on masthead → SETUP notes → SCRIPT BEGINS.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const scaffold = !!node.attrs.scaffold;
      if (scaffold) {
        const head = el('div', 'wp-bin-head', { contenteditable: 'false' });
        head.appendChild(Object.assign(el('span', 'wp-bin-kind'), { textContent: 'SETUP' }));
        const view = cartridge({ blockClass: 'wp-bin is-scaffold', dataAttr: 'data-bin', node, editor, getPos, headChildren: [head] });
        view.dom.setAttribute('data-scaffold', '1');
        return view;
      }
      return directionNodeView({ node, editor, getPos });
    };
  },
});

// --- IMAGE — a reference frame / inspo still living inline in the rack (ADDITIVE) ---
// An ATOM block node: the image + its caption are pure attrs (src / alt / kind), no editable
// content, so it round-trips byte-exact through JSON like every other reconstruction-complete
// node (WP-13). INERT for Burma/Palau: their blocks arrays contain no type:"image", so
// buildEditorDocument never emits this node for them — registering the type only widens what the
// schema ACCEPTS, it changes nothing about what existing docs contain or render.
// kind: 'shot' = a reference frame pulled from footage; 'inspo' = mood/inspiration (gets a badge).
//
// VIDEO SRCS (gif→mp4 optimization, image-drop.js): a big dropped GIF is transcoded to a
// looping mp4 before upload, so an imageBlock's src may end .mp4. Same node, same attrs,
// same round-trip (src is just a string) — only the rendered element differs: a muted
// autoplaying looping <video> is visually identical to the GIF it replaced.

// Pure: does this src want a <video> element? Case-insensitive, query-string/hash
// tolerant (a CDN URL may carry ?token=…). Exported so the img/video fork is a locked,
// testable contract in BOTH renderHTML and the nodeview.
export function isVideoSrc(src) {
  const s = String(src || '').trim();
  if (!s) return false;
  // mp4 (gif→mp4 transcode + direct paste), webm + mov (direct video paste/drop). Query-string /
  // hash tolerant; matches ONLY a real trailing container extension (…/y.mp4.png stays an image).
  return /\.(mp4|webm|mov)$/i.test(s.split(/[?#]/, 1)[0]);
}

// Pure: does this src get the "⇩ DOWNLOAD MP4" promise (motion) vs a plain "⇩ DOWNLOAD"?
// Motion = an .mp4 (already video) OR a legacy .gif (transcoded to mp4 on the way down).
// Exported so the lightbox footer's button-label contract is a locked, testable decision.
export function isMotionSrc(src) {
  return isVideoSrc(src) || /\.gif$/i.test(String(src || '').split(/[?#]/, 1)[0]);
}

// ── INLINE IMAGE TRANSFORM (Supabase render endpoint) ───────────────────────────────────
// The rack renders reference STILLS inline at a BOUNDED width via Supabase's on-the-fly image
// transform endpoint (/render/image/public/…), which also auto-negotiates WebP off the browser's
// Accept header. A pasted screenshot is a ~1MB PNG; served through the transform at column width it
// lands ~30-50KB (a 20-30× cut), so a 300-still Nile script downloads ~12MB inline instead of
// ~300MB. FULL RES is always one click away — the lightbox and the DOWNLOAD button read the RAW
// a.src, never the transform, so nothing about crop fidelity, downloads, or exports changes.
//
// Only OUR public storage URLs are rewritten (…/storage/v1/object/public/<bucket>/<path>); bundled
// /palau2/img/* paths, foreign hosts, data:, and already-query-stringed/signed URLs pass through
// untouched. Videos are NEVER transformed (the endpoint is image-only). If a transformed URL ever
// fails to load the nodeview self-heals to the original AND disables transforms for the rest of the
// session (feature-detect once, cache the verdict) — a project with transforms turned off still works.
const STORAGE_PUBLIC_MARKER = '/storage/v1/object/public/';
const STORAGE_RENDER_MARKER = '/storage/v1/render/image/public/';
export const INLINE_WIDTH_LADDER = [480, 768, 1080, 1440];

// Snap a target CSS width (× DPR, capped ×2) UP to the nearest ladder rung so the CDN caches a small
// fixed set of variants instead of one per pixel width. Past the top rung the lightbox serves full res.
export function pickInlineWidth(boxWidthPx, dpr = 1) {
  const factor = Math.min(Math.max(Number(dpr) || 1, 1), 2);
  const target = Math.max(1, Math.round((Number(boxWidthPx) || 720) * factor));
  for (const w of INLINE_WIDTH_LADDER) if (w >= target) return w;
  return INLINE_WIDTH_LADDER[INLINE_WIDTH_LADDER.length - 1];
}

// Rewrite an eligible public storage URL to its bounded transform variant. Returns the input
// UNCHANGED for anything unsafe to transform (video, foreign host, bundled path, already-query'd).
// Pure + exported so the eligibility boundary is a locked test.
export function supabaseInlineSrc(src, width, quality = 78) {
  const s = String(src || '');
  if (isVideoSrc(s)) return s;                       // endpoint is image-only
  const i = s.indexOf(STORAGE_PUBLIC_MARKER);
  if (i < 0) return s;                                // bundled / relative / foreign — leave it
  const rest = s.slice(i + STORAGE_PUBLIC_MARKER.length); // "<bucket>/<path>"
  if (!rest || rest.includes('?') || rest.includes('#')) return s; // don't touch signed/query URLs
  const w = Math.round(Number(width) || 0);
  if (!(w > 0)) return s;
  const q = Math.min(100, Math.max(1, Math.round(Number(quality) || 78)));
  return `${s.slice(0, i)}${STORAGE_RENDER_MARKER}${rest}?width=${w}&quality=${q}`;
}

// Pure: is this src pointing at the transform endpoint? Used by the nodeview's error handler to tell
// a failed TRANSFORM (fall back to original) from a genuinely broken original (leave it broken).
export function isRenderTransformSrc(src) {
  return String(src || '').includes(STORAGE_RENDER_MARKER);
}

// Session verdict — flips false the first time any transform URL errors, then every inline image
// falls back to its raw original. Module-scoped so the whole rack shares one feature-detect result.
let inlineTransformsOk = true;
export function inlineTransformsEnabled() { return inlineTransformsOk; }
export function disableInlineTransforms() { inlineTransformsOk = false; }

// Pure: the download filename STEM, from the caption (alt). Sanitized to a filesystem-safe
// slug (word chars + dashes), stripped of leading/trailing dashes, capped at 60 chars, with
// an always-nonempty fallback so a download can never land as a bare ".ext".
export function mediaDownloadBase(alt) {
  return (String(alt || '').trim() || 'script-media')
    .replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'script-media';
}

// Pure: the download file EXTENSION. Prefer the src path's own extension (our storage URLs
// always carry one). When the path carries none — a signed/extensionless CDN URL — fall back
// to the blob's MIME type so the file still opens in an editor, rather than a useless ".bin"
// when the real type is actually known. Only reaches 'bin' when both signals are absent.
const DOWNLOAD_MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
export function mediaDownloadExt(src, mimeType) {
  const fromPath = (String(src || '').split(/[?#]/, 1)[0].match(/\.(\w{2,4})$/) || [])[1];
  if (fromPath) return fromPath.toLowerCase();
  const mime = String(mimeType || '').trim().toLowerCase().split(';', 1)[0];
  return DOWNLOAD_MIME_EXT[mime] || 'bin';
}

// ── IMAGE RESIZE + CROP — pure decisions (locked by image-resize-crop.test.mjs) ──────────
// Johnny drags a corner to shrink an image; the persisted `width` is a CSS-px integer on the
// image BOX. null = natural (the CSS max-width default). Only SMALLER is offered, so the max
// clamp is the live column/lane width measured at drag time.
export const IMAGE_MIN_WIDTH = 96;
export function clampImageWidth(px, maxPx) {
  const n = Math.round(Number(px));
  if (!Number.isFinite(n)) return null;
  const max = Number.isFinite(maxPx) && maxPx > 0 ? Math.round(maxPx) : 640;
  return Math.max(IMAGE_MIN_WIDTH, Math.min(n, max));
}

// A crop is a NORMALIZED rect {x,y,w,h} in 0..1 of the NATURAL image — resolution-independent,
// applied as pure CSS metadata on the node (NO server-side pixel processing). Valid = numbers,
// positive w/h, inside the frame, and NOT a full-frame no-op (a full-frame crop reads as "no crop"
// so an accidental select-all clears rather than persisting a meaningless rect).
export function isValidCrop(c) {
  if (!c || typeof c !== 'object') return false;
  const { x, y, w, h } = c;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (![x, y, w, h].every(num)) return false;
  if (w <= 0 || h <= 0 || x < 0 || y < 0) return false;
  if (x + w > 1.0001 || y + h > 1.0001) return false;
  return !(x <= 0.0001 && y <= 0.0001 && w >= 0.9999 && h >= 0.9999);
}
export const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

// The <video> attribute set that makes an mp4 behave exactly like a GIF: autoplays
// muted, loops forever, never fullscreens on iOS, and costs only its moov box until
// it nears the viewport.
const VIDEO_LOOP_ATTRS = { autoplay: '', loop: '', muted: '', playsinline: '', preload: 'metadata' };

// ── MEDIA LIGHTBOX — click a still/video in the rack → the same media, BIG. ─────────────
// Johnny: "not full screen — it plays in a bigger screen that is as wide as the whole
// full-width script." So the frame is sized to the LIVE script column's width (measured at
// open time from .wp-editor-content), capped to the viewport — an in-tool viewing surface,
// not a browser fullscreen takeover. A video keeps auto-looping muted (same contract as the
// rack element); the caption rides below. Esc / click-away / × close. One instance ever.
// Download the lightbox's media in an edit-suite-ready form (Johnny: "downloadable as mp4
// or something that can be put into video editing software"). A video src IS already a
// Premiere-ready fast-start H.264 mp4 — straight blob download. A legacy .gif src gets
// transcoded to mp4 on the way down via the same in-browser pipeline the drop path uses
// (dynamic import — the transcoder stays out of the core chunk); if WebCodecs balks, the
// raw gif downloads instead (Premiere imports those too, just less happily). Stills come
// down in their native format. Cross-origin CDN srcs need the fetch→blob→objectURL dance —
// a bare <a download> is ignored cross-origin.
async function downloadMediaFromLightbox(src, alt, button) {
  const base = mediaDownloadBase(alt);
  const label = button.textContent;
  button.disabled = true;
  try {
    button.textContent = 'FETCHING…';
    const res = await fetch(src);
    if (!res.ok) throw new Error('http ' + res.status);
    let blob = await res.blob();
    let ext = mediaDownloadExt(src, blob.type);
    if (!isVideoSrc(src) && /gif/i.test(blob.type + ext)) {
      try {
        button.textContent = 'CONVERTING…';
        const { transcodeGifToMp4 } = await import('./gif-transcode.js');
        blob = await transcodeGifToMp4(new File([blob], base + '.gif', { type: 'image/gif' }));
        ext = 'mp4';
      } catch { /* raw gif still downloads below */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = base + '.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (e) {
    try { window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone: 'error', msg: 'download failed (' + (e?.message || 'network') + ') — try again' } })); } catch {}
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

let closeOpenLightbox = null;
export function openMediaLightbox({ src, alt }) {
  if (closeOpenLightbox) closeOpenLightbox();
  if (!src) return;

  const scrim = el('div', 'wp-media-lightbox', { role: 'dialog', 'aria-label': alt || 'media preview' });
  const frame = el('figure', 'wp-media-lightbox-frame');
  // Width = the full script column, right now (reading knobs resize it live), minus a hair
  // of breathing room; never wider than the viewport allows.
  let width = 960;
  try {
    const rack = document.querySelector('.wp-editor-content');
    if (rack) width = rack.getBoundingClientRect().width;
  } catch {}
  frame.style.width = Math.round(Math.min(width, window.innerWidth - 48)) + 'px';

  let media;
  if (isVideoSrc(src)) {
    media = el('video', 'wp-media-lightbox-media', { ...VIDEO_LOOP_ATTRS, preload: 'auto' });
    media.muted = true; media.autoplay = true; media.loop = true; media.playsInline = true;
  } else {
    media = el('img', 'wp-media-lightbox-media', { decoding: 'async' });
    media.alt = alt || '';
  }
  media.src = src;
  frame.appendChild(media);
  // FOOTER — caption (when present) + the edit-suite download. Motion gets the honest
  // "MP4" promise; a still downloads as itself.
  const foot = el('div', 'wp-media-lightbox-foot');
  const cap = el('figcaption', 'wp-media-lightbox-cap');
  cap.textContent = alt || '';
  foot.appendChild(cap);
  const isMotion = isMotionSrc(src);
  const dl = el('button', 'wp-media-lightbox-dl', {
    type: 'button',
    title: isMotion ? 'Download as an mp4 ready for your edit' : 'Download this image',
  });
  dl.textContent = isMotion ? '⇩ DOWNLOAD MP4' : '⇩ DOWNLOAD';
  dl.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); downloadMediaFromLightbox(src, alt, dl); });
  foot.appendChild(dl);
  frame.appendChild(foot);
  const closeBtn = el('button', 'wp-media-lightbox-close', { type: 'button', title: 'Close (Esc)', 'aria-label': 'close preview' });
  closeBtn.textContent = '×';
  frame.appendChild(closeBtn);
  scrim.appendChild(frame);

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    try { if (media.tagName === 'VIDEO') media.pause(); } catch {}
    scrim.remove();
    closeOpenLightbox = null;
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  closeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); close(); });
  document.addEventListener('keydown', onKey, true);

  document.body.appendChild(scrim);
  closeOpenLightbox = close;
}

export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      ...baseAttrs(),
      src: { default: '' },
      alt: { default: '' },
      kind: { default: 'shot' },
      // Rendered BOX width in CSS px (drag a corner to shrink). null = natural. A plain number
      // survives PM-JSON toJSON/fromJSON automatically; default null keeps every existing doc
      // byte-identical (additive).
      width: { default: null },
      // Normalized crop rect {x,y,w,h} 0..1 (double-click to crop). null = uncropped. Object
      // survives PM-JSON; also emitted as data-crop in renderHTML for HTML export fidelity.
      crop: { default: null },
      // CLIPBOARD PASTE placeholder state (WP-13, attr-driven — NOT a decoration). When Johnny
      // pastes media it lands IMMEDIATELY as a real row with uploading:true + empty src; the
      // upload promise swaps in the final src (and uploading:false) when the bytes land, or sets
      // uploadError on failure. Both default to the resting state, so every EXISTING image block
      // serializes byte-identical (docToBlocks emits them only when set). A block that reloads
      // still uploading:true has an interrupted upload — the nodeview renders it as a recoverable
      // error (the in-flight promise didn't survive the reload).
      uploading: { default: false },
      uploadError: { default: null },
    };
  },
  // CLIPBOARD / HTML ROUND-TRIP (Johnny 2026-07-22, "copy/cut/paste them easily"). An internal
  // ProseMirror copy serializes the node through renderHTML and reconstructs it on paste through
  // THIS getAttrs (PM's clipboard path is DOM-parse, not fromJSON) — so without capturing the media
  // attrs a pasted copy came back blank (empty src, no crop/width/caption). We read them back here.
  // blockId is DELIBERATELY not parsed: a paste must never resurrect a duplicate id — the copy lands
  // with a null id and docToBlocks mints a fresh one on the next save (see baseAttrs comment above).
  parseHTML() {
    return [{
      tag: 'figure[data-image]',
      getAttrs: (dom) => {
        const media = dom.querySelector('img, video');
        const cap = dom.querySelector('figcaption');
        const alt = (media && (media.getAttribute('alt') || media.getAttribute('aria-label')))
          || (cap && cap.textContent) || '';
        const wRaw = parseFloat(dom.getAttribute('data-width') || '');
        let crop = null;
        const cRaw = dom.getAttribute('data-crop');
        if (cRaw) { try { const c = JSON.parse(cRaw); if (isValidCrop(c)) crop = c; } catch {} }
        return {
          src: (media && media.getAttribute('src')) || '',
          alt: alt || '',
          kind: dom.getAttribute('data-kind') || 'shot',
          width: Number.isFinite(wRaw) ? wRaw : null,
          crop,
        };
      },
    }];
  },
  renderHTML({ node }) {
    const a = node.attrs;
    const pending = (a.uploading || a.uploadError) && !a.src;
    const children = [];
    if (pending) {
      // No media element while a paste is in flight / failed — an empty src would render a broken
      // media icon into every export. A quiet status line stands in until the real src lands.
      children.push(['div', { class: 'wp-media-status', contenteditable: 'false' },
        a.uploadError ? String(a.uploadError) : 'uploading…']);
    } else {
      children.push(
        isVideoSrc(a.src)
          ? ['video', { src: a.src || '', class: 'wp-image-img', 'aria-label': a.alt || '', ...VIDEO_LOOP_ATTRS }]
          : ['img', { src: a.src || '', alt: a.alt || '', loading: 'lazy' }],
      );
    }
    if (a.alt) children.push(['figcaption', { class: 'wp-image-caption' }, a.alt]);
    // NOT a .wp-cart: an image is a quiet figure (no spine, no counter, no flex-row chrome) —
    // calm doctrine styling lives on .wp-image in styles.css.
    const figAttrs = {
      'data-image': '', 'data-kind': a.kind || 'shot',
      'data-block-id': a.blockId || '', class: 'wp-image',
    };
    if (a.uploading) figAttrs['data-uploading'] = '1';
    if (a.uploadError) figAttrs['data-error'] = '1';
    // width rides in BOTH style (HTML-export fidelity) and data-width (a clean, un-regex'd read for
    // the clipboard parseHTML round-trip above).
    if (Number.isFinite(a.width)) { figAttrs.style = `width:${a.width}px`; figAttrs['data-width'] = String(a.width); }
    if (isValidCrop(a.crop)) figAttrs['data-crop'] = JSON.stringify(a.crop);
    return ['figure', mergeAttributes(sharedRenderAttrs(node, figAttrs)), ...children];
  },
  // Captions are reference metadata, not script words — contribute nothing to text exports.
  renderText() { return ''; },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let attrs = node.attrs;
      const dom = el('figure', 'wp-image', { 'data-image': '', contenteditable: 'false' });
      if (attrs.blockId) dom.setAttribute('data-block-id', attrs.blockId);
      dom.setAttribute('data-kind', attrs.kind || 'shot');
      syncSharedDomAttrs(dom, attrs);

      // BOX — the width-controlled frame. Everything visual (crop wrap, tools, handles, crop UI)
      // lives inside it; the caption/badge sit OUTSIDE it under the figure.
      const boxEl = el('div', 'wp-image-box');
      const cropWrap = el('div', 'wp-image-cropwrap');
      boxEl.appendChild(cropWrap);
      dom.appendChild(boxEl);

      // Bounded inline src for the CURRENT image attrs: the Supabase transform variant sized to the
      // box (× DPR), or the raw src when transforms are off/ineligible/video. The lightbox + download
      // never call this — they always read the full-res a.src.
      const inlineSrcFor = (a) => {
        if (!inlineTransformsOk || isVideoSrc(a.src)) return a.src || '';
        const measured = boxEl.getBoundingClientRect().width;
        const boxW = measured > 0 ? measured : (Number.isFinite(a.width) ? a.width : 720);
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        return supabaseInlineSrc(a.src, pickInlineWidth(boxW, dpr));
      };

      const makeMediaEl = (a) => {
        if (isVideoSrc(a.src)) {
          const v = el('video', 'wp-image-img', { ...VIDEO_LOOP_ATTRS });
          v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true;
          return v;
        }
        const img = el('img', 'wp-image-img', { loading: 'lazy', decoding: 'async' });
        // FEATURE-DETECT ONCE: a failed TRANSFORM url (not a broken original) → turn transforms off
        // for the session and repaint this image at full res. The guard on isRenderTransformSrc stops
        // any loop — once src is the raw original, a further error is a truly broken image, left as-is.
        img.addEventListener('error', () => {
          const orig = attrs.src || '';
          if (orig && isRenderTransformSrc(img.getAttribute('src')) && img.getAttribute('src') !== orig) {
            inlineTransformsOk = false;
            img.src = orig;
          }
        });
        return img;
      };
      let media = makeMediaEl(attrs);
      cropWrap.appendChild(media);

      // Natural aspect (natW/natH) once the media has dimensions; null until loaded.
      const naturalRatio = (m) => {
        const w = m.tagName === 'VIDEO' ? m.videoWidth : m.naturalWidth;
        const h = m.tagName === 'VIDEO' ? m.videoHeight : m.naturalHeight;
        return w > 0 && h > 0 ? w / h : null;
      };

      // CROP RENDER — pure CSS, pixel-exact. Reads live wrap width so it tracks responsive lanes.
      const applyCropStyles = (a) => {
        const c = isValidCrop(a.crop) ? a.crop : null;
        if (!c) {
          cropWrap.style.overflow = ''; cropWrap.style.position = ''; cropWrap.style.height = '';
          media.style.position = ''; media.style.width = ''; media.style.height = '';
          media.style.left = ''; media.style.top = ''; media.style.maxWidth = '';
          return;
        }
        const ratio = naturalRatio(media);           // wait for load if unknown
        if (!ratio) return;
        const W = cropWrap.getBoundingClientRect().width || boxEl.getBoundingClientRect().width;
        if (!W) return;
        const fullW = W / c.w;
        const fullH = fullW / ratio;
        cropWrap.style.overflow = 'hidden';
        cropWrap.style.position = 'relative';
        cropWrap.style.height = (c.h * fullH) + 'px';
        media.style.position = 'absolute';
        media.style.maxWidth = 'none';
        media.style.width = fullW + 'px';
        media.style.height = fullH + 'px';
        media.style.left = (-c.x * fullW) + 'px';
        media.style.top = (-c.y * fullH) + 'px';
      };

      // --sized marks "the box has a controlled width, so the media fills it (width:100%)". Absent,
      // the box is fit-content and the media renders at natural size, so the frame HUGS the image
      // instead of spanning the whole column (Johnny 2026-07-09: "big weird bounding box frame").
      const applyWidth = (a) => {
        if (Number.isFinite(a.width)) { boxEl.style.width = a.width + 'px'; boxEl.classList.add('wp-image-box--sized'); }
        else { boxEl.style.width = ''; boxEl.classList.remove('wp-image-box--sized'); }
      };

      const paint = (a) => {
        if (isVideoSrc(a.src) !== (media.tagName === 'VIDEO')) {
          const next = makeMediaEl(a);
          media.replaceWith(next);   // stays inside cropWrap
          media = next;
          media.addEventListener('load', onMediaReady);
          media.addEventListener('loadedmetadata', onMediaReady);
        }
        media.src = media.tagName === 'IMG' ? inlineSrcFor(a) : (a.src || '');
        if (media.tagName === 'IMG') media.alt = a.alt || '';
        else media.setAttribute('aria-label', a.alt || '');
        dom.setAttribute('data-kind', a.kind || 'shot');
        applyWidth(a);
        applyCropStyles(a);
      };
      const onMediaReady = () => applyCropStyles(attrs);
      media.addEventListener('load', onMediaReady);
      media.addEventListener('loadedmetadata', onMediaReady);

      // The gate: editor editable AND not a read-only share. EVERY write path checks this.
      const canEdit = () => { try { return editor.isEditable && !isReadOnly(); } catch { return false; } };

      // INLINE TOOLS — small FULLSCREEN + DOWNLOAD, always available (viewing/downloading is a
      // READ op, allowed in read-only). Fullscreen opens the existing script-column lightbox
      // (which carries the BIG download button).
      const toolsEl = el('div', 'wp-image-tools', { contenteditable: 'false' });
      const fsBtn = el('button', 'wp-image-tool wp-image-tool-fs', { type: 'button', title: 'Open fullscreen', 'aria-label': 'open fullscreen' });
      fsBtn.textContent = '⤢';
      const dlBtn = el('button', 'wp-image-tool wp-image-tool-dl', { type: 'button', title: 'Download' });
      dlBtn.textContent = '⇩';
      toolsEl.appendChild(fsBtn); toolsEl.appendChild(dlBtn);
      boxEl.appendChild(toolsEl);
      fsBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); openMediaLightbox(attrs); });
      dlBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); downloadMediaFromLightbox(attrs.src, attrs.alt, dlBtn); });

      // RESIZE HANDLES — visible only when the node is selected AND the editor is editable
      // (CSS keyed on the .ProseMirror[contenteditable="true"] ancestor + .ProseMirror-selectednode,
      // so it tracks setEditable with NO repaint). Drag mutates ONLY box.style.width (pure DOM,
      // ignoreMutation swallows it, NO transaction). ONE setNodeMarkup fires on pointerup.
      const handlesEl = el('div', 'wp-image-handles', { contenteditable: 'false' });
      for (const h of ['nw', 'ne', 'sw', 'se', 'e', 'w']) {
        handlesEl.appendChild(el('span', 'wp-image-handle wp-image-handle-' + h, { 'data-h': h }));
      }
      boxEl.appendChild(handlesEl);

      // ── PASTE PLACEHOLDER / ERROR overlay (attr-driven). Covers the box while a pasted
      // media upload is in flight, and stands in with a retry/remove card if it failed (or was
      // interrupted by a reload). Purely presentational — the retry/remove BUTTONS dispatch real
      // transactions through image-drop.js so a failed paste is never a silent vanish.
      const blockId = attrs.blockId || '';
      const statusEl = el('div', 'wp-media-status', { contenteditable: 'false', hidden: '' });
      const statusSpin = el('span', 'wp-media-status-spin');
      const statusLabel = el('span', 'wp-media-status-label');
      const statusRow = el('div', 'wp-media-status-row');
      statusRow.appendChild(statusSpin); statusRow.appendChild(statusLabel);
      const statusActions = el('div', 'wp-media-status-actions');
      const retryBtn = el('button', 'wp-media-status-btn wp-media-status-retry', { type: 'button' });
      retryBtn.textContent = 'RETRY';
      const removeBtn = el('button', 'wp-media-status-btn wp-media-status-remove', { type: 'button' });
      removeBtn.textContent = 'REMOVE';
      statusActions.appendChild(retryBtn); statusActions.appendChild(removeBtn);
      statusEl.appendChild(statusRow); statusEl.appendChild(statusActions);
      boxEl.appendChild(statusEl);
      retryBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); if (blockId) retryMediaUpload(editor.view, blockId); });
      removeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); if (blockId) removeMediaBlock(editor.view, blockId); });
      // While active, the transcode/upload narrates its stage (OPTIMIZING → UPLOADING) via a
      // window event — the label lives in image-drop's session map, not in the doc.
      const onProgress = (e) => {
        if (!e?.detail || e.detail.id !== blockId) return;
        if (attrs.uploading && mediaUploadIsActive(blockId)) statusLabel.textContent = e.detail.label || 'UPLOADING…';
      };
      window.addEventListener(MEDIA_PROGRESS_EVENT, onProgress);

      const maxBoxWidth = () => {
        try {
          const host = dom.parentElement;
          const hw = host ? host.getBoundingClientRect().width : 640;
          return Math.max(IMAGE_MIN_WIDTH, Math.round(hw));
        } catch { return 640; }
      };

      let dragging = false;
      const commitWidth = (w) => {
        if (!canEdit()) { paint(attrs); return; }               // read-only defense in depth
        if ((attrs.width ?? null) === (w ?? null)) { paint(attrs); return; }
        try {
          const pos = getPos();
          if (typeof pos !== 'number') { paint(attrs); return; }
          const live = editor.state.doc.nodeAt(pos);
          if (!live || live.type.name !== 'imageBlock') { paint(attrs); return; }
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, null, { ...live.attrs, width: w }));
        } catch { paint(attrs); }
      };

      const beginResize = (e) => {
        if (!canEdit()) return;
        e.preventDefault(); e.stopPropagation();
        const west = String(e.currentTarget.dataset.h || '').includes('w');
        const startX = e.clientX;
        const startW = boxEl.getBoundingClientRect().width;
        const maxW = maxBoxWidth();
        dragging = true;
        boxEl.classList.add('wp-image-resizing');
        boxEl.classList.add('wp-image-box--sized');   // media fills the box while dragging

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          boxEl.style.width = clampImageWidth(startW + (west ? -dx : dx), maxW) + 'px';
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove, true);
          window.removeEventListener('pointerup', onUp, true);
          dragging = false;
          boxEl.classList.remove('wp-image-resizing');
          commitWidth(clampImageWidth(boxEl.getBoundingClientRect().width, maxW));
        };
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
      };
      handlesEl.querySelectorAll('.wp-image-handle').forEach((h) => h.addEventListener('pointerdown', beginResize));

      // CROP EDITOR (double-click). Shows the FULL image (crop cleared visually), overlays a
      // draggable/resizable rect; Apply normalizes to 0..1 and commits ONE transaction; Esc/Cancel
      // restores. Absolute to the natural image, so re-cropping replaces from scratch.
      const cropUi = el('div', 'wp-image-cropui', { contenteditable: 'false', hidden: '' });
      const cropRect = el('div', 'wp-image-croprect');
      for (const h of ['nw', 'ne', 'sw', 'se']) cropRect.appendChild(el('span', 'wp-image-crophandle wp-image-crophandle-' + h, { 'data-h': h }));
      const cropBar = el('div', 'wp-image-cropbar');
      const cropApply = el('button', 'wp-image-cropbtn wp-image-cropbtn-apply', { type: 'button' }); cropApply.textContent = 'CROP';
      const cropCancel = el('button', 'wp-image-cropbtn wp-image-cropbtn-cancel', { type: 'button' }); cropCancel.textContent = 'CANCEL';
      cropBar.appendChild(cropApply); cropBar.appendChild(cropCancel);
      cropUi.appendChild(cropRect); cropUi.appendChild(cropBar);
      boxEl.appendChild(cropUi);

      let cropping = false;
      let rectPx = { l: 0, t: 0, w: 0, h: 0 };   // px within the shown-full media box
      const mediaBox = () => media.getBoundingClientRect();

      const paintCropRect = () => {
        cropRect.style.left = rectPx.l + 'px';
        cropRect.style.top = rectPx.t + 'px';
        cropRect.style.width = rectPx.w + 'px';
        cropRect.style.height = rectPx.h + 'px';
      };
      const enterCropMode = () => {
        if (!canEdit() || cropping) return;
        cropping = true;
        // Show full image while cropping.
        cropWrap.style.overflow = ''; cropWrap.style.position = 'relative'; cropWrap.style.height = '';
        media.style.position = ''; media.style.width = ''; media.style.height = '';
        media.style.left = ''; media.style.top = ''; media.style.maxWidth = '';
        const mb = mediaBox();
        const wrapRect = cropWrap.getBoundingClientRect();
        const ox = mb.left - wrapRect.left, oy = mb.top - wrapRect.top;
        const c = isValidCrop(attrs.crop) ? attrs.crop : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
        rectPx = { l: ox + c.x * mb.width, t: oy + c.y * mb.height, w: c.w * mb.width, h: c.h * mb.height };
        cropUi.hidden = false;
        boxEl.classList.add('wp-image-cropping');
        paintCropRect();
        document.addEventListener('keydown', onCropKey, true);
      };
      const exitCropMode = () => {
        cropping = false;
        cropUi.hidden = true;
        boxEl.classList.remove('wp-image-cropping');
        document.removeEventListener('keydown', onCropKey, true);
        applyCropStyles(attrs);   // restore whatever crop is persisted
      };
      const onCropKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exitCropMode(); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitCrop(); }
      };

      // rect drag (body move) + corner resize — pure DOM, no transaction until Apply.
      const dragRect = (e, mode) => {
        if (!canEdit()) return;
        e.preventDefault(); e.stopPropagation();
        const sx = e.clientX, sy = e.clientY;
        const start = { ...rectPx };
        const mb = mediaBox(); const wrapRect = cropWrap.getBoundingClientRect();
        const minX = mb.left - wrapRect.left, minY = mb.top - wrapRect.top;
        const maxX = minX + mb.width, maxY = minY + mb.height;
        const onMove = (ev) => {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          let { l, t, w, h } = start;
          if (mode === 'move') {
            l = Math.max(minX, Math.min(start.l + dx, maxX - w));
            t = Math.max(minY, Math.min(start.t + dy, maxY - h));
          } else {
            const east = mode.includes('e'), south = mode.includes('s');
            if (east) w = Math.max(24, Math.min(start.w + dx, maxX - start.l));
            else { const nl = Math.max(minX, Math.min(start.l + dx, start.l + start.w - 24)); w = start.w + (start.l - nl); l = nl; }
            if (south) h = Math.max(24, Math.min(start.h + dy, maxY - start.t));
            else { const nt = Math.max(minY, Math.min(start.t + dy, start.t + start.h - 24)); h = start.h + (start.t - nt); t = nt; }
          }
          rectPx = { l, t, w, h };
          paintCropRect();
        };
        const onUp = () => { window.removeEventListener('pointermove', onMove, true); window.removeEventListener('pointerup', onUp, true); };
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
      };
      cropRect.addEventListener('pointerdown', (e) => { if (e.target === cropRect) dragRect(e, 'move'); });
      cropRect.querySelectorAll('.wp-image-crophandle').forEach((h) =>
        h.addEventListener('pointerdown', (e) => dragRect(e, e.currentTarget.dataset.h)));

      const commitCrop = () => {
        if (!canEdit()) { exitCropMode(); return; }
        const mb = mediaBox(); const wrapRect = cropWrap.getBoundingClientRect();
        const ox = mb.left - wrapRect.left, oy = mb.top - wrapRect.top;
        const nx = clamp01((rectPx.l - ox) / mb.width);
        const ny = clamp01((rectPx.t - oy) / mb.height);
        const nw = clamp01(rectPx.w / mb.width);
        const nh = clamp01(rectPx.h / mb.height);
        const next = isValidCrop({ x: nx, y: ny, w: nw, h: nh }) ? { x: nx, y: ny, w: nw, h: nh } : null;
        try {
          const pos = getPos();
          if (typeof pos === 'number') {
            const live = editor.state.doc.nodeAt(pos);
            if (live && live.type.name === 'imageBlock') {
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, null, { ...live.attrs, crop: next }));
            }
          }
        } catch {}
        exitCropMode();
      };
      cropApply.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); commitCrop(); });
      cropCancel.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); exitCropMode(); });

      // CLICK → fullscreen ONLY in read/non-edit mode (readers keep click-to-zoom). In edit mode a
      // click just selects the atom → the resize box appears. DOUBLE-CLICK → crop (edit only).
      dom.addEventListener('click', (e) => {
        if (e.target !== media) return;
        if (canEdit()) return;
        e.preventDefault(); e.stopPropagation();
        openMediaLightbox(attrs);
      });
      media.addEventListener('dblclick', (e) => {
        if (!canEdit()) return;
        e.preventDefault(); e.stopPropagation();
        enterCropMode();
      });

      // Recompute px-exact crop when the column/lane resizes (responsive). Pure DOM.
      let ro = null;
      try { ro = new ResizeObserver(() => { if (!cropping && !dragging) applyCropStyles(attrs); }); ro.observe(boxEl); } catch {}

      // INSPO badge — only for kind:'inspo' (mood reference, not a real frame from footage).
      const badge = el('span', 'wp-image-badge', { contenteditable: 'false' });
      badge.textContent = 'INSPO';
      dom.appendChild(badge);

      // CAPTION — hidden until typed. Three faces, one at a time (verbatim from the shipped impl).
      const cap = el('figcaption', 'wp-image-caption', { contenteditable: 'false', title: 'click to edit the caption' });
      const capStrip = el('button', 'wp-image-cap-strip', { type: 'button', contenteditable: 'false', title: 'add a caption' });
      capStrip.textContent = '+ caption';
      const capInput = el('input', 'wp-image-cap-input', { type: 'text', placeholder: 'caption…' });
      dom.appendChild(cap);
      dom.appendChild(capStrip);
      dom.appendChild(capInput);

      let editing = false;

      const paintAll = (a) => {
        attrs = a;
        if (!cropping && !dragging) paint(a);   // don't stomp a live drag/crop with a peer echo
        dom.classList.toggle('wp-image--editable', canEdit());
        // PASTE PLACEHOLDER / ERROR state. `active` = an upload this session is still driving;
        // `interrupted` = uploading:true survived a reload (the promise did not) → recoverable.
        const active = !!a.uploading && mediaUploadIsActive(blockId);
        const interrupted = !!a.uploading && !active;
        const errored = !a.uploading && !!a.uploadError;
        const pending = !!a.uploading || errored;
        dom.classList.toggle('wp-image--pending', pending);
        dom.classList.toggle('wp-image--error', errored || interrupted);
        statusEl.hidden = !pending;
        statusSpin.hidden = !active;
        if (active) statusLabel.textContent = mediaUploadLabel(blockId) || 'UPLOADING…';
        else if (interrupted) statusLabel.textContent = 'UPLOAD INTERRUPTED';
        else if (errored) statusLabel.textContent = String(a.uploadError || 'UPLOAD FAILED');
        statusActions.hidden = active || !pending;   // no actions mid-flight; retry/remove once settled
        // Retry needs the original bytes (kept in-session); after a reload they are gone → remove only.
        retryBtn.hidden = !(interrupted || errored) || !mediaUploadCanRetry(blockId) || !canEdit();
        removeBtn.hidden = !(interrupted || errored) || !canEdit();
        badge.hidden = pending || (a.kind || 'shot') !== 'inspo';
        cap.textContent = a.alt || '';
        cap.hidden = editing || !a.alt || pending;
        capStrip.hidden = editing || !!a.alt || !canEdit() || pending;
        capInput.hidden = !editing;
      };

      const commit = (value) => {
        const text = String(value ?? '').trim();
        editing = false;
        if (text === (attrs.alt || '')) { paintAll(attrs); return; }
        try {
          const pos = getPos();
          if (typeof pos !== 'number') { paintAll(attrs); return; }
          const live = editor.state.doc.nodeAt(pos);
          if (!live || live.type.name !== 'imageBlock') { paintAll(attrs); return; }
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, null, { ...live.attrs, alt: text })
          );
        } catch { paintAll(attrs); }
      };

      const startEditing = () => {
        if (!canEdit()) return;
        editing = true;
        capInput.value = attrs.alt || '';
        paintAll(attrs);
        capInput.focus();
        capInput.select();
      };

      capStrip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); startEditing(); });
      cap.addEventListener('click', (e) => {
        if (!canEdit()) return;
        e.preventDefault(); e.stopPropagation(); startEditing();
      });
      capInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(capInput.value); }
        if (e.key === 'Escape') { e.preventDefault(); editing = false; paintAll(attrs); }
      });
      capInput.addEventListener('blur', () => { if (editing) commit(capInput.value); });

      paintAll(attrs);

      return {
        dom,
        ignoreMutation: () => true,
        stopEvent: (event) => {
          const t = event.target;
          if (t === capInput || capInput.contains(t)) return true;
          if (handlesEl.contains(t)) return true;
          if (toolsEl.contains(t)) return true;
          if (cropUi.contains(t)) return true;
          if (statusEl.contains(t)) return true;
          return false;
        },
        update(updated) {
          if (updated.type.name !== 'imageBlock') return false;
          paintAll(updated.attrs);
          syncSharedDomAttrs(dom, updated.attrs);
          return true;
        },
        destroy() {
          try { if (ro) ro.disconnect(); } catch {}
          document.removeEventListener('keydown', onCropKey, true);
          window.removeEventListener(MEDIA_PROGRESS_EVENT, onProgress);
        },
      };
    };
  },
});

export const BURMA_NODES = [
  ChapterBlock, SceneBlock, VoBlock, OncamBlock,
  SotBlock, BrollBlock, MontageBlock, NoneBlock, ScriptStart, NoteBlock, BinBlock,
  ImageBlock,
  DirectionChip, DirectionBreak,
  // FACT-CHECK FOOTNOTE (inline atom) — one registration here reaches the live editor,
  // migrate-doc's mirror/save-gate schema, and the collab schema alike.
  FcFootnote,
];
