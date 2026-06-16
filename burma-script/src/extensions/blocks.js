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

// Insert a fresh paragraph block (defaults to a VO-style writing block) below `getPos`.
function insertBlockBelow(editor, getPos) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (typeof pos !== 'number') return;
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const after = pos + node.nodeSize;
  const fresh = state.schema.nodes.voBlock.createAndFill({ blockId: 'blk_' + Math.random().toString(36).slice(2, 9), status: 'todo' });
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
const TYPE_MENU = [
  ['chapterBlock', 'CHAPTER'],
  ['voBlock', 'VO — narration'],
  ['oncamBlock', 'On camera'],
  ['sotBlock', 'SOT — soundbite'],
  ['brollBlock', 'B-roll'],
  ['sceneBlock', 'Scene heading'],
  ['noteBlock', 'Note'],
  ['binBlock', 'Bin — holding'],
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

function deleteBlock(editor, getPos) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (typeof pos !== 'number') return;
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  if (state.doc.childCount <= 1) return;
  view.dispatch(state.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
  view.focus();
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

// --- CHAPTER — inverted dark cartridge, ivory cap, ACT tag ---
export const ChapterBlock = Node.create({
  name: 'chapterBlock',
  group: 'block',
  content: 'paragraph+',
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
      const kind = Object.assign(el('span', 'wp-ch-kind'), { textContent: 'CH · ACT' });
      const tag = Object.assign(el('span', 'wp-ch-tag'), { textContent: ACT_TAG[node.attrs.genre || 'other'] || '' });
      head.appendChild(kind); head.appendChild(tag);
      const view = cartridge({ blockClass: 'wp-chapter', dataAttr: 'data-chapter', node, editor, getPos, headChildren: [head] });
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
  content: 'paragraph+',
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
  content: 'paragraph+',
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
  content: 'paragraph+',
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-oncam]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-oncam': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-cart wp-oncam',
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const head = el('div', 'wp-vo-head', { contenteditable: 'false' });
      head.appendChild(Object.assign(el('span', 'wp-vo-kind'), { textContent: 'ON CAMERA' }));
      return cartridge({ blockClass: 'wp-oncam', dataAttr: 'data-oncam', node, editor, getPos, headChildren: [head] });
    };
  },
});

// --- SOT — orange cap, recessed LCD timecode window + speaker + quote + done toggle ---
export const SotBlock = Node.create({
  name: 'sotBlock',
  group: 'block',
  content: 'paragraph+',
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
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const a = node.attrs;

      // recessed LCD window — day label over ivory timecode digits. Click copies.
      const win = el('div', 'wp-lcd', { contenteditable: 'false', title: 'copy timecode', role: 'button', tabindex: '-1' });
      const dayLabel = Object.assign(el('div', 'wp-lcd-day'), { textContent: a.ambiguous ? 'DAY ?' : (a.day ? 'DAY ' + a.day : 'DAY') });
      const digits = Object.assign(el('div', 'wp-lcd-tc'), { textContent: a.timecode || '——:——:——:——' });
      win.appendChild(dayLabel); win.appendChild(digits);
      win.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const raw = editor.state.doc.nodeAt(getPos())?.attrs.timecode || '';
        if (raw) {
          navigator.clipboard?.writeText(raw).catch(() => {});
          window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tc: raw } }));
        }
        win.classList.add('copied');
        setTimeout(() => win.classList.remove('copied'), 700);
      });

      // speaker label sits above the quote — built into a middle column wrapper.
      const mid = el('div', 'wp-sot-mid', { contenteditable: 'false' });
      const spk = Object.assign(el('div', 'wp-sot-spk'), { textContent: a.speaker || 'SOT' });
      mid.appendChild(spk);

      // done toggle (right).
      const done = el('button', 'wp-done' + (a.done ? ' is-done' : ''), { type: 'button', contenteditable: 'false', title: 'mark done', 'aria-label': 'mark done', tabindex: '-1' });
      done.textContent = '✓';
      done.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const cur = editor.state.doc.nodeAt(getPos());
        setAttr(editor, getPos, { done: !cur?.attrs.done });
      });

      // 3-column grid: [LCD] [speaker+quote] [done]. The quote prose IS the editable body,
      // so we place it inside the middle column after the speaker label.
      const view = cartridge({ blockClass: 'wp-sot', dataAttr: 'data-sot', node, editor, getPos, headChildren: [win, mid, done], bodyClass: 'wp-sot-grid' });
      // move the editable .wp-body INTO the middle column under the speaker label.
      mid.appendChild(view.contentDOM);
      view.dom.setAttribute('data-done', a.done ? '1' : '0');
      return {
        ...view,
        update(updated) {
          if (updated.type.name !== 'sotBlock') return false;
          view.dom.classList.toggle('is-done', !!updated.attrs.done);
          view.dom.setAttribute('data-done', updated.attrs.done ? '1' : '0');
          done.classList.toggle('is-done', !!updated.attrs.done);
          return true;
        },
      };
    };
  },
});

