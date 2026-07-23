/*
 * downloads-newest.test.mjs — DOWNLOADS HOTKEY (⌘⌥M) — downloads-newest.js.
 *
 * Johnny 2026-07-23: "press a key, my newest download lands in the script — no Finder, no drag" AND
 * "insert it into the cell that the cursor is in… as if I'm pasting it or dragging it in." ⌘⌃M finds
 * the NEWEST complete real file in the shared drop folder (via the File System Access API, with a
 * once-granted directory handle persisted in IndexedDB) and inserts it INLINE INTO THE CELL at the
 * cursor — the EXACT at-caret insert a drag-drop uses (image-drop.js's insertMediaAtPos), NOT the
 * new-row paste. A caret with no legal inline spot falls back to the new-row paste (startMediaPaste).
 *
 * Proves, all headless (the real File System Access API needs a live gesture + a real Chrome
 * permission grant that no headless run can produce — so the SELECTION rules, the MEDIA GATE, the
 * PERMISSION state machine, and the ORCHESTRATOR are unit-tested purely / against mocks):
 *   1. SELECTION (pure) — pickNewestFile excludes in-progress downloads (.crdownload/.download/
 *      .part/.tmp/trailing '~'), hidden/system files (.DS_Store, leading dot), zero-byte files, and
 *      directories, then picks max lastModified. isInProgressName / isHiddenName / isCompleteRealFile.
 *   2. MEDIA GATE (pure) — routeNewestFile sends a supported image/video to onMedia and anything
 *      else (svg, zip, HEIC) to onReject; reuses image-drop.js's isSupportedMediaMime exactly.
 *   3. PERMISSION state machine — granted → 'granted' with NO request; prompt → requestPermission
 *      then its verdict; denied → 'denied' without asking; a throwing API degrades to 'denied'.
 *   4. ORCHESTRATOR (mocked deps) — granted handle → silent enumerate + insertMediaAtPos([file]) at
 *      the LIVE cursor (not the new-row paste); first use (no handle) → showDirectoryPicker + save +
 *      link toast + insert; denied stored handle → re-pick; caret with no legal inline spot → falls
 *      back to the new-row paste; unsupported newest file → toast, nothing inserted; a picker
 *      AbortError → silent no-op; read-only → nothing happens.
 *   5. KEYMAP — list-shortcuts.js binds Mod-Alt-m at priority 1001 behind the isEditable gate and
 *      routes to runDownloadsHotkey; shortcuts-list.js documents ⌘⌥M on the help card.
 *
 * Run: bun src/extensions/downloads-newest.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isInProgressName, isHiddenName, isCompleteRealFile, pickNewestFile,
  routeNewestFile, ensureReadPermission, runDownloadsHotkey,
  mediaPickerAcceptTypes,
} from './downloads-newest.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, p), 'utf8');

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const okAsync = async (label, fn) => { await fn(); pass++; };

// orchestrator reads isDestroyed + state.selection.from (the live cursor the file inserts at)
const CURSOR = 7;
const view = { isDestroyed: false, state: { selection: { from: CURSOR } } };
const fileRec = (name, lastModified, size, extra = {}) => ({ name, kind: 'file', lastModified, size, ...extra });

// ── 1. SELECTION (pure) ────────────────────────────────────────────────────────────────────
ok('isInProgressName flags every partial-download sentinel + trailing ~', () => {
  for (const n of ['clip.mp4.crdownload', 'map.gif.download', 'a.part', 'x.tmp', 'draft~', 'MAP.GIF.CRDOWNLOAD']) {
    assert.ok(isInProgressName(n), `should flag ${n}`);
  }
  for (const n of ['map.gif', 'clip.mp4', 'photo.png', 'notes.txt']) {
    assert.ok(!isInProgressName(n), `should NOT flag ${n}`);
  }
});

ok('isHiddenName flags dotfiles (.DS_Store, leading dot) only', () => {
  assert.ok(isHiddenName('.DS_Store'));
  assert.ok(isHiddenName('.localized'));
  assert.ok(!isHiddenName('map.gif'));
  assert.ok(!isHiddenName('a.b.png'));
});

ok('isCompleteRealFile requires a real, complete, non-hidden FILE', () => {
  assert.ok(isCompleteRealFile(fileRec('map.gif', 100, 56 * 1024 * 1024)));
  assert.ok(!isCompleteRealFile({ name: 'stuff', kind: 'directory', lastModified: 100, size: 0 }), 'directory');
  assert.ok(!isCompleteRealFile(fileRec('map.gif.crdownload', 100, 10)), 'in-progress');
  assert.ok(!isCompleteRealFile(fileRec('.DS_Store', 100, 6148)), 'hidden');
  assert.ok(!isCompleteRealFile(fileRec('empty.png', 100, 0)), 'zero-byte');
  assert.ok(!isCompleteRealFile(null), 'null');
});

ok('pickNewestFile picks max lastModified among complete real files', () => {
  const picked = pickNewestFile([
    fileRec('old.png', 100, 1000),
    fileRec('newest.gif', 900, 56 * 1024 * 1024),
    fileRec('mid.mp4', 500, 2000),
  ]);
  assert.equal(picked.name, 'newest.gif');
});

ok('pickNewestFile ignores a NEWER in-progress/hidden/zero-byte/dir, keeps the newest COMPLETE', () => {
  const picked = pickNewestFile([
    fileRec('real.gif', 500, 5_000_000),          // the answer
    fileRec('downloading.gif.crdownload', 999, 3), // newer but partial → excluded
    fileRec('.DS_Store', 998, 6148),               // newer but hidden → excluded
    fileRec('empty.png', 997, 0),                  // newer but empty → excluded
    { name: 'folder', kind: 'directory', lastModified: 996, size: 0 }, // newer dir → excluded
  ]);
  assert.equal(picked.name, 'real.gif');
});

ok('pickNewestFile returns null when nothing qualifies / list is empty', () => {
  assert.equal(pickNewestFile([]), null);
  assert.equal(pickNewestFile([fileRec('.DS_Store', 1, 10), fileRec('a.crdownload', 2, 10)]), null);
  assert.equal(pickNewestFile(null), null);
});

ok('pickNewestFile returns the SAME record (carrying a .file handle) it was given', () => {
  const rec = fileRec('map.gif', 900, 10, { file: { name: 'map.gif' } });
  const picked = pickNewestFile([fileRec('old.png', 100, 10), rec]);
  assert.strictEqual(picked, rec);
  assert.ok(picked.file);
});

// ── 2. MEDIA GATE (pure) ───────────────────────────────────────────────────────────────────
ok('routeNewestFile → onMedia for supported image/video, onReject otherwise', () => {
  for (const type of ['image/gif', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']) {
    let mediaHit = null, rejectHit = false;
    const verdict = routeNewestFile({ name: 'x', type }, { onMedia: (f) => { mediaHit = f; }, onReject: () => { rejectHit = true; } });
    assert.equal(verdict, 'media', `${type} → media`);
    assert.ok(mediaHit && !rejectHit, `${type} routed to onMedia only`);
  }
  for (const type of ['image/svg+xml', 'application/zip', 'image/heic', 'application/pdf', '']) {
    let mediaHit = false, rejectHit = null;
    const verdict = routeNewestFile({ name: 'x.svg', type }, { onMedia: () => { mediaHit = true; }, onReject: (f) => { rejectHit = f; } });
    assert.equal(verdict, 'reject', `${type} → reject`);
    assert.ok(rejectHit && !mediaHit, `${type} routed to onReject only`);
  }
});

ok('mediaPickerAcceptTypes offers the exact image+video extension set', () => {
  const types = mediaPickerAcceptTypes();
  const flat = JSON.stringify(types);
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov']) {
    assert.ok(flat.includes(ext), `picker offers ${ext}`);
  }
});

// ── 3. PERMISSION state machine (mocked handle) ──────────────────────────────────────────────
const makeHandle = (queryState, requestState) => {
  const calls = { query: 0, request: 0 };
  return {
    calls,
    async queryPermission() { calls.query++; return queryState; },
    async requestPermission() { calls.request++; return requestState; },
  };
};

await okAsync('ensureReadPermission: granted → granted, NO request', async () => {
  const h = makeHandle('granted', 'granted');
  assert.equal(await ensureReadPermission(h), 'granted');
  assert.equal(h.calls.request, 0, 'must not prompt when already granted');
});

await okAsync('ensureReadPermission: prompt → requestPermission, returns its verdict', async () => {
  const grant = makeHandle('prompt', 'granted');
  assert.equal(await ensureReadPermission(grant), 'granted');
  assert.equal(grant.calls.request, 1);
  const refuse = makeHandle('prompt', 'denied');
  assert.equal(await ensureReadPermission(refuse), 'denied');
  assert.equal(refuse.calls.request, 1);
});

await okAsync('ensureReadPermission: prompt with request:false stays prompt (no ask)', async () => {
  const h = makeHandle('prompt', 'granted');
  assert.equal(await ensureReadPermission(h, { request: false }), 'prompt');
  assert.equal(h.calls.request, 0);
});

await okAsync('ensureReadPermission: a throwing API / bad handle degrades to denied', async () => {
  const thrower = { async queryPermission() { throw new Error('boom'); }, async requestPermission() { throw new Error('boom'); } };
  assert.equal(await ensureReadPermission(thrower), 'denied');
  assert.equal(await ensureReadPermission(null), 'denied');
  assert.equal(await ensureReadPermission({}), 'denied');
});

// ── 4. ORCHESTRATOR (mocked deps) ────────────────────────────────────────────────────────────
// Deps injected so no real File System Access API / IndexedDB / gesture is needed. The SOURCE is now
// the SHARED drop folder (shared/drop-folder.js): getDropFolderHandle loads it, linkDropFolder picks +
// persists it for BOTH tools.
const baseDeps = (over = {}) => {
  const log = { inserted: [], pasted: [], toasts: [], pickedDir: 0 };
  return {
    log,
    isReadOnly: () => false,
    hasDirectoryPicker: () => true,
    // PRIMARY path: at-cursor-in-cell insert. Records the files + the position it was handed, and
    // reports success (true) so the orchestrator does NOT fall back to the new-row paste.
    insertMediaAtPos: (_v, files, pos) => { log.inserted.push({ files, pos }); return true; },
    // FALLBACK path (only when insertMediaAtPos returns false): the new-row paste.
    startMediaPaste: (_v, files) => log.pasted.push(files),
    toast: (msg, opts) => log.toasts.push({ msg, opts }),
    getDropFolderHandle: async () => null,
    ensureReadPermission: async () => 'granted',
    newestFileFromDir: async () => ({ name: 'map.gif', type: 'image/gif' }),
    // linkDropFolder both picks AND persists (shared module) — the mock just records the pick.
    linkDropFolder: async () => { log.pickedDir++; return { id: 'picked' }; },
    ...over,
  };
};

await okAsync('granted stored handle → SILENT enumerate + insertMediaAtPos([newest]) at cursor, no picker/toast', async () => {
  const d = baseDeps({ getDropFolderHandle: async () => ({ id: 'stored' }), ensureReadPermission: async () => 'granted' });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pickedDir, 0, 'no directory picker on a granted handle');
  assert.equal(d.log.inserted.length, 1, 'inserted inline at the cursor');
  assert.deepEqual(d.log.inserted[0].files, [{ name: 'map.gif', type: 'image/gif' }]);
  assert.equal(d.log.inserted[0].pos, CURSOR, 'insert position is the LIVE cursor (selection.from)');
  assert.equal(d.log.pasted.length, 0, 'the at-cursor path is used, NOT the new-row paste');
  assert.equal(d.log.toasts.length, 0, 'silent success — no toast');
});

await okAsync('first use (no linked handle) → linkDropFolder + link toast + insert at cursor', async () => {
  const d = baseDeps({ getDropFolderHandle: async () => null });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pickedDir, 1, 'picker shown on first use');
  assert.ok(d.log.toasts.some((t) => /script folder linked/i.test(t.msg)), 'one-time link toast');
  assert.equal(d.log.inserted.length, 1, 'newest file still inserted at the cursor after linking');
  assert.equal(d.log.pasted.length, 0);
});

await okAsync('denied stored handle → re-link via linkDropFolder, then insert at cursor', async () => {
  const d = baseDeps({ getDropFolderHandle: async () => ({ id: 'stored' }), ensureReadPermission: async () => 'denied' });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pickedDir, 1, 'a denied handle falls back to the picker');
  assert.equal(d.log.inserted.length, 1);
});

await okAsync('caret with NO legal inline spot → graceful fallback to the new-row paste', async () => {
  // insertMediaAtPos returns false when the cursor is on a chip / empty selection / pre-table doc.
  const d = baseDeps({
    getDropFolderHandle: async () => ({ id: 'stored' }),
    insertMediaAtPos: () => false,
  });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.inserted.length, 0, 'inline insert reported no legal spot');
  assert.equal(d.log.pasted.length, 1, 'fell back to the new-row paste so the file still lands');
  assert.deepEqual(d.log.pasted[0], [{ name: 'map.gif', type: 'image/gif' }]);
});

await okAsync('UNSUPPORTED newest file → toast, nothing inserted (neither path)', async () => {
  const d = baseDeps({
    getDropFolderHandle: async () => ({ id: 'stored' }),
    newestFileFromDir: async () => ({ name: 'thing.svg', type: 'image/svg+xml' }),
  });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.inserted.length, 0, 'junk is never inserted');
  assert.equal(d.log.pasted.length, 0, 'junk never falls back to the paste path either');
  assert.ok(d.log.toasts.some((t) => /thing\.svg/.test(t.msg) && /image or video/i.test(t.msg)), 'named calm toast');
});

await okAsync('empty folder (enumerate → null) → calm toast, no insert', async () => {
  const d = baseDeps({ getDropFolderHandle: async () => ({ id: 'stored' }), newestFileFromDir: async () => null });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.inserted.length, 0);
  assert.equal(d.log.pasted.length, 0);
  assert.ok(d.log.toasts.some((t) => /no complete file/i.test(t.msg)));
});

await okAsync('picker AbortError (user cancels) → SILENT: no toast, no insert', async () => {
  const abort = () => { const e = new Error('cancel'); e.name = 'AbortError'; throw e; };
  const d = baseDeps({ getDropFolderHandle: async () => null, linkDropFolder: async () => abort() });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pasted.length, 0);
  assert.equal(d.log.toasts.length, 0, 'a cancelled picker is silent, not an error');
});

await okAsync('read-only session → whole hotkey is a no-op', async () => {
  const d = baseDeps({ isReadOnly: () => true, getDropFolderHandle: async () => ({ id: 'stored' }) });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.inserted.length, 0);
  assert.equal(d.log.pasted.length, 0);
  assert.equal(d.log.pickedDir, 0);
  assert.equal(d.log.toasts.length, 0);
});

await okAsync('no File System Access API → falls back to showOpenFilePicker + insert at cursor', async () => {
  const log = { inserted: [], pasted: [], toasts: [] };
  let opened = 0;
  const d = {
    isReadOnly: () => false,
    hasDirectoryPicker: () => false, // Safari
    insertMediaAtPos: (_v, files, pos) => { log.inserted.push({ files, pos }); return true; },
    startMediaPaste: (_v, files) => log.pasted.push(files),
    toast: (msg) => log.toasts.push(msg),
    showOpenFilePicker: async () => { opened++; return [{ getFile: async () => ({ name: 'clip.mp4', type: 'video/mp4' }) }]; },
  };
  await runDownloadsHotkey(view, d);
  assert.equal(opened, 1, 'used the file picker fallback');
  assert.deepEqual(log.inserted[0].files, [{ name: 'clip.mp4', type: 'video/mp4' }]);
  assert.equal(log.inserted[0].pos, CURSOR, 'the picked file inserts at the live cursor too');
  assert.equal(log.pasted.length, 0);
});

await okAsync('Safari fallback: picker AbortError → silent', async () => {
  const log = { inserted: [], pasted: [], toasts: [] };
  const d = {
    isReadOnly: () => false,
    hasDirectoryPicker: () => false,
    insertMediaAtPos: (_v, files, pos) => { log.inserted.push({ files, pos }); return true; },
    startMediaPaste: (_v, files) => log.pasted.push(files),
    toast: (msg) => log.toasts.push(msg),
    showOpenFilePicker: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; },
  };
  await runDownloadsHotkey(view, d);
  assert.equal(log.inserted.length, 0);
  assert.equal(log.pasted.length, 0);
  assert.equal(log.toasts.length, 0);
});

// ── 5. KEYMAP + CARD (static source truth) ───────────────────────────────────────────────────
ok('list-shortcuts.js binds Mod-Alt-m at priority 1001 behind isEditable → runDownloadsHotkey', () => {
  const ls = src('list-shortcuts.js');
  assert.ok(/priority:\s*1001/.test(ls), 'priority 1001 tier');
  assert.ok(/import \{ runDownloadsHotkey \} from '\.\/downloads-newest\.js'/.test(ls), 'imports the orchestrator');
  assert.ok(/'Mod-Ctrl-m':\s*\(\)\s*=>\s*\{/.test(ls), 'binds Mod-Ctrl-m (⌘⌃M — off ⌘⌥M which macOS eats for minimize)');
  // the isEditable gate + the call live inside that handler
  const handler = ls.slice(ls.indexOf("'Mod-Ctrl-m'"));
  assert.ok(/if \(!this\.editor\.isEditable\) return false;/.test(handler), 'isEditable gate (no-op in ?read)');
  assert.ok(/runDownloadsHotkey\(this\.editor\.view\)/.test(handler), 'routes to runDownloadsHotkey');
});

ok('shortcuts-list.js documents ⌘⌃M on the help card + keyLabel renders ⌃ on mac', () => {
  const sl = src('../shortcuts-list.js');
  assert.ok(/keys:\s*\['Mod',\s*'Ctrl',\s*'M'\]/.test(sl), 'card row for ⌘⌃M');
  assert.ok(/newest gif from your script folder/i.test(sl), 'plain-words copy (shared drop folder)');
  assert.ok(/token === 'Ctrl'.*mac \? '⌃'/s.test(sl), "keyLabel maps Ctrl → ⌃ on mac");
});

// ── 6. CHORD COPY vs BINDING (static source truth) ───────────────────────────────────────────
// The rebind ⌘⌥M → ⌘⌃M (macOS reserves ⌘⌥M for minimize) touched the keymap + help card + the
// list-shortcuts comment, but the ORCHESTRATOR's user-facing toasts were missed — they told Johnny
// to "press ⌘⌥M", the exact chord that minimizes his window instead of grabbing the download. This
// locks every ⌘⌥M reference OUT of downloads-newest.js and pins the two user-facing toasts to the
// ACTUALLY-BOUND chord, so a future rebind that forgets the toast copy goes RED here.
ok('downloads-newest.js names the bound ⌘⌃M in its toasts — never the macOS-reserved ⌘⌥M', () => {
  const dn = src('downloads-newest.js');
  const ls = src('list-shortcuts.js');
  // The keymap binding is the source of truth for which chord actually fires.
  assert.ok(/'Mod-Ctrl-m'/.test(ls) && !/'Mod-Alt-m'/.test(ls), 'keymap binds Mod-Ctrl-m, not Mod-Alt-m');
  // No trace of the macOS-reserved ⌘⌥M (label OR Mod-Alt-m token) survives anywhere in the module.
  assert.ok(!/⌘⌥M/.test(dn), 'no stale ⌘⌥M label in the downloads module');
  assert.ok(!/Mod-Alt-m/.test(dn), 'no stale Mod-Alt-m token in the downloads module');
  // The two user-facing toasts (LINKED grant + read-error) name ⌘⌃M — the chord that actually works.
  const linked = dn.match(/doToast\('script folder linked[^']*'/);
  assert.ok(linked && /⌘⌃M/.test(linked[0]), 'LINKED toast names ⌘⌃M');
  const readErr = dn.match(/doToast\("couldn't read your script folder[^"]*"/);
  assert.ok(readErr && /⌘⌃M/.test(readErr[0]), 'read-error toast names ⌘⌃M');
});

console.log(`downloads-newest.test.mjs: ${pass} assertions passed`);
