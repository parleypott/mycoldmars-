import { Node, Mark } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isReadOnly } from '../read-mode.js';

export const DIRECTION_CHIP_KINDS = ['archive', 'factcheck', 'animation', '3d', 'broll', 'direction'];

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

export function defaultDirectionMarkAttrs(kind) {
  switch (kind) {
    case 'archive':   return { kind, status: 'needed' };
    case 'factcheck': return { kind, status: 'todo' };
    case 'animation': return { kind, status: 'static' };
    case '3d':        return { kind, status: 'static' };
    case 'broll':     return { kind, status: 'unchecked' };
    case 'direction':
    default:          return { kind: 'direction', status: 'default' };
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

// ── ARCHIVE MARK CHECKBOX PLUGIN ────────────────────────────────────────────────────────────
// For each contiguous run of directionMark with kind='archive' in the doc, render a small
// clickable checkbox widget (☐/☑) at the start of the run. Clicking toggles the status of
// the entire run between 'needed' (red) and 'found' (green).

function findArchiveMarkRuns(doc, markType) {
  const runs = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const archiveMark = node.marks.find((m) => m.type === markType && m.attrs.kind === 'archive');
    if (!archiveMark) return;
    const from = pos;
    const to = pos + node.nodeSize;
    const status = archiveMark.attrs.status;
    // Merge with the previous run if immediately adjacent (no gap between text nodes)
    const last = runs.length > 0 ? runs[runs.length - 1] : null;
    if (last && last.to === from) {
      last.to = to;
      return;
    }
    runs.push({ from, to, status });
  });
  return runs;
}

function buildCheckboxDecorations(state) {
  const markType = state.schema.marks.directionMark;
  if (!markType) return DecorationSet.empty;
  const runs = findArchiveMarkRuns(state.doc, markType);
  if (!runs.length) return DecorationSet.empty;

  const decos = runs.map(({ from, to, status }) => {
    const checked = status === 'found';
    return Decoration.widget(
      from,
      (view, getPos) => {
        const cb = document.createElement('span');
        cb.setAttribute('contenteditable', 'false');
        cb.className = 'wp-dhl-cb';
        cb.setAttribute('data-dhl-checkbox', '');
        cb.textContent = checked ? '☑' : '☐';
        cb.title = checked ? 'Mark as needed' : 'Mark as found';

        cb.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (isReadOnly()) return;
          const currentState = view.state;
          const mt = currentState.schema.marks.directionMark;
          if (!mt) return;
          const currentPos = typeof getPos === 'function' ? getPos() : null;
          const allRuns = findArchiveMarkRuns(currentState.doc, mt);
          // Find the run containing the widget's current position
          const run = currentPos != null
            ? allRuns.find((r) => r.from <= currentPos && r.to > currentPos)
              || allRuns.find((r) => Math.abs(r.from - currentPos) <= 2)
            : null;
          if (!run) return;
          const newStatus = run.status === 'found' ? 'needed' : 'found';
          let tr = currentState.tr;
          tr = tr.removeMark(run.from, run.to, mt);
          tr = tr.addMark(run.from, run.to, mt.create({ kind: 'archive', status: newStatus }));
          view.dispatch(tr);
        });

        return cb;
      },
      { side: -1 }, // widget appears BEFORE the first character of the run
    );
  });

  return DecorationSet.create(state.doc, decos);
}

function createArchiveCheckboxPlugin() {
  return new Plugin({
    state: {
      init(_, state) { return buildCheckboxDecorations(state); },
      apply(tr, set, _oldState, newState) {
        if (!tr.docChanged) return set.map(tr.mapping, tr.doc);
        return buildCheckboxDecorations(newState);
      },
    },
    props: {
      decorations(state) { return this.getState(state); },
    },
  });
}

// ── DIRECTION MARK — the highlighter ────────────────────────────────────────────────────────
// A mark (not an atom node) so the user types their own direction text with highlight
// formatting applied. inclusive: true means typing at the end of a marked range continues
// with the mark — the highlight persists as Johnny types and presses Enter.
export const DirectionMark = Mark.create({
  name: 'directionMark',

  // CRITICAL: inclusive:true → cursor at the end of a marked range IS inside the mark;
  // the next typed character (and subsequent ones) inherits the mark automatically.
  // This is what makes the highlight persist as he types.
  inclusive: true,

  addAttributes() {
    return {
      kind: {
        default: 'direction',
        parseHTML: (el) => el.getAttribute('data-kind') || 'direction',
        renderHTML: (attrs) => ({ 'data-kind': attrs.kind || 'direction' }),
      },
      status: {
        default: 'default',
        parseHTML: (el) => el.getAttribute('data-status') || 'default',
        renderHTML: (attrs) => ({ 'data-status': attrs.status || 'default' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-dhl]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { 'data-dhl': '', class: 'wp-dhl', ...HTMLAttributes }, 0];
  },

  addProseMirrorPlugins() {
    return [createArchiveCheckboxPlugin()];
  },
});

// ── BACK-COMPAT: DirectionChip atom node (kept for parsing old saved docs) ─────────────────
// The slash menu NO LONGER inserts this. It remains registered so existing saved docs that
// contain a <span data-dchip> atom still render correctly and round-trip without data loss.
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

// Legacy command kept for any back-compat callers (not used by slash menu any more).
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
