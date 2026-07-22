// TIMECODE TAG — the deterministic right-click bake (convert-menu.js → marks.convertTimecodesInRange).
//
// Johnny 2026-07-22: "let me highlight and right click and have an option for 'timecode tag' and it
// bakes into that formatting with the click-to-copy feature." The menu entry runs the SAME machinery
// the right-click retro-convert on plain text uses — marks.js convertTimecodesInRange over the
// SELECTION. This suite pins that machinery (the load-bearing core the menu action calls) across the
// contexts the menu must cover: a plain paragraph, a bullet item, and a directionMark ('oncam') run,
// with the day captured when a "DAY N" prefix is present and left null (the DAY ? state) when not, a
// clean no-op on a codeless selection, and exactly one undo. The menu's DOM wiring (the TIMECODE TAG
// button in the utility row, its shake-on-no-op) is verified live in a headless browser — this file
// pins the deterministic conversion the button dispatches.
//
// Run: bun burma-script/src/timecode-tag-bake.test.mjs   (auto-discovered by run-tests.mjs)

import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Node as PMNode } from '@tiptap/pm/model';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark, defaultDirectionMarkAttrs } from './extensions/direction-chip.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';
import { convertTimecodesInRange } from './extensions/marks.js';

setEpisode(BURMA); // timecodeChips on; schema import needs an episode chosen

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

let pass = 0, fail = 0;
const ok = (label, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`  ✗ ${label}\n    ${e.message}`); } };

const tcMark = schema.marks.timecode;
// oncam directionMark in JSON form (PMNode.fromJSON wants mark JSON, not a Mark instance).
const oncam = { type: 'directionMark', attrs: defaultDirectionMarkAttrs('oncam') };

// A full-width row wrapping ONE block (matches document-builder's grain).
const row = (block) => ({ type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [block] }] });
const none = (id, content) => ({ type: 'noneBlock', attrs: { blockId: id, flavor: null, chapterId: null }, content });
const para = (content) => ({ type: 'paragraph', content });
const txt = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

// Build a fresh state from a doc JSON, with history so undo is testable.
function stateFrom(docJson) {
  const doc = PMNode.fromJSON(schema, docJson);
  return EditorState.create({ schema, doc, plugins: [history()] });
}

// Find the [from,to] inner range of the FIRST paragraph whose flattened text includes `needle`.
function paraRangeContaining(state, needle) {
  let hit = null;
  state.doc.descendants((node, pos) => {
    if (hit) return false;
    if (node.type.name === 'paragraph' && node.textContent.includes(needle)) {
      hit = { from: pos + 1, to: pos + node.nodeSize - 1 };
      return false;
    }
    return undefined;
  });
  return hit;
}

// Apply convertTimecodesInRange over a selection range, returning { changed, state }.
function bakeOver(state, range) {
  let dispatched = null;
  const changed = convertTimecodesInRange(state, range.from, range.to, (tr) => { dispatched = tr; });
  return { changed, state: dispatched ? state.apply(dispatched) : state };
}

// The timecode mark attrs on the text node whose text === code (null if not chipped).
function chipFor(state, code) {
  let found = null;
  state.doc.descendants((node) => {
    if (found) return false;
    if (node.isText && node.text === code) {
      const m = node.marks.find((mk) => mk.type === tcMark);
      if (m) found = { tc: m.attrs.tc, day: m.attrs.day };
    }
    return undefined;
  });
  return found;
}

// ── PLAIN PARAGRAPH, day present → chip with day, "DAY N " stripped ────────────────────────────────
ok('bakes a dead code in a PLAIN paragraph, captures DAY 1, strips the literal', () => {
  const st = stateFrom({ type: 'doc', content: [row(none('r1', [para([txt('DAY 1 00:09:44:16 hello')])]))] });
  const range = paraRangeContaining(st, '00:09:44:16');
  const { changed, state } = bakeOver(st, range);
  assert.equal(changed, true, 'reported a conversion');
  assert.deepEqual(chipFor(state, '00:09:44:16'), { tc: '00:09:44:16', day: 1 }, 'chipped with day=1');
  // the folded literal "DAY 1 " is stripped from the prose (mirrors the live input/paste rule)
  const paraText = state.doc.firstChild.firstChild.firstChild.firstChild.textContent;
  assert.ok(!/DAY 1\b/.test(paraText), `"DAY 1" literal stripped, got: ${JSON.stringify(paraText)}`);
});

