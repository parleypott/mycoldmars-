// Burma Script Tool — the editor component.
// MIRRORS translation/src/editor/Editor.jsx: useEditor() with StarterKit (most block
// types disabled, since OUR custom NODES replace them) + the Burma block nodes + inline
// marks + Dropcursor/Gapcursor for the Notion drag-reorder feel. EditorContent renders
// the live ProseMirror surface; onUpdate autosaves the doc JSON to localStorage. The
// blocks-data source stays READ-ONLY — we only ever read/write the working copy (LAW #11).
//
// Block chrome (drag grip, copy/done/VO controls) is owned by each node's NodeView
// (extensions/blocks.js) and dispatches real transactions — no centralized DOM shim.

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { buildEditorDocument, docToBlocks, nodeText } from './document-builder.js';
import { BurmaBubbleMenu } from './BubbleMenu.jsx';
import { Workshop } from './Workshop.jsx';

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

// Telemetry off the live doc — walks the node tree (reusing nodeText) rather than
// regex-scraping stringified JSON, so it counts correctly through marks/escapes.
function telemetry(doc) {
  let words = 0, blocks = 0, done = 0, sot = 0;
  for (const n of doc?.content || []) {
    blocks++;
    if (n.type === 'voBlock' || n.type === 'oncamBlock') {
      const t = nodeText(n);
      if (t) words += t.split(/\s+/).filter((w) => /\w/.test(w)).length;
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
        // so the schema doesn't fight. Keep paragraph + basic inline marks (bold/italic).
        heading: false, blockquote: false, codeBlock: false, code: false,
        bulletList: false, orderedList: false, listItem: false, horizontalRule: false,
        // We own dropcursor/gapcursor below so we can Swiss-red the dropcursor.
        dropcursor: false, gapcursor: false,
      }),
      Dropcursor.configure({ color: '#e2001a', width: 2 }),
      Gapcursor,
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
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try { localStorage.setItem(LS_DOC, JSON.stringify(json)); } catch {}
      }, 400);
    },
    editorProps: {
      attributes: { class: 'wp-editor-content' },
    },
  });

  // Flush a final save when unmounting.
  useEffect(() => () => {
    if (!editor) return;
    try { localStorage.setItem(LS_DOC, JSON.stringify(editor.getJSON())); } catch {}
  }, [editor]);

  return (
    <>
      <EditorContent editor={editor} class="wp-editor" />
      <BurmaBubbleMenu editor={editor} />
      <Workshop />
    </>
  );
}

export { LS_DOC, docToBlocks };
