/*
 * video-loop.test.mjs — VIDEO LOOP CONTROLS for a video-src imageBlock ("living gif" dials).
 * Three additive attrs — playbackRate / trimIn / trimOut — style the AMBIENT inline loop only
 * (the lightbox + download always serve the full original). Locked here:
 *
 *   1. PURE MATH — videoLoopSeekTarget (the loop engine's one decision), normalizeVideoRate
 *      (1× collapses to null), normalizeVideoTrim (edges collapse to null, min window, 0.1s
 *      snap), videoTrimLabel (mm:ss.d), videoResetPatch.
 *   2. ROUND-TRIP — attrs survive build → mirror-schema fromJSON → check → toJSON byte-exact;
 *      docToBlocks emits videoRate/videoTrimIn/videoTrimOut ONLY when set (byte-stable when
 *      absent); buildEditorDocument reads them back; malformed block fields are rejected to null.
 *   3. renderHTML — data-video-rate/data-trim-in/data-trim-out emitted only when set, and only
 *      for video srcs (a still can never carry loop dials through the clipboard).
 *   4. ONE TRANSACTION PER GESTURE — a speed choice / trim release / reset is a single
 *      setNodeMarkup step; reset clears all three dials.
 *
 * Run: bun burma-script/src/extensions/video-loop.test.mjs  (auto-discovered)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import {
  BURMA_NODES, isVideoSrc,
  videoLoopSeekTarget, normalizeVideoRate, normalizeVideoTrim, videoTrimLabel, videoResetPatch,
  VIDEO_RATE_CHOICES, VIDEO_TRIM_MIN_WINDOW,
} from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { PALAU2 } from '../../../palau2-script/config.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };
const clone = (x) => JSON.parse(JSON.stringify(x));

// EXACTLY the editor's extension set (Editor.jsx) = EXACTLY migrate-doc.js's mirror schema.
const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, strike: false, dropcursor: false, gapcursor: false,
    history: { depth: 100, newGroupDelay: 750 },
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

// Palau2 carries image blocks; set BEFORE importing document-builder (episode-derived regexes).
setEpisode(PALAU2);
const { buildEditorDocument, ensureTableDoc, docToBlocks } = await import('../document-builder.js');

const MP4_URL = 'https://fake-project.supabase.co/storage/v1/object/public/script-images/scripts/test-ep/loop_abc1234.mp4';
const PNG_URL = 'https://fake-project.supabase.co/storage/v1/object/public/script-images/scripts/test-ep/still_abc1234.png';

// ── 1: PURE MATH ────────────────────────────────────────────────────────────────────────

ok('videoLoopSeekTarget: no trim set → never seeks', () => {
  assert.equal(videoLoopSeekTarget(0, null, null), null);
  assert.equal(videoLoopSeekTarget(123.4, null, null), null);
  assert.equal(videoLoopSeekTarget(5, 0, null), null);
  assert.equal(videoLoopSeekTarget(5, null, undefined), null);
});

ok('videoLoopSeekTarget: wraps to trimIn at/past trimOut, jumps forward when below trimIn', () => {
  assert.equal(videoLoopSeekTarget(4.0, 1.5, 4.0), 1.5);  // exactly at OUT → wrap
  assert.equal(videoLoopSeekTarget(4.7, 1.5, 4.0), 1.5);  // past OUT → wrap
  assert.equal(videoLoopSeekTarget(2.2, 1.5, 4.0), null); // inside the window → leave alone
  assert.equal(videoLoopSeekTarget(0.0, 1.5, 4.0), 1.5);  // native loop wrapped to 0 → jump to IN
  assert.equal(videoLoopSeekTarget(0.4, 1.5, null), 1.5); // IN-only trim still enforced
  assert.equal(videoLoopSeekTarget(9.9, 1.5, null), null);
});

ok('videoLoopSeekTarget: degenerate trimOut ≤ trimIn is ignored (never a zero-width loop)', () => {
  assert.equal(videoLoopSeekTarget(5, 3, 3), null);
  assert.equal(videoLoopSeekTarget(5, 3, 2), null);
  assert.equal(videoLoopSeekTarget(1, 3, 2), 3);   // trimIn alone still applies
});

// THE BUSY-SEEK GUARD — a persisted trimIn at/past the real clip's end (pasted data-attrs from
// a longer video, a future src swap to a shorter clip) must NOT loop forever: without the
// duration clamp the engine seeks forward → browser clamps to the end → native loop wraps to
// 0 → seek forward again, 20+ times/sec on a frozen frame. With duration known, an
// unenforceable window is treated as ABSENT (return null, whole window ignored).
ok('videoLoopSeekTarget: trimIn ≥ duration → window treated as absent (no perpetual seek)', () => {
  // the live repro: <figure data-trim-in="20" data-trim-out="25"> pasted around an 8s mp4
  assert.equal(videoLoopSeekTarget(0.0, 20, 25, 8), null);   // native wrap to 0 → engine must NOT seek to 20
  assert.equal(videoLoopSeekTarget(7.99, 20, 25, 8), null);  // pinned at the end → leave alone
  assert.equal(videoLoopSeekTarget(4.0, 20, 25, 8), null);   // mid-clip → plays through
  // trimIn inside the last min-window sliver is equally unenforceable
  assert.equal(videoLoopSeekTarget(0.0, 8 - VIDEO_TRIM_MIN_WINDOW / 2, null, 8), null);
  assert.equal(videoLoopSeekTarget(0.0, 8, null, 8), null);  // exactly at the end
  // and the clamp drops the WHOLE window: garbage out < in must not resurrect a [0, out] loop
  assert.equal(videoLoopSeekTarget(4.0, 20, 3, 8), null);
});

ok('videoLoopSeekTarget: duration clamp leaves valid windows + unknown durations alone', () => {
  assert.equal(videoLoopSeekTarget(0.0, 1.5, 4.0, 8), 1.5);  // valid window unchanged
  assert.equal(videoLoopSeekTarget(4.0, 1.5, 4.0, 8), 1.5);
  assert.equal(videoLoopSeekTarget(2.2, 1.5, 4.0, 8), null);
  assert.equal(videoLoopSeekTarget(0.0, 2, 25, 8), 2);       // out past end is benign: [2, native end]
  assert.equal(videoLoopSeekTarget(0.0, 20, 25, NaN), 20);   // metadata not loaded → no clamp (as before)
  assert.equal(videoLoopSeekTarget(0.0, 20, 25, 0), 20);     // zero/garbage duration → no clamp
  assert.equal(videoLoopSeekTarget(0.0, 20, 25, undefined), 20);
});

ok('normalizeVideoRate: 1× collapses to null; clamps; garbage → null', () => {
  assert.equal(normalizeVideoRate(1), null);
  assert.equal(normalizeVideoRate('1'), null);
  assert.equal(normalizeVideoRate(2), 2);
  assert.equal(normalizeVideoRate(0.25), 0.25);
  assert.equal(normalizeVideoRate(99), 4);         // clamped to VIDEO_RATE_MAX
  assert.equal(normalizeVideoRate(0.001), 0.1);    // clamped to VIDEO_RATE_MIN
  assert.equal(normalizeVideoRate(0), null);
  assert.equal(normalizeVideoRate(-2), null);
  assert.equal(normalizeVideoRate('fast'), null);
  assert.equal(normalizeVideoRate(null), null);
  for (const r of VIDEO_RATE_CHOICES) {
    assert.equal(normalizeVideoRate(r), r === 1 ? null : r);
  }
});

ok('normalizeVideoTrim: edges collapse to null (byte-stable), interior persists snapped to 0.1s', () => {
  assert.deepEqual(normalizeVideoTrim(null, null, 10), { trimIn: null, trimOut: null });
  assert.deepEqual(normalizeVideoTrim(0, 10, 10), { trimIn: null, trimOut: null });
  assert.deepEqual(normalizeVideoTrim(1.234, 8.765, 10), { trimIn: 1.2, trimOut: 8.8 });
  assert.deepEqual(normalizeVideoTrim(2, null, 10), { trimIn: 2, trimOut: null });
  assert.deepEqual(normalizeVideoTrim(0, 6.5, 10), { trimIn: null, trimOut: 6.5 });
  // OUT dragged to (or past) the end → absent, not a number that drifts vs duration.
  assert.deepEqual(normalizeVideoTrim(1, 9.98, 10), { trimIn: 1, trimOut: null });
  assert.deepEqual(normalizeVideoTrim(1, 42, 10), { trimIn: 1, trimOut: null });
});

ok('normalizeVideoTrim: degenerate window pulls IN back by the min window (never a sliver)', () => {
  const { trimIn, trimOut } = normalizeVideoTrim(5, 5.05, 10);
  assert.equal(trimOut, 5.1);
  assert.ok(trimOut - trimIn >= VIDEO_TRIM_MIN_WINDOW - 1e-9, 'window ≥ min');
});

ok('videoTrimLabel: mm:ss.d', () => {
  assert.equal(videoTrimLabel(0), '0:00.0');
  assert.equal(videoTrimLabel(3.44), '0:03.4');
  assert.equal(videoTrimLabel(61.29), '1:01.2');
  assert.equal(videoTrimLabel(600), '10:00.0');
  assert.equal(videoTrimLabel(-5), '0:00.0');
  assert.equal(videoTrimLabel('junk'), '0:00.0');
});

ok('videoResetPatch clears all three dials', () => {
  assert.deepEqual(videoResetPatch(), { playbackRate: null, trimIn: null, trimOut: null });
});

// ── 2: ROUND-TRIP ───────────────────────────────────────────────────────────────────────

const VIDEO_BLOCK = {
  id: 'image_vid_1',
  type: 'image',
  imageSrc: MP4_URL,
  imageAlt: 'ambient loop of the harbor',
  imageKind: 'shot',
  videoRate: 2,
  videoTrimIn: 1.5,
  videoTrimOut: 4.2,
};
const PLAIN_VIDEO_BLOCK = { id: 'image_vid_2', type: 'image', imageSrc: MP4_URL, imageAlt: '', imageKind: 'shot' };

const doc = ensureTableDoc(buildEditorDocument([VIDEO_BLOCK, PLAIN_VIDEO_BLOCK]));
const findImg = (d, id) => {
  const rows = d.content.filter((r) => r.type === 'tableRow');
  return rows.flatMap((r) => r.content.flatMap((c) => c.content))
    .find((b) => b.type === 'imageBlock' && b.attrs.blockId === id);
};

ok('buildEditorDocument reads videoRate/videoTrimIn/videoTrimOut into node attrs', () => {
  const img = findImg(doc, 'image_vid_1');
  assert.ok(img, 'video imageBlock present');
  assert.equal(img.attrs.playbackRate, 2);
  assert.equal(img.attrs.trimIn, 1.5);
  assert.equal(img.attrs.trimOut, 4.2);
});

ok('absent dials build as null attrs (additive default)', () => {
  const img = findImg(doc, 'image_vid_2');
  assert.equal(img.attrs.playbackRate, null);
  assert.equal(img.attrs.trimIn, null);
  assert.equal(img.attrs.trimOut, null);
});

ok('malformed block dials are rejected to null (rate 1, negatives, strings, NaN)', () => {
  const bad = ensureTableDoc(buildEditorDocument([{
    ...PLAIN_VIDEO_BLOCK, id: 'image_vid_bad',
    videoRate: 1, videoTrimIn: -3, videoTrimOut: 'later',
  }]));
  const img = findImg(bad, 'image_vid_bad');
  assert.equal(img.attrs.playbackRate, null);   // 1 is never a persisted rate
  assert.equal(img.attrs.trimIn, null);
  assert.equal(img.attrs.trimOut, null);
});

ok('doc round-trips through the mirror schema (fromJSON → check → toJSON) byte-stable', () => {
  const json1 = clone(PMNode.fromJSON(schema, doc).toJSON());
  const node2 = PMNode.fromJSON(schema, json1);
  node2.check();
  assert.deepEqual(clone(node2.toJSON()), json1);
  assert.ok(JSON.stringify(json1).includes('"playbackRate":2'), 'rate survived serialization');
});

ok('docToBlocks emits video dials ONLY when set (byte-stable absent contract)', () => {
  const back = docToBlocks(clone(PMNode.fromJSON(schema, doc).toJSON()));
  const dialed = back.find((b) => b.id === 'image_vid_1');
  assert.equal(dialed.videoRate, 2);
  assert.equal(dialed.videoTrimIn, 1.5);
  assert.equal(dialed.videoTrimOut, 4.2);
  const plain = back.find((b) => b.id === 'image_vid_2');
  assert.ok(!('videoRate' in plain), 'no videoRate key when unset');
  assert.ok(!('videoTrimIn' in plain), 'no videoTrimIn key when unset');
  assert.ok(!('videoTrimOut' in plain), 'no videoTrimOut key when unset');
});

ok('blocks → doc → blocks is a fixed point for the dialed video block', () => {
  const back = docToBlocks(clone(PMNode.fromJSON(schema, doc).toJSON()));
  const again = docToBlocks(clone(PMNode.fromJSON(schema, ensureTableDoc(buildEditorDocument(back))).toJSON()));
  assert.deepEqual(
    again.find((b) => b.id === 'image_vid_1'),
    back.find((b) => b.id === 'image_vid_1'),
  );
});

// ── 3: renderHTML data attrs — set-only, video-only ─────────────────────────────────────

function renderFig(attrs) {
  const node = schema.nodes.imageBlock.create(attrs);
  // toDOM spec array: ['figure', {…attrs}, …children]
  return schema.nodes.imageBlock.spec.toDOM(node);
}

ok('renderHTML emits data-video-rate/data-trim-in/data-trim-out only when set', () => {
  const [, figAttrs] = renderFig({ blockId: 'b1', src: MP4_URL, playbackRate: 2, trimIn: 1.5, trimOut: 4.2 });
  assert.equal(figAttrs['data-video-rate'], '2');
  assert.equal(figAttrs['data-trim-in'], '1.5');
  assert.equal(figAttrs['data-trim-out'], '4.2');
  const [, plainAttrs] = renderFig({ blockId: 'b2', src: MP4_URL });
  assert.ok(!('data-video-rate' in plainAttrs));
  assert.ok(!('data-trim-in' in plainAttrs));
  assert.ok(!('data-trim-out' in plainAttrs));
});

ok('renderHTML never emits loop dials for a still src', () => {
  assert.equal(isVideoSrc(PNG_URL), false);
  const [, figAttrs] = renderFig({ blockId: 'b3', src: PNG_URL, playbackRate: 2, trimIn: 1.5, trimOut: 4.2 });
  assert.ok(!('data-video-rate' in figAttrs));
  assert.ok(!('data-trim-in' in figAttrs));
  assert.ok(!('data-trim-out' in figAttrs));
});

// ── 4: ONE TRANSACTION PER GESTURE ──────────────────────────────────────────────────────

function stateWithVideoNode(extraAttrs = {}) {
  const d = ensureTableDoc(buildEditorDocument([{ ...PLAIN_VIDEO_BLOCK, id: 'image_tx', ...extraAttrs }]));
  const pmDoc = PMNode.fromJSON(schema, d);
  let pos = null;
  pmDoc.descendants((n, p) => {
    if (n.type.name === 'imageBlock' && n.attrs.blockId === 'image_tx') { pos = p; return false; }
    return true;
  });
  assert.ok(typeof pos === 'number', 'found the video node');
  return { state: EditorState.create({ schema, doc: pmDoc }), pos };
}

ok('a speed choice is ONE setNodeMarkup step', () => {
  const { state, pos } = stateWithVideoNode();
  const live = state.doc.nodeAt(pos);
  const tr = state.tr.setNodeMarkup(pos, null, { ...live.attrs, playbackRate: normalizeVideoRate(2) });
  assert.equal(tr.steps.length, 1);
  const next = state.apply(tr);
  assert.equal(next.doc.nodeAt(pos).attrs.playbackRate, 2);
});

ok('a trim release is ONE setNodeMarkup step carrying both edges', () => {
  const { state, pos } = stateWithVideoNode();
  const live = state.doc.nodeAt(pos);
  const trim = normalizeVideoTrim(1.5, 4.2, 10);
  const tr = state.tr.setNodeMarkup(pos, null, { ...live.attrs, ...trim });
  assert.equal(tr.steps.length, 1);
  const next = state.apply(tr);
  assert.equal(next.doc.nodeAt(pos).attrs.trimIn, 1.5);
  assert.equal(next.doc.nodeAt(pos).attrs.trimOut, 4.2);
});

ok('RESET is ONE step and clears all three dials', () => {
  const { state, pos } = stateWithVideoNode({ videoRate: 2, videoTrimIn: 1.5, videoTrimOut: 4.2 });
  const live = state.doc.nodeAt(pos);
  assert.equal(live.attrs.playbackRate, 2);
  const tr = state.tr.setNodeMarkup(pos, null, { ...live.attrs, ...videoResetPatch() });
  assert.equal(tr.steps.length, 1);
  const a = state.apply(tr).doc.nodeAt(pos).attrs;
  assert.equal(a.playbackRate, null);
  assert.equal(a.trimIn, null);
  assert.equal(a.trimOut, null);
});

console.log(`\nvideo-loop: ${pass} passed, 0 failed`);
