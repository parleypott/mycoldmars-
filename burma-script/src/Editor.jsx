// Burma Script Tool — the editor component.
// MIRRORS translation/src/editor/Editor.jsx: useEditor() with StarterKit (most block
// types disabled, since OUR custom NODES replace them) + the Burma block nodes + inline
// marks + Dropcursor/Gapcursor for the Notion drag-reorder feel. EditorContent renders
// the live ProseMirror surface; onUpdate autosaves the doc JSON to localStorage. The
// blocks-data source stays READ-ONLY — we only ever read/write the working copy (LAW #11).
//
// Block chrome (drag grip, copy/done/VO controls) is owned by each node's NodeView
// (extensions/blocks.js) and dispatches real transactions — no centralized DOM shim.

import { useEditor, EditorContent, useEditorState } from '@tiptap/react';
import { getMarkRange } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import TextAlign from '@tiptap/extension-text-align';
import { memo } from 'preact/compat';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { mintNoteId } from './extensions/footnote.js';
import { ChapterFrames } from './extensions/chapter-frames.js';
import { DayFold } from './extensions/day-fold.js';
import { SlashMenu } from './extensions/slash-menu.js';
import { ConvertMenu } from './extensions/convert-menu.js';
import { PasteSanitize } from './extensions/paste-sanitize.js';
import { FindReplace } from './extensions/find-replace.js';
import { ImageDrop } from './extensions/image-drop.js';
import { LinkKeymap } from './extensions/link-kbd.js';
import { ListShortcuts } from './extensions/list-shortcuts.js';
import { VizPasteAdopt } from './extensions/viz-paste-adopt.js';
import { FootnoteDeleteGuard } from './extensions/footnote-delete-guard.js';
import { ChapterFocus } from './extensions/chapter-focus.js';
import { RowNumbers } from './extensions/row-numbers.js';
import { WorkspaceFilter } from './extensions/workspace-filter.js';
import { readChecked, writeChecked } from './extensions/ws-checkoff.js';
import { TkDetect } from './extensions/tk-detect.js';
import { buildEditorDocument, ensureTableDoc, docToBlocks, nodeText } from './document-builder.js';
import { LinkPopover } from './LinkPopover.jsx';
import { FindReplacePanel } from './FindReplace.jsx';
import { Workshop } from './Workshop.jsx';
import { saveDoc, backupRaw, syncBaseVersion, getKnownBaseVersion, primeVersionFloor, isReloadingForAdopt, isReloadingForReset, isRenderableLocalDoc, LS_DOC_VER } from './migrate-doc.js';
import { pushDoc, handlePushResult } from './cloud-sync.js';
import { isReadOnly } from './read-mode.js';
import { isEditMode } from './edit-mode.js';
import { getEpisodeStorage, onEpisodeChange } from './episode-config.js';
import { getCollabSession } from './collab.js';

export let LS_DOC = '';

function syncStorageKeys() {
  LS_DOC = getEpisodeStorage().DOC;
}

onEpisodeChange(syncStorageKeys);

// CARDINAL SIN GUARD: if the saved doc existed but could NOT be read/parsed at seed time, we
// must NOT let autosave clobber the original bytes with the fresh source fallback — that would
// turn a recoverable corruption into permanent loss. seedDoc sets this true ONLY when there was
// raw bytes we failed to use; a clean "no saved doc yet" leaves it false (fresh save is fine).
let seededOverUnreadableDoc = false;

// CH-02 — re-resolve a span mark's CURRENT contiguous range near a cached [a,b] window. The
// Workshop's cached coordinates may be stale (the doc shifted under an open dock), so we probe a
// handful of positions across the cached range for the mark and, on the first hit, expand to the
// mark's full run via getMarkRange. Returns { from, to } or null if the mark no longer lives there.
// Pure (no dispatch) so it is safe to call before deciding whether to insert.
export function findMarkRange(state, markType, a, b) {
  if (!markType) return null;
  const size = state.doc.content.size;
  const lo = Math.max(0, Math.min(a, size));
  const hi = Math.max(lo, Math.min(b, size));
  // Probe lo, hi, midpoint, and a few interior steps — robust to boundary/inclusive quirks.
  const probes = new Set([lo, hi, Math.floor((lo + hi) / 2)]);
  const span = Math.max(1, hi - lo);
  for (let k = 1; k < 4; k++) probes.add(lo + Math.floor((span * k) / 4));
  for (const p of probes) {
    if (p < 0 || p > size) continue;
    let range = null;
    try { range = getMarkRange(state.doc.resolve(p), markType); } catch {}
    if (range && range.from != null && range.to != null && range.to > range.from) {
      return { from: range.from, to: range.to };
    }
  }
  return null;
}

