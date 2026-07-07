// Burma Script Tool — IMAGE DROP/PASTE (drag a still into the rack, e.g. the SHOWN column).
//
// Before this extension the engine had NO file-drop handling at all: ProseMirror
// preventDefault()s dragover (making the editor a valid drop target) but its default drop
// handler can only parse text/html|text/plain — a Finder image drag carries only `Files`,
// so PM bailed WITHOUT preventDefault and the browser executed its default action:
// NAVIGATE THE TAB to the dropped image, replacing the editor mid-session. This plugin
// closes that trap (every file drop over the editor is swallowed) and turns image drops
// into persisted imageBlock nodes.
//
// This is an Extension, NOT a Node — it adds ZERO schema, so the Editor.jsx /
// migrate-doc.js mirror-schema lockstep is untouched (same posture as FindReplace). The
// imageBlock node it inserts already exists in BURMA_NODES and already round-trips
// docToBlocks / the save-gate schema losslessly (image-block.test.mjs).
//
// THE BYTES-NEVER-IN-THE-DOC LAW: the doc is persisted whole to localStorage (~5MB origin
// budget; quota-escalation.test.mjs documents a real quota failure at ~167KB), IndexedDB,
// /api/script-doc, a FULL COPY per autosave into script_doc_revisions, and the Yjs collab
// room. So we upload the bytes FIRST (/api/script-image-upload → public Supabase CDN URL)
// and only the ~100-byte URL ever enters the doc. While the upload is in flight the drop
// point is held by a WIDGET DECORATION (the canonical ProseMirror upload-placeholder
// pattern): decorations are not doc state — no history step, no collab payload, nothing to
// autosave — and the placeholder's position maps through every concurrent transaction
// (Johnny's own typing, a teammate's Yjs edits) via tr.mapping. If an edit DELETES the
// placeholder (row removed, undo), the insert ABORTS with a toast — never clamps to a
// stale/wrong position (silent structural corruption is the failure class this kills).
//
// ONE-TRANSACTION LAW: the final insert is a single tr carrying the node with its FINAL
// attrs (no insert-then-patch) + the remove-placeholder meta — one undo removes the image
// byte-exact, and the tr rides the existing autosave debounce / Yjs binding unchanged.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Slice, Fragment } from '@tiptap/pm/model';
import { dropPoint } from '@tiptap/pm/transform';
import { isReadOnly } from '../read-mode.js';
import { getEpisode } from '../episode-config.js';

export const imageDropKey = new PluginKey('burmaImageDrop');

// Client-side mime allow-list — deliberately the SAME set the server's imageStorageMeta
// stores (png/jpeg/webp; image/jpg is the non-canonical jpeg spelling it normalizes).
// Anything else — notably HEIC from macOS Photos — is rejected HERE with a toast: the
// server would coerce its Content-Type to png WITHOUT transcoding the bytes, producing a
// broken render that would then persist into every doc revision.
export const SUPPORTED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

// Pure: split a FileList/array into supported images vs everything else.
export function pickImageFiles(files) {
  const images = [];
  const rejected = [];
  for (const f of Array.from(files || [])) {
    const type = String(f?.type || '').toLowerCase();
    if (SUPPORTED_IMAGE_MIMES.has(type)) images.push(f);
    else rejected.push(f);
  }
  return { images, rejected };
}

// Same shape as the seeded palau2 image ids ('image_test_1') / slash-menu's mintBlockId.
// The id doubles as the upload's block_id, so the storage path names the block it feeds.
export function mintImageBlockId() {
  return 'image_' + Math.random().toString(36).slice(2, 9);
}

