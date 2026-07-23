// SHARED DROP FOLDER — one user-picked folder that links two same-origin tools (newpress.press):
// MapKeys WRITES its exported gifs into it, the script tool READS the newest from it. Because both
// pages share an origin they share this IndexedDB, so the FileSystemDirectoryHandle the user grants
// ONCE is visible to BOTH — linking from either tool sets it for the other for free.
//
// Johnny 2026-07-23: "MapKeys should save gifs to a folder I pick (e.g. Desktop/mapkey-gifs), and
// the script tool's ⌘⌃M reads the NEWEST from that same folder — zero-click, auto-newest, no
// Downloads blocklist, no background helper."
//
// GESTURE LAW: showDirectoryPicker (linkDropFolder) and requestPermission (ensureDropPermission with
// request:true) REQUIRE transient user activation — call them synchronously from a click/keydown. But
// createWritable / getFile on an ALREADY-'granted' handle need NO gesture, so MapKeys can write
// silently on every export once the folder is linked, and the script tool reads silently on ⌘⌃M.
//
// The grant is asked for as READWRITE (linkDropFolder mode default) so the SAME grant covers both the
// MapKeys write and the script-tool read — the user is prompted exactly once, ever.

// One tiny dedicated DB so it can never collide with a tool's doc/recovery stores. Same names on both
// origins-of-one so the handle round-trips between the two pages.
const DB = 'wp-drop-folder';
const STORE = 'handles';
const KEY = 'handle';
const PICKER_ID = 'wp-drop-folder'; // stable id → the OS re-opens the picker at the same place

function idbAvailable() {
  return typeof indexedDB !== 'undefined' && indexedDB;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!idbAvailable()) { reject(new Error('no-indexeddb')); return; }
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
  });
}

// Persist the granted directory handle (a FileSystemDirectoryHandle is structured-clone-able, so it
// stores straight into IndexedDB and survives reloads). Best-effort — a save failure just means the
// NEXT link re-picks, never a crash. Exported so a caller can persist a handle it obtained elsewhere.
export async function saveDropFolderHandle(handle) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close?.();
    return true;
  } catch { return false; }
}

// Load the persisted handle, or null when there is none / IndexedDB is unavailable. Never throws.
export async function getDropFolderHandle() {
  try {
    const db = await openDb();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
    db.close?.();
    return handle || null;
  } catch { return null; }
}

// Drop the persisted handle (e.g. the folder was deleted and became permanently unusable). Best-effort.
export async function clearDropFolderHandle() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close?.();
    return true;
  } catch { return false; }
}

// PERMISSION STATE MACHINE — queryPermission tells us where we stand; 'granted' → proceed SILENTLY;
// 'prompt' + request → requestPermission (needs a gesture, one click) then its verdict; 'denied' →
// 'denied'. Never throws — any API error resolves to 'denied' so the caller re-links rather than
// wedging. `mode` is 'read' (script-tool enumerate) or 'readwrite' (a readwrite re-grant). MapKeys
// calls this with { mode:'readwrite', request:false } post-render so it NEVER prompts without a
// gesture — a not-yet-granted folder simply falls back to the plain download.
//   returns 'granted' | 'prompt' | 'denied'
export async function ensureDropPermission(handle, { mode = 'read', request = true } = {}) {
  if (!handle || typeof handle.queryPermission !== 'function') return 'denied';
  const opts = { mode };
  let state = 'prompt';
  try { state = await handle.queryPermission(opts); } catch { state = 'prompt'; }
  if (state === 'granted') return 'granted';
  if (request && typeof handle.requestPermission === 'function') {
    try { state = await handle.requestPermission(opts); } catch { state = 'denied'; }
  }
  return state === 'granted' ? 'granted' : (state === 'prompt' ? 'prompt' : 'denied');
}

// Feature detect — the whole shared-folder path needs showDirectoryPicker (Chromium). Safari has
// neither this nor a persistent directory handle, so each tool takes its own one-click fallback.
export function hasDirectoryPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// LINK — open the OS directory picker, persist the grant, return the handle. MUST be called from a
// user gesture (a click or the ⌘⌃M keydown) because showDirectoryPicker requires transient user
// activation. startIn:'desktop' + a suggest-name copy points the user at "a folder like Desktop ›
// mapkey-gifs", but they can pick ANY allowed folder (Chrome blocks Downloads specifically; a normal
// folder is fine). Asks for READWRITE by default so the one grant covers BOTH tools. `deps` lets the
// test inject showDirectoryPicker + the persister without a real gesture/IndexedDB.
export async function linkDropFolder({ mode = 'readwrite' } = {}, deps = {}) {
  const pick = deps.showDirectoryPicker
    || (typeof window !== 'undefined' ? window.showDirectoryPicker?.bind(window) : null);
  if (typeof pick !== 'function') throw new Error('no-directory-picker');
  const handle = await pick({ id: PICKER_ID, mode, startIn: 'desktop' });
  if (!handle) return null;
  const save = deps.saveDropFolderHandle || saveDropFolderHandle;
  await save(handle);
  return handle;
}

// The copy every tool shows when asking the user to pick the folder — kept here so both tools say the
// same thing about WHAT to pick (a normal folder, not Downloads).
export const DROP_FOLDER_SUGGEST_COPY = 'Pick a folder for your MapKeys gifs — something like Desktop › mapkey-gifs (not Downloads).';
