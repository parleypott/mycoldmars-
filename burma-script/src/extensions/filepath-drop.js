// FILEPATH DROP — detect a folder (or a non-media file) dragged from Finder into the script and turn
// the location on Johnny's computer into a green code-path chip (filepathSpan). Kept as a SEPARATE
// small module so image-drop.js only needs ONE early branch in its drop handler (folder / path-only
// drop → filepath chip, handled=true) — a localized hook that reconciles cleanly with the parallel
// audio-blocks drop branch.
//
// THE BROWSER-PATH REALITY (verified on Chrome/macOS): a File object dropped from Finder exposes ONLY
// its .name — the absolute filesystem path is hidden for security. BUT dragging a file or folder out
// of Finder ALSO populates the DataTransfer with a `file://` URL in `text/uri-list` (and usually a
// mirror in `text/plain`) that DOES carry the absolute path, e.g.
//     file:///Users/johnnyharris/Desktop/Boat%20Nile.qta
// So we read text/uri-list (falling back to text/plain), parse the first file:// URL, decodeURIComponent
// it, and that is the real path. A FOLDER is identified structurally via webkitGetAsEntry().isDirectory
// (a folder can never be uploadable media). When NO path is exposed we fall back to the dropped item's
// name so the chip still renders something Johnny can edit.
import { TextSelection } from '@tiptap/pm/state';

// Media mime families we must NEVER hijack — images/videos upload via image-drop.js, audio via the
// audio-blocks workflow. Only a NON-media file falls back to a filepath chip; a folder is always a chip.
const MEDIA_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const isMediaMime = (type) => {
  const t = String(type || '').toLowerCase();
  return MEDIA_MIME_PREFIXES.some((p) => t.startsWith(p));
};

// Convert a single `file://` URL to an absolute filesystem path. Handles the macOS empty-host form
// (file:///Users/…) and the file://localhost/Users/… form, and decodes %20 → space etc. Returns ''
// for anything that isn't a file:// URL.
export function fileUrlToPath(url) {
  if (!url) return '';
  let s = String(url).trim();
  if (!/^file:\/\//i.test(s)) return '';
  s = s.slice('file://'.length);
  // Strip an optional host segment (e.g. "localhost") before the first slash. The macOS empty-host
  // form already starts with '/', so indexOf('/') === 0 and we keep the whole string.
  const slash = s.indexOf('/');
  if (slash > 0) s = s.slice(slash);
  else if (slash === -1) return '';
  try { s = decodeURIComponent(s); } catch { /* keep the raw (still better than nothing) */ }
  return s;
}

// Pull the first absolute path out of a DataTransfer's text payloads. text/uri-list is the canonical
// carrier (RFC 2483: one URL per line, '#' lines are comments); text/plain is the fallback mirror.
export function pathFromDataTransfer(dt) {
  if (!dt || typeof dt.getData !== 'function') return '';
  const blocks = [];
  try { blocks.push(dt.getData('text/uri-list')); } catch { /* some browsers throw off-drop */ }
  try { blocks.push(dt.getData('text/plain')); } catch { /* ignore */ }
  for (const block of blocks) {
    if (!block) continue;
    for (const line of String(block).split(/[\r\n]+/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      if (/^file:\/\//i.test(t)) {
        const p = fileUrlToPath(t);
        if (p) return p;
      }
    }
  }
  return '';
}

// Is this drop a FOLDER? webkitGetAsEntry().isDirectory is the only reliable signal — a dropped folder
// shows up in dataTransfer.files as a zero-byte, empty-type File-like entry, indistinguishable from an
// extensionless file by name alone. Returns { isFolder, name } (name = folder name fallback for the
// chip when no file:// path is exposed). MUST be called synchronously during the drop event — the
// items list is only live for the duration of the handler.
export function folderInfoFromDataTransfer(dt) {
  const items = dt && dt.items ? Array.from(dt.items) : [];
  for (const it of items) {
    if (it.kind !== 'file' || typeof it.webkitGetAsEntry !== 'function') continue;
    let entry = null;
    try { entry = it.webkitGetAsEntry(); } catch { entry = null; }
    if (entry && entry.isDirectory) {
      return { isFolder: true, name: entry.name || '' };
    }
  }
  return { isFolder: false, name: '' };
}

// THE DECISION. Given a drop event, return { path, isFolder } when it should become a filepath chip,
// or null to let image-drop.js / the audio workflow / ProseMirror handle it untouched.
//   1. FOLDER drop  → ALWAYS a chip (can't be media). Path from file:// URL, else the folder name.
//   2. Media files present (image/video/audio) → null (let them upload).
//   3. A non-media FILE with an exposed file:// path → chip (a sensible pointer fallback).
// Everything else (plain-text drags, PM node drags, row-reorder) → null.
export function detectFilepathDrop(event) {
  const dt = event && event.dataTransfer;
  if (!dt) return null;

  const { isFolder, name } = folderInfoFromDataTransfer(dt);
  const path = pathFromDataTransfer(dt);

  if (isFolder) {
    // A folder is unambiguous — always a chip. Prefer the real path; fall back to the folder name.
    const text = path || name;
    return text ? { path: text, isFolder: true } : null;
  }

  // Not a folder. If ANY real media file rode along, this is an upload — never hijack it.
  const files = dt.files ? Array.from(dt.files) : [];
  if (files.some((f) => isMediaMime(f.type))) return null;

  // A non-media file (a .qta project, a .txt, an extensionless doc) with an exposed path → chip.
  if (path) return { path, isFolder: false };

  return null;
}

// Insert the green filepath chip at `pos` in ONE user transaction (COLLAB LOOP LAW: one tx, no auto-
// dispatch of anything downstream). The path text carries the filepathSpan mark; the caret lands after
// the chip with the mark REMOVED from the stored set so the next keystroke is ordinary prose (the mark
// is inclusive:true, so without this a following space would bleed green). Returns true on success.
export function insertFilepathChip(view, path, pos) {
  const text = String(path || '').trim();
  if (!text) return false;
  const { state } = view;
  const markType = state.schema.marks.filepathSpan;
  if (!markType) return false;
  const at = Number.isInteger(pos) ? pos : state.selection.from;
  try {
    const node = state.schema.text(text, [markType.create()]);
    const tr = state.tr.insert(at, node);
    const after = at + node.nodeSize;
    try { tr.setSelection(TextSelection.create(tr.doc, after)); } catch { /* best-effort caret */ }
    tr.removeStoredMark(markType);
    view.dispatch(tr);
    return true;
  } catch {
    return false; // mapped pos was not a legal inline insertion point — abort, never clamp
  }
}
