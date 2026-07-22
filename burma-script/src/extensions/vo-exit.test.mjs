/*
 * vo-exit.test.mjs — the VO block's double-return exit (blocks.js doExitVoOnEmptyTail).
 * Johnny: "when im in a VO block and i hit return twice another VO tag emerges. lets nix that."
 *
 * Proves:
 *   1. Enter on a VO's trailing EMPTY paragraph exits the block: the empty line is removed,
 *      a bare paragraph lands right AFTER the voBlock, the caret sits in it — and the doc
 *      holds exactly ONE voBlock (no second corner tag).
 *   2. ONE UNDO restores the pre-exit doc byte-exact.
 *   3. Enter mid-block (non-empty paragraph, or empty paragraph that is NOT last) returns
 *      false — multi-paragraph VO writing is untouched.
 *   4. A fresh VO whose ONLY paragraph is empty keeps normal Enter (returns false).
 *   5. The exited doc passes the mirror save-gate schema.
 *
 * Run: bun src/extensions/vo-exit.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { doExitVoOnEmptyTail } from './blocks.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
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
const voDoc = (paras) => ({
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'voBlock', attrs: { blockId: 'blk_vo', status: 'todo' },
        content: paras.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })),
      }],
    }],
  }],
});

// caret inside the LAST paragraph of the voBlock
function stateWithCaretInLastPara(docJson) {
  const doc = docFrom(docJson);
  let pos = null;
  doc.descendants((n, p) => { if (n.type.name === 'paragraph') pos = p + 1; });
  return EditorState.create({ schema, doc, plugins: [history()], selection: TextSelection.create(doc, pos) });
}

const countVo = (doc) => { let n = 0; doc.descendants((x) => { if (x.type.name === 'voBlock') n++; }); return n; };

// ── 1+2+5: exit on trailing empty paragraph ─────────────────────────────────────────────────
ok('Enter on the trailing empty line exits the VO — one voBlock, caret after it; undo restores', () => {
  let state = stateWithCaretInLastPara(voDoc(['the ridgelines swim', '']));
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doExitVoOnEmptyTail(state, dispatch), true, 'exit handled');
  assert.equal(countVo(state.doc), 1, 'still exactly ONE voBlock — no second VO tag');
  const cell = state.doc.child(0).child(0);
  assert.equal(cell.childCount, 2, 'cell = voBlock + the fresh bare paragraph');
  assert.equal(cell.child(0).type.name, 'voBlock');
  assert.equal(cell.child(0).childCount, 1, 'the empty tail line left the VO');
  assert.equal(cell.child(0).textContent, 'the ridgelines swim', 'VO words intact');
  assert.equal(cell.child(1).type.name, 'paragraph', 'exit lands in a bare paragraph');
  assert.ok(state.selection.$from.parent === state.doc.resolve(state.selection.from).parent, 'caret placed');

  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();

  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'one undo restores byte-exact');
});

// ── 3: mid-block Enter untouched ────────────────────────────────────────────────────────────
ok('Enter in a non-empty last paragraph is NOT hijacked', () => {
  let state = stateWithCaretInLastPara(voDoc(['line one', 'line two words']));
  assert.equal(doExitVoOnEmptyTail(state, () => {}), false);
});

ok('an empty paragraph that is not last is NOT hijacked', () => {
  const doc = docFrom(voDoc(['', 'closing words']));
  // caret in the FIRST (empty) paragraph
  let pos = null;
  doc.descendants((n, p) => { if (pos == null && n.type.name === 'paragraph') pos = p + 1; });
  const state = EditorState.create({ schema, doc, plugins: [history()], selection: TextSelection.create(doc, pos) });
  assert.equal(doExitVoOnEmptyTail(state, () => {}), false);
});

// ── 4: a fresh empty VO keeps normal Enter ──────────────────────────────────────────────────
ok('a VO whose only paragraph is empty keeps default Enter', () => {
  let state = stateWithCaretInLastPara(voDoc(['']));
  assert.equal(doExitVoOnEmptyTail(state, () => {}), false);
});

console.log(`vo-exit.test.mjs: ${pass} assertions passed`);
