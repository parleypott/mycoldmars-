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

const baseAttrs = () => ({ blockId: { default: null } });

// chapter genre → ACT tag shown top-right of a chapter cartridge body.
const ACT_TAG = { coldopen: 'HISTORY', history: 'HISTORY', ground: 'GROUND', inquiry: 'GROUND', latm: 'GROUND', other: '' };

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
  const grip = el('button', 'wp-grip', {
    type: 'button', contenteditable: 'false', 'data-drag-handle': '', draggable: 'true',
    title: 'Drag to move · click for menu', 'aria-label': 'Move or open block menu', tabindex: '-1',
  });
  grip.textContent = '⠿';
  let dragged = false;
  grip.addEventListener('dragstart', () => { dragged = true; });
  grip.addEventListener('mousedown', () => { dragged = false; });
  grip.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (dragged) { dragged = false; return; }
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
function changeBlockType(editor, getPos, typeName) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (typeof pos !== 'number') return;
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const target = state.schema.nodes[typeName];
  if (!target) return;
  const defaults = {};
  const specAttrs = target.spec.attrs || {};
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
  view.dispatch(state.tr.delete(pos, pos + node.nodeSize));
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
function closeBlockMenu() {
  if (!openMenuEl) return;
  openMenuEl.remove(); openMenuEl = null;
  document.removeEventListener('mousedown', onDocDown, true);
  if (openMenuReposition) {
    window.removeEventListener('scroll', openMenuReposition, true);
    window.removeEventListener('resize', openMenuReposition);
    openMenuReposition = null;
  }
}
function onDocDown(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeBlockMenu(); }
function openBlockMenu(editor, getPos, anchor) {
  closeBlockMenu();
  const menu = el('div', 'wp-blockmenu', { contenteditable: 'false' });
  const curPos = typeof getPos === 'function' ? getPos() : getPos;
  const curNode = editor.state.doc.nodeAt(curPos);
  const curType = curNode?.type.name;

  const head = el('div', 'wp-bm-head'); head.textContent = 'Turn into';
  menu.appendChild(head);
  TYPE_MENU.forEach(([name, label]) => {
    const item = el('button', 'wp-bm-item' + (name === curType ? ' is-current' : ''), { type: 'button' });
    item.textContent = label;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); changeBlockType(editor, getPos, name); closeBlockMenu(); });
    menu.appendChild(item);
  });
  const sep = el('div', 'wp-bm-sep'); menu.appendChild(sep);
  const ins = el('button', 'wp-bm-item', { type: 'button' });
  ins.textContent = 'Insert block below';
  ins.addEventListener('mousedown', (e) => { e.preventDefault(); insertBlockBelow(editor, getPos); closeBlockMenu(); });
  menu.appendChild(ins);
  const del = el('button', 'wp-bm-item wp-bm-del', { type: 'button' });
  del.textContent = 'Delete block';
  del.addEventListener('mousedown', (e) => { e.preventDefault(); deleteBlock(editor, getPos); closeBlockMenu(); });
  menu.appendChild(del);

  document.body.appendChild(menu);
  menu.style.position = 'fixed';
  const place = () => {
    const r = anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { closeBlockMenu(); return; }
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${r.left}px`;
  };
  place();
  openMenuEl = menu;
  openMenuReposition = place;
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}

// Position the node, then dispatch a markup change to its attrs.
function setAttr(editor, getPos, patch) {
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

  const head = el('div', 'wp-dir-head', { contenteditable: 'false' });
  head.appendChild(Object.assign(el('span', 'wp-dir-kind'), { textContent: 'DIRECTION' }));

  let done = null;
  if (hasDone) {
    done = el('button', 'wp-done' + (a.done ? ' is-done' : ''), {
      type: 'button', contenteditable: 'false', title: 'mark done', 'aria-label': 'mark done', tabindex: '-1',
    });
    done.textContent = '✓';
    done.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const cur = editor.state.doc.nodeAt(getPos());
      setAttr(editor, getPos, { done: !cur?.attrs.done });
    });
    head.appendChild(done);
  }

  const view = cartridge({ blockClass: 'wp-dir', dataAttr: 'data-direction', node, editor, getPos, headChildren: [head] });
  if (hasDone) view.dom.setAttribute('data-done', a.done ? '1' : '0');
  return {
    ...view,
    update(updated) {
      if (updated.type.name !== node.type.name) return false;
      if (hasDone) {
        view.dom.classList.toggle('is-done', !!updated.attrs.done);
        view.dom.setAttribute('data-done', updated.attrs.done ? '1' : '0');
        if (done) done.classList.toggle('is-done', !!updated.attrs.done);
      }
      return true;
    },
  };
}

// --- CHAPTER — inverted dark cartridge, ivory cap, ACT tag ---
export const ChapterBlock = Node.create({
  name: 'chapterBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  defining: true,
  draggable: true,
  addAttributes() {
    return { ...baseAttrs(), genre: { default: 'other' } };
  },
  parseHTML() { return [{ tag: 'section[data-chapter]' }]; },
  renderHTML({ node }) {
    return ['section', mergeAttributes({
      'data-chapter': '', 'data-genre': node.attrs.genre || 'other',
      'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-chapter',
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
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
  defining: true,
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'section[data-scene]' }]; },
  renderHTML({ node }) {
    return ['section', mergeAttributes({
      'data-scene': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-scene',
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
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
export const VoBlock = Node.create({
  name: 'voBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  draggable: true,
  addAttributes() {
    return { ...baseAttrs(), status: { default: 'todo' } };
  },
  parseHTML() { return [{ tag: 'div[data-vo]' }]; },
  renderHTML({ node }) {
    const status = node.attrs.status || 'todo';
    return ['div', mergeAttributes({
      'data-vo': '', 'data-status': status,
      'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-vo',
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const status0 = node.attrs.status || 'todo';
      const head = el('div', 'wp-vo-head', { contenteditable: 'false' });
      head.appendChild(Object.assign(el('span', 'wp-vo-kind'), { textContent: 'VO · NARRATION' }));

      // REC control: word REC + 3-position pill (3 pips) + state label.
      const rec = el('div', 'wp-rec', { title: 'cycle record state', role: 'button', tabindex: '-1' });
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
      };
      paint(status0);
      const cycle = (e) => {
        e.preventDefault();
        const cur = editor.state.doc.nodeAt(getPos())?.attrs.status || 'todo';
        setAttr(editor, getPos, { status: VO_ORDER[(VO_ORDER.indexOf(cur) + 1) % VO_ORDER.length] });
      };
      // mousedown for the snappy feel; click as a fallback so programmatic / AT-driven
      // activation (a synthetic click with no preceding mousedown) can't be dropped.
      rec.addEventListener('mousedown', cycle);
      rec.addEventListener('click', (e) => { e.preventDefault(); });
      head.appendChild(rec);

      const view = cartridge({ blockClass: 'wp-vo', dataAttr: 'data-vo', node, editor, getPos, headChildren: [head] });
      view.dom.setAttribute('data-status', status0);
      return {
        ...view,
        update(updated) {
          if (updated.type.name !== 'voBlock') return false;
          const st = updated.attrs.status || 'todo';
          view.dom.setAttribute('data-status', st);
          paint(st);
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
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-oncam]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-oncam': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-oncam',
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
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
  draggable: true,
  addAttributes() {
    return {
      ...baseAttrs(),
      timecode: { default: '' }, day: { default: null }, ambiguous: { default: false },
      speaker: { default: '' }, done: { default: false }, rawTimecode: { default: '' },
    };
  },
  parseHTML() { return [{ tag: 'div[data-sot]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['div', mergeAttributes({
      'data-sot': '', 'data-block-id': a.blockId || '', 'data-done': a.done ? '1' : '0',
      class: 'wp-cart wp-sot' + (a.done ? ' is-done' : ''),
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
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
  draggable: true,
  addAttributes() {
    return {
      ...baseAttrs(),
      timecode: { default: '' }, day: { default: null }, ambiguous: { default: false },
      done: { default: false }, rawTimecode: { default: '' },
    };
  },
  parseHTML() { return [{ tag: 'div[data-broll]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['div', mergeAttributes({
      'data-broll': '', 'data-block-id': a.blockId || '', 'data-done': a.done ? '1' : '0',
      class: 'wp-cart wp-broll' + (a.done ? ' is-done' : ''),
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
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
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-montage]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-montage': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-montage',
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
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
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-none]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-none': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-none',
    }), ['div', { class: 'wp-none-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = el('div', 'wp-none');
      dom.setAttribute('data-none', '');
      if (node.attrs.blockId) dom.setAttribute('data-block-id', node.attrs.blockId);
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
  draggable: true,
  addAttributes() { return { ...baseAttrs(), kind: { default: 'note' } }; },
  parseHTML() { return [{ tag: 'div[data-note]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['div', mergeAttributes({
      'data-note': '', 'data-kind': a.kind, 'data-block-id': a.blockId || '', class: 'wp-cart wp-note',
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const head = el('div', 'wp-note-head', { contenteditable: 'false' });
      head.appendChild(Object.assign(el('span', 'wp-note-kind'), { textContent: node.attrs.kind === 'jh-note' ? 'JH NOTE' : 'EDITOR NOTE' }));
      const view = cartridge({ blockClass: 'wp-note', dataAttr: 'data-note', node, editor, getPos, headChildren: [head] });
      view.dom.setAttribute('data-kind', node.attrs.kind);
      return view;
    };
  },
});

// --- BIN — unplaced holding material (light cartridge, quietest) ---
export const BinBlock = Node.create({
  name: 'binBlock',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  draggable: true,
  addAttributes() { return { ...baseAttrs(), scaffold: { default: false } }; },
  parseHTML() { return [{ tag: 'div[data-bin]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-bin': '', 'data-block-id': node.attrs.blockId || '',
      'data-scaffold': node.attrs.scaffold ? '1' : '0',
      class: 'wp-cart wp-bin' + (node.attrs.scaffold ? ' is-scaffold' : ''),
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
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

export const BURMA_NODES = [
  ChapterBlock, SceneBlock, VoBlock, OncamBlock,
  SotBlock, BrollBlock, MontageBlock, NoneBlock, ScriptStart, NoteBlock, BinBlock,
];