// Caption default: the filename without its extension (editable later via attrs).
export function altFromFilename(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

// THE GUARD that makes byte-srcs structurally impossible: only an absolute http(s) URL or
// a root-relative bundled path (the existing /palau2/img/* shape) may enter the doc.
// data:/blob:/javascript:/everything-else is refused — a data: URL would replicate
// megabytes into every persistence sink, and a blob: URL dies on reload and would ship a
// permanently broken src to every collaborator and revision.
export function isSafeImageSrc(src) {
  const s = String(src || '').trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (s.startsWith('/') && !s.startsWith('//')) return true;
  return false;
}

// Refine a raw coordinate-derived position to a LEGAL insertion point for an imageBlock
// using PM's own dropPoint (the same routine PM's default drop uses). tableCell content is
// 'block+' and imageBlock is group:'block', so a drop over a shown cell lands INSIDE that
// cell rather than between rows. Returns null when no legal point exists — caller aborts.
export function resolveDropPos(state, rawPos) {
  const type = state.schema.nodes.imageBlock;
  if (!type) return null;
  const probe = new Slice(Fragment.from(type.create()), 0, 0);
  return dropPoint(state.doc, rawPos, probe);
}

// Placeholder CRUD — all meta-only transactions (decorations are not doc content: no
// history step, no autosave, no collab payload).
export function addPlaceholderTr(state, pos, id) {
  return state.tr.setMeta(imageDropKey, { add: { pos, id } }).setMeta('addToHistory', false);
}

export function removePlaceholderTr(state, id) {
  return state.tr.setMeta(imageDropKey, { remove: { id } }).setMeta('addToHistory', false);
}

// Read the placeholder's CURRENT (mapped) position. null = deleted by an edit → abort.
export function findPlaceholderPos(state, id) {
  const set = imageDropKey.getState(state);
  if (!set) return null;
  const found = set.find(undefined, undefined, (spec) => spec.id === id);
  return found.length ? found[0].from : null;
}

// The ONE transaction that lands the image: create the node with its FINAL attrs at the
// placeholder's mapped position and clear the placeholder in the same tr. Returns null
// (caller aborts + toasts) when the placeholder is gone, the src is unsafe, or the mapped
// position is no longer a legal insertion point — never a partial/patched insert.
export function insertImageTr(state, id, { src, alt = '', kind = 'shot' }) {
  if (!isSafeImageSrc(src)) return null;
  const pos = findPlaceholderPos(state, id);
  if (pos == null) return null;
  const type = state.schema.nodes.imageBlock;
  if (!type) return null;
  try {
    const node = type.create({ blockId: id, src: String(src), alt: String(alt || ''), kind });
    const tr = state.tr.insert(pos, node);
    tr.setMeta(imageDropKey, { remove: { id } });
    return tr;
  } catch {
    return null; // mapped pos became structurally illegal — abort, never clamp
  }
}

// Widget DOM is built lazily (function form) so the plugin is fully headless-testable —
// no document access until a real view renders the decoration.
function placeholderDom() {
  const el = document.createElement('span');
  el.className = 'wp-image-uploading';
  el.setAttribute('contenteditable', 'false');
  el.textContent = 'UPLOADING IMAGE…';
  return el;
}

function toast(msg, tone = 'error') {
  try { window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone, msg } })); } catch {}
}

// FileReader → bare base64 (strip the data:*;base64, prefix — the endpoint wants raw).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const at = s.indexOf('base64,');
      resolve(at >= 0 ? s.slice(at + 7) : s);
    };
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
}

async function uploadAndInsert(view, file, id) {
  let url = null;
  let detail = '';
  try {
    const dataBase64 = await fileToBase64(file);
    // The scripts-library gate's fetch interceptor injects the signed-in JWT on
    // same-origin /api/* calls, so this request is authed for free in editable sessions.
    const res = await fetch('/api/script-image-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: getEpisode().id,
        block_id: id,
        dataBase64,
        mimeType: file.type,
      }),
    });
    const out = await res.json().catch(() => null);
    if (res.ok && out && out.ok && out.url) url = out.url;
    else detail = (out && out.error) || `http ${res.status}`;
  } catch (e) {
    detail = e?.message || 'network error';
  }
  if (view.isDestroyed) return;

  if (!url) {
    // LOUD failure — the doc is clean either way (placeholder is decoration-only), but
    // Johnny must know the image did not stay. Never a silent no-op.
    view.dispatch(removePlaceholderTr(view.state, id));
    toast(`image upload failed (${detail || 'unknown'}) — the picture was NOT added`);
    return;
  }
  const tr = insertImageTr(view.state, id, { src: url, alt: altFromFilename(file.name), kind: 'shot' });
  if (!tr) {
    // Placeholder deleted (row removed / undo) or position no longer legal → ABORT.
    view.dispatch(removePlaceholderTr(view.state, id));
    toast('that spot was edited away while the image uploaded — drop it again');
    return;
  }
  view.dispatch(tr);
}

