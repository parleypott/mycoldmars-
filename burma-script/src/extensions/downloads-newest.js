// Burma Script Tool — DROP-FOLDER HOTKEY (Johnny 2026-07-23: "press a key, my newest gif lands in
// the script — no Finder, no drag").
//
// THE USE CASE: Johnny renders a gif in his MapKeys tool and it saves into a SHARED DROP FOLDER he
// picked once (e.g. Desktop › mapkey-gifs). He wants that gif in the script INSTANTLY. ⌘⌃M does
// exactly that: it finds the NEWEST complete real file in that same folder and inserts it INLINE INTO
// THE CELL at the cursor — the EXACT at-caret insert a drag-drop uses (image-drop.js's insertMediaAtPos,
// NOT the new-row paste). Johnny 2026-07-23: "insert it into the cell that the cursor is in… as if I'm
// pasting it or dragging it in." So it inherits, for free, the full road already proven by image-drop.js:
// gif→mp4 transcode, base64/signed route split, SHA-256 dedupe, the 413 self-heal, video-loop controls,
// and the one-user-transaction insert. (A caret with no legal inline spot falls back to the new-row paste.)
//
// WHY A SHARED FOLDER (not ~/Downloads): a page cannot freely read ~/Downloads, AND Chrome's
// showDirectoryPicker BLOCKS the Downloads folder outright ("contains system files"). So instead the
// USER grants a NORMAL folder ONCE (showDirectoryPicker → linkDropFolder) and the handle persists in
// IndexedDB. MapKeys and this script tool are the SAME ORIGIN (newpress.press), so they SHARE that
// IndexedDB and the SAME handle — MapKeys writes gifs into the folder, this tool reads the newest out.
// Linking from EITHER tool sets it for both. Handle store + permission live in shared/drop-folder.js.
//
// GESTURE LAW: showDirectoryPicker / requestPermission REQUIRE transient user activation, so the whole
// chain is kicked off synchronously from the keydown handler (list-shortcuts.js) and never waits on a
// timer before touching those APIs — the browser keeps the activation alive across the awaited
// permission/link steps as one continuous chain. Reading an ALREADY-'granted' folder needs no gesture.
//
// COLLAB LOOP LAW: this module never dispatches a transaction itself. It hands the File to
// insertMediaAtPos (or, on the fallback, startMediaPaste), whose insert is a single user-initiated
// transaction (one undo removes it) — identical to a drag-drop / paste. Read-mode is gated at the
// keymap call site (editor.isEditable) AND re-checked here, so ⌘⌃M is a no-op on a ?read share.

import { isReadOnly } from '../read-mode.js';
import {
  getDropFolderHandle,
  ensureDropPermission,
  linkDropFolder,
  hasDirectoryPicker as sharedHasDirectoryPicker,
} from '../../../shared/drop-folder.js';
import {
  isSupportedMediaMime,
  SUPPORTED_IMAGE_MIMES,
  SUPPORTED_VIDEO_MIMES,
  insertMediaAtPos,
  startMediaPaste,
} from './image-drop.js';

// ── toast (same wp-toast bus main.jsx's CopyToast listens on) ─────────────────────────────
// An ok toast carries { tone:'ok', lab, msg }; an error carries { tone:'error', msg }.
function toast(msg, { tone = 'error', lab } = {}) {
  try {
    window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone, lab, msg } }));
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// NEWEST-FILE SELECTION — PURE. The whole "grab my latest gif" promise rests on picking the right
// file, so the rules are pure functions over plain {name,lastModified,size,kind} records and
// unit-tested hard. NONE of these touch the DOM or the File System Access API. (Unchanged when the
// SOURCE moved from Downloads to the shared drop folder — the selection logic is identical.)

// IN-PROGRESS download sentinels — a partially-written file must NEVER be picked (it would upload
// a truncated/zero-byte fragment). Chrome/Brave use .crdownload; other browsers/tools use
// .download / .part / .tmp; a trailing '~' is the classic editor/temp marker.
const IN_PROGRESS_SUFFIXES = ['.crdownload', '.download', '.part', '.tmp'];
export function isInProgressName(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  if (n.endsWith('~')) return true;
  return IN_PROGRESS_SUFFIXES.some((s) => n.endsWith(s));
}

// HIDDEN / SYSTEM files — macOS litters folders with .DS_Store and other dotfiles. A leading dot
// means hidden; never a thing Johnny meant to use.
export function isHiddenName(name) {
  const n = String(name || '');
  return n.startsWith('.');
}

