/*
 * timecode-chips.test.mjs — Johnny 2026-07-21: day-timecodes don't tag their DAY → red "DAY ?" nag.
 *
 * The failing forms from his sessions, all of which must collapse to ONE chip tagged with the day:
 *   "day 1 00:11:17:19"     (single space, lower)
 *   "DAY 1  00:20:18:16"    (DOUBLE space, upper)
 *   "DAY 1 - 00:09:44:16"   (DASH separator)
 * Root causes, all proven here:
 *
 *   (1) FLAG GATE. The chip input/paste rules were gated on `palauTimecodes`, forbidden in Burma. Now
 *       gated on a NEW presentation flag `timecodeChips` (ON for burma/palau/palau2/library), split
 *       from the data-touching document-builder parsing (still Palau-only).
 *
 *   (2) SEPARATOR RIGIDITY. The day-branch swallowed only `\s*` between "DAY N" and the code, so a dash
 *       (and, live, some whitespace forms) fell through to the BARE branch → day=null → nag. The
 *       separator is now `[-\s–—]*` — any spaces and/or a hyphen/en/em dash, or nothing (glued).
 *
 *   (3) RETROACTIVITY + already-bare chips. Input rules fire only at the caret; a code already on the
 *       page never retro-tags. `convertTimecodesInRange` (right-click → "Convert timecodes on this
 *       row") fixes them in ONE transaction — INCLUDING an existing BARE chip (day=null) sitting after
 *       a literal "DAY N", the exact "still shows DAY ?" case — and works inside a directionMark run.
 *
 * Run: bun src/extensions/timecode-chips.test.mjs
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS, TimecodeMark, collectRowTimecodeOps, convertTimecodesInRange } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ok —', label); };

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, strike: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);
const timecodeType = schema.marks.timecode;

function episode(features) {
  return { id: 'test', title: 'T', days: [1, 2, 3], sequences: [], genres: [], flavors: [], features, storage: {}, cloud: {} };
}

// A voBlock paragraph whose inline `content` array is the row's text.
function docWith(content) {
  return PMNode.fromJSON(schema, {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [{
        type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' },
        content: [{ type: 'paragraph', content }],
      }] }],
    }],
  });
}
const oncam = (text) => ({ type: 'text', text, marks: [{ type: 'directionMark', attrs: { kind: 'oncam', status: 'static' } }] });

function timecodeRuns(doc) {
  const runs = [];
  doc.descendants((node) => {
    if (!node.isText) return;
    const m = node.marks.find((mk) => mk.type === timecodeType);
    if (m) runs.push({ text: node.text, day: m.attrs.day, tc: m.attrs.tc, hasOncam: node.marks.some((k) => k.type.name === 'directionMark' && k.attrs.kind === 'oncam') });
  });
  return runs;
}

// ── ROOT CAUSE 1: the FLAG GATE ──────────────────────────────────────────────────────────────
ok('addInputRules returns NO rules when timecodeChips is OFF; a rule when ON (indep. of palauTimecodes)', () => {
  setEpisode(episode({ palauTimecodes: false }));
  assert.equal(TimecodeMark.config.addInputRules.call({ type: timecodeType }).length, 0);
  setEpisode(episode({ timecodeChips: true, palauTimecodes: false }));
  assert.equal(TimecodeMark.config.addInputRules.call({ type: timecodeType }).length, 1);
});

// ── ROOT CAUSE 2: the SEPARATOR — every reported form captures the DAY ────────────────────────
ok('the chip regex captures day + code for single-space, DOUBLE-space, DASH, en-dash, tab, glued forms', () => {
  setEpisode(episode({ timecodeChips: true }));
  const [rule] = TimecodeMark.config.addPasteRules.call({ type: timecodeType });
  const expect = (input, day, tc) => {
    const re = rule.find; re.lastIndex = 0;
    const m = re.exec(input);
    assert.ok(m, `matches ${JSON.stringify(input)}`);
    assert.equal(m[1], day, `day of ${JSON.stringify(input)}`);
    assert.equal(m[2], tc, `code of ${JSON.stringify(input)}`);
  };
  expect('day 1 00:11:17:19', '1', '00:11:17:19');   // single space, lower
  expect('DAY 1  00:20:18:16', '1', '00:20:18:16');  // DOUBLE space (Johnny's live report)
  expect('DAY 1 - 00:09:44:16', '1', '00:09:44:16'); // DASH separator (his doc form)
  expect('DAY 1 – 00:09:44:16', '1', '00:09:44:16'); // en-dash
  expect('DAY1\t00:02:06:21', '1', '00:02:06:21');   // tab, no space after DAY
  expect('day100:02:06:21', '1', '00:02:06:21');     // fully glued
  const re = rule.find; re.lastIndex = 0;
  const b = re.exec('cut at 00:04:30:00 here');
  assert.ok(b && b[2] === '00:04:30:00' && b[1] === undefined, 'bare code chips, no day');
});

// ── ROOT CAUSE 3a: retro-convert dead TEXT (day captured, prefix stripped, inside oncam) ───────
ok('convertTimecodesInRange chips dead day-prefixed text inside an oncam run — day tagged, prefix gone', () => {
  setEpisode(episode({ timecodeChips: true }));
  let state = EditorState.create({ schema, doc: docWith([oncam('ALT: at day 1 00:11:17:19  DAY 1 - 00:20:18:16')]) });
  assert.equal(convertTimecodesInRange(state, 0, state.doc.content.size, (tr) => { state = state.apply(tr); }), true);
  const runs = timecodeRuns(state.doc);
  assert.equal(runs.length, 2, 'both codes chipped');
  assert.deepEqual(runs.map((r) => ({ day: r.day, tc: r.tc, oncam: r.hasOncam })), [
    { day: 1, tc: '00:11:17:19', oncam: true },
    { day: 1, tc: '00:20:18:16', oncam: true },  // dash form tagged too
  ]);
  const plain = state.doc.textBetween(0, state.doc.content.size, ' ', ' ');
  assert.ok(!/day\s*1\s*[-–—]?\s*00:/i.test(plain), 'no "DAY 1 <sep> <code>" left as dead text');
});

// ── ROOT CAUSE 3b: THE "STILL DAY ?" CASE — an existing BARE chip after a literal "DAY N" ──────
ok('convertTimecodesInRange RE-TAGS an already-bare chip (day=null) preceded by a "DAY 1" literal', () => {
  setEpisode(episode({ timecodeChips: true, palauTimecodes: true, dayFold: true }));
  // The code is ALREADY a chip but with day=null (what the nag keys off), with a literal "DAY 1  "
  // sitting before it — precisely the on-page state that renders the red "DAY ?".
  let state = EditorState.create({ schema, doc: docWith([
    { type: 'text', text: 'DAY 1  ' },
    { type: 'text', text: '00:20:18:16', marks: [{ type: 'timecode', attrs: { tc: '00:20:18:16', day: null, seq: null } }] },
  ]) });
  const before = timecodeRuns(state.doc);
  assert.equal(before.length, 1);
  assert.equal(before[0].day, null, 'starts bare (day=null) — this is the DAY ? nag state');

  assert.equal(convertTimecodesInRange(state, 0, state.doc.content.size, (tr) => { state = state.apply(tr); }), true);
  const after = timecodeRuns(state.doc);
  assert.equal(after.length, 1, 'still exactly one chip');
  assert.equal(after[0].day, 1, 'chip now carries day=1 → the DAY ? nag clears');
  assert.equal(after[0].tc, '00:20:18:16', 'code unchanged');
  const plain = state.doc.textBetween(0, state.doc.content.size, ' ', ' ');
  assert.ok(!/DAY\s*1/i.test(plain), 'the redundant literal "DAY 1" was stripped');
});

// ── idempotence + no-op ───────────────────────────────────────────────────────────────────────
ok('a chip already tagged with the right day yields NO op (idempotent — no double-work, no dispatch)', () => {
  setEpisode(episode({ timecodeChips: true }));
  const state = EditorState.create({ schema, doc: docWith([
    { type: 'text', text: '00:20:18:16', marks: [{ type: 'timecode', attrs: { tc: '00:20:18:16', day: 1, seq: null } }] },
  ]) });
  assert.equal(collectRowTimecodeOps(state, 0, state.doc.content.size).length, 0);
  assert.equal(convertTimecodesInRange(state, 0, state.doc.content.size, () => { throw new Error('should not dispatch'); }), false);
});

ok('plain prose with no timecodes is a no-op', () => {
  setEpisode(episode({ timecodeChips: true }));
  const state = EditorState.create({ schema, doc: docWith([{ type: 'text', text: 'just prose, no codes' }]) });
  assert.equal(convertTimecodesInRange(state, 0, state.doc.content.size, () => { throw new Error('should not dispatch'); }), false);
});

// ── WHOLE-SCRIPT CONVERT: multi-row doc, ONE transaction, every dead code chipped ────────────────
// A doc with the same shape as a fresh table script (several tableRows, each a voBlock paragraph),
// mixing plain codes, day-prefixed codes, and a broll run in a bullet. `convertTimecodesInRange`
// over the WHOLE doc must chip them all in ONE transaction — this is the "convert every timecode in
// the whole script" one-click path. Also pins the block-boundary fix: a "DAY N" at a row's start must
// keep its day even though the previous row's text ends in a letter (no gluing across the boundary).
const broll = (text) => ({ type: 'text', text, marks: [{ type: 'directionMark', attrs: { kind: 'broll', status: 'unchecked' } }] });
function multiRowDoc() {
  const row = (content) => ({ type: 'tableRow', attrs: { cols: 1, pairId: null }, content: [{ type: 'tableCell', attrs: { role: 'full' }, content }] });
  return PMNode.fromJSON(schema, { type: 'doc', content: [
    row([{ type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cut here 00:01:02:03 more' }] }] }]),
    // The middle row STARTS with "DAY 2" and the previous row ends in a letter ("more") — the block
    // boundary must not let the 'e' defeat the day-branch lookbehind.
    row([{ type: 'voBlock', attrs: { blockId: 'b2', status: 'todo' }, content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [broll('DAY 2 00:03:48:02')] }] }] }] }]),
    row([{ type: 'voBlock', attrs: { blockId: 'b3', status: 'todo' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'DAY 3 - 00:09:44:16' }] }] }]),
  ] });
}

ok('whole-script convert chips EVERY dead code across rows/lists/broll in ONE transaction, days intact', () => {
  setEpisode(episode({ timecodeChips: true, palauTimecodes: true, dayFold: true }));
  let state = EditorState.create({ schema, doc: multiRowDoc() });
  const before = state.tr; // capture step count baseline
  assert.equal(convertTimecodesInRange(state, 0, state.doc.content.size, (tr) => {
    // ONE transaction — the retro-convert never dispatches more than once.
    assert.ok(tr.docChanged, 'the single transaction changes the doc');
    state = state.apply(tr);
  }), true);
  const runs = timecodeRuns(state.doc).sort((a, b) => a.tc.localeCompare(b.tc));
  assert.deepEqual(runs.map((r) => ({ day: r.day, tc: r.tc })), [
    { day: null, tc: '00:01:02:03' }, // bare, no day
    { day: 2, tc: '00:03:48:02' },    // broll-in-bullet, day kept ACROSS the block boundary (the fix)
    { day: 3, tc: '00:09:44:16' },    // dash form
  ], 'all three chipped with correct days');
  // Idempotent: a second whole-doc pass finds nothing to do.
  assert.equal(convertTimecodesInRange(state, 0, state.doc.content.size, () => { throw new Error('should not re-dispatch'); }), false);
  void before;
});

ok('block-boundary separator: a row-starting "DAY N" is NOT robbed of its day by the previous row', () => {
  setEpisode(episode({ timecodeChips: true }));
  const state = EditorState.create({ schema, doc: multiRowDoc() });
  const ops = collectRowTimecodeOps(state, 0, state.doc.content.size);
  const mid = ops.find((o) => o.tc === '00:03:48:02');
  assert.ok(mid, 'the middle code is collected');
  assert.equal(mid.day, 2, 'its day survives the cross-row flatten (regression guard for the glue bug)');
});

console.log(`\ntimecode-chips.test.mjs — ${pass} checks passed`);
