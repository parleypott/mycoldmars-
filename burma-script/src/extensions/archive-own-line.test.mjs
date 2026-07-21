/*
 * archive-own-line.test.mjs — the /archive slash command's split decision
 * (slash-menu.js triggerFillsLine, used by setArchiveMark under archiveOwnLine).
 *
 * Johnny 2026-07-21: "/archive then Enter makes a paragraph space above it."
 * With archiveOwnLine on (Burma + Palau + library scripts), setArchiveMark splitBlocks so
 * the archive pops onto its own line. But when "/archive" is the paragraph's ONLY content,
 * deleting the trigger already leaves an empty line of its own — splitting there just
 * strands a blank paragraph ABOVE the checklist item. The fix: skip the split exactly when
 * the trigger text fills the whole paragraph.
 *
 * Proves:
 *   1. "/archive" alone on its line → triggerFillsLine TRUE (no split → no stray paragraph).
 *   2. Text before the trigger ("find the tapes /archive") → FALSE (split keeps popping the
 *      archive onto its own line — the intended own-line behavior is untouched).
 *   3. Text after the trigger (caret mid-line) → FALSE (pre-existing split path untouched).
 *   4. Works identically inside a said-lane cell of a split row (the common real-world spot).
 *
 * Run: bun src/extensions/archive-own-line.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { triggerFillsLine } from './slash-menu.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

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

const docFrom = (json) => PMNode.fromJSON(schema, json);
const row = (blocks, attrs) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, ...(attrs || {}) },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
const none = (id, text) => ({
  type: 'noneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});

function triggerRange(doc, trigger) {
  let range = null;
  doc.descendants((node, pos) => {
    if (range || !node.isText) return;
    const at = node.text.indexOf(trigger);
    if (at >= 0) range = { from: pos + at, to: pos + at + trigger.length };
  });
  if (!range) throw new Error(`trigger ${trigger} not found in doc`);
  return range;
}

const stateFor = (docJson) => EditorState.create({ doc: docFrom(docJson) });

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

ok('1. trigger alone on the line → fills line (skip split)', () => {
  const state = stateFor({ type: 'doc', content: [row([none('b1', '/archive')])] });
  const range = triggerRange(state.doc, '/archive');
  assert.equal(triggerFillsLine(state, range), true);
});

ok('2. text before the trigger → does not fill line (split keeps own-line pop)', () => {
  const state = stateFor({ type: 'doc', content: [row([none('b1', 'find the tapes /archive')])] });
  const range = triggerRange(state.doc, '/archive');
  assert.equal(triggerFillsLine(state, range), false);
});

ok('3. text after the trigger → does not fill line', () => {
  const state = stateFor({ type: 'doc', content: [row([none('b1', '/archive trailing')])] });
  const range = triggerRange(state.doc, '/archive');
  assert.equal(triggerFillsLine(state, range), false);
});

ok('4. trigger alone inside a said-lane cell of a split row → fills line', () => {
  const state = stateFor({
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 2, pairId: 'pairu_test1' },
      content: [
        { type: 'tableCell', attrs: { role: 'said' }, content: [none('b1', '/archive')] },
        { type: 'tableCell', attrs: { role: 'shown' }, content: [none('b2', 'broll of the port')] },
      ],
    }],
  });
  const range = triggerRange(state.doc, '/archive');
  assert.equal(triggerFillsLine(state, range), true);
});

console.log(`archive-own-line: ${pass}/4 passed`);
