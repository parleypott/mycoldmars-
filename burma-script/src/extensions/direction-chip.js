import { Node, Mark } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isReadOnly } from '../read-mode.js';
import { episodeFlag } from '../episode-config.js';

export const DIRECTION_CHIP_KINDS = ['archive', 'oncam', 'factcheck', 'animation', '3d', 'broll', 'direction'];

// The two "checkbox" direction kinds — a red run + a ☐/☑ that cycles needed↔found.
// Archive is the original; oncam ("on cam to film") behaves identically but reads a
// distinctly warmer/deeper red so the two never blur together at a glance.
export const CHECKBOX_MARK_KINDS = ['archive', 'oncam'];

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
    case 'oncam':     return { kind, status: 'needed' };
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

// ── CHECKBOX MARK PLUGIN (archive + oncam) ──────────────────────────────────────────────────
// For each contiguous run of directionMark whose kind is a CHECKBOX_MARK_KIND ('archive' or
// 'oncam'), render a small clickable checkbox widget (☐/☑) at the start of the run. Clicking
// toggles the status of the entire run between 'needed' (red) and 'found' (green). The run
// carries its own kind so the toggle rebuilds the mark as the SAME kind it started as — archive
// stays archive, oncam stays oncam.

function findCheckboxMarkRuns(doc, markType) {
  const runs = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find(
      (m) => m.type === markType && CHECKBOX_MARK_KINDS.includes(m.attrs.kind),
    );
    if (!mark) return;
    const from = pos;
    const to = pos + node.nodeSize;
    const kind = mark.attrs.kind;
    const status = mark.attrs.status;
    // Merge with the previous run only if it is immediately adjacent AND the same kind, so an
    // archive run and an oncam run that touch never fuse into one checkbox.
    const last = runs.length > 0 ? runs[runs.length - 1] : null;
    if (last && last.to === from && last.kind === kind) {
      last.to = to;
      return;
    }
    runs.push({ from, to, kind, status });
  });
  return runs;
}

function buildCheckboxDecorations(state) {
  const markType = state.schema.marks.directionMark;
  if (!markType) return DecorationSet.empty;
  const runs = findCheckboxMarkRuns(state.doc, markType);
  if (!runs.length) return DecorationSet.empty;

  // archiveOwnLine flag (Palau opts in): an archive run that leads its paragraph gets a small left
  // indent so it reads as its own indented, checkable line. Gated on the same flag as the slash-menu
  // side so Burma renders byte-for-byte as before (its inline archives never shift). oncam is never
  // indented — only archive owes it.
  const isPalau = episodeFlag('archiveOwnLine');
  const decos = [];

  runs.forEach(({ from, to, kind, status }) => {
    const checked = status === 'found';
    decos.push(
      Decoration.widget(
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
            const allRuns = findCheckboxMarkRuns(currentState.doc, mt);
            // Find the run containing the widget's current position
            const run = currentPos != null
              ? allRuns.find((r) => r.from <= currentPos && r.to > currentPos)
                || allRuns.find((r) => Math.abs(r.from - currentPos) <= 2)
              : null;
            if (!run) return;
            const newStatus = run.status === 'found' ? 'needed' : 'found';
            let tr = currentState.tr;
            tr = tr.removeMark(run.from, run.to, mt);
            tr = tr.addMark(run.from, run.to, mt.create({ kind: run.kind, status: newStatus }));
            view.dispatch(tr);
          });

          return cb;
        },
        { side: -1 }, // widget appears BEFORE the first character of the run
      ),
    );

    if (isPalau && kind === 'archive') {
      const $from = state.doc.resolve(from);
      // Only indent when the archive run STARTS its paragraph (its own popped line), never a
      // mid-sentence archive. parentOffset 0 = first inline content of the textblock.
      if ($from.parent.isTextblock && $from.parentOffset === 0) {
        const paraStart = $from.before();
        const paraEnd = $from.after();
        decos.push(Decoration.node(paraStart, paraEnd, { class: 'wp-archive-line' }));
      }
    }
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

// ── EMPTY-CHIP PLACEHOLDER PLUGIN ────────────────────────────────────────────────────────────
// The moment a /command + Enter fires, setMark on the empty cursor stores a directionMark but
// there's no text yet — so nothing shows and Johnny stares at a bare caret. This plugin paints the
// BEGINNINGS of the chip: an empty little box (styled exactly like .wp-dhl[data-kind=K]) at the
// cursor, plus a leading ☐ for the archive/oncam checkbox kinds. It's a pure cursor decoration — it
// reads state.storedMarks, renders only while the selection is empty and that stored mark is live,
// and vanishes on the first keystroke (the typed char takes the mark, storedMarks clears, and the
// real chip renders in its place). Nothing is inserted into the doc, so saved output is untouched.
function storedDirectionMark(state) {
  const markType = state.schema.marks.directionMark;
  if (!markType) return null;
  const { selection, storedMarks } = state;
  // Only a collapsed caret with an explicitly-stored directionMark qualifies. A caret sitting
  // inside existing marked text (storedMarks === null) already shows the real chip, so skip it.
  if (!selection.empty || !storedMarks) return null;
  return storedMarks.find((m) => m.type === markType) || null;
}

function buildPlaceholderDecorations(state) {
  const mark = storedDirectionMark(state);
  if (!mark) return DecorationSet.empty;
  const kind = mark.attrs.kind || 'direction';
  const status = mark.attrs.status || defaultDirectionMarkAttrs(kind).status;
  const pos = state.selection.from;

  const widget = Decoration.widget(
    pos,
    () => {
      const wrap = document.createElement('span');
      wrap.setAttribute('contenteditable', 'false');
      wrap.className = 'wp-dhl-placeholder-wrap';
      // archive/oncam lead with the ☐ checkbox exactly like a real run does.
      if (CHECKBOX_MARK_KINDS.includes(kind)) {
        const cb = document.createElement('span');
        cb.className = 'wp-dhl-cb';
        cb.setAttribute('data-dhl-placeholder-cb', '');
        cb.textContent = status === 'found' ? '☑' : '☐';
        wrap.appendChild(cb);
      }
      const box = document.createElement('span');
      box.className = 'wp-dhl wp-dhl-placeholder';
      box.setAttribute('data-kind', kind);
      box.setAttribute('data-status', status);
      box.setAttribute('data-dhl-placeholder', '');
      wrap.appendChild(box);
      return wrap;
    },
    // side:1 keeps the caret to the LEFT of the box so it reads as "the box I'm about to type into",
    // and gives the widget a stable key so ProseMirror doesn't thrash it between renders.
    { side: 1, key: `dhl-ph-${kind}-${status}` },
  );

  return DecorationSet.create(state.doc, [widget]);
}

function createPlaceholderChipPlugin() {
  return new Plugin({
    props: {
      // Recomputed on every view update (selection + storedMarks both change without docChanged),
      // so the box appears the instant the mark is stored and disappears the instant it clears.
      decorations(state) { return buildPlaceholderDecorations(state); },
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
    return [createArchiveCheckboxPlugin(), createPlaceholderChipPlugin()];
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