// --- B-ROLL — burgundy cap, copy-timecode string + mono desc + [visual] chip ---
export const BrollBlock = Node.create({
  name: 'brollBlock',
  group: 'block',
  content: 'paragraph+',
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
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const a = node.attrs;
      const head = el('div', 'wp-broll-head', { contenteditable: 'false' });
      head.appendChild(Object.assign(el('span', 'wp-broll-kind'), { textContent: 'B-ROLL' }));

      const tcStr = el('span', 'wp-broll-tc', { title: 'copy timecode', role: 'button', tabindex: '-1' });
      const dayTxt = a.ambiguous ? 'DAY ?' : (a.day ? 'DAY ' + a.day : 'DAY');
      tcStr.textContent = `${dayTxt} · ${a.timecode || '——:——:——:——'} ⧉`;
      tcStr.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const raw = editor.state.doc.nodeAt(getPos())?.attrs.timecode || '';
        if (raw) {
          navigator.clipboard?.writeText(raw).catch(() => {});
          window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tc: raw } }));
        }
        tcStr.classList.add('copied');
        setTimeout(() => tcStr.classList.remove('copied'), 700);
      });
      head.appendChild(tcStr);

      const view = cartridge({ blockClass: 'wp-broll', dataAttr: 'data-broll', node, editor, getPos, headChildren: [head] });
      view.dom.setAttribute('data-done', a.done ? '1' : '0');
      return {
        ...view,
        update(updated) {
          if (updated.type.name !== 'brollBlock') return false;
          view.dom.classList.toggle('is-done', !!updated.attrs.done);
          view.dom.setAttribute('data-done', updated.attrs.done ? '1' : '0');
          return true;
        },
      };
    };
  },
});

// --- SERVICE (map-need / archive-req) — light cartridge, kind label ---
export const ServiceBlock = Node.create({
  name: 'serviceBlock',
  group: 'block',
  content: 'paragraph+',
  draggable: true,
  addAttributes() {
    return { ...baseAttrs(), kind: { default: 'map-need' }, label: { default: '' } };
  },
  parseHTML() { return [{ tag: 'div[data-service]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['div', mergeAttributes({
      'data-service': '', 'data-kind': a.kind, 'data-block-id': a.blockId || '', class: 'wp-cart wp-service',
    }), ['div', { class: 'wp-cart-body' }, ['div', { class: 'wp-body' }, 0]]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const head = el('div', 'wp-svc-head', { contenteditable: 'false' });
      head.appendChild(Object.assign(el('span', 'wp-svc-kind'), { textContent: node.attrs.kind === 'archive-req' ? 'ARCHIVE REQUEST' : 'MAPPING NEED' }));
      const view = cartridge({ blockClass: 'wp-service', dataAttr: 'data-service', node, editor, getPos, headChildren: [head] });
      view.dom.setAttribute('data-kind', node.attrs.kind);
      return view;
    };
  },
});

// --- NOTE / JH-NOTE — yellow cap, tinted cartridge, italic note ---
export const NoteBlock = Node.create({
  name: 'noteBlock',
  group: 'block',
  content: 'paragraph+',
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
  content: 'paragraph+',
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
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const scaffold = !!node.attrs.scaffold;
      const head = el('div', 'wp-bin-head', { contenteditable: 'false' });
      head.appendChild(Object.assign(el('span', 'wp-bin-kind'), { textContent: scaffold ? 'SETUP' : 'BIN' }));
      const view = cartridge({ blockClass: 'wp-bin' + (scaffold ? ' is-scaffold' : ''), dataAttr: 'data-bin', node, editor, getPos, headChildren: [head] });
      view.dom.setAttribute('data-scaffold', scaffold ? '1' : '0');
      return view;
    };
  },
});

export const BURMA_NODES = [
  ChapterBlock, SceneBlock, VoBlock, OncamBlock,
  SotBlock, BrollBlock, ServiceBlock, NoteBlock, BinBlock,
];
