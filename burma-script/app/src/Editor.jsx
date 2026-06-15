// Burma Script Tool — the editor component.
// MIRRORS translation/src/editor/Editor.jsx: useEditor() with StarterKit (most block
// types disabled, since OUR custom nodes replace them) + the Burma block nodes + inline
// marks. EditorContent renders the live ProseMirror surface. onUpdate persists the doc
// JSON to localStorage (autosave). The blocks-data source stays READ-ONLY — we only ever
// read/write the working copy in localStorage (DESIGN LAW #11).

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { buildEditorDocument, docToBlocks } from './document-builder.js';

const LS_DOC = 'wp01_burma_doc_v1';

// Seed the working copy: prefer the persisted localStorage doc; else build fresh
// from the read-only blocks. The source blocks array is NEVER mutated.
function seedDoc(sourceBlocks) {
  try {
    const saved = localStorage.getItem(LS_DOC);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.content?.length) return parsed;
    }
  } catch {}
  return buildEditorDocument(sourceBlocks);
}

// Telemetry off the live doc — words in VO/ONCAM, block + done counts.
function telemetry(doc) {
  let words = 0, blocks = 0, done = 0, sot = 0;
  for (const n of doc?.content || []) {
    blocks++;
    if (n.type === 'voBlock' || n.type === 'oncamBlock') {
      const t = JSON.stringify(n.content || '').match(/"text":"([^"]*)"/g) || [];
      words += t.join(' ').split(/\s+/).filter(w => /\w/.test(w)).length;
    }
    if (n.type === 'sotBlock') { sot++; if (n.attrs?.done) done++; }
  }
  return { words, blocks, sot, done };
}

export function BurmaEditor({ sourceBlocks, onTelemetry }) {
  const initial = useMemo(() => seedDoc(sourceBlocks), [sourceBlocks]);
  const saveTimer = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // OUR custom block nodes own the document; disable StarterKit's blocks
        // so the schema doesn't fight. Keep paragraph + basic inline marks.
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
      }),
      ...BURMA_NODES,
      ...BURMA_MARKS,
    ],
    content: initial,
    autofocus: false,
    onCreate({ editor }) {
      onTelemetry?.(telemetry(editor.getJSON()));
    },
    onUpdate({ editor }) {
      const json = editor.getJSON();
      onTelemetry?.(telemetry(json));
      // Debounced autosave of the working copy.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try { localStorage.setItem(LS_DOC, JSON.stringify(json)); } catch {}
      }, 400);
    },
    editorProps: {
      attributes: { class: 'wp-editor-content' },
      handleDOMEvents: {
        // icon-copy (⧉) copies the timecode; done-tick (✓) toggles done. Both live
        // in contenteditable:false head rows, so we intercept at the editor level.
        mousedown: (view, event) => {
          const copyBtn = event.target.closest('.wp-copy');
          if (copyBtn) {
            event.preventDefault();
            const tc = copyBtn.getAttribute('data-tc') || '';
            if (tc) navigator.clipboard?.writeText(tc).catch(() => {});
            copyBtn.classList.add('copied');
            setTimeout(() => copyBtn.classList.remove('copied'), 600);
            return true;
          }
          const doneBtn = event.target.closest('.wp-done');
          if (doneBtn) {
            event.preventDefault();
            const blockEl = doneBtn.closest('[data-block-id]');
            if (!blockEl) return false;
            const pos = view.posAtDOM(blockEl, 0);
            const resolved = view.state.doc.resolve(pos);
            for (let d = resolved.depth; d >= 0; d--) {
              const node = resolved.node(d);
              if (node.type.name === 'sotBlock' || node.type.name === 'brollBlock') {
                const startPos = resolved.before(d);
                const tr = view.state.tr.setNodeMarkup(startPos, undefined, {
                  ...node.attrs, done: !node.attrs.done,
                });
                view.dispatch(tr);
                return true;
              }
            }
            return false;
          }
          // VO 3-state dot cycles todo -> recorded -> in-edit
          const voDot = event.target.closest('.wp-vodot');
          if (voDot) {
            event.preventDefault();
            const blockEl = voDot.closest('[data-block-id]');
            if (!blockEl) return false;
            const pos = view.posAtDOM(blockEl, 0);
            const resolved = view.state.doc.resolve(pos);
            for (let d = resolved.depth; d >= 0; d--) {
              const node = resolved.node(d);
              if (node.type.name === 'voBlock') {
                const order = ['todo', 'recorded', 'in-edit'];
                const next = order[(order.indexOf(node.attrs.status) + 1) % order.length];
                const startPos = resolved.before(d);
                view.dispatch(view.state.tr.setNodeMarkup(startPos, undefined, { ...node.attrs, status: next }));
                return true;
              }
            }
            return false;
          }
          return false;
        },
      },
    },
  });

  // Flush a final save when unmounting.
  useEffect(() => () => {
    if (!editor) return;
    try { localStorage.setItem(LS_DOC, JSON.stringify(editor.getJSON())); } catch {}
  }, [editor]);

  return <EditorContent editor={editor} class="wp-editor" />;
}

export { LS_DOC, docToBlocks };