// Shared drop/paste entry: place one placeholder per file at the refined position and
// kick off the async uploads. Placeholders at the same position map to AFTER each landed
// insert (widget side ≥ 0), so a multi-file drop keeps its order.
function startUploads(view, files, rawPos) {
  const pos = resolveDropPos(view.state, rawPos);
  if (pos == null) {
    toast('no legal spot for an image there — try dropping onto a row');
    return;
  }
  for (const file of files) {
    const id = mintImageBlockId();
    view.dispatch(addPlaceholderTr(view.state, pos, id));
    uploadAndInsert(view, file, id);
  }
}

// Exported so the test mounts the EXACT production plugin on a bare EditorState.
export function buildImageDropPlugin() {
  return new Plugin({
    key: imageDropKey,
    state: {
      init() { return DecorationSet.empty; },
      apply(tr, set) {
        // Map every live placeholder through this transaction FIRST (positions survive
        // concurrent edits; a placeholder whose position is deleted drops out of the set —
        // that disappearance is exactly what makes the insert abort), THEN apply add/remove
        // meta against the mapped set.
        set = set.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(imageDropKey);
        if (meta?.add) {
          const deco = Decoration.widget(meta.add.pos, placeholderDom, { id: meta.add.id });
          set = set.add(tr.doc, [deco]);
        }
        if (meta?.remove) {
          set = set.remove(set.find(undefined, undefined, (spec) => spec.id === meta.remove.id));
        }
        return set;
      },
    },
    props: {
      decorations(state) { return imageDropKey.getState(state); },
      // handleDOMEvents.drop (not props.handleDrop) is deliberate: PM only calls
      // handleDrop AFTER posAtCoords resolves — if it doesn't, an unhandled file drop
      // still NAVIGATES THE TAB. This DOM-level hook fires first and swallows EVERY
      // file drop over the editor unconditionally. Non-file drops (PM node drags, the
      // table.js row-reorder — which also stopPropagates on the row DOM before reaching
      // us) carry no dataTransfer.files, return false, and proceed untouched.
      handleDOMEvents: {
        drop(view, event) {
          const files = event.dataTransfer && event.dataTransfer.files;
          if (!files || !files.length) return false;
          event.preventDefault(); // NEVER navigate away on a file drop, whatever the file
          if (isReadOnly() || !view.editable) return true; // read-only: swallow silently
          const { images, rejected } = pickImageFiles(files);
          if (!images.length) {
            toast('only png / jpeg / webp images can be dropped into the script');
            return true;
          }
          if (rejected.length) {
            toast(`${rejected.length} file${rejected.length > 1 ? 's' : ''} skipped — only png / jpeg / webp images land here`);
          }
          const raw = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!raw) {
            toast('could not find a spot for that image — drop it onto a row');
            return true;
          }
          startUploads(view, images, raw.pos);
          return true;
        },
      },
      // Cheap adjacent win: a screenshot on the clipboard pastes in through the exact
      // same upload path, inserted at the caret. Text/HTML pastes (no files) fall through
      // to PasteSanitize untouched.
      handlePaste(view, event) {
        const files = event.clipboardData && event.clipboardData.files;
        if (!files || !files.length) return false;
        const { images } = pickImageFiles(files);
        if (!images.length) return false; // not an image paste — normal paste proceeds
        if (isReadOnly() || !view.editable) return true;
        startUploads(view, images, view.state.selection.from);
        return true;
      },
    },
  });
}

export const ImageDrop = Extension.create({
  name: 'burmaImageDrop',
  addProseMirrorPlugins() {
    return [buildImageDropPlugin()];
  },
});
