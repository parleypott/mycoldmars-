import { Node } from '@tiptap/core';
import { isReadOnly } from '../read-mode.js';

export const DIRECTION_CHIP_KINDS = ['archive', 'factcheck', 'animation', 'broll', 'direction'];

export function defaultDirectionChipAttrs(kind) {
  switch (kind) {
    case 'archive':
      return { kind, status: 'needed', filePath: '' };
    case 'factcheck':
      return { kind, status: 'todo', filePath: '' };
    case 'animation':
      return { kind, status: 'static', filePath: '' };
    case 'broll':
      return { kind, status: 'unchecked', filePath: '' };
    case 'direction':
    default:
      return { kind: 'direction', status: 'default', filePath: '' };
  }
}

export function directionChipText(attrs) {
  const kind = attrs?.kind || 'direction';
  const status = attrs?.status || defaultDirectionChipAttrs(kind).status;
  const filePath = String(attrs?.filePath || '').trim();
  if (kind === 'archive') {
    if (status === 'found') return `ARCHIVE FOUND (${filePath || 'file path'})`;
    return 'ARCHIVE NEEDED';
  }
  if (kind === 'factcheck') return status === 'sourced' ? 'SOURCED' : 'NEEDS FACT CHECK + SOURCE';
  if (kind === 'animation') return 'ANIMATION';
  if (kind === 'broll') return `${status === 'checked' ? '[x]' : '[ ]'} B-ROLL (shot)`;
  return '[General Direction]';
}

export function nextDirectionChipAttrs(attrs) {
  const kind = attrs?.kind || 'direction';
  const status = attrs?.status || defaultDirectionChipAttrs(kind).status;
  if (kind === 'archive') return { ...attrs, status: status === 'found' ? 'needed' : 'found' };
  if (kind === 'factcheck') return { ...attrs, status: status === 'sourced' ? 'todo' : 'sourced' };
  if (kind === 'broll') return { ...attrs, status: status === 'checked' ? 'unchecked' : 'checked' };
  // Animation and the plain direction chip are intentionally single-state tokens.
  return null;
}

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function readDirectionChipAttr(element, name, fallback) {
  const value = element.getAttribute(name);
  return value == null || value === '' ? fallback : value;
}

function editArchivePath(editor, getPos) {
  if (isReadOnly()) return;
  const pos = typeof getPos === 'function' ? getPos() : getPos;
  if (typeof pos !== 'number') return;
  const cur = editor.state.doc.nodeAt(pos);
  if (!cur || cur.type.name !== 'directionChip') return;
  if (cur.attrs.kind !== 'archive' || cur.attrs.status !== 'found') return;
  const next = window.prompt('Archive file path', cur.attrs.filePath || 'file path');
  if (next == null) return;
  const filePath = String(next).trim();
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, filePath }));
}

export const DirectionChip = Node.create({
  name: 'directionChip',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: false,
  addAttributes() {
    const defaults = defaultDirectionChipAttrs('direction');
    return {
      kind: {
        default: defaults.kind,
        parseHTML: (element) => readDirectionChipAttr(element, 'data-kind', defaults.kind),
        renderHTML: (attributes) => ({ 'data-kind': attributes.kind || defaults.kind }),
      },
      status: {
        default: defaults.status,
        parseHTML: (element) => readDirectionChipAttr(element, 'data-status', defaults.status),
        renderHTML: (attributes) => ({ 'data-status': attributes.status || defaults.status }),
      },
      filePath: {
        default: defaults.filePath,
        parseHTML: (element) => element.getAttribute('data-file') || '',
        renderHTML: (attributes) => ({ 'data-file': attributes.filePath || '' }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-dchip]' }];
  },
  renderHTML({ node }) {
    return ['span', {
      'data-dchip': '',
      'data-kind': node.attrs.kind || 'direction',
      'data-status': node.attrs.status || defaultDirectionChipAttrs(node.attrs.kind).status,
      'data-file': node.attrs.filePath || '',
      class: 'wp-dchip',
    }, directionChipText(node.attrs)];
  },
  renderText({ node }) {
    return directionChipText(node.attrs);
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = el('span', 'wp-dchip', {
        contenteditable: 'false',
        tabindex: '0',
        'data-dchip': '',
      });
      const paint = (attrs) => {
        dom.textContent = directionChipText(attrs);
        dom.setAttribute('data-kind', attrs?.kind || 'direction');
        dom.setAttribute('data-status', attrs?.status || defaultDirectionChipAttrs(attrs?.kind).status);
        dom.setAttribute('data-file', attrs?.filePath || '');
        dom.setAttribute('aria-label', directionChipText(attrs));
        if (attrs?.kind === 'archive' && attrs?.status === 'found') dom.setAttribute('title', 'Right-click to edit archive path');
        else dom.removeAttribute('title');
      };
      paint(node.attrs);

      dom.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        if (isReadOnly()) return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const cur = editor.state.doc.nodeAt(pos);
        const next = nextDirectionChipAttrs(cur?.attrs);
        if (!next) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, next));
      });
      dom.addEventListener('contextmenu', (e) => {
        const cur = editor.state.doc.nodeAt(getPos());
        if (cur?.attrs.kind !== 'archive' || cur?.attrs.status !== 'found') return;
        e.preventDefault();
        editArchivePath(editor, getPos);
      });
      dom.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        e.preventDefault();
        if (isReadOnly()) return;
        const cur = editor.state.doc.nodeAt(getPos());
        if (e.shiftKey && cur?.attrs.kind === 'archive' && cur?.attrs.status === 'found') {
          editArchivePath(editor, getPos);
          return;
        }
        const next = nextDirectionChipAttrs(cur?.attrs);
        if (!next) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, next));
      });

      return {
        dom,
        ignoreMutation: () => true,
        update(updated) {
          if (updated.type.name !== 'directionChip') return false;
          paint(updated.attrs);
          return true;
        },
      };
    };
  },
});

export function directionChipCommand(editor, kind) {
  return editor
    .chain()
    .focus()
    .insertContent({ type: 'directionChip', attrs: defaultDirectionChipAttrs(kind) })
    .run();
}

export const DirectionBreak = Node.create({
  name: 'directionBreak',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,
  parseHTML() {
    return [{ tag: 'div[data-dchip-break]' }];
  },
  renderHTML() {
    return ['div', { 'data-dchip-break': '', class: 'wp-dchip-break', contenteditable: 'false' }, 'VISUAL BREAK'];
  },
  renderText() {
    return '';
  },
  addNodeView() {
    return () => {
      const dom = el('div', 'wp-dchip-break', { 'data-dchip-break': '', contenteditable: 'false' });
      dom.textContent = 'VISUAL BREAK';
      return { dom, ignoreMutation: () => true };
    };
  },
});