// A file is a candidate for "newest real, complete file" only when it is: an actual file (not a
// directory), not hidden/system, not an in-progress download, and has real bytes (size > 0). The
// zero-byte gate double-covers a write that just began (the OS creates a 0-byte target first).
export function isCompleteRealFile(entry) {
  if (!entry) return false;
  if (entry.kind === 'directory') return false;
  const name = entry.name;
  if (!name || isHiddenName(name) || isInProgressName(name)) return false;
  if (!(Number(entry.lastModified) >= 0)) return false;
  if (!(Number(entry.size) > 0)) return false;
  return true;
}

// Pure: pick the entry with the greatest lastModified among the complete real files. Strict `>`
// keeps the FIRST-seen entry on an exact tie (rare; directory order is not guaranteed but a tie is
// pathological). Returns null when nothing qualifies. Each entry is returned AS PASSED, so a caller
// that attached a `.file` handle to the record gets it back.
export function pickNewestFile(entries) {
  let best = null;
  for (const e of Array.from(entries || [])) {
    if (!isCompleteRealFile(e)) continue;
    if (best == null || Number(e.lastModified) > Number(best.lastModified)) best = e;
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// MEDIA GATE + ROUTE — PURE. The newest file might be a .svg / .zip Johnny also has in the folder;
// only a supported image/video is inserted. Reuses image-drop.js's EXACT predicate so this can
// never drift from what the paste/drop paths accept. onMedia/onReject are injected so the routing
// decision is testable without a live editor.
export function routeNewestFile(file, { onMedia, onReject }) {
  if (file && isSupportedMediaMime(String(file.type || ''))) {
    onMedia?.(file);
    return 'media';
  }
  onReject?.(file);
  return 'reject';
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// PERMISSION — thin READ wrapper over the shared state machine, kept exported so callers/tests that
// only care about read access have a one-arg entry point. The canonical machine (granted → silent,
// prompt → requestPermission inside the gesture, denied/throw → denied) lives in shared/drop-folder.js.
//   returns 'granted' | 'prompt' | 'denied'
export function ensureReadPermission(handle, opts = {}) {
  return ensureDropPermission(handle, { mode: 'read', ...opts });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ENUMERATE — walk the directory handle's entries, resolve each to a File, and pick the newest
// complete real file. A cheap NAME gate runs BEFORE getFile() so we never read the bytes of an
// in-progress/hidden file. Returns the winning File (with .lastModified/.size/.name from the File
// itself, which is the authoritative mtime) or null. Never throws — a per-entry getFile() failure
// (a file being written mid-scan) is skipped, not fatal.
export async function newestFileFromDir(dirHandle) {
  if (!dirHandle || typeof dirHandle.entries !== 'function') return null;
  const candidates = [];
  try {
    for await (const [name, entry] of dirHandle.entries()) {
      if (!entry || entry.kind !== 'file') continue;
      if (isHiddenName(name) || isInProgressName(name)) continue; // cheap pre-gate, skip the read
      try {
        const file = await entry.getFile();
        candidates.push({ name, kind: 'file', lastModified: file.lastModified, size: file.size, file });
      } catch { /* file vanished / being written — skip */ }
    }
  } catch { return null; }
  const picked = pickNewestFile(candidates);
  return picked ? picked.file : null;
}

// showOpenFilePicker accept map for the Safari fallback — the exact media set image-drop.js takes.
export function mediaPickerAcceptTypes() {
  const imageExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  const videoExt = ['.mp4', '.webm', '.mov'];
  return [
    { description: 'Images', accept: { 'image/*': imageExt } },
    { description: 'Video', accept: { 'video/*': videoExt } },
  ];
}

// Feature detect — the zero-click path needs showDirectoryPicker (Chromium). Safari has neither this
// nor a persistent directory handle, so it takes the one-click showOpenFilePicker fallback. Re-exports
// the shared detector so both tools agree on capability.
export function hasDirectoryPicker() {
  return sharedHasDirectoryPicker();
}
export function hasFilePicker() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

// Insert a resolved File through the media gate + the shared upload pipeline. A supported image/video
// lands INLINE INTO THE CELL at the live cursor — the EXACT at-caret insert a drag-drop uses
// (insertMediaAtPos: dropPoint refinement, then the transcode/route-split/dedupe/413-self-heal/
// loop-controls road). Johnny 2026-07-23: "insert it into the cell that the cursor is in… as if I'm
// pasting it or dragging it in." If the caret has NO legal inline spot (empty/odd selection, a chip,
// a pre-table doc) the inline insert reports false and we fall back to the new-row paste path so the
// file still lands somewhere sensible — never a dead toast. Anything non-media → a calm named toast.
function insertResolvedFile(view, file, deps = {}) {
  const insertAtCursor = deps.insertMediaAtPos || insertMediaAtPos;
  const pasteAsRow = deps.startMediaPaste || startMediaPaste;
  const doToast = deps.toast || toast;
  return routeNewestFile(file, {
    onMedia: (f) => {
      const pos = view?.state?.selection?.from;
      const placed = pos != null && insertAtCursor(view, [f], pos);
      if (!placed) pasteAsRow(view, [f]); // no legal inline spot → sensible new-row fallback
    },
    onReject: (f) => doToast(`newest file isn't an image or video (${f?.name || 'unknown file'})`),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SAFARI / NO-API FALLBACK — showOpenFilePicker defaulting to the desktop (Safari can't persist a
// directory handle, so the zero-click version is impossible there). One click to confirm the file,
// then the same insert pipeline. An AbortError = Johnny cancelled the picker = silent.
async function runFilePickerFallback(view, deps = {}) {
  const doToast = deps.toast || toast;
  const openFilePicker = deps.showOpenFilePicker
    || (typeof window !== 'undefined' ? window.showOpenFilePicker?.bind(window) : null);
  if (typeof openFilePicker !== 'function') {
    doToast("this browser can't reach your script folder — drag the file into the script instead");
    return;
  }
  try {
    const [fileHandle] = await openFilePicker({
      startIn: 'desktop',
      multiple: false,
      excludeAcceptAllOption: false,
      types: mediaPickerAcceptTypes(),
    });
    if (!fileHandle) return;
    const file = await fileHandle.getFile();
    insertResolvedFile(view, file, deps);
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user cancelled — silent
    doToast("couldn't open that file — try again");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE ORCHESTRATOR — what ⌘⌃M runs. Dependency-injectable (every browser API + the two side-effect
// sinks can be mocked) so the whole flow is drivable in a headless test without a real gesture.
//
// FLOW (Chromium): load the SHARED drop-folder handle → if present, ensureReadPermission (granted =
// silent, prompt = one-click request); with a granted handle, enumerate + insert the newest file. No
// usable handle (first ever use here, or permission revoked) → linkDropFolder (showDirectoryPicker,
// persisted for BOTH tools), tell Johnny ONCE, then enumerate + insert. Any picker AbortError = silent.
export async function runDownloadsHotkey(view, deps = {}) {
  const doToast = deps.toast || toast;
  const readOnly = deps.isReadOnly || isReadOnly;
  if (readOnly()) return; // ?read share — never mutate (belt-and-suspenders; keymap also gates)
  if (!view || view.isDestroyed) return;

  const dirPickerAvailable = deps.hasDirectoryPicker ? deps.hasDirectoryPicker() : hasDirectoryPicker();
  if (!dirPickerAvailable) {
    return runFilePickerFallback(view, deps);
  }

  const getHandle = deps.getDropFolderHandle || getDropFolderHandle;
  const link = deps.linkDropFolder || linkDropFolder;
  const ensure = deps.ensureReadPermission || ensureReadPermission;
  const enumerate = deps.newestFileFromDir || newestFileFromDir;

  try {
    let handle = await getHandle();
    if (handle) {
      const perm = await ensure(handle); // silent when 'granted'; one click when 'prompt'
      if (perm !== 'granted') handle = null; // denied/prompt-refused → re-link below
    }
    if (!handle) {
      // First use here (or the grant is gone): pick the folder MapKeys saves gifs to. The keypress is
      // the gesture — linkDropFolder calls showDirectoryPicker synchronously inside this chain and
      // persists the handle for BOTH tools. AbortError (user cancels) surfaces to the catch → silent.
      handle = await link({ mode: 'readwrite' });
      if (!handle) return;
      doToast('script folder linked — ⌘⌃M now drops in your newest gif instantly', { tone: 'ok', lab: 'LINKED' });
    }
    const file = await enumerate(handle);
    if (!file) { doToast('no complete file in your script folder yet'); return; }
    insertResolvedFile(view, file, deps);
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user cancelled the directory picker — silent
    doToast("couldn't read your script folder — press ⌘⌃M to try again");
  }
}

// Re-exported so the media set the picker offers stays welded to image-drop.js's allow-list.
export { SUPPORTED_IMAGE_MIMES, SUPPORTED_VIDEO_MIMES };
