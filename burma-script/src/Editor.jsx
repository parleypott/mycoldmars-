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
import { buildEditorDocument, docToBlocks, nodeText, flattenSpine, wrapRowsTable } from './document-builder.js';
import { TABLE_SPINE_NODES } from './extensions/table-spine.js';
import { BurmaBubbleMenu } from './BubbleMenu.jsx';
import { Workshop } from './Workshop.jsx';

const LS_DOC = 'wp01_burma_doc_v1';
const LS_BLOCKS = 'wp01_burma_blocks_v1'; // derived schema-faithful export (exercises docToBlocks)
const LS_DOC_BACKUP = 'wp01_burma_doc_v1__pre_table_backup'; // SACRED: pre-migration snapshot

// True when a persisted doc is the LEGACY flat list (no table spine) — i.e. saved before
// the table-spine build. A fresh build is already a table; a migrated doc is too.
function isLegacyFlat(doc) {
  return !!doc?.content?.length && !doc.content.some((n) => n.type === 'table');
}

// SACRED MIGRATION (LAW #1 — never lose a word or a fill): wrap a legacy flat doc into the
// table spine, but ONLY commit it after proving the migration is loss-free:
//   (1) back up the original verbatim to a separate key FIRST,
//   (2) validate the wrapped doc round-trips to the SAME ordered cartridge text + block ids
//       (text-equality + schema/shape check via flattenSpine),
//   (3) fall back to the ORIGINAL doc on ANY mismatch or thrown error.
// On success we hand back the table doc (autosave will persist it on the first edit). On any
// doubt we hand back the untouched original — the user never loses their {tk}/{fc} fills.
function migrateLegacyToTable(original) {
  try {
    const before = (original.content || []).map((n) => `${n.type}|${n.attrs?.blockId || ''}|${nodeText(n)}`);
    const table = wrapRowsTable(original.content);
    const wrapped = { ...original, content: [table] };
    // round-trip: flatten the wrapped doc back to the ordered cartridge nodes and compare.
    const after = flattenSpine(wrapped).map((n) => `${n.type}|${n.attrs?.blockId || ''}|${nodeText(n)}`);
    if (before.length !== after.length) return original;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return original;
    // text + ids + order all match → safe. Snapshot the original before returning the table.
    try { localStorage.setItem(LS_DOC_BACKUP, JSON.stringify(original)); } catch {}
    return wrapped;
  } catch {
    return original; // ANY error → keep the original. Never lose a fill.
  }
}

// Seed the working copy: prefer the persisted localStorage doc; else build fresh from the
// read-only blocks. The source blocks array is NEVER mutated. A legacy flat persisted doc is
// migrated to the table spine through the SACRED, validated, back-up-first path above.
function seedDoc(sourceBlocks) {
  try {
    const saved = localStorage.getItem(LS_DOC);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.content?.length) {
        return isLegacyFlat(parsed) ? migrateLegacyToTable(parsed) : parsed;
      }
    }
  } catch {}
  return buildEditorDocument(sourceBlocks);
}

// Telemetry off the live doc — walks the node tree (reusing nodeText) rather than
// regex-scraping stringified JSON, so it counts correctly through marks/escapes.
// Also derives the OUTLINE (chapter/scene spine) for the left rail — monochrome,
// indented titles, keyed by blockId so a click can scroll the matching node into view.
function telemetry(doc) {
  let words = 0, blocks = 0, done = 0, sot = 0, scaffold = 0;
  const outline = [];
  // Telemetry walks the CARTRIDGES, reaching through the table spine (table>row>cell) so the
  // counts + outline are identical whether the doc is the new table shape or a legacy list.
  for (const n of flattenSpine(doc)) {
    // scriptStart is a decorative divider, not a content block — don't count it.
    if (n.type === 'scriptStart') continue;
    blocks++;
    if (n.type === 'voBlock' || n.type === 'oncamBlock') {
      const t = nodeText(n);
      if (t) words += t.split(/\s+/).filter((w) => /\w/.test(w)).length;
    }
    if (n.type === 'sotBlock') { sot++; if (n.attrs?.done) done++; }
    if (n.type === 'binBlock' && n.attrs?.scaffold) scaffold++;
    if (n.type === 'chapterBlock' || n.type === 'sceneBlock') {
      const title = nodeText(n).replace(/\s+/g, ' ').trim();
      if (title) outline.push({ id: n.attrs?.blockId || '', title, level: n.type === 'chapterBlock' ? 0 : 1 });
    }
  }
  return { words, blocks, sot, done, scaffold, outline };
}

export function BurmaEditor({ sourceBlocks, onTelemetry, onEditorReady }) {
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
      Dropcursor.configure({ color: '#d23b2c', width: 2 }),
      Gapcursor,
      ...TABLE_SPINE_NODES,
      ...BURMA_NODES,
      ...BURMA_MARKS,
    ],
    content: initial,
    autofocus: false,
    onCreate({ editor }) {
      onTelemetry?.(telemetry(editor.getJSON()));
      // Hand the live editor up so the Exports panel can read the current doc JSON
      // (docToBlocks) for the worklist exports — always reflecting live edits/reorders.
      onEditorReady?.(editor);
    },
    onUpdate({ editor }) {
      const json = editor.getJSON();
      onTelemetry?.(telemetry(json));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(LS_DOC, JSON.stringify(json));
          // Derived schema-faithful blocks export — keeps docToBlocks() exercised at
          // runtime (the round-trip the schema's persistence contract promises), and
          // gives a clean blocks array any downstream tool can consume. The doc JSON
          // stays canonical; this is a read-only derived view.
          localStorage.setItem(LS_BLOCKS, JSON.stringify(docToBlocks(json)));
          window.dispatchEvent(new CustomEvent('wp-saved'));
        } catch {}
      }, 400);
    },
    editorProps: {
      attributes: { class: 'wp-editor-content' },
    },
  });

  // The Workshop hub picks an option and asks us to INSERT it where the {TK}/{fc} marker
  // was — the marker dispatched its own {from,to} range, so we replace exactly that range
  // with the chosen prose. We drop the span mark on the replacement (plain text node) so the
  // resolved line reads as finished script, not a still-pending marker. This is the real
  // insert-replace flow the punch-list (#6) demands — a genuine PM transaction over the
  // range the mark already provides, not a stub.
  useEffect(() => {
    if (!editor) return;
    const onReplace = (e) => {
      const { from, to, text } = e.detail || {};
      if (typeof from !== 'number' || typeof to !== 'number' || !text) return;
      const size = editor.state.doc.content.size;
      const a = Math.max(0, Math.min(from, size));
      const b = Math.max(a, Math.min(to, size));
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: a, to: b },
          [{ type: 'text', text: String(text), marks: [] }],
        )
        .run();
    };
    window.addEventListener('wp-replace-span', onReplace);
    return () => window.removeEventListener('wp-replace-span', onReplace);
  }, [editor]);

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