// Seed the working copy: prefer the persisted localStorage doc; else build fresh
// from the read-only blocks. The source blocks array is NEVER mutated.
// READ-ONLY SHARE (read-only-share): when a `?read`/`?view` recipient is given Johnny's latest
// CLOUD doc, seed straight from THAT (so they see his live script) and skip every localStorage read —
// a reader's view is built purely in-memory from the cloud bytes, never from their own LS_DOC, and
// `seededOverUnreadableDoc` stays false because no write path is ever reachable in read-only mode.
function seedDoc(sourceBlocks, readOnlyDoc, recoveredDoc) {
  if (readOnlyDoc?.content?.length) {
    return ensureTableDoc(readOnlyDoc);
  }
  // Boot rehydration can recover a renderable newest doc from `.z`/IDB even when the fat LS_DOC key
  // still cannot fit under quota. In that one full-origin case we seed from the recovered bytes
  // directly, but keep writes ENABLED — this is Johnny's real editable doc, not a read-only share.
  if (recoveredDoc?.content?.length) {
    return ensureTableDoc(recoveredDoc);
  }
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
      // CH-06 — same shared "renderable?" predicate hasUsableLocalDoc + the migrate base-gate use.
      if (isRenderableLocalDoc(parsed)) {
        // CROSS-TAB BASE: adopt the on-disk version as this tab's base, so the conflict guard
        // measures every later save against the doc this tab actually rendered from.
        syncBaseVersion();
        return ensureTableDoc(parsed);
      }
      // DL-04 — Parsed cleanly but EMPTY / wrong shape (no content). This is NOT corrupt bytes
      // worth preserving — it's an empty doc. Latching here would make the ENTIRE session
      // read-only-to-disk (flushSave early-returns forever), so every edit Johnny makes would
      // vanish on reload with no banner. An empty doc is SAFE to overwrite — do NOT latch; fall
      // through and build a fresh doc from source, which the editor will then save normally.
      console.warn('[burma] saved doc parsed but is empty/shapeless — starting from source (safe to overwrite)');
    } catch (e) {
      // Saved bytes exist but won't parse. KEEP THEM: snapshot to a recovery key, flag the
      // editor so autosave/flush refuse to overwrite LS_DOC, and warn loudly + visibly.
      seededOverUnreadableDoc = true;
      try { backupRaw(saved); } catch {}
      try {
        // COLLISION-PROOF KEY (snapshot-key-collision): epoch-ms + monotonic seq so two seeds in the
        // same ms can't overwrite each other's preserved corrupt bytes. Math.random tail is belt-and-
        // suspenders for the (single-shot, once-per-seed) corrupt path.
        const key = LS_DOC + '.corrupt.' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
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
export function telemetry(doc) {
  let words = 0, blocks = 0, done = 0, sot = 0, scaffold = 0, chapters = 0;
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
      // TITLE, not transcript (design panel 2026-07-07): the outline used to swallow the
      // WHOLE block body — director's notes, timecodes, 700-char b-roll dumps — and then
      // mid-word-ellipsize it in CSS. The doctrine already treats the FIRST paragraph as
      // the chapter title, so the outline reads exactly that, with bracketed asides
      // stripped (when words remain) and a word-boundary clamp. Chapters carry a book
      // ordinal ("01") — the fly-out + pinned panel both render it.
      const first = (n.content || []).find((c) => c.type === 'paragraph') || n;
      let title = nodeText(first).replace(/\s+/g, ' ').trim();
      const bare = title.replace(/\[[^\]]*\]|\{TK[^}]*\}/gi, '').replace(/\s+/g, ' ').trim();
      if (bare) title = bare;
      if (title.length > 72) title = title.slice(0, 72).replace(/\s+\S*$/, '') + '…';
      if (title) outline.push({
        id: n.attrs?.blockId || '',
        title,
        level: n.type === 'chapterBlock' ? 0 : 1,
        ord: n.type === 'chapterBlock' ? String(++chapters).padStart(2, '0') : null,
      });
    }
  }
  return { words, blocks, sot, done, scaffold, outline };
}

function scheduleIdleTask(fn, timeout = 500) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return { kind: 'idle', id: window.requestIdleCallback(fn, { timeout }) };
  }
  return {
    kind: 'timeout',
    id: setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 0 }), timeout),
  };
}

function cancelIdleTask(task) {
  if (!task) return;
  if (task.kind === 'idle' && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(task.id);
    return;
  }
  clearTimeout(task.id);
}

function selectionWrapperKey(editor) {
  if (!editor) return 'off';
  const keys = new Set();
  const addPos = ($pos) => {
    for (let d = $pos.depth; d > 0; d -= 1) {
      if ($pos.node(d).type?.name === 'tableRow') {
        keys.add(`row:${$pos.before(d)}`);
        break;
      }
    }
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d);
      if (node?.attrs?.blockId) {
        keys.add(`block:${node.attrs.blockId}`);
        return;
      }
      if (node?.type?.name === 'scriptStart') {
        keys.add(`script:${$pos.before(d)}`);
        return;
      }
    }
  };
  addPos(editor.state.selection.$from);
  addPos(editor.state.selection.$to);
  return Array.from(keys).sort().join('|') || 'off';
}

function paintActiveSelectionWrappers(editor) {
  // GUARD: editor.view is a throwing Proxy until the ProseMirror view mounts (isInitialized flips
  // true). Reading `.dom` before then throws — so gate on isInitialized, never on `editor?.view?.dom`
  // (that optional chain still trips the Proxy getter and throws).
  if (!editor?.isInitialized) return;
  const root = editor.view.dom;
  if (!root) return;
  const next = new Set();
  const addHost = ($pos) => {
    try {
      const { node } = editor.view.domAtPos($pos.pos);
      const start = node?.nodeType === 1 ? node : node?.parentElement;
      const row = start?.closest?.('.wp-trow');
      const block = start?.closest?.('.wp-cart, .wp-none, .wp-script-begins');
      if (row) next.add(row);
      if (block) next.add(block);
    } catch {}
  };
  addHost(editor.state.selection.$from);
  addHost(editor.state.selection.$to);
  root.querySelectorAll('[data-pm-active-selection]').forEach((el) => {
    if (!next.has(el)) el.removeAttribute('data-pm-active-selection');
  });
  next.forEach((el) => el.setAttribute('data-pm-active-selection', ''));
}

function clearActiveSelectionWrappers(editor) {
  // GUARD: see paintActiveSelectionWrappers — `editor?.view?.dom` throws via the view Proxy before
  // the view mounts, so gate on isInitialized instead of optional-chaining through `.view`.
  if (!editor?.isInitialized) return;
  editor.view.dom?.querySelectorAll?.('[data-pm-active-selection]')?.forEach((el) => {
    el.removeAttribute('data-pm-active-selection');
  });
}

