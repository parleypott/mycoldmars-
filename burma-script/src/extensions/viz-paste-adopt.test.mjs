/*
 * viz-paste-adopt.test.mjs — paste adopts the active viz tag, across paragraph breaks.
 *
 * Locks the two load-bearing decisions behind the handlePaste plugin (the DOM paste event itself
 * isn't unit-testable without a view):
 *   1. activeDirectionMark() finds the STORED directionMark a fresh /viz slash leaves — and finds
 *      the one on the run under the cursor when there's no stored mark; returns null otherwise.
 *   2. addMark over the inserted range clothes EVERY text node — including across a paragraph
 *      break — so a multi-paragraph paste wears the tag end to end (the "clothe everything" ask).
 *
 * Run: bun src/extensions/viz-paste-adopt.test.mjs
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark, defaultDirectionMarkAttrs } from './direction-chip.js';
import { activeDirectionMark } from './viz-paste-adopt.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ok —', label); };

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

const dm = schema.marks.directionMark;
const twoParaVo = {
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'first line of the paste' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'second line of the paste' }] },
        ],
      }],
    }],
  }],
};

// ── 1: activeDirectionMark reads the stored mark (post-slash empty cursor) ─────────────────
ok('activeDirectionMark finds a STORED directionMark; null when none', () => {
  const doc = PMNode.fromJSON(schema, twoParaVo);
  let caret = 1; doc.descendants((n, p) => { if (caret === 1 && n.isText) caret = p + 1; });
  const base = EditorState.create({ schema, doc, selection: TextSelection.create(doc, caret) });
  assert.equal(activeDirectionMark(base), null, 'no mark active → null');
  const mark = dm.create(defaultDirectionMarkAttrs('mapdata'));
  const withStored = base.apply(base.tr.setStoredMarks([mark]));
  const found = activeDirectionMark(withStored);
  assert.ok(found, 'stored directionMark detected');
  assert.equal(found.attrs.kind, 'mapdata');
});

// ── 2: addMark over the range clothes BOTH paragraphs (across the break) ───────────────────
ok('the active tag clothes every text node across a paragraph break', () => {
  const doc = PMNode.fromJSON(schema, twoParaVo);
  // select the entire span of both paragraphs' text
  let start = -1, end = -1;
  doc.descendants((n, p) => {
    if (n.isText) { if (start < 0) start = p; end = p + n.nodeSize; }
  });
  const mark = dm.create(defaultDirectionMarkAttrs('mapdata'));
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, start, end) });
  const next = state.apply(state.tr.addMark(start, end, mark));
  const marked = [];
  next.doc.descendants((n) => { if (n.isText) marked.push((n.marks || []).some((m) => m.type === dm)); });
  assert.equal(marked.length, 2, 'two text runs (one per paragraph)');
  assert.ok(marked.every(Boolean), 'BOTH paragraphs carry the tag — clothed across the break');
});

console.log(`\nviz-paste-adopt.test.mjs — ${pass} checks passed`);
