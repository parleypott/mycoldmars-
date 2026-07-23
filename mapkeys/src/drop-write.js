// MAPKEYS → SHARED DROP FOLDER — write an exported gif blob into the folder the script tool reads.
//
// Johnny 2026-07-23: MapKeys gifs should auto-flow into his script tool. Instead of dropping every
// export into ~/Downloads (where the script tool can't legally reach — Chrome blocks that folder),
// MapKeys writes the gif straight into the shared drop folder the user linked ONCE. The script tool's
// ⌘⌃M then reads the NEWEST file from that same folder. Zero-click on both ends after the one-time link.
//
// GESTURE LAW: this runs on the gif 'finished' callback — NO user gesture is live there. That's fine:
// createWritable() on an ALREADY-'granted' handle needs no gesture. So we only ever write when the
// folder is linked AND permission is already 'granted' (we ask ensureDropPermission with request:false,
// which NEVER prompts). If the folder isn't linked, or the grant isn't live, we fall back to the plain
// browser download — so an un-set-up MapKeys keeps working exactly as before and a gif is NEVER lost.

import { getDropFolderHandle, ensureDropPermission } from '../../shared/drop-folder.js';

// PURE-ish write: given a granted directory handle, a blob, and a filename, create/overwrite the file
// and stream the blob in. Returns true on success. Throws are the caller's to catch (it falls back to
// a download). Split out so a test can drive it with a mock handle and assert getFileHandle→
// createWritable→write(blob)→close were called in order with the right name — no real FS needed.
export async function writeBlobToDropFolder(dirHandle, blob, name) {
  if (!dirHandle || typeof dirHandle.getFileHandle !== 'function') throw new Error('bad-handle');
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  return true;
}

// ORCHESTRATOR — what the gif 'finished' handler calls with the encoded blob + the filename MapKeys
// already generates. Dependency-injectable so the whole decision (linked+granted → silent write;
// otherwise → download) is drivable headless.
//
// FLOW: load the shared handle → if present, ensureDropPermission({mode:'readwrite', request:false})
// (SILENT — never prompts, no gesture here) → if 'granted', write the blob into the folder and toast
// "saved to your script folder → ⌘⌃M drops it in". ANY miss (no handle, not granted, write error) →
// downloadFallback(blob, name) so the gif always lands somewhere. Returns 'folder' | 'download'.
export async function saveGifBlob({ blob, name }, deps = {}) {
  const getHandle = deps.getDropFolderHandle || getDropFolderHandle;
  const ensure = deps.ensureDropPermission || ensureDropPermission;
  const write = deps.writeBlobToDropFolder || writeBlobToDropFolder;
  const download = deps.downloadFallback;      // required: the a.download path from main.js
  const toast = deps.toast || (() => {});

  try {
    const handle = await getHandle();
    if (handle) {
      // request:false → this can run without a gesture (we're in the encoder callback). A 'prompt'
      // or 'denied' folder just falls through to the download; MapKeys never nags mid-render.
      const perm = await ensure(handle, { mode: 'readwrite', request: false });
      if (perm === 'granted') {
        await write(handle, blob, name);
        toast('saved to your script folder → ⌘⌃M drops it in');
        return 'folder';
      }
    }
  } catch {
    // fall through to the download — a folder hiccup must NEVER cost the gif
  }
  download?.(blob, name);
  return 'download';
}
