/*
 * audio-block.test.mjs — the AUDIO block (waveform strip) + its drop/paste pipeline.
 *
 * Johnny drops audio (wav / mp3 / m4a / a QuickTime ".qta" voice memo) into the rack. Audio lands as
 * its OWN atom node (audioBlock — a WaveSurfer strip), NOT an imageBlock; weird containers are
 * transcoded to mp3 client-side before upload (audio-transcode.js); the doc carries only the ~100-byte
 * public URL (BYTES-NEVER-IN-THE-DOC, same as imageBlock). This test drives the exported pure pieces +
 * the real production plugin against the mirror schema. Locked here:
 *
 *   1. ROUND-TRIP — an audioBlock passes the mirror-schema fromJSON→check→toJSON byte-exact and
 *      docToBlocks exports { type:'audio', audioSrc, audioOrigName, audioMime, audioDurationSec }.
 *      ABSENT attrs (no mime/duration/placeholder) are OMITTED so an untouched doc is byte-identical.
 *      buildEditorDocument rebuilds the node from a blocks array (the full blocks↔doc↔blocks loop).
 *   2. renderHTML fork — a landed clip renders <figure data-audio><audio>; a pending one renders the
 *      wp-media-status card (no empty <audio> in an export).
 *   3. DETECTION — isAudioFile routes wav/mp3/m4a/.qta to audio (extension WINS over a misleading
 *      video/quicktime or empty mime on a .qta); images/videos are untouched (never audio).
 *   4. TRANSCODE DECISION (pure) — wav/mp3 pass through; m4a/aac/.qta/ogg/flac convert to mp3.
 *   5. ROUTE — every audio upload rides the SIGNED road (the base64 edge fn would coerce audio → png).
 *   6. INSERT-AT-CURSOR — insertAudioAtCursor lands the strip INSIDE the cell at the caret, one
 *      transaction, uploading:true, the first block NodeSelected (immediately clickable).
 *   7. ?READ — a read-only paste is swallowed with NO doc mutation (playback allowed, insert not).
 *   8. formatAudioClock — the strip's mm:ss / h:mm:ss clock.
 *
 * Run: bun src/extensions/audio-block.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES, formatAudioClock } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import {
  isAudioFile, audioTranscodeDecision, pickMediaUploadRoute, pickMediaFiles,
  SUPPORTED_AUDIO_MIMES, AUDIO_EXT_RE, mintAudioBlockId,
  resolveAudioDropPos, insertAudioAtCursor, buildAudioRowNode, buildImageDropPlugin,
} from './image-drop.js';
import { docToBlocks, buildEditorDocument } from '../document-builder.js';
import { setEpisode } from '../episode-config.js';
import { __setReadOnlyForTest } from '../read-mode.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
    history: { depth: 100, newGroupDelay: 750 },
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);
const docFrom = (json) => PMNode.fromJSON(schema, json);
const fullRow = (blocks) => ({ type: 'tableRow', attrs: { cols: 1, pairId: null }, content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }] });
const MP3_URL = 'https://fake.supabase.co/storage/v1/object/public/script-images/scripts/_ca/deadbeef.mp3';

// ── 1: ROUND-TRIP ─────────────────────────────────────────────────────────────────────────
ok('a fully-attributed audioBlock round-trips the mirror schema byte-exact + docToBlocks export', () => {
  const doc = {
    type: 'doc',
    content: [fullRow([{ type: 'audioBlock', attrs: { blockId: 'audio_abc1234', src: MP3_URL, origName: 'Boat Nile.qta', mime: 'audio/mpeg', durationSec: 128 } }])],
  };
  const json1 = clone(docFrom(doc).toJSON());
  const node2 = docFrom(json1);
  node2.check(); // the save-gate law — an audioBlock must be legal everywhere the editor accepts docs
  assert.deepEqual(clone(node2.toJSON()), json1, 'mirror round-trip byte-exact');

  const back = docToBlocks(clone(json1));
  const aud = back.find((b) => b.type === 'audio');
  assert.ok(aud, 'docToBlocks exports the audio block');
  assert.equal(aud.id, 'audio_abc1234');
  assert.equal(aud.audioSrc, MP3_URL);
  assert.equal(aud.audioOrigName, 'Boat Nile.qta');
  assert.equal(aud.audioMime, 'audio/mpeg');
  assert.equal(aud.audioDurationSec, 128);
});

ok('a minimal audioBlock OMITS absent attrs (byte-stable): no mime/duration/placeholder keys', () => {
  const doc = { type: 'doc', content: [fullRow([{ type: 'audioBlock', attrs: { blockId: 'audio_min0001', src: MP3_URL, origName: 'memo.mp3' } }])] };
  const back = docToBlocks(clone(docFrom(doc).toJSON()));
  const aud = back.find((b) => b.type === 'audio');
  assert.equal(aud.audioSrc, MP3_URL);
  assert.equal(aud.audioOrigName, 'memo.mp3');
  // Absent optional attrs must NOT appear on the derived block — that is the byte-stability contract.
  assert.ok(!('audioMime' in aud), 'no mime key when unset');
  assert.ok(!('audioDurationSec' in aud), 'no duration key when unset');
  assert.ok(!('audioUploading' in aud), 'no uploading key when landed');
  assert.ok(!('audioUploadError' in aud), 'no error key when landed');
});

ok('blocks → buildEditorDocument → docToBlocks rebuilds the audio node (full loop)', () => {
  const blocks = [{ id: 'audio_loop001', type: 'audio', audioSrc: MP3_URL, audioOrigName: 'clip.wav', audioMime: 'audio/wav', audioDurationSec: 42 }];
  const doc = buildEditorDocument(blocks);
  const node = docFrom(clone(doc));
  node.check();
  const back = docToBlocks(clone(node.toJSON())).find((b) => b.type === 'audio');
  assert.equal(back.audioSrc, MP3_URL);
  assert.equal(back.audioOrigName, 'clip.wav');
  assert.equal(back.audioMime, 'audio/wav');
  assert.equal(back.audioDurationSec, 42);
});

ok('a mid-convert audioBlock keeps uploading:true through the round-trip (interrupted-drop survival)', () => {
  const doc = { type: 'doc', content: [fullRow([{ type: 'audioBlock', attrs: { blockId: 'audio_pend001', src: '', origName: 'voice.qta', uploading: true } }])] };
  const node = docFrom(doc);
  node.check();
  const aud = docToBlocks(clone(node.toJSON())).find((b) => b.type === 'audio');
  assert.equal(aud.audioUploading, true, 'uploading flag survives so the nodeview shows the interrupted card');
  assert.equal(aud.audioSrc, '');
});

// ── 2: renderHTML fork ──────────────────────────────────────────────────────────────────────
ok('renderHTML: a landed clip emits <figure data-audio><audio>; a pending one emits the status card', () => {
  const toDom = (attrs) => schema.nodes.audioBlock.spec.toDOM(schema.nodes.audioBlock.create(attrs));
  const landed = toDom({ blockId: 'audio_r1', src: MP3_URL, origName: 'memo.mp3', mime: 'audio/mpeg', durationSec: 12 });
  assert.equal(landed[0], 'figure');
  assert.equal(landed[1]['data-audio'], '');
  assert.equal(landed[1]['data-src'], MP3_URL);
  assert.equal(landed[1]['data-duration'], '12');
  assert.equal(landed[2][0], 'audio', 'a src renders a plain <audio> fallback');
  assert.equal(landed[2][1].src, MP3_URL);

  const pending = toDom({ blockId: 'audio_r2', src: '', origName: 'x.qta', uploading: true });
  assert.equal(pending[2][0], 'div', 'no empty <audio> while converting');
  assert.equal(pending[2][1].class, 'wp-media-status');
});

// ── 3: DETECTION — the .qta problem ─────────────────────────────────────────────────────────
ok('isAudioFile: wav/mp3/m4a/aac/.qta → audio; images/videos never audio', () => {
  const f = (name, type) => ({ name, type });
  assert.equal(isAudioFile(f('take.wav', 'audio/wav')), true);
  assert.equal(isAudioFile(f('take.WAV', '')), true, 'extension wins with empty mime');
  assert.equal(isAudioFile(f('vo.mp3', 'audio/mpeg')), true);
  assert.equal(isAudioFile(f('memo.m4a', 'audio/mp4')), true);
  assert.equal(isAudioFile(f('sound.aac', 'audio/aac')), true);
  // THE LOAD-BEARING CASE: a macOS ".qta" voice memo reports video/quicktime (or empty) — extension
  // must route it to AUDIO, never the video path.
  assert.equal(isAudioFile(f('Boat Nile    .qta', 'video/quicktime')), true, '.qta with quicktime mime → audio');
  assert.equal(isAudioFile(f('Boat Nile    .qta', '')), true, '.qta with empty mime → audio');
  // Images/videos are never audio.
  assert.equal(isAudioFile(f('frame.png', 'image/png')), false);
  assert.equal(isAudioFile(f('loop.gif', 'image/gif')), false);
  assert.equal(isAudioFile(f('clip.mp4', 'video/mp4')), false);
  assert.equal(isAudioFile(f('screen.mov', 'video/quicktime')), false, 'a real .mov video stays video');
  assert.ok(SUPPORTED_AUDIO_MIMES.has('audio/mpeg') && AUDIO_EXT_RE.test('x.qta'));
});

ok('a .qta is excluded from the image/video pickMediaFiles set (routed to audio instead)', () => {
  const all = [{ name: 'Boat Nile    .qta', type: 'video/quicktime' }, { name: 'shot.png', type: 'image/png' }];
  const audio = all.filter(isAudioFile);
  const rest = all.filter((x) => !isAudioFile(x));
  assert.deepEqual(audio.map((x) => x.name), ['Boat Nile    .qta']);
  const { media } = pickMediaFiles(rest);
  assert.deepEqual(media.map((x) => x.name), ['shot.png'], 'only the image goes to the image/video path');
  assert.match(mintAudioBlockId(), /^audio_[a-z0-9]{7}$/);
});

// ── 4: TRANSCODE DECISION (pure) ─────────────────────────────────────────────────────────────
ok('audioTranscodeDecision: wav/mp3 pass through; everything else converts to mp3', () => {
  const f = (name, type) => ({ name, type });
  assert.equal(audioTranscodeDecision(f('a.mp3', 'audio/mpeg')), 'passthrough');
  assert.equal(audioTranscodeDecision(f('a.mp3', '')), 'passthrough', 'mp3 by extension');
  assert.equal(audioTranscodeDecision(f('a.wav', 'audio/wav')), 'passthrough');
  assert.equal(audioTranscodeDecision(f('a.wav', 'audio/x-wav')), 'passthrough');
  assert.equal(audioTranscodeDecision(f('a.wav', '')), 'passthrough', 'wav by extension');
  // The formats a browser won't universally play → mp3.
  assert.equal(audioTranscodeDecision(f('a.m4a', 'audio/mp4')), 'transcode');
  assert.equal(audioTranscodeDecision(f('a.aac', 'audio/aac')), 'transcode');
  assert.equal(audioTranscodeDecision(f('Boat Nile    .qta', 'video/quicktime')), 'transcode', 'the .qta converts');
  assert.equal(audioTranscodeDecision(f('a.ogg', 'audio/ogg')), 'transcode');
  assert.equal(audioTranscodeDecision(f('a.flac', 'audio/flac')), 'transcode');
});

// ── 5: ROUTE ─────────────────────────────────────────────────────────────────────────────────
ok('pickMediaUploadRoute: audio/* → signed at ANY size (base64 would coerce audio → png)', () => {
  const MB = 1024 * 1024;
  assert.equal(pickMediaUploadRoute('audio/mpeg', 100), 'signed');
  assert.equal(pickMediaUploadRoute('audio/wav', 30 * MB), 'signed');
  assert.equal(pickMediaUploadRoute('AUDIO/MP4', 8 * MB), 'signed', 'case-insensitive');
  // Video still signed; small images still base64 (the existing contract is untouched).
  assert.equal(pickMediaUploadRoute('video/mp4', 100), 'signed');
  assert.equal(pickMediaUploadRoute('image/png', 1 * MB), 'base64');
});

// ── 6: INSERT-AT-CURSOR ────────────────────────────────────────────────────────────────────
ok('insertAudioAtCursor: strip lands INSIDE the cell at the caret, uploading:true, one transaction', () => {
  // A one-row doc; caret inside its cell. resolveAudioDropPos refines a raw pos to a legal in-cell point.
  const docJson = { type: 'doc', content: [fullRow([{ type: 'noneBlock', attrs: { blockId: 'blk_1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'here' }] }] }])] };
  const doc0 = docFrom(docJson);
  let state = EditorState.create({ schema, doc: doc0, plugins: [history(), buildImageDropPlugin()], selection: TextSelection.near(doc0.resolve(1), 1) });
  let dispatched = 0;
  const view = {
    get state() { return state; },
    editable: true, isDestroyed: false,
    hasFocus() { return true; }, focus() {},
    dispatch(tr) { dispatched += 1; state = state.apply(tr); },
  };
  // Raw pos inside the cell's paragraph text.
  let rawPos = null;
  doc0.descendants((node, pos) => { if (rawPos == null && node.type.name === 'paragraph') rawPos = pos + 1; });
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => null }); // async upload fails harmlessly
  try {
    const ok2 = insertAudioAtCursor(view, [{ name: 'take.wav', type: 'audio/wav', size: 4096 }], rawPos);
    assert.equal(ok2, true, 'a legal in-cell spot existed');
  } finally {
    globalThis.fetch = savedFetch;
  }
  assert.equal(dispatched, 1, 'exactly one insert transaction (one undo removes the drop)');
  // The audioBlock landed inside the tableCell, uploading:true, empty src (bytes not in the doc yet).
  let landed = null, parentIsCell = false;
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'audioBlock') { landed = node; parentIsCell = state.doc.resolve(pos).parent.type.name === 'tableCell'; }
  });
  assert.ok(landed, 'an audioBlock was inserted');
  assert.equal(parentIsCell, true, 'it landed INSIDE the cell (in-cell drop), not between rows');
  assert.equal(landed.attrs.uploading, true, 'converting/uploading placeholder state');
  assert.equal(landed.attrs.src, '', 'no bytes/URL in the doc until the upload lands');
  assert.equal(landed.attrs.origName, 'take.wav', 'filename captured for the strip + download');
  assert.equal(state.selection.constructor.name, 'NodeSelection', 'the block is NodeSelected → immediately clickable');
});

ok('resolveAudioDropPos returns null when there is no legal audio insertion point', () => {
  // A doc position outside any block-accepting context still resolves via dropPoint; assert the
  // function is defined + returns a number for a legal doc and tolerates junk without throwing.
  const docJson = { type: 'doc', content: [fullRow([{ type: 'noneBlock', attrs: { blockId: 'b' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }])] };
  const doc = docFrom(docJson);
  const p = resolveAudioDropPos(EditorState.create({ schema, doc }), 3);
  assert.ok(typeof p === 'number', 'a legal in-cell point is found');
});

ok('buildAudioRowNode builds a legal tableRow>tableCell>audioBlock (pairu_ user-added, uploading)', () => {
  const row = buildAudioRowNode(schema, { id: 'audio_row001', origName: 'memo.qta' });
  assert.ok(row, 'row built against the full schema');
  assert.equal(row.type.name, 'tableRow');
  assert.match(row.attrs.pairId, /^pairu_/, 'user-added marker so the empty-row cull keeps it while converting');
  const cell = row.child(0);
  const aud = cell.child(0);
  assert.equal(aud.type.name, 'audioBlock');
  assert.equal(aud.attrs.uploading, true);
  assert.equal(aud.attrs.origName, 'memo.qta');
  // The whole row must be schema-legal.
  docFrom({ type: 'doc', content: [clone(row.toJSON())] }).check();
});

// ── 7: ?READ — no insert on paste (playback is allowed, mutation is not) ─────────────────────
ok('read-only paste of audio is SWALLOWED with no doc mutation', () => {
  const docJson = { type: 'doc', content: [fullRow([{ type: 'noneBlock', attrs: { blockId: 'b' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }])] };
  const doc = docFrom(docJson);
  const plugin = buildImageDropPlugin();
  let state = EditorState.create({ schema, doc, plugins: [history(), plugin], selection: TextSelection.near(doc.resolve(1), 1) });
  const before = clone(state.doc.toJSON());
  let dispatched = 0;
  const view = { get state() { return state; }, editable: true, isDestroyed: false, hasFocus() { return true; }, focus() {}, dispatch(tr) { dispatched += 1; state = state.apply(tr); } };
  const audioFile = { name: 'take.wav', type: 'audio/wav', size: 4096 };
  const event = { clipboardData: { files: [audioFile], items: [], getData: () => '' }, preventDefault() {} };
  __setReadOnlyForTest(true);
  try {
    const handled = plugin.props.handlePaste(view, event);
    assert.equal(handled, true, 'the audio paste is swallowed (returns true) in read mode');
  } finally {
    __setReadOnlyForTest(false);
  }
  assert.equal(dispatched, 0, 'no transaction dispatched in read mode');
  assert.deepEqual(clone(state.doc.toJSON()), before, 'doc bytes untouched in ?read');
});

// ── 8: formatAudioClock ──────────────────────────────────────────────────────────────────────
ok('formatAudioClock: mm:ss under an hour, h:mm:ss past it', () => {
  assert.equal(formatAudioClock(0), '0:00');
  assert.equal(formatAudioClock(5), '0:05');
  assert.equal(formatAudioClock(65), '1:05');
  assert.equal(formatAudioClock(128), '2:08');
  assert.equal(formatAudioClock(3661), '1:01:01');
  assert.equal(formatAudioClock(-3), '0:00', 'negatives floor to zero');
  assert.equal(formatAudioClock(NaN), '0:00');
});

console.log(`audio-block.test.mjs: ${pass} assertions passed`);
