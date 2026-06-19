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
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { buildEditorDocument, ensureTableDoc, docToBlocks, nodeText } from './document-builder.js';
import { BurmaBubbleMenu } from './BubbleMenu.jsx';
import { Workshop } from './Workshop.jsx';
import { saveDoc, backupRaw, syncBaseVersion, getKnownBaseVersion, LS_DOC_VER } from './migrate-doc.js';
import { pushDoc } from './cloud-sync.js';

const LS_DOC = 'wp01_burma_doc_v1';
const LS_BLOCKS = 'wp01_burma_blocks_v1'; // derived schema-faithful export (exercises docToBlocks)

// CARDINAL SIN GUARD: if the saved doc existed but could NOT be read/parsed at seed time, we
// must NOT let autosave clobber the original bytes with the fresh source fallback — that would
// turn a recoverable corruption into permanent loss. seedDoc sets this true ONLY when there was
// raw bytes we failed to use; a clean "no saved doc yet" leaves it false (fresh save is fine).
let seededOverUnreadableDoc = false;

// Seed the working copy: prefer the persisted localStorage doc; else build fresh
// from the read-only blocks. The source blocks array is NEVER mutated.
function seedDoc(sourceBlocks) {
  let saved = null;
  try {
    saved = localStorage.getItem(LS_DOC);
  } catch {}
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // MIGRATION-SAFE: a doc saved before the table spine has flat block nodes at the top
      // level. ensureTableDoc wraps them into full-width rows so the existing edited doc
      // (Johnny's filled answers) keeps rendering — no content touched, marks ride along.
      if (parsed?.content?.length) {
        // CROSS-TAB BASE: adopt the on-disk version as this tab's base, so the conflict guard
        // measures every later save against the doc this tab actually rendered from.
        syncBaseVersion();
        return ensureTableDoc(parsed);
      }
      // Parsed but empty/wrong shape — treat as unreadable so we don't autosave over it.
      seededOverUnreadableDoc = true;
    } catch (e) {
      // Saved bytes exist but won't parse. KEEP THEM: snapshot to a recovery key, flag the
      // editor so autosave/flush refuse to overwrite LS_DOC, and warn loudly + visibly.
      seededOverUnreadableDoc = true;
      try { backupRaw(saved); } catch {}
      try {
        const key = LS_DOC + '.corrupt.' + Date.now();
        localStorage.setItem(key, saved);
        console.warn('[burma] saved doc unreadable — preserved at', key, '— starting from source', e);
        window.dispatchEvent(new CustomEvent('wp-save-failed', {
          detail: { kind: 'corrupt', message: 'saved script could not be read — original preserved, editing starts from source' },
        }));
      } catch {}
    }
  }
  return buildEditorDocument(sourceBlocks);
}

