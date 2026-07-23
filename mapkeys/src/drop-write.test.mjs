/*
 * drop-write.test.mjs — MAPKEYS → SHARED DROP FOLDER write path (mapkeys/src/drop-write.js).
 *
 * Johnny 2026-07-23: MapKeys gifs should auto-flow into the script tool. On every gif export MapKeys
 * writes the blob into the shared drop folder (the same folder the script tool's ⌘⌃M reads), so the
 * insert is zero-click on both ends after a one-time link.
 *
 * Proves, all headless (no real File System Access API / gesture):
 *   1. writeBlobToDropFolder — given a granted directory handle, calls getFileHandle(name,{create}) →
 *      createWritable → write(blob) → close, in that order, with the right name and the exact blob.
 *   2. saveGifBlob — a linked + GRANTED folder → SILENT write (NO gesture: ensureDropPermission is
 *      asked with request:false), a "saved to your script folder" toast, and NO download; returns
 *      'folder'. No handle → download fallback, returns 'download'. A not-granted handle (prompt/
 *      denied) → download, and permission is asked request:false (never prompts mid-render). A write
 *      error → the gif still downloads (never lost). Returns are exact.
 *
 * Run: bun src/drop-write.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { writeBlobToDropFolder, saveGifBlob } from './drop-write.js';

let pass = 0;
const okAsync = async (label, fn) => { await fn(); pass++; };

// ── 1. writeBlobToDropFolder — the createWritable dance, order + args asserted ──────────────────
await okAsync('writeBlobToDropFolder: getFileHandle→createWritable→write(blob)→close in order', async () => {
  const order = [];
  const blob = { size: 56 * 1024 * 1024, type: 'image/gif' };
  let wroteBlob = null, createOpts = null, askedName = null;
  const writable = {
    async write(b) { order.push('write'); wroteBlob = b; },
    async close() { order.push('close'); },
  };
  const fileHandle = { async createWritable() { order.push('createWritable'); return writable; } };
  const dirHandle = {
    async getFileHandle(name, opts) { order.push('getFileHandle'); askedName = name; createOpts = opts; return fileHandle; },
  };
  const out = await writeBlobToDropFolder(dirHandle, blob, 'mapkeys-K01-K04-100pct-12fps.gif');
  assert.equal(out, true);
  assert.deepEqual(order, ['getFileHandle', 'createWritable', 'write', 'close'], 'strict call order');
  assert.equal(askedName, 'mapkeys-K01-K04-100pct-12fps.gif', 'writes under the generated name');
  assert.deepEqual(createOpts, { create: true }, 'creates the file if absent');
  assert.strictEqual(wroteBlob, blob, 'streams the exact blob');
});

await okAsync('writeBlobToDropFolder: close() runs even when write() throws (no leaked writable)', async () => {
  let closed = false;
  const writable = { async write() { throw new Error('disk full'); }, async close() { closed = true; } };
  const dirHandle = { async getFileHandle() { return { async createWritable() { return writable; } }; } };
  await assert.rejects(() => writeBlobToDropFolder(dirHandle, { size: 1 }, 'x.gif'), /disk full/);
  assert.equal(closed, true, 'finally-closed the writable');
});

await okAsync('writeBlobToDropFolder: a bad handle throws (caller falls back to download)', async () => {
  await assert.rejects(() => writeBlobToDropFolder(null, {}, 'x.gif'), /bad-handle/);
  await assert.rejects(() => writeBlobToDropFolder({}, {}, 'x.gif'), /bad-handle/);
});

// ── 2. saveGifBlob orchestrator (injected deps) ─────────────────────────────────────────────────
const baseDeps = (over = {}) => {
  const log = { wrote: [], toasts: [], downloads: [], permAsks: [] };
  return {
    log,
    getDropFolderHandle: async () => ({ id: 'granted-folder' }),
    ensureDropPermission: async (_h, opts) => { log.permAsks.push(opts); return 'granted'; },
    writeBlobToDropFolder: async (_h, blob, name) => { log.wrote.push({ blob, name }); return true; },
    toast: (m) => log.toasts.push(m),
    downloadFallback: (blob, name) => log.downloads.push({ blob, name }),
    ...over,
  };
};

await okAsync('linked + granted folder → SILENT write, toast, NO download, returns "folder"', async () => {
  const d = baseDeps();
  const blob = { size: 10, type: 'image/gif' };
  const where = await saveGifBlob({ blob, name: 'map.gif' }, d);
  assert.equal(where, 'folder');
  assert.equal(d.log.wrote.length, 1, 'wrote to the folder');
  assert.strictEqual(d.log.wrote[0].blob, blob);
  assert.equal(d.log.wrote[0].name, 'map.gif');
  assert.equal(d.log.downloads.length, 0, 'no browser download when the folder took it');
  assert.ok(d.log.toasts.some((t) => /script folder/i.test(t) && /⌘⌃M/.test(t)), 'calm confirming toast');
  // The write must be gesture-free: permission asked with request:false.
  assert.equal(d.log.permAsks[0].request, false, 'never prompts post-render (no gesture)');
  assert.equal(d.log.permAsks[0].mode, 'readwrite', 'checks the write grant');
});

await okAsync('no linked folder → download fallback, no write, returns "download"', async () => {
  const d = baseDeps({ getDropFolderHandle: async () => null });
  const blob = { size: 10 };
  const where = await saveGifBlob({ blob, name: 'map.gif' }, d);
  assert.equal(where, 'download');
  assert.equal(d.log.wrote.length, 0);
  assert.equal(d.log.downloads.length, 1, 'the gif still lands via download');
  assert.strictEqual(d.log.downloads[0].blob, blob);
});

await okAsync('handle present but NOT granted (prompt/denied) → download, still request:false', async () => {
  for (const perm of ['prompt', 'denied']) {
    const d = baseDeps({ ensureDropPermission: async (_h, opts) => { d.log.permAsks.push(opts); return perm; } });
    const where = await saveGifBlob({ blob: { size: 1 }, name: 'm.gif' }, d);
    assert.equal(where, 'download', `${perm} → download`);
    assert.equal(d.log.wrote.length, 0, `${perm} → no write`);
    assert.equal(d.log.downloads.length, 1, `${perm} → downloaded`);
    assert.ok(d.log.permAsks.every((a) => a.request === false), 'never prompts mid-render');
  }
});

await okAsync('a write ERROR still downloads the gif (never lost), returns "download"', async () => {
  const d = baseDeps({ writeBlobToDropFolder: async () => { throw new Error('write blew up'); } });
  const where = await saveGifBlob({ blob: { size: 1 }, name: 'm.gif' }, d);
  assert.equal(where, 'download');
  assert.equal(d.log.downloads.length, 1, 'fell back to download on a write error');
});

await okAsync('a getDropFolderHandle throw still downloads the gif', async () => {
  const d = baseDeps({ getDropFolderHandle: async () => { throw new Error('idb down'); } });
  const where = await saveGifBlob({ blob: { size: 1 }, name: 'm.gif' }, d);
  assert.equal(where, 'download');
  assert.equal(d.log.downloads.length, 1);
});

console.log(`drop-write.test.mjs: ${pass} assertions passed`);
