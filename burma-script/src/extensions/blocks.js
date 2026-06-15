// Burma Script Tool — custom ProseMirror NODES, one per block type.
// MIRRORS translation/src/editor/extensions/SpeakerBlock.js: each is a Node.create
// with group:'block', content:'paragraph+' (editable prose inside), addAttributes for
// the metadata. Every block is draggable:true so ProseMirror handles native reorder,
// and each ships a NodeView that OWNS its chrome (drag grip, copy/done/VO controls) and
// dispatches real transactions — no centralized DOM-walking mousedown shim.
//
// DESIGN LAW: blocks share ONE rhythm. Differentiation = node class + tiny gutter marks,
// never loud colored boxes. SOT/broll render the TIMECODE as the hero element.

import { Node, mergeAttributes } from '@tiptap/core';

const baseAttrs = () => ({ blockId: { default: null } });

const GENRE_LABEL = { coldopen: 'COLD', history: 'HIST', ground: 'GRND', inquiry: 'INQ', latm: 'MAP', other: '' };

// ---------------------------------------------------------------------------
// NodeView toolkit. A NodeView returns { dom, contentDOM } where `dom` is the
// whole block and `contentDOM` is the hole ProseMirror fills with editable
// child content. We build the chrome with plain DOM, wire control buttons to
// commands via the editor instance, and mark the drag grip draggable so PM's
// own drag machinery moves the node. Mirrors the SpeakerBlock ownership model.
// ---------------------------------------------------------------------------

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// The Notion-style drag grip. draggable=true + data-drag-handle tells the PM
// view to start a node drag from the OUTER node, so the whole block (chrome +
// content) moves as a unit and the dropcursor shows the drop target.
//
// The grip rail also hosts the Notion controls: "+" to insert a fresh block below,
// and the "∷" handle itself opens the block menu (change type / delete) on click,
// drags on drag. All actions dispatch real ProseMirror transactions.
function makeGrip(editor, getPos) {
  const rail = el('div', 'wp-grip', { contenteditable: 'false' });

  // "+" — insert a new editable paragraph-bearing block directly BELOW this one.
  const add = el('button', 'wp-add', { type: 'button', contenteditable: 'false', title: 'Add block below', 'aria-label': 'Add block below', tabindex: '-1' });
  add.textContent = '+';
  add.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    insertBlockBelow(editor, getPos);
  });

  // "∷" — the real drag handle. data-drag-handle + draggable lets PM move the whole
  // node. A plain click (no drag) opens the block menu.
  const handle = el('button', 'wp-handle', { type: 'button', contenteditable: 'false', 'data-drag-handle': '', draggable: 'true', title: 'Drag to move · click for menu', 'aria-label': 'Move or open block menu', tabindex: '-1' });
  handle.textContent = '∷';
  let dragged = false;
  handle.addEventListener('dragstart', () => { dragged = true; });
  handle.addEventListener('mousedown', () => { dragged = false; });
  handle.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (dragged) { dragged = false; return; }
    openBlockMenu(editor, getPos, handle);
  });

  rail.appendChild(add);
  rail.appendChild(handle);
  return rail;
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
  // drop the cursor into the new block's editable body (after + 2 lands inside the paragraph)
  try {
    const Selection = state.selection.constructor;
    tr = tr.setSelection(Selection.near(tr.doc.resolve(after + 2)));
  } catch {}
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

// Change a block's TYPE in place — preserves its editable content + blockId.
const TYPE_MENU = [
  ['voBlock', 'VO — voiceover'],
  ['oncamBlock', 'On camera'],
  ['sotBlock', 'SOT — sound on tape'],
  ['brollBlock', 'B-roll'],
  ['sceneBlock', 'Scene heading'],
  ['chapterBlock', 'Chapter heading'],
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
  // Build the target's default attrs from the schema, then carry over what survives.
  const defaults = {};
  const specAttrs = target.spec.attrs || {};
  for (const k in specAttrs) defaults[k] = specAttrs[k].default ?? null;
  const next = { ...defaults, blockId: node.attrs.blockId };
  if ('status' in defaults && node.attrs.status) next.status = node.attrs.status;
  // setNodeMarkup re-types the node, keeping its paragraph content intact.
  view.dispatch(state.tr.setNodeMarkup(pos, target, next));
}

