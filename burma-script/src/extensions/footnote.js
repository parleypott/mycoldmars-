// FACT-CHECK FOOTNOTE — the receipt that rides beside a verified fact.
//
// The {fc}/{TK} chips are the CLAIMS — they stay live and clickable forever (lineage law:
// never bake a marker into plain text). This node is the separate RECEIPT: a small green
// circle-check icon pinned inline right after the asserted fact. Click it and a comment
// card flies out — Google-Docs-margin style — holding the fact-check CONTEXT and the
// SOURCE, both editable in place. It is an inline ATOM: the note/source/claim live in node
// attrs, so they travel with the doc through autosave, cloud snapshots, IndexedDB recovery,
// Yjs collab, and copy/paste — no side table, nothing to desync.
//
// EXPORT LAW — docToBlocks() serializes the footnote as a `{fn <note> || <source>}` token
// (document-builder nodeText), and inlineContent() parses that token back into a real
// fcFootnote node. So even the derived blocks view never silently drops the writer's
// fact-check words — the one export/rebuild round-trip keeps note + source intact.
//
// Born from the Workshop dock's CREATE FOOTNOTE button (Editor.jsx 'wp-create-footnote'
// listener, stale-range-guarded like every Workshop insert) or auto-attached when a
// researched option / suggested edit replaces a marker (lineage rides along).

import { Node, mergeAttributes } from '@tiptap/core';
import { isReadOnly } from '../read-mode.js';

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

export function mintNoteId() {
  return 'fn_' + Math.random().toString(36).slice(2, 9);
}

// ── the fly-out comment card (one live instance) ────────────────────────────────────────────
// Fixed-position card near the clicked icon, clamped to the viewport, closed on Escape /
// click-away / scroll — the same calm floating discipline as the slash / convert menus.
// Edits debounce into ONE setNodeMarkup per pause (500ms), with a hard flush on close, so
// the doc always holds the latest words and the history isn't shredded per keystroke.
let openPanel = null;
export function closeOpenFootnotePanel() {
  if (openPanel) { openPanel.close(); openPanel = null; }
}

