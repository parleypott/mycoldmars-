/**
 * FILEPATH DROP — the pure path-extraction + drop-decision logic that turns a Finder drag into a
 * green code-path chip. No DOM: we mock the DataTransfer shape Chrome/macOS actually hands the drop
 * handler (text/uri-list carrying a file:// URL, dataTransfer.items with webkitGetAsEntry, and
 * dataTransfer.files for the media-exclusion gate).
 *
 * Contract locked here:
 *   1. fileUrlToPath decodes %20 / handles the macOS empty-host and localhost forms.
 *   2. pathFromDataTransfer prefers text/uri-list, skips comment lines, falls back to text/plain.
 *   3. detectFilepathDrop: FOLDER → always a chip (real path, else folder-name fallback); a media
 *      file (image/video/audio) → null (never hijack an upload); a non-media file with a path →
 *      a chip fallback; a bare text drag → null.
 *
 * Run: bun src/extensions/filepath-drop.test.mjs
 */
import assert from 'node:assert/strict';
import { fileUrlToPath, pathFromDataTransfer, detectFilepathDrop } from './filepath-drop.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

// A DataTransfer stub: text payloads by mime, an items[] (each with webkitGetAsEntry), and files[].
function makeDT({ text = {}, items = [], files = [] } = {}) {
  return {
    getData: (mime) => text[mime] || '',
    items: items.map((it) => ({
      kind: it.kind || 'file',
      webkitGetAsEntry: () => (it.entry === undefined ? null : it.entry),
    })),
    files,
  };
}
const fileEntry = () => ({ isDirectory: false, isFile: true, name: 'x' });
const dirEntry = (name) => ({ isDirectory: true, isFile: false, name });

// --- 1. fileUrlToPath ------------------------------------------------------------------------------
ok('fileUrlToPath decodes the macOS empty-host form with an encoded space', () => {
  assert.equal(
    fileUrlToPath('file:///Users/johnnyharris/Desktop/Boat%20Nile.qta'),
    '/Users/johnnyharris/Desktop/Boat Nile.qta',
  );
});
ok('fileUrlToPath strips a localhost host segment', () => {
  assert.equal(fileUrlToPath('file://localhost/Users/johnny/clip.mov'), '/Users/johnny/clip.mov');
});
ok('fileUrlToPath decodes a folder path with multiple encoded chars', () => {
  assert.equal(
    fileUrlToPath('file:///Users/johnny/My%20Footage/Day%201'),
    '/Users/johnny/My Footage/Day 1',
  );
});
ok('fileUrlToPath returns empty for a non-file URL', () => {
  assert.equal(fileUrlToPath('https://example.com/x'), '');
  assert.equal(fileUrlToPath(''), '');
  assert.equal(fileUrlToPath('/Users/johnny/plain'), '');
});

// --- 2. pathFromDataTransfer -----------------------------------------------------------------------
ok('pathFromDataTransfer reads the file:// URL out of text/uri-list', () => {
  const dt = makeDT({ text: { 'text/uri-list': 'file:///Users/johnny/Desktop/Boat%20Nile.qta' } });
  assert.equal(pathFromDataTransfer(dt), '/Users/johnny/Desktop/Boat Nile.qta');
});
ok('pathFromDataTransfer skips uri-list comment lines and takes the first URL', () => {
  const dt = makeDT({ text: { 'text/uri-list': '# a comment\r\nfile:///Users/johnny/a.txt\r\nfile:///Users/johnny/b.txt' } });
  assert.equal(pathFromDataTransfer(dt), '/Users/johnny/a.txt');
});
ok('pathFromDataTransfer falls back to text/plain when uri-list is absent', () => {
  const dt = makeDT({ text: { 'text/plain': 'file:///Users/johnny/notes.md' } });
  assert.equal(pathFromDataTransfer(dt), '/Users/johnny/notes.md');
});
ok('pathFromDataTransfer returns empty when no file:// path is exposed', () => {
  const dt = makeDT({ text: { 'text/plain': 'just some dragged words' } });
  assert.equal(pathFromDataTransfer(dt), '');
});

// --- 3. detectFilepathDrop -------------------------------------------------------------------------
ok('a FOLDER drop with an exposed path → chip with the real path', () => {
  const dt = makeDT({
    text: { 'text/uri-list': 'file:///Users/johnny/My%20Footage' },
    items: [{ entry: dirEntry('My Footage') }],
    files: [{ name: 'My Footage', type: '' }], // folders masquerade as a bogus zero-type file
  });
  const r = detectFilepathDrop({ dataTransfer: dt });
  assert.deepEqual(r, { path: '/Users/johnny/My Footage', isFolder: true });
});
ok('a FOLDER drop with NO exposed path → chip falls back to the folder name', () => {
  const dt = makeDT({
    items: [{ entry: dirEntry('Secret Folder') }],
    files: [{ name: 'Secret Folder', type: '' }],
  });
  const r = detectFilepathDrop({ dataTransfer: dt });
  assert.deepEqual(r, { path: 'Secret Folder', isFolder: true });
});
ok('an IMAGE-media file drop → null (the upload path keeps it)', () => {
  const dt = makeDT({
    text: { 'text/uri-list': 'file:///Users/johnny/still.png' },
    items: [{ entry: fileEntry() }],
    files: [{ name: 'still.png', type: 'image/png' }],
  });
  assert.equal(detectFilepathDrop({ dataTransfer: dt }), null);
});
ok('an AUDIO-media file drop → null (the audio-blocks workflow keeps it)', () => {
  const dt = makeDT({
    text: { 'text/uri-list': 'file:///Users/johnny/vo.wav' },
    items: [{ entry: fileEntry() }],
    files: [{ name: 'vo.wav', type: 'audio/wav' }],
  });
  assert.equal(detectFilepathDrop({ dataTransfer: dt }), null);
});
ok('a NON-media file with an exposed path → chip fallback', () => {
  const dt = makeDT({
    text: { 'text/uri-list': 'file:///Users/johnny/Desktop/Boat%20Nile.qta' },
    items: [{ entry: fileEntry() }],
    files: [{ name: 'Boat Nile.qta', type: '' }], // .qta has no registered mime
  });
  const r = detectFilepathDrop({ dataTransfer: dt });
  assert.deepEqual(r, { path: '/Users/johnny/Desktop/Boat Nile.qta', isFolder: false });
});
ok('a bare text drag (no path, no folder, no media) → null', () => {
  const dt = makeDT({ text: { 'text/plain': 'a selected sentence' } });
  assert.equal(detectFilepathDrop({ dataTransfer: dt }), null);
});
ok('no dataTransfer at all → null', () => {
  assert.equal(detectFilepathDrop({}), null);
});

console.log(`filepath-drop.test.mjs: ${pass} assertions passed`);