function deleteBlock(editor, getPos) {
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (typeof pos !== 'number') return;
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  if (state.doc.childCount <= 1) return; // never empty the doc
  view.dispatch(state.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
  view.focus();
}

// A tiny floating menu anchored to the handle. Plain DOM (NodeView-owned), one open
// at a time. Change-type list + delete.
let openMenuEl = null;
function closeBlockMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; document.removeEventListener('mousedown', onDocDown, true); } }
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
  const del = el('button', 'wp-bm-item wp-bm-del', { type: 'button' });
  del.textContent = 'Delete block';
  del.addEventListener('mousedown', (e) => { e.preventDefault(); deleteBlock(editor, getPos); closeBlockMenu(); });
  menu.appendChild(del);

  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${r.left}px`;
  openMenuEl = menu;
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

// Shared shell: outer block dom + grip + (optional head row) + gutter + body.
function shellView({ blockClass, dataAttr, node, editor, getPos, gutterChildren, headChildren }) {
  const dom = el('div', blockClass);
  dom.setAttribute(dataAttr, '');
  if (node.attrs.blockId) dom.setAttribute('data-block-id', node.attrs.blockId);

  dom.appendChild(makeGrip(editor, getPos));

  if (headChildren && headChildren.length) {
    const head = el('div', 'wp-tc-head', { contenteditable: 'false' });
    headChildren.forEach((c) => head.appendChild(c));
    dom.appendChild(head);
  }

  const gutter = el('div', 'wp-gutter', { contenteditable: 'false' });
  (gutterChildren || []).forEach((c) => gutter.appendChild(c));
  dom.appendChild(gutter);

  const body = el('div', 'wp-body');
  dom.appendChild(body);

  return { dom, contentDOM: body };
}

// --- CHAPTER — quiet weighted heading. Genre is a FAINT gutter mark only. ---
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
      'data-block-id': node.attrs.blockId || '', class: 'wp-chapter',
    }), ['div', { class: 'wp-chapter-inner' }, 0]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = el('section', 'wp-chapter');
      dom.setAttribute('data-chapter', '');
      dom.setAttribute('data-genre', node.attrs.genre || 'other');
      if (node.attrs.blockId) dom.setAttribute('data-block-id', node.attrs.blockId);
      dom.appendChild(makeGrip(editor, getPos));
      // faint monochrome genre marker in a real gutter cell so it tracks the row
      // and wraps with multi-line titles (uniformity, correction #1).
      const gutter = el('div', 'wp-gutter wp-gutter-head', { contenteditable: 'false' });
      const g = node.attrs.genre || 'other';
      if (g !== 'other') gutter.appendChild(Object.assign(el('span', 'wp-kind'), { textContent: GENRE_LABEL[g] || g }));
      dom.appendChild(gutter);
      const inner = el('div', 'wp-chapter-inner');
      dom.appendChild(inner);
      return { dom, contentDOM: inner };
    };
  },
});

// --- SCENE — quieter sub-heading. Gutter mark rides in the gutter cell. ---
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
      'data-scene': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-scene',
    }), ['div', { class: 'wp-scene-inner' }, 0]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = el('section', 'wp-scene');
      dom.setAttribute('data-scene', '');
      if (node.attrs.blockId) dom.setAttribute('data-block-id', node.attrs.blockId);
      dom.appendChild(makeGrip(editor, getPos));
      const gutter = el('div', 'wp-gutter wp-gutter-head', { contenteditable: 'false' });
      gutter.appendChild(Object.assign(el('span', 'wp-kind'), { textContent: 'SCENE' }));
      dom.appendChild(gutter);
      const inner = el('div', 'wp-scene-inner');
      dom.appendChild(inner);
      return { dom, contentDOM: inner };
    };
  },
});

// --- VO — clean editable prose. status = tiny 3-state footprint in the gutter ---
const VO_ORDER = ['todo', 'recorded', 'in-edit'];
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
      'data-block-id': node.attrs.blockId || '', class: 'wp-block wp-vo',
    }),
      ['div', { class: 'wp-gutter', contenteditable: 'false' },
        ['span', { class: 'wp-kind' }, 'VO'],
        ['button', { class: 'wp-vodot', 'data-status': status }],
      ],
      ['div', { class: 'wp-body' }, 0],
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const kind = Object.assign(el('span', 'wp-kind'), { textContent: 'VO' });
      const dot = el('button', 'wp-vodot', { type: 'button', 'data-status': node.attrs.status || 'todo', title: 'VO status — click to cycle', 'aria-label': 'Cycle VO status' });
      dot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const cur = editor.state.doc.nodeAt(getPos())?.attrs.status || 'todo';
        setAttr(editor, getPos, { status: VO_ORDER[(VO_ORDER.indexOf(cur) + 1) % VO_ORDER.length] });
      });
      const view = shellView({ blockClass: 'wp-block wp-vo', dataAttr: 'data-vo', node, editor, getPos, gutterChildren: [kind, dot] });
      view.dom.setAttribute('data-status', node.attrs.status || 'todo');
      return {
        ...view,
        update(updated) {
          if (updated.type.name !== 'voBlock') return false;
          view.dom.setAttribute('data-status', updated.attrs.status || 'todo');
          dot.setAttribute('data-status', updated.attrs.status || 'todo');
          return true;
        },
      };
    };
  },
});

// --- ONCAM — editable prose, marked on-camera ---
export const OncamBlock = Node.create({
  name: 'oncamBlock',
  group: 'block',
  content: 'paragraph+',
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-oncam]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-oncam': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-block wp-oncam',
    }),
      ['div', { class: 'wp-gutter', contenteditable: 'false' }, ['span', { class: 'wp-kind' }, 'OC']],
      ['div', { class: 'wp-body' }, 0],
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const kind = Object.assign(el('span', 'wp-kind'), { textContent: 'OC' });
      return shellView({ blockClass: 'wp-block wp-oncam', dataAttr: 'data-oncam', node, editor, getPos, gutterChildren: [kind] });
    };
  },
});

// Build the hero head row shared by SOT + B-roll. Returns { children, copy, done }.
function timecodeHead({ node, editor, getPos, isBroll }) {
  const children = [];
  if (isBroll) children.push(Object.assign(el('span', 'wp-kind wp-kind-broll'), { textContent: 'B-ROLL' }));

  const tc = el('span', 'wp-tc' + (node.attrs.ambiguous ? ' wp-tc-amb' : ''));
  tc.textContent = node.attrs.timecode || '——:——:——:——';
  children.push(tc);

  const day = el('span', 'wp-day');
  day.textContent = node.attrs.ambiguous ? 'DAY ?' : (node.attrs.day ? 'DAY ' + node.attrs.day : '');
  children.push(day);

  if (!isBroll && node.attrs.speaker) {
    children.push(Object.assign(el('span', 'wp-speaker'), { textContent: node.attrs.speaker }));
  }

  children.push(el('span', 'wp-spacer'));

  const copy = el('button', 'wp-copy', { type: 'button', title: 'Copy timecode', 'aria-label': 'Copy timecode' });
  copy.textContent = '⧉'; // icon-only (correction #4)
  copy.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const raw = editor.state.doc.nodeAt(getPos())?.attrs.timecode || '';
    if (raw) navigator.clipboard?.writeText(raw).catch(() => {});
    copy.classList.add('copied');
    setTimeout(() => copy.classList.remove('copied'), 600);
  });
  children.push(copy);

  const done = el('button', 'wp-done' + (node.attrs.done ? ' is-done' : ''), { type: 'button', title: 'Mark done', 'aria-label': 'Mark done' });
  done.textContent = '✓';
  done.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const cur = editor.state.doc.nodeAt(getPos());
    setAttr(editor, getPos, { done: !cur?.attrs.done });
  });
  children.push(done);

  return { children, copy, done };
}

// --- SOT — the editorial workhorse. TIMECODE IS THE HERO. icon-copy. done-tick. ---
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
      class: 'wp-block wp-sot' + (a.done ? ' is-done' : ''),
    }), ['div', { class: 'wp-body' }, 0]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const built = timecodeHead({ node, editor, getPos, isBroll: false });
      const view = shellView({ blockClass: 'wp-block wp-sot' + (node.attrs.done ? ' is-done' : ''), dataAttr: 'data-sot', node, editor, getPos, headChildren: built.children });
      view.dom.setAttribute('data-done', node.attrs.done ? '1' : '0');
      return {
        ...view,
        update(updated) {
          if (updated.type.name !== 'sotBlock') return false;
          view.dom.classList.toggle('is-done', !!updated.attrs.done);
          view.dom.setAttribute('data-done', updated.attrs.done ? '1' : '0');
          built.done.classList.toggle('is-done', !!updated.attrs.done);
          return true;
        },
      };
    };
  },
});

// --- B-ROLL — same hero timecode, lighter speaker ---
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
      class: 'wp-block wp-broll' + (a.done ? ' is-done' : ''),
    }), ['div', { class: 'wp-body' }, 0]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const built = timecodeHead({ node, editor, getPos, isBroll: true });
      const view = shellView({ blockClass: 'wp-block wp-broll' + (node.attrs.done ? ' is-done' : ''), dataAttr: 'data-broll', node, editor, getPos, headChildren: built.children });
      view.dom.setAttribute('data-done', node.attrs.done ? '1' : '0');
      return {
        ...view,
        update(updated) {
          if (updated.type.name !== 'brollBlock') return false;
          view.dom.classList.toggle('is-done', !!updated.attrs.done);
          view.dom.setAttribute('data-done', updated.attrs.done ? '1' : '0');
          built.done.classList.toggle('is-done', !!updated.attrs.done);
          return true;
        },
      };
    };
  },
});

// --- SERVICE (map-need / archive-req) — calm utility block ---
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
      'data-service': '', 'data-kind': a.kind, 'data-block-id': a.blockId || '', class: 'wp-block wp-service',
    }),
      ['div', { class: 'wp-gutter', contenteditable: 'false' }, ['span', { class: 'wp-kind' }, a.kind === 'archive-req' ? 'ARCHIVE' : 'MAP']],
      ['div', { class: 'wp-body' }, 0],
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const kind = Object.assign(el('span', 'wp-kind'), { textContent: node.attrs.kind === 'archive-req' ? 'ARCHIVE' : 'MAP' });
      const view = shellView({ blockClass: 'wp-block wp-service', dataAttr: 'data-service', node, editor, getPos, gutterChildren: [kind] });
      view.dom.setAttribute('data-kind', node.attrs.kind);
      return view;
    };
  },
});

// --- NOTE / JH-NOTE — margin-voice aside ---
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
      'data-note': '', 'data-kind': a.kind, 'data-block-id': a.blockId || '', class: 'wp-block wp-note',
    }),
      ['div', { class: 'wp-gutter', contenteditable: 'false' }, ['span', { class: 'wp-kind' }, a.kind === 'jh-note' ? 'JH' : 'NOTE']],
      ['div', { class: 'wp-body' }, 0],
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const kind = Object.assign(el('span', 'wp-kind'), { textContent: node.attrs.kind === 'jh-note' ? 'JH' : 'NOTE' });
      const view = shellView({ blockClass: 'wp-block wp-note', dataAttr: 'data-note', node, editor, getPos, gutterChildren: [kind] });
      view.dom.setAttribute('data-kind', node.attrs.kind);
      return view;
    };
  },
});

// --- BIN — unplaced holding material, quietest of all ---
export const BinBlock = Node.create({
  name: 'binBlock',
  group: 'block',
  content: 'paragraph+',
  draggable: true,
  addAttributes() { return baseAttrs(); },
  parseHTML() { return [{ tag: 'div[data-bin]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-bin': '', 'data-block-id': node.attrs.blockId || '', class: 'wp-block wp-bin',
    }),
      ['div', { class: 'wp-gutter', contenteditable: 'false' }, ['span', { class: 'wp-kind' }, 'BIN']],
      ['div', { class: 'wp-body' }, 0],
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const kind = Object.assign(el('span', 'wp-kind'), { textContent: 'BIN' });
      return shellView({ blockClass: 'wp-block wp-bin', dataAttr: 'data-bin', node, editor, getPos, gutterChildren: [kind] });
    };
  },
});

export const BURMA_NODES = [
  ChapterBlock, SceneBlock, VoBlock, OncamBlock,
  SotBlock, BrollBlock, ServiceBlock, NoteBlock, BinBlock,
];