function createFootnotePanel(editor, getPos, iconDom) {
  const readOnly = isReadOnly();
  const panel = el('div', 'wp-fnote-panel', { contenteditable: 'false', role: 'dialog', 'aria-label': 'fact-check footnote' });

  const liveAttrs = () => {
    const pos = typeof getPos === 'function' ? getPos() : getPos;
    if (typeof pos !== 'number') return null;
    const node = editor.state.doc.nodeAt(pos);
    return node && node.type.name === 'fcFootnote' ? node.attrs : null;
  };
  const attrs0 = liveAttrs() || {};

  let onDocDown = null;
  let onKey = null;
  let onScroll = null;
  let saveTimer = null;
  const pending = {};

  const flush = () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!Object.keys(pending).length) return;
    const pos = typeof getPos === 'function' ? getPos() : getPos;
    if (typeof pos !== 'number') return;
    const cur = editor.state.doc.nodeAt(pos);
    if (!cur || cur.type.name !== 'fcFootnote') return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...pending }),
    );
    for (const k in pending) delete pending[k];
  };
  const queueSave = (patch) => {
    Object.assign(pending, patch);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 500);
  };

  const close = () => {
    if (!panel.parentNode) return;
    flush(); // never lose in-flight words
    if (onDocDown) document.removeEventListener('mousedown', onDocDown, true);
    if (onKey) document.removeEventListener('keydown', onKey, true);
    if (onScroll) {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    }
    panel.remove();
  };

  // HEAD — green check identity + close
  const head = el('div', 'wp-fnote-head');
  const badge = el('span', 'wp-fnote-badge');
  badge.textContent = '✓ FACT CHECK';
  head.appendChild(badge);
  const closeBtn = el('button', 'wp-fnote-close', { type: 'button', title: 'Close' });
  closeBtn.textContent = '×';
  closeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); close(); openPanel = null; });
  head.appendChild(closeBtn);
  panel.appendChild(head);

  // THE CLAIM — the original marker text, quiet + read-only (the lineage line)
  if (attrs0.marker) {
    const claim = el('div', 'wp-fnote-claim');
    claim.textContent = attrs0.marker;
    panel.appendChild(claim);
  }

  // NOTE — the fact-check context, editable
  const noteLabel = el('label', 'wp-fnote-label');
  noteLabel.textContent = 'Context';
  panel.appendChild(noteLabel);
  const note = el('textarea', 'wp-fnote-text', { rows: '3', placeholder: 'What did the check find?' });
  note.value = attrs0.note || '';
  if (readOnly) note.setAttribute('disabled', '');
  note.addEventListener('input', () => queueSave({ note: note.value }));
  panel.appendChild(note);

  // SOURCE — editable
  const srcLabel = el('label', 'wp-fnote-label');
  srcLabel.textContent = 'Source';
  panel.appendChild(srcLabel);
  const src = el('textarea', 'wp-fnote-text wp-fnote-src', { rows: '2', placeholder: 'Where it comes from (link or citation)' });
  src.value = attrs0.source || '';
  if (readOnly) src.setAttribute('disabled', '');
  src.addEventListener('input', () => queueSave({ source: src.value }));
  panel.appendChild(src);

  // linkified source URLs, so a reader can click straight through
  const urls = String(attrs0.source || '').match(/https?:\/\/\S+/g) || [];
  if (urls.length) {
    const links = el('div', 'wp-fnote-links');
    urls.slice(0, 4).forEach((u) => {
      const a = el('a', 'wp-fnote-link', { href: u, target: '_blank', rel: 'noopener noreferrer' });
      a.textContent = u.replace(/^https?:\/\//, '').slice(0, 46);
      links.appendChild(a);
    });
    panel.appendChild(links);
  }

  // DELETE — writers only
  if (!readOnly) {
    const del = el('button', 'wp-fnote-delete', { type: 'button' });
    del.textContent = 'Delete footnote';
    del.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const pos = typeof getPos === 'function' ? getPos() : getPos;
      if (typeof pos !== 'number') return;
      const cur = editor.state.doc.nodeAt(pos);
      if (!cur || cur.type.name !== 'fcFootnote') return;
      close(); openPanel = null;
      editor.view.dispatch(editor.state.tr.delete(pos, pos + cur.nodeSize));
      editor.view.focus();
    });
    panel.appendChild(del);
  }

  document.body.appendChild(panel);

  // Fly out beside the icon — right of it when there's room (margin-comment feel), else left.
  const r = iconDom.getBoundingClientRect();
  panel.style.position = 'fixed';
  const bw = panel.getBoundingClientRect().width || 320;
  let left = r.right + 10;
  if (left + bw > window.innerWidth - 8) left = Math.max(8, r.left - bw - 10);
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.max(8, Math.min(r.top - 8, window.innerHeight - panel.getBoundingClientRect().height - 8))}px`;

  onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); openPanel = null; editor.view.focus(); }
  };
  onDocDown = (e) => { if (!panel.contains(e.target) && e.target !== iconDom && !iconDom.contains(e.target)) { close(); openPanel = null; } };
  onScroll = (e) => { if (panel.contains(e.target)) return; close(); openPanel = null; };
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  if (!readOnly) requestAnimationFrame(() => note.focus());

  return { panel, close };
}

// ── the node ─────────────────────────────────────────────────────────────────────────────────
export const FcFootnote = Node.create({
  name: 'fcFootnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      noteId: { default: null },
      note: { default: '' },     // fact-check context — editable in the fly-out
      source: { default: '' },   // source link / citation — editable in the fly-out
      marker: { default: '' },   // the original {fc}/{TK} claim text (lineage, read-only)
      verdict: { default: '' },  // supported / contradicted / unclear ('' = unset)
    };
  },

  parseHTML() {
    return [{
      tag: 'span[data-fcnote]',
      getAttrs: (dom) => ({
        noteId: dom.getAttribute('data-note-id') || null,
        note: dom.getAttribute('data-note') || '',
        source: dom.getAttribute('data-source') || '',
        marker: dom.getAttribute('data-marker') || '',
        verdict: dom.getAttribute('data-verdict') || '',
      }),
    }];
  },

  renderHTML({ node }) {
    const a = node.attrs;
    return ['span', mergeAttributes({
      'data-fcnote': '',
      'data-note-id': a.noteId || '',
      'data-note': a.note || '',
      'data-source': a.source || '',
      'data-marker': a.marker || '',
      'data-verdict': a.verdict || '',
      class: 'wp-fcnote',
    }), '✓'];
  },

  addNodeView() {
    return ({ editor, getPos }) => {
      const dom = el('span', 'wp-fcnote', { 'data-fcnote': '', contenteditable: 'false', title: 'fact-check footnote — click to open', role: 'button', 'aria-label': 'fact-check footnote' });
      // crisp inline SVG: green circle, white check (the doctrine's one green, --ep-copied)
      dom.innerHTML =
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
        + '<circle cx="8" cy="8" r="7.25" class="wp-fcnote-circle"/>'
        + '<path d="M4.7 8.4l2.1 2.1 4.4-4.6" class="wp-fcnote-check" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
        + '</svg>';
      dom.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeOpenFootnotePanel();
        openPanel = createFootnotePanel(editor, getPos, dom);
      });
      return {
        dom,
        // attr saves from the fly-out repaint nothing in the icon — ignore them
        update(updated) { return updated.type.name === 'fcFootnote'; },
        ignoreMutation: () => true,
      };
    };
  },
});