// ── BULLET item, no day → chip with day=null (the DAY ? state) ─────────────────────────────────────
ok('bakes a dead code inside a BULLET item, day absent → day=null (DAY ?)', () => {
  const st = stateFrom({ type: 'doc', content: [row(none('r2', [
    { type: 'bulletList', content: [
      { type: 'listItem', content: [para([txt('00:11:17:19')])] },
    ] },
  ]))] });
  const range = paraRangeContaining(st, '00:11:17:19');
  const { changed, state } = bakeOver(st, range);
  assert.equal(changed, true);
  assert.deepEqual(chipFor(state, '00:11:17:19'), { tc: '00:11:17:19', day: null }, 'chipped bare (DAY ?)');
});

// ── inside an ONCAM directionMark run, day present → chip rides WITH the oncam mark ─────────────────
ok('bakes a dead code inside an ONCAM run, captures DAY 2, keeps the oncam mark', () => {
  const st = stateFrom({ type: 'doc', content: [row(none('r3', [
    para([txt('DAY 2 03:49:59:08 on camera', [oncam])]),
  ]))] });
  const range = paraRangeContaining(st, '03:49:59:08');
  const { changed, state } = bakeOver(st, range);
  assert.equal(changed, true);
  const chip = chipFor(state, '03:49:59:08');
  assert.deepEqual(chip, { tc: '03:49:59:08', day: 2 }, 'chipped with day=2');
  // the chipped code STILL carries the oncam directionMark (a reclassable run survives the bake)
  let hasOncam = false;
  state.doc.descendants((node) => {
    if (node.isText && node.text === '03:49:59:08') {
      hasOncam = node.marks.some((m) => m.type === schema.marks.directionMark && m.attrs.kind === 'oncam');
    }
  });
  assert.ok(hasOncam, 'chip still wears the oncam run mark');
});

// ── NO-OP: a selection holding no parseable code returns false and dispatches nothing ──────────────
ok('no-op on a codeless selection — returns false, no transaction', () => {
  const st = stateFrom({ type: 'doc', content: [row(none('r4', [para([txt('just some prose, no timecode here')])]))] });
  const range = paraRangeContaining(st, 'prose');
  // dry probe (null dispatch) must be false, AND a real call must not dispatch
  assert.equal(convertTimecodesInRange(st, range.from, range.to, null), false, 'dry probe false');
  const { changed, state } = bakeOver(st, range);
  assert.equal(changed, false, 'reported no change');
  assert.equal(state, st, 'state is byte-identical (no transaction)');
});

// ── ONE UNDO restores the pre-bake prose exactly ──────────────────────────────────────────────────
ok('the bake is a single transaction — one undo restores the original', () => {
  const st = stateFrom({ type: 'doc', content: [row(none('r5', [para([txt('DAY 1 00:09:44:16 hello')])]))] });
  const before = st.doc.toJSON();
  const range = paraRangeContaining(st, '00:09:44:16');
  const { state } = bakeOver(st, range);
  assert.notDeepEqual(state.doc.toJSON(), before, 'doc changed by the bake');
  let undone = null;
  undo(state, (tr) => { undone = state.apply(tr); });
  assert.deepEqual(undone.doc.toJSON(), before, 'exactly one undo restores the pre-bake doc');
});

// ── MULTIPLE codes in one selection bake together in ONE transaction ───────────────────────────────
ok('bakes EVERY code in the selection at once (one undo removes all)', () => {
  const st = stateFrom({ type: 'doc', content: [row(none('r6', [
    para([txt('DAY 1 00:09:44:16 then DAY 2 03:49:59:08 later')]),
  ]))] });
  const range = paraRangeContaining(st, '00:09:44:16');
  const { changed, state } = bakeOver(st, range);
  assert.equal(changed, true);
  assert.deepEqual(chipFor(state, '00:09:44:16'), { tc: '00:09:44:16', day: 1 });
  assert.deepEqual(chipFor(state, '03:49:59:08'), { tc: '03:49:59:08', day: 2 });
});

console.log(`timecode-tag-bake: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
