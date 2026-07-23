/*
 * downloads-newest.test.mjs — DOWNLOADS HOTKEY (⌘⌥M) — downloads-newest.js.
 *
 * Johnny 2026-07-23: "press a key, my newest download lands in the script — no Finder, no drag."
 * ⌘⌥M finds the NEWEST complete real file in ~/Downloads (via the File System Access API, with a
 * once-granted directory handle persisted in IndexedDB) and feeds it through the SAME media-paste
 * pipeline a clipboard paste uses (startMediaPaste).
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
 *   4. ORCHESTRATOR (mocked deps) — granted handle → silent enumerate + startMediaPaste([file]);
 *      first use (no handle) → showDirectoryPicker + save + link toast + insert; denied stored
 *      handle → re-pick; unsupported newest file → toast, startMediaPaste NOT called; a picker
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

const view = { isDestroyed: false }; // orchestrator only reads isDestroyed + hands to startMediaPaste
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
// Deps injected so no real File System Access API / IndexedDB / gesture is needed.
const baseDeps = (over = {}) => {
  const log = { pasted: [], toasts: [], saved: [], pickedDir: 0 };
  return {
    log,
    isReadOnly: () => false,
    hasDirectoryPicker: () => true,
    startMediaPaste: (_v, files) => log.pasted.push(files),
    toast: (msg, opts) => log.toasts.push({ msg, opts }),
    saveDownloadsHandle: async (h) => { log.saved.push(h); return true; },
    loadDownloadsHandle: async () => null,
    ensureReadPermission: async () => 'granted',
    newestFileFromDir: async () => ({ name: 'map.gif', type: 'image/gif' }),
    showDirectoryPicker: async () => { log.pickedDir++; return { id: 'picked' }; },
    ...over,
  };
};

await okAsync('granted stored handle → SILENT enumerate + startMediaPaste([newest]), no picker/toast', async () => {
  const d = baseDeps({ loadDownloadsHandle: async () => ({ id: 'stored' }), ensureReadPermission: async () => 'granted' });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pickedDir, 0, 'no directory picker on a granted handle');
  assert.equal(d.log.pasted.length, 1);
  assert.deepEqual(d.log.pasted[0], [{ name: 'map.gif', type: 'image/gif' }]);
  assert.equal(d.log.toasts.length, 0, 'silent success — no toast');
});

await okAsync('first use (no stored handle) → showDirectoryPicker + save + link toast + insert', async () => {
  const d = baseDeps({ loadDownloadsHandle: async () => null });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pickedDir, 1, 'picker shown on first use');
  assert.equal(d.log.saved.length, 1, 'handle persisted');
  assert.ok(d.log.toasts.some((t) => /downloads folder linked/i.test(t.msg)), 'one-time link toast');
  assert.equal(d.log.pasted.length, 1, 'newest file still inserted after linking');
});

await okAsync('denied stored handle → re-pick via showDirectoryPicker, then insert', async () => {
  const d = baseDeps({ loadDownloadsHandle: async () => ({ id: 'stored' }), ensureReadPermission: async () => 'denied' });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pickedDir, 1, 'a denied handle falls back to the picker');
  assert.equal(d.log.pasted.length, 1);
});

await okAsync('UNSUPPORTED newest file → toast, startMediaPaste NOT called', async () => {
  const d = baseDeps({
    loadDownloadsHandle: async () => ({ id: 'stored' }),
    newestFileFromDir: async () => ({ name: 'thing.svg', type: 'image/svg+xml' }),
  });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pasted.length, 0, 'junk is never inserted');
  assert.ok(d.log.toasts.some((t) => /thing\.svg/.test(t.msg) && /image or video/i.test(t.msg)), 'named calm toast');
});

await okAsync('empty downloads (enumerate → null) → calm toast, no insert', async () => {
  const d = baseDeps({ loadDownloadsHandle: async () => ({ id: 'stored' }), newestFileFromDir: async () => null });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pasted.length, 0);
  assert.ok(d.log.toasts.some((t) => /no complete file/i.test(t.msg)));
});

await okAsync('picker AbortError (user cancels) → SILENT: no toast, no insert', async () => {
  const abort = () => { const e = new Error('cancel'); e.name = 'AbortError'; throw e; };
  const d = baseDeps({ loadDownloadsHandle: async () => null, showDirectoryPicker: async () => abort() });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pasted.length, 0);
  assert.equal(d.log.toasts.length, 0, 'a cancelled picker is silent, not an error');
});

await okAsync('read-only session → whole hotkey is a no-op', async () => {
  const d = baseDeps({ isReadOnly: () => true, loadDownloadsHandle: async () => ({ id: 'stored' }) });
  await runDownloadsHotkey(view, d);
  assert.equal(d.log.pasted.length, 0);
  assert.equal(d.log.pickedDir, 0);
  assert.equal(d.log.toasts.length, 0);
});

await okAsync('no File System Access API → falls back to showOpenFilePicker + insert', async () => {
  const log = { pasted: [], toasts: [] };
  let opened = 0;
  const d = {
    isReadOnly: () => false,
    hasDirectoryPicker: () => false, // Safari
    startMediaPaste: (_v, files) => log.pasted.push(files),
    toast: (msg) => log.toasts.push(msg),
    showOpenFilePicker: async () => { opened++; return [{ getFile: async () => ({ name: 'clip.mp4', type: 'video/mp4' }) }]; },
  };
  await runDownloadsHotkey(view, d);
  assert.equal(opened, 1, 'used the file picker fallback');
  assert.deepEqual(log.pasted[0], [{ name: 'clip.mp4', type: 'video/mp4' }]);
});

await okAsync('Safari fallback: picker AbortError → silent', async () => {
  const log = { pasted: [], toasts: [] };
  const d = {
    isReadOnly: () => false,
    hasDirectoryPicker: () => false,
    startMediaPaste: (_v, files) => log.pasted.push(files),
    toast: (msg) => log.toasts.push(msg),
    showOpenFilePicker: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; },
  };
  await runDownloadsHotkey(view, d);
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
  assert.ok(/newest download/i.test(sl), 'plain-words copy');
  assert.ok(/token === 'Ctrl'.*mac \? '⌃'/s.test(sl), "keyLabel maps Ctrl → ⌃ on mac");
});

console.log(`downloads-newest.test.mjs: ${pass} assertions passed`);