// Telemetry off the live doc — walks the node tree (reusing nodeText) rather than
// regex-scraping stringified JSON, so it counts correctly through marks/escapes.
// Also derives the OUTLINE (chapter/scene spine) for the left rail — monochrome,
// indented titles, keyed by blockId so a click can scroll the matching node into view.
function telemetry(doc) {
  let words = 0, blocks = 0, done = 0, sot = 0, scaffold = 0;
  const outline = [];
  // TABLE SPINE — the doc top level is tableRow+. Flatten rows→cells→blocks so telemetry counts
  // the cartridge nodes exactly as before (and the outline keys by the cartridge's blockId).
  const flat = [];
  for (const row of doc?.content || []) {
    if (row?.type === 'tableRow') {
      for (const cell of row.content || []) {
        if (cell?.type === 'tableCell') for (const b of cell.content || []) flat.push(b);
        else flat.push(cell);
      }
    } else {
      flat.push(row);
    }
  }
  for (const n of flat) {
    // scriptStart is a decorative divider, not a content block — don't count it.
    if (n.type === 'scriptStart') continue;
    blocks++;
    if (n.type === 'voBlock' || n.type === 'oncamBlock' || n.type === 'montageBlock') {
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

  // The SINGLE canonical-write path. Cancels any pending debounce and writes the absolute latest
  // editor JSON through saveDoc (quota-aware retry + read-back invariant + loud failure). Used by
  // the debounce, the unmount flush, AND the pagehide/visibilitychange unload listeners — so a
  // reload/tab-close can never drop the latest keystroke. Refuses to write if we seeded over an
  // unreadable saved doc (never clobber recoverable bytes with the source fallback).
  function flushSave(editor) {
    if (!editor) return;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (seededOverUnreadableDoc) return; // protected: original bytes preserved, don't overwrite.
    const json = editor.getJSON();
    const res = saveDoc(json); // handles its own loud failure + wp-saved on success.
    // Derived schema-faithful blocks export — keeps docToBlocks() exercised and gives downstream
    // tools a clean blocks array. SEPARATE try/catch AFTER the canonical doc: it roughly doubles
    // payload and is the likeliest line to blow quota, so it must never threaten LS_DOC.
    if (res.ok) {
      try { localStorage.setItem(LS_BLOCKS, JSON.stringify(docToBlocks(json))); } catch {}
      // CLOUD MIRROR — after the LOCAL save lands durably, push it up so the doc follows Johnny to
      // any browser/device. Fire-and-forget: a cloud-push failure must NEVER block or undo the local
      // save (which already succeeded above). pushDoc never throws and fires its own cloud-status
      // events (wp-cloud-saved / wp-cloud-offline); we deliberately do NOT await it on the hot path.
      // We push the version saveDoc just stamped so cloud's optimistic-concurrency token stays in
      // lockstep with the local monotonic LS_DOC_VER.
      const pushVersion = res.version || getKnownBaseVersion();
      try { pushDoc(json, pushVersion); } catch {}
    }
  }
  const flushRef = useRef(flushSave);
  flushRef.current = flushSave;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // OUR custom block nodes own the document; disable StarterKit's blocks
        // so the schema doesn't fight. Keep paragraph + basic inline marks (bold/italic).
        heading: false, blockquote: false, codeBlock: false, code: false,
        // LISTS ON: bullet ("- ") + ordered ("1. ") lists work inside writing block bodies.
        // MUST stay identical to the mirror schema in migrate-doc.js or saved docs containing a
        // list fail the read-back invariant and fire wp-save-failed.
        horizontalRule: false,
        // We own dropcursor/gapcursor below so we can Swiss-red the dropcursor.
        dropcursor: false, gapcursor: false,
      }),
      Dropcursor.configure({ color: '#d23b2c', width: 2 }),
      Gapcursor,
      ...BURMA_TABLE_NODES,
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
      // We have unsaved keystrokes in volatile editor state right now — say so, so the
      // save-status indicator can show "unsaved" between keystroke and the debounced write.
      window.dispatchEvent(new CustomEvent('wp-dirty'));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Short debounce so the persisted copy is never more than a fraction of a second behind.
      saveTimer.current = setTimeout(() => { flushRef.current(editor); }, 150);
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

  // DURABLE FLUSH ON PAGE TEARDOWN — the actual safety net Johnny's "edit → reload → gone" needs.
  // React/Preact useEffect cleanup does NOT run on a hard browser reload (Cmd-R/F5), tab close, or
  // navigation — the VM is torn down before cleanup fires. So the debounced timer dies unfired and
  // the last edits are lost. 'pagehide' and 'visibilitychange'(hidden) are the ONLY events that
  // reliably fire before teardown across browsers (incl. mobile + bfcache). Both synchronously
  // flush the ABSOLUTE LATEST editor JSON, bypassing the debounce.
  useEffect(() => {
    if (!editor) return;
    const flushNow = () => { flushRef.current(editor); };
    const onPageHide = () => flushNow();
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushNow(); };
    const onBeforeUnload = () => flushNow();
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [editor]);

  // CROSS-TAB STALE DETECTION — the `storage` event fires in OTHER tabs (never the writer) when a
  // shared localStorage key changes. So when a sibling tab saves the doc, THIS tab hears it and
  // learns its in-memory copy is now behind. We surface a gentle "updated in another tab — reload"
  // indicator (wp-stale-tab) and deliberately DO NOT advance this tab's known base version: the
  // conflict guard in saveDoc keys off that base, so leaving it stale is exactly what stops the
  // eager on-hidden flush from stomping the sibling's newer doc. Reloading is the clean recovery —
  // it re-seeds from disk and re-syncs the base. (We never lose anything either way: a stomp
  // attempt is caught by the guard and snapshotted to a .conflict key.)
  useEffect(() => {
    const onStorage = (e) => {
      if (!e) return;
      // Only care about the doc itself or its version stamp changing under us.
      if (e.key !== LS_DOC && e.key !== LS_DOC_VER) return;
      // A removal (e.newValue == null) is a RESET in another tab — also a reason to reload.
      window.dispatchEvent(new CustomEvent('wp-stale-tab', {
        detail: { message: 'this script was just updated in another tab — reload to get the latest.' },
      }));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Flush a final save on in-SPA unmount (route change / React teardown). Goes through the same
  // guarded writer so an unmount can't silently fail or clobber a protected unreadable doc.
  useEffect(() => () => {
    flushRef.current(editor);
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