export const BurmaEditor = memo(function BurmaEditor({ sourceBlocks, onTelemetry, onEditorReady, readOnlyDoc, recoveredDoc }) {
  // READ-ONLY SHARE (read-only-share): frozen at mount. In read-only mode the editor is constructed
  // NON-editable and the ENTIRE persistence layer is short-circuited — no debounce, no flushSave, no
  // pagehide/visibility/storage listeners, no cloud push. A reader's browser has no code path that
  // can write LS_DOC or PUT the cloud. (saveDoc/pushDoc also refuse independently — defense in depth.)
  const readOnly = isReadOnly();
  // COLLAB (Phase 1) — non-null ONLY when main.jsx prepared a Liveblocks/Yjs session (episode
  // `collab` flag on, runtime loaded, never in read-only). When null, EVERYTHING below behaves
  // byte-identically to the pre-collab engine — the flag-off path is the existing engine.
  const collab = readOnly ? null : getCollabSession();
  const initial = useMemo(() => seedDoc(sourceBlocks, readOnlyDoc, recoveredDoc), [sourceBlocks, readOnlyDoc, recoveredDoc]);
  const saveTimer = useRef(null);
  // COLLAB — the periodic read-only cloud snapshot's state: has the doc changed since the last
  // accepted push, and what version did the last LOCAL save stamp (the version the push carries).
  const cloudSnapshotDirty = useRef(false);
  const lastSnapshotVersion = useRef(0);
  // PERF-3/PERF-7/ux-10 — telemetry (full-doc getJSON + nodeText word-recount + outline rebuild)
  // used to run SYNCHRONOUSLY on every keystroke. That is the one keystroke-latency cost that
  // scales with doc size (a full plain-object copy of the ~167KB tree allocated per keypress, then
  // flattened + word-counted). It runs on its own trailing debounce now: the word/block/outline
  // numbers don't need to update mid-burst — refreshing them when typing pauses is invisible to the
  // user and removes the only unbounded synchronous per-keystroke work. wp-dirty still fires instantly.
  const telTimer = useRef(null);
  const telIdleTask = useRef(null);
  // ZERO-EDIT VISIT GUARD (audit 2026-07-07): the pagehide/visibility/unmount flushes exist to
  // save the LAST KEYSTROKES — but they used to run on every teardown, so a purely passive
  // visit (open, scroll, close — the READ-mode default) still wrote LS_DOC and bumped/pushed
  // the canonical cloud version. Flipped true on the first LOCAL (non-echo) edit; until then
  // the teardown flushes have nothing to protect and stay silent.
  const hadLocalEdit = useRef(false);

  // The SINGLE canonical-write path. Cancels any pending debounce and writes the absolute latest
  // editor JSON through saveDoc (quota-aware retry + read-back invariant + loud failure). Used by
  // the debounce, the unmount flush, AND the pagehide/visibilitychange unload listeners — so a
  // reload/tab-close can never drop the latest keystroke. Refuses to write if we seeded over an
  // unreadable saved doc (never clobber recoverable bytes with the source fallback).
  function flushSave(editor) {
    if (!editor) return;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (seededOverUnreadableDoc) {
      // DL-04 — the latch is set ONLY when the saved bytes were genuinely unreadable (parse threw)
      // and we preserved them. We refuse to overwrite, but we must NOT let the indicator sit on
      // green/SAVED while nothing persists: re-fire wp-save-failed each attempt so the banner stays
      // up and Johnny knows his on-screen copy is the one to trust (and to export it).
      try {
        window.dispatchEvent(new CustomEvent('wp-save-failed', {
          detail: { kind: 'corrupt', message: 'your previous saved script could not be read and was preserved — new edits are NOT being saved over it. Export now to keep them.' },
        }));
      } catch {}
      return; // protected: original bytes preserved, don't overwrite.
    }
    // ADOPT-CLOUD RELOAD GUARD — reconcile adopted a strictly-newer cloud doc to disk and is about
    // to location.reload() so the editor re-seeds from it. The pagehide/beforeunload that reload
    // fires would otherwise flush THIS tab's stale local doc over the just-adopted cloud doc,
    // silently clobbering the newer device's work. Refuse the write: the on-disk doc is already
    // canonical and the reload will re-seed it. (Mirrors the seededOverUnreadableDoc refusal above.)
    if (isReloadingForAdopt()) return;
    // DL-05 — RESET RELOAD GUARD: resetDoc removed LS_DOC and is reloading to clear back to source.
    // The teardown flush during that reload would resurrect the just-reset doc. Refuse the write.
    if (isReloadingForReset()) return;
    // TRUE COMPARE-AND-SWAP base — capture the version this edit was BUILT ON *before* saveDoc stamps
    // the next one. knownBaseVersion is the version this tab last read/adopted/successfully-saved, i.e.
    // exactly what the cloud should currently hold; saveDoc bumps it to base+1 below, so reading it
    // AFTER would wrongly send the new version as the base. Passed to pushDoc so the server accepts only
    // if the cloud still equals this base — a concurrent device that advanced the cloud makes our push
    // 409 (→ latch + banner) instead of silently overwriting the newer doc. base<=0 → pushDoc omits it
    // (strictly-greater fallback), so the first save / an un-seeded tab is never broken.
    // CAS-REGRESSION REVERT (2026-07-02): we intentionally DO NOT send baseForPush to pushDoc below,
    // so the cloud write uses the known-good STRICTLY-GREATER rule, not eq.<base> compare-and-swap.
    // Why: the load-time keep-local reconcile pushes this tab's local doc up WITHOUT advancing
    // knownBaseVersion, so the first post-load edit's CAS base was stale → the cloud (already moved by
    // that reconcile push) 409'd it → a FALSE "ANOTHER DEVICE" banner for a solo editor. Strictly-
    // greater + the benign-conflict guard (handlePushResult) is the proven-quiet state. True CAS is a
    // real hardening but needs knownBaseVersion to track every accepted cloud push first (a deeper,
    // multi-tab-tested change). baseForPush stays computed for that future wiring + diagnostics.
    const baseForPush = getKnownBaseVersion();
    const json = editor.getJSON();
    const res = saveDoc(json); // handles its own loud failure + wp-saved on success.
    if (res.ok) {
      // PERF-2 — we DELIBERATELY no longer write the derived LS_BLOCKS to localStorage. It was a
      // ~167KB second copy of the doc on every save that NOTHING reads at runtime (confirmed: the
      // only readers of docToBlocks are the live Exports panel and tests, which call it on demand
      // against the in-memory editor JSON — never via this key). On the LIVE failure that triggered
      // this fix it doubled the per-save storage payload and was a prime contributor to filling the
      // localStorage quota. docToBlocks stays imported and exercised for exports/tests; it's just not
      // mirrored to a dead key here. (saveDoc's quota escalator also evicts a lingering LS_BLOCKS key
      // first, so any copy left over from a pre-PERF-2 build gets reclaimed on the next pinch.)
      // CLOUD MIRROR — after the LOCAL save lands durably, push it up so the doc follows Johnny to
      // any browser/device. Fire-and-forget for the SAVE itself: a cloud-push failure must NEVER block
      // or undo the local save (which already succeeded above). pushDoc never throws and fires its own
      // wp-cloud-saved / wp-cloud-offline events; we deliberately do NOT await it on the hot path.
      // We push the version saveDoc just stamped so cloud's optimistic-concurrency token stays in
      // lockstep with the local monotonic LS_DOC_VER.
      //
      // CRITICAL — we MUST consume the push result. A 409 (two devices in sync both stamp the same
      // next version, then push divergent edits) means THIS device's edit was REFUSED by the cloud and
      // lives ONLY in localStorage. Discarding that return (the old `try { pushDoc(...) } catch {}`)
      // silently stranded the edit AND falsely flipped the pill to "Saved to cloud". handlePushResult
      // snapshots BOTH this device's edit and the newer cloud doc to .conflict.<ts> and raises the
      // reload/merge banner — treating a hot-path 409 exactly like the load-time adopt path. We pass
      // the EXACT json we tried to push so the stranded bytes are the ones snapshotted.
      // cloud-7 — use the version saveDoc just stamped DIRECTLY. On res.ok it is guaranteed >= 1
      // (max(...)+1), so the old `res.version || getKnownBaseVersion()` fallback only mattered if a
      // future saveDoc returned ok without a version — in which case `||` would ALSO swallow a
      // legitimate version 0 and silently push a mismatched/stale version that 409s. Prefer the
      // stamped version; only fall back (and warn) if it is genuinely absent, and never push a 0.
      let pushVersion = res.version;
      if (!(pushVersion > 0)) {
        pushVersion = getKnownBaseVersion();
        console.warn('[burma] saveDoc returned ok without a version — falling back to knownBaseVersion v' + pushVersion);
      }
      if (pushVersion > 0) {
        try {
          Promise.resolve(pushDoc(json, pushVersion))
            .then((pr) => handlePushResult(pr, json))
            .catch(() => {});
        } catch {}
      }
    }
  }
  // COLLAB FLUSH — the demoted save path for collab sessions ("demote, don't delete"). The Yjs
  // room is the canonical doc; this keeps the LOCAL data-loss-proofing machinery alive (saveDoc's
  // dual-write durability, quota escalation, backups, recovery, export — all unchanged) as a
  // read-only SNAPSHOT of the converged doc. What it deliberately RETIRES for the session:
  //   • the version-CAS / strictly-greater cloud push + handlePushResult 409 conflict machinery
  //     (Yjs merges concurrent edits; a "conflict" is not a thing that can happen to the doc), and
  //   • the cross-tab conflict guard (two collab tabs hold the SAME converged content, so the
  //     guard's "another tab is newer" refusal is meaningless churn — syncBaseVersion() adopts the
  //     on-disk version before every write, which structurally disarms it without touching saveDoc).
  // The cloud mirror happens on the periodic snapshot timer below, not per-flush.
  function collabFlush(editor) {
    if (!editor) return;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    // SYNC GATE — before the room's initial sync the editor holds an empty Y.Doc shell, not the
    // script. Snapshotting it would arm the cloud mirror with a near-empty doc (the audited
    // blank-editor-overwrites-cloud path). The editable gate below makes typing impossible here
    // anyway; this catches the unmount/pagehide flush paths too.
    if (collab.hasSynced && !collab.hasSynced()) return;
    if (seededOverUnreadableDoc) {
      // Same latch as flushSave: never overwrite preserved-but-unreadable original bytes.
      try {
        window.dispatchEvent(new CustomEvent('wp-save-failed', {
          detail: { kind: 'corrupt', message: 'your previous saved script could not be read and was preserved — new edits are NOT being saved over it. Export now to keep them.' },
        }));
      } catch {}
      return;
    }
    if (isReloadingForAdopt()) return;
    if (isReloadingForReset()) return;
    // Adopt the on-disk version as this tab's base (see the header comment): in collab the local
    // store is a snapshot of a CONVERGED doc, so "newest write wins" is always correct locally.
    try { syncBaseVersion(); } catch {}
    const json = editor.getJSON();
    const res = saveDoc(json); // same guarded writer: empty-doc clobber guard, quota, read-back.
    if (res.ok) {
      if (res.version > 0) lastSnapshotVersion.current = res.version;
      cloudSnapshotDirty.current = true; // the snapshot timer pushes the cloud mirror.
    }
  }
  const flushRef = useRef(flushSave);
  flushRef.current = collab ? collabFlush : flushSave;

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
        // WP-12 — undo history tuning. depth 100 (not "infinite") caps the in-memory step stack;
        // newGroupDelay 750ms coalesces a typing burst into ONE undo step so Cmd+Z rolls back a
        // sentence, not a letter. The stack is session-only ProseMirror state — we persist ONLY
        // editor.getJSON() (the doc), never the history, so it rebuilds fresh on every load and never
        // adds to the storage pressure that caused the original quota crash.
        history: { depth: 100, newGroupDelay: 750 },
        // COLLAB — native undo history MUST be off in a collab session (spike ground truth): the
        // Collaboration extension ships its own Y.UndoManager-backed undo/redo that only rolls back
        // YOUR OWN changes, never a teammate's. `undoRedo` is the v3 StarterKit key (History was
        // renamed UndoRedo); `history` rides along for any legacy alias. Spread of null = no-op, so
        // the non-collab config above is untouched when the flag is off.
        ...(collab ? { undoRedo: false, history: false } : null),
      }),
      Dropcursor.configure({ color: '#d23b2c', width: 2 }),
      Gapcursor,
      // PARAGRAPH ALIGNMENT — global `textAlign` attr on paragraph only (all script prose lives in
      // paragraphs, incl. inside voBlock/oncam/sot/none/broll bodies and table cells, so this one
      // registration reaches every writable text run). COLLAB-SAFE: TextAlign adds attrs + the
      // setTextAlign/unsetTextAlign commands and NO ProseMirror plugin — nothing auto-dispatches, so
      // it can't echo-loop under y-sync. Persists via getJSON; survives save/load. Keep this config
      // byte-identical to migrate-doc.js buildSchema() (lockstep contract).
      //
      // STRIP TextAlign's built-in keymap (Johnny 2026-07-09): it binds Mod-Shift-l/e/r/j to
      // left/center/right/justify — and Mod-Shift-R hijacked Chrome's HARD RELOAD, right-aligning
      // the script instead of reloading. Alignment lives on the right-click bulk menu's buttons
      // (convert-menu.js), so these OS-colliding chords aren't needed; drop them all and give
      // Cmd+Shift+R back to Chrome.
      TextAlign.extend({ addKeyboardShortcuts: () => ({}) })
        .configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'], defaultAlignment: 'left' }),
      ...BURMA_TABLE_NODES,
      ...BURMA_NODES,
      ...BURMA_MARKS,
      DirectionMark,
      ChapterFrames,
      DayFold,
      SlashMenu,
      ConvertMenu,
      PasteSanitize,
      // Find & Replace is a decoration-only plugin (adds NO schema) + editor commands. Safe to load
      // in read-only sessions too — the panel that drives it is edit-only (gated below), and its
      // replace commands refuse when the editor is non-editable.
      FindReplace,
      // Chapter focus — decoration-only plugin (adds NO schema, dispatches NOTHING itself).
      // Safe in read-only and collab sessions alike; the meta that drives it comes from the
      // wp-chapter-focus listener in main.jsx.
      ChapterFocus,
      // Master row numbers — decoration-only margin numbers on every top-level row (adds NO
      // schema, dispatches NOTHING — chapter-focus is the template; workspaces.js walkTopRows
      // is the single enumeration truth). Safe in read-only and collab sessions alike.
      RowNumbers,
      // Workspace cutout filter — decoration-only plugin (adds NO schema, dispatches
      // NOTHING on its own; chapter-focus is the template). The meta that drives it comes
      // from the WORKSPACES menu / ?ws= deep link in main.jsx. Safe in collab sessions.
      // checkStore persists the per-person, per-workspace row CHECK-OFF to localStorage,
      // resolved LIVE off the active episode's storage namespace (never frozen at init, so
      // an episode switch points it at the new project's own keys). View-local: the checks
      // never touch the doc or a collab transaction.
      WorkspaceFilter.configure({
        checkStore: {
          load: (wsKey) => readChecked(getEpisodeStorage(), wsKey),
          save: (wsKey, set) => writeChecked(getEpisodeStorage(), wsKey, set),
        },
      }),
      // TK loose-end paint — decoration-only plugin (adds NO schema, dispatches NOTHING;
      // row-numbers is the memo discipline). Bare TK / '(TK …)' turns subtle red; the same
      // tk-pattern.js probe drives the TK workspace membership. Safe in read-only and
      // collab sessions alike.
      TkDetect,
      // Image drag/drop + paste — decoration-placeholder plugin (adds NO schema; the imageBlock
      // node it inserts already lives in BURMA_NODES). Always-on: with no files on the gesture it
      // does nothing, and in read-only sessions it only swallows file drops so the browser can
      // never navigate away from the editor (the pre-fix failure mode).
      ImageDrop,
      // Cmd+K hyperlinks — the link MARK ships with StarterKit v3 (already in the schema +
      // MARKS_ALLOWLIST); this only adds the gesture (prompt/edit/remove) + Cmd-click-to-open.
      LinkKeymap,
      // PASTE ADOPTS THE ACTIVE VIZ TAG — after slashing a viz tag, Cmd+V blankets the whole
      // paste (across paragraph breaks) in that directionMark. Registered after PasteSanitize so
      // the sanitized slice reaches it; keymap/handlePaste only, COLLAB LOOP LAW safe.
      VizPasteAdopt,
      // GUARANTEED LIST SHORTCUTS — Cmd/Ctrl+Shift+8 (bullet) / +7 (ordered) at priority 1001
      // (above Collaboration's 1000) so the keymap can never be shadowed or dropped, regardless of
      // how StarterKit's own list keymap fares under this configure() + the Yjs binding. Keymap
      // only → COLLAB LOOP LAW safe. See list-shortcuts.js for the regression story.
      ListShortcuts,
      // FOOTNOTES RESIST DELETE — priority 1001 so the first Backspace/Delete next to a fact-check
      // footnote SELECTS the atom instead of nuking it; a second press deletes it. Pure selection
      // change on the resist step → COLLAB LOOP LAW safe, read-safe (bows out when not editable).
      FootnoteDeleteGuard,
      // COLLAB — Collaboration (binds the Y.Doc; the Yjs binding carries every PM transaction,
      // including the NodeViews' — spike-proven lossless) + CollaborationCaret (teammates' colored
      // cursors/selections via the Liveblocks awareness provider). Empty when the flag is off.
      ...(collab ? collab.extensions() : []),
    ],
    // COLLAB — content comes from the synced Y.Doc, never from `content` (passing both would
    // double-seed). The room is seeded once from the cloud doc in onCreate (seedIfEmpty).
    content: collab ? null : initial,
    autofocus: false,
    // PERF-4 — the real per-keystroke win is `shouldRerenderOnTransaction: false`: ProseMirror
    // mutates its own DOM in place without bouncing this component through React/Preact on every
    // transaction. We deliberately DO NOT set `immediatelyRender: true`: under Preact that exposes
    // the `editor` instance to child effects (LinkPopover, selection painters) one commit BEFORE
    // EditorContent mounts the ProseMirror view. Any `editor.view.dom` read in that window hits
    // tiptap's view Proxy, which THROWS ("view is not available"), crashing the passive-effect flush
    // and aborting the whole editor mount — no editor, no slash menu. Leaving immediatelyRender at
    // its default (false) restores the known-good lifecycle: `editor` is null on the first render,
    // so every child effect safely early-returns, and by the time it is non-null the view is mounted.
    shouldRerenderOnTransaction: false,
    // READ-ONLY SHARE: construct the surface non-editable so the recipient cannot type, drag, or
    // delete. Combined with the short-circuited persistence below, the doc is structurally frozen.
    // COLLAB starts NON-editable until the room's initial sync lands (the effect below flips it).
    // A pre-sync editor is an empty shell — letting keystrokes in is how a failed Liveblocks
    // connect turned into "first typed word overwrites the cloud script". Non-collab: unchanged.
    // READ/EDIT MODE: every session ALSO starts in READ mode (isEditMode() is false at load) —
    // the sticky switch arms editing; the wp-edit-mode effect below flips this live.
    editable: !readOnly && (!collab || collab.hasSynced()) && isEditMode(),
    onCreate({ editor }) {
      onTelemetry?.(telemetry(editor.getJSON()));
      // Hand the live editor up so the Exports panel can read the current doc JSON
      // (docToBlocks) for the worklist exports — always reflecting live edits/reorders.
      onEditorReady?.(editor);
      if (collab) {
        // ONE-SHOT ROOM SEED — after the provider's initial sync, seed the Y.Doc from the current
        // cloud doc ONLY if the room is genuinely empty (guarded twice: here and inside the
        // runtime's shouldSeedRoom). A non-empty room / a newer Y.Doc is NEVER overwritten.
        collab.seedIfEmpty(editor).catch(() => {});
        // Swap the caret's fallback identity for the server-issued one (real name + color from
        // user_profiles via the auth endpoint) as soon as the room connection delivers it.
        collab.wireCaretIdentity(editor);
      }
    },
    onUpdate({ editor, transaction }) {
      // PERF-3/PERF-7/ux-10 — fire the cheap dirty event INSTANTLY (it's just a CustomEvent), but
      // defer the expensive telemetry recompute (getJSON + word/outline walk) onto a trailing timer,
      // then spend the actual full-doc walk inside requestIdleCallback (setTimeout fallback) so no
      // word-count / outline rebuild shares the synchronous edit transaction.
      if (telTimer.current) clearTimeout(telTimer.current);
      if (telIdleTask.current) {
        cancelIdleTask(telIdleTask.current);
        telIdleTask.current = null;
      }
      telTimer.current = setTimeout(() => {
        telTimer.current = null;
        telIdleTask.current = scheduleIdleTask(() => {
          telIdleTask.current = null;
          onTelemetry?.(telemetry(editor.getJSON()));
        });
      }, 200);
      // READ-ONLY SHARE: a non-editable editor should never fire onUpdate, but guard anyway so NO
      // dirty/debounce/flush path can ever run in a reader's session. Telemetry above is harmless.
      if (readOnly) return;
      // Y-SYNC ECHO GATE — a teammate's keystroke arrives as a y-sync transaction (isChangeOrigin,
      // not undo/redo). Their tab persists their edits and the room is canonical, so a remote echo
      // is nothing THIS tab needs to save: skip the dirty event + 300ms flush debounce entirely.
      // Telemetry above still ran (remote edits do change word counts / outline). Local undo/redo
      // deliberately passes through — it changes the doc this user owns. A pending saveTimer from a
      // real local edit is untouched: it fires and snapshots the merged doc.
      if (collab && collab.isRemoteEcho && collab.isRemoteEcho(transaction)) return;
      // We have unsaved keystrokes in volatile editor state right now — say so, so the
      // save-status indicator can show "unsaved" between keystroke and the debounced write.
      hadLocalEdit.current = true; // arms the teardown flushes (zero-edit visit guard)
      window.dispatchEvent(new CustomEvent('wp-dirty'));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // PERF-7 — keep the durable write OFF the hot keystroke path too. 300ms is still well inside
      // the existing pagehide/visibility flush safety net, but halves the save churn during bursts.
      saveTimer.current = setTimeout(() => { flushRef.current(editor); }, 300);
    },
    editorProps: {
      attributes: { class: 'wp-editor-content' },
    },
  });

  const activeSelectionKey = useEditorState({
    editor,
    selector: (snapshot) => selectionWrapperKey(snapshot.editor),
    equalityFn: Object.is,
  }) || 'off';

  useEffect(() => {
    if (!editor) return;
    paintActiveSelectionWrappers(editor);
    return () => clearActiveSelectionWrappers(editor);
  }, [editor, activeSelectionKey]);

  // The Workshop hub picks an option and asks us to INSERT it where the {TK}/{fc} marker
  // was — the marker dispatched its own {from,to} range, so we replace exactly that range
  // with the chosen prose. We drop the span mark on the replacement (plain text node) so the
  // resolved line reads as finished script, not a still-pending marker. This is the real
  // insert-replace flow the punch-list (#6) demands — a genuine PM transaction over the
  // range the mark already provides, not a stub.
  useEffect(() => {
    if (!editor) return;
    const onReplace = (e) => {
      const { from, to, text, markerText, kind } = e.detail || {};
      if (typeof from !== 'number' || typeof to !== 'number' || !text) return;
      // READ MODE (audit P1): commands dispatch past `editable:false`, so a stale Workshop dock
      // (opened in EDIT, clicked after flipping to READ) must be refused here — loudly.
      if (!editor.isEditable) {
        window.dispatchEvent(new CustomEvent('wp-toast', {
          detail: { tone: 'error', msg: 'you are in READ mode — flip the switch to EDIT to insert' },
        }));
        return;
      }
      const { state } = editor;
      const size = state.doc.content.size;
      let a = Math.max(0, Math.min(from, size));
      let b = Math.max(a, Math.min(to, size));

      // CH-02 — STALE-RANGE GUARD. The Workshop dock captured {from,to} when the marker was
      // clicked, but stayed open while the editor remained fully editable. If Johnny edited ABOVE
      // the marker before picking a card, every later position shifted and the cached range no
      // longer covers the {tk}/{fc} marker — inserting at it would drop the prose in the wrong
      // place and silently delete good script. Before touching anything, re-resolve the marker:
      //   1. re-find the span mark's CURRENT range fresh (authoritative), or
      //   2. if no mark sits at the cached range, fall back to confirming the cached text still
      //      reads as the marker we opened on.
      // If neither holds, ABORT and toast — never corrupt text.
      const markName = kind === 'tk' ? 'tkSpan' : kind === 'fc' ? 'factCheckSpan'
        : kind === 'visual' ? 'visualSpan' : null;
      const markType = markName ? state.schema.marks[markName] : null;
      let resolved = false;
      if (markType) {
        // Probe a few positions inside the cached range for the span mark, then expand to its full
        // contiguous run via getMarkRange — this re-derives the TRUE current marker bounds even if
        // the doc shifted, as long as the mark still exists somewhere at/near the cached range.
        const range = findMarkRange(state, markType, a, b);
        if (range) { a = range.from; b = range.to; resolved = true; }
      }
      if (!resolved && typeof markerText === 'string' && markerText.length) {
        // No live mark at the cached range. Only proceed if the cached coordinates still hold the
        // EXACT marker text we opened on (so we're overwriting the same words, just unmarked).
        const here = state.doc.textBetween(a, b, '');
        if (here.trim() === markerText.trim()) resolved = true;
      }
      // If we have NO marker identity to check against (legacy/visual with no markerText), keep the
      // old clamp-only behaviour so existing flows don't regress.
      if (!resolved && (markType || (typeof markerText === 'string' && markerText.length))) {
        // ux-01 — this is an ABORT, not a copy. Send the error tone so the toast reads "CAN'T —
        // that marker moved" (red), not a reassuring green "COPIED".
        window.dispatchEvent(new CustomEvent('wp-toast', {
          detail: { tone: 'error', msg: 'that marker moved — click it again to insert' },
        }));
        return;
      }

      // LINEAGE LAW — when the Workshop pick carries fact-check receipts (detail.footnote),
      // the replacement is text + a green ✓ fcFootnote right after it, so resolving a marker
      // never silently bakes away WHERE the fact came from.
      const content = [{ type: 'text', text: String(text), marks: [] }];
      const fn = e.detail && e.detail.footnote;
      if (fn && (fn.note || fn.source)) {
        content.push({
          type: 'fcFootnote',
          attrs: {
            noteId: mintNoteId(),
            note: String(fn.note || ''),
            source: String(fn.source || ''),
            marker: String(markerText || ''),
            verdict: String(fn.verdict || ''),
          },
        });
      }
      editor
        .chain()
        .focus()
        .insertContentAt({ from: a, to: b }, content)
        .run();
    };
    window.addEventListener('wp-replace-span', onReplace);
    return () => window.removeEventListener('wp-replace-span', onReplace);
  }, [editor]);

  // CREATE FOOTNOTE — the Workshop dock's receipt-drop ('wp-create-footnote'). The green ✓
  // fcFootnote lands right AFTER the marker span; the {fc}/{TK} chip itself is untouched (the
  // claim stays live — lineage law). Same CH-02 stale-range guard as onReplace above: the
  // dock's cached {from,to} is re-resolved against the mark's CURRENT range before anything
  // is inserted; if the marker moved and can't be re-found, abort with the error toast
  // instead of dropping the receipt into the wrong sentence.
  useEffect(() => {
    if (!editor) return;
    const onFootnote = (e) => {
      const { from, to, markerText, kind, note, source, verdict } = e.detail || {};
      if (typeof from !== 'number' || typeof to !== 'number') return;
      // READ MODE: same refusal as onReplace — a footnote drop is a doc write.
      if (!editor.isEditable) {
        window.dispatchEvent(new CustomEvent('wp-toast', {
          detail: { tone: 'error', msg: 'you are in READ mode — flip the switch to EDIT to add the footnote' },
        }));
        return;
      }
      const { state } = editor;
      const size = state.doc.content.size;
      let a = Math.max(0, Math.min(from, size));
      let b = Math.max(a, Math.min(to, size));

      const markName = kind === 'tk' ? 'tkSpan' : kind === 'fc' ? 'factCheckSpan' : null;
      const markType = markName ? state.schema.marks[markName] : null;
      let resolved = false;
      if (markType) {
        const range = findMarkRange(state, markType, a, b);
        if (range) { a = range.from; b = range.to; resolved = true; }
      }
      if (!resolved && typeof markerText === 'string' && markerText.length) {
        const here = state.doc.textBetween(a, b, '');
        if (here.trim() === markerText.trim()) resolved = true;
      }
      if (!resolved) {
        window.dispatchEvent(new CustomEvent('wp-toast', {
          detail: { tone: 'error', msg: 'that marker moved — click it again to add the footnote' },
        }));
        return;
      }

      editor
        .chain()
        .focus()
        .insertContentAt(b, [{
          type: 'fcFootnote',
          attrs: {
            noteId: mintNoteId(),
            note: String(note || ''),
            source: String(source || ''),
            marker: String(markerText || ''),
            verdict: String(verdict || ''),
          },
        }])
        // CHECKED FLIP — the receipt landing IS the claim getting fact-checked, so the span's
        // status turns 'checked' (red wash → green in said cells) in the SAME transaction:
        // one undo removes footnote + green together, never a half-state. Only fc spans have
        // status; a {TK} footnote drop leaves its tkSpan untouched.
        .command(({ tr, state }) => {
          const fcType = state.schema.marks.factCheckSpan;
          if (kind === 'fc' && fcType && b > a) {
            tr.addMark(a, b, fcType.create({ status: 'checked' }));
          }
          return true;
        })
        .run();
      window.dispatchEvent(new CustomEvent('wp-toast', { detail: { msg: 'footnote added — click the green ✓ to edit' } }));
    };
    window.addEventListener('wp-create-footnote', onFootnote);
    return () => window.removeEventListener('wp-create-footnote', onFootnote);
  }, [editor]);

  // DURABLE FLUSH ON PAGE TEARDOWN — the actual safety net Johnny's "edit → reload → gone" needs.
  // React/Preact useEffect cleanup does NOT run on a hard browser reload (Cmd-R/F5), tab close, or
  // navigation — the VM is torn down before cleanup fires. So the debounced timer dies unfired and
  // the last edits are lost. 'pagehide' and 'visibilitychange'(hidden) are the ONLY events that
  // reliably fire before teardown across browsers (incl. mobile + bfcache). Both synchronously
  // flush the ABSOLUTE LATEST editor JSON, bypassing the debounce.
  useEffect(() => {
    if (!editor) return;
    if (readOnly) return; // READ-ONLY SHARE: no teardown flush — there is nothing to persist.
    const flushNow = () => { if (hadLocalEdit.current) flushRef.current(editor); };
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
  // COLLAB — PERIODIC READ-ONLY CLOUD SNAPSHOT. The Yjs room is canonical; every ~20s (only when
  // the doc actually changed) we mirror the converged editor JSON up to /api/script-doc so the
  // append-only cloud version history, the `?read` share view, and the fresh-device recovery
  // paths all keep working. Deliberately QUIET: a 409 just means another collaborator's snapshot
  // landed first — the content converges via Yjs, so we prime our version stamp past the cloud's,
  // re-stamp locally, and let the next tick carry it. NO handlePushResult here: no conflict
  // banners, no .conflict snapshots, no push latch — those belong to the single-writer engine.
  useEffect(() => {
    if (!collab || !editor || readOnly) return undefined;
    const tick = () => {
      // SYNC GATE — never mirror an editor whose room content was never delivered (see collabFlush).
      if (collab.hasSynced && !collab.hasSynced()) return;
      if (!cloudSnapshotDirty.current) return;
      const version = lastSnapshotVersion.current || getKnownBaseVersion();
      if (!(version > 0)) return;
      cloudSnapshotDirty.current = false;
      const json = editor.getJSON();
      Promise.resolve(pushDoc(json, version))
        .then((pr) => {
          if (pr && pr.stale === true) {
            // A teammate's snapshot is ahead. Benign by construction (Yjs already merged the
            // content) — advance our stamp past theirs and retry on the next tick.
            const cv = Math.floor(Number(pr.version)) || 0;
            try { if (cv > 0) primeVersionFloor(cv); } catch {}
            try { flushRef.current(editor); } catch {} // re-stamp local save above the cloud version
            cloudSnapshotDirty.current = true;
          }
        })
        .catch(() => {});
    };
    const id = setInterval(tick, 20000);
    return () => clearInterval(id);
  }, [editor]);

  // COLLAB SYNC GATE — the editor mounted non-editable (see `editable:` above); flip it live the
  // moment the room's initial sync delivers the real doc. Surfaces state through wp-collab-sync so
  // the save pill can say "connecting…" instead of presenting a dead blank page, and raises the
  // STUCK banner if sync hasn't landed after 20s (auth failure / room unreachable) — the exact
  // symptom Johnny hit as "blank until I open a private window". Editing stays off while stuck:
  // a keystroke into an unsynced shell is the overwrite bug, not a feature. If sync arrives late,
  // the gate still opens and the banner clears — a slow room is not a broken room.
  useEffect(() => {
    if (!collab || !editor || readOnly) return undefined;
    // READ/EDIT MODE: sync landing opens the collab gate, but the surface only goes live if the
    // sticky switch is on EDIT — otherwise the session stays in its calm read-mode default and
    // the wp-edit-mode listener below arms it when the switch flips.
    if (collab.hasSynced()) { if (editor.isEditable !== isEditMode()) editor.setEditable(isEditMode()); return undefined; }
    const announce = (state) => {
      try { window.dispatchEvent(new CustomEvent('wp-collab-sync', { detail: { state } })); } catch {}
    };
    announce('connecting');
    const stuckTimer = setTimeout(() => { if (!collab.hasSynced()) announce('stuck'); }, 20000);
    const off = collab.onSynced(() => {
      clearTimeout(stuckTimer);
      if (!editor.isDestroyed) editor.setEditable(isEditMode());
      announce('synced');
    });
    return () => { off(); clearTimeout(stuckTimer); };
  }, [editor]);

  // READ/EDIT MODE — the sticky switch flipped. Editable is the AND of three gates: not a
  // `?read` share (structural), collab room synced (overwrite safety), and the switch on EDIT.
  // The first two never relax here; the switch only ever controls the last term.
  useEffect(() => {
    if (!editor || readOnly) return undefined;
    const onMode = (e) => {
      const wantEdit = !!(e.detail && e.detail.edit);
      const synced = !collab || collab.hasSynced();
      if (!editor.isDestroyed) editor.setEditable(wantEdit && synced);
    };
    window.addEventListener('wp-edit-mode', onMode);
    return () => window.removeEventListener('wp-edit-mode', onMode);
  }, [editor]);

  useEffect(() => {
    if (readOnly) return; // READ-ONLY SHARE: a reader never reacts to cross-tab writes — it's frozen.
    if (collab) return;   // COLLAB: tabs converge through the Yjs room — the reload banner would fight it.
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
  // READ-ONLY SHARE: skip — there is nothing to flush and saveDoc would refuse anyway.
  useEffect(() => {
    if (readOnly) return undefined;
    return () => {
      if (telTimer.current) { clearTimeout(telTimer.current); telTimer.current = null; }
      if (telIdleTask.current) { cancelIdleTask(telIdleTask.current); telIdleTask.current = null; }
      clearActiveSelectionWrappers(editor);
      if (hadLocalEdit.current) flushRef.current(editor); // zero-edit visit guard
    };
  }, [editor]);

  return (
    <>
      <EditorContent editor={editor} class="wp-editor" />
      {/* READ-ONLY SHARE: the LinkPopover and Workshop dock are edit-only chrome — omit them
          entirely so a reader gets a calm, clean reading surface. (The old floating BubbleMenu
          is gone — Johnny: "it kind of gets in the way"; its survivors — TK, FC, the three
          alignment tools — live in the right-click bulk menu, extensions/convert-menu.js.) */}
      {!readOnly && <LinkPopover editor={editor} />}
      {/* Find & Replace panel — Cmd/Ctrl+F opens it. Edit-only chrome. */}
      {!readOnly && <FindReplacePanel editor={editor} />}
      {!readOnly && <Workshop />}
    </>
  );
});

export { docToBlocks };
