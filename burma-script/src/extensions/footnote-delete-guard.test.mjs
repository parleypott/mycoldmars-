/*
 * footnote-delete-guard.test.mjs — footnotes resist a single delete.
 *
 * Locks the pure decision behind the Backspace/Delete guard: footnoteAtCursor() returns the
 * atom's position ONLY when an empty cursor sits immediately on the given side of a fcFootnote —
 * so the keymap can select the atom (resist) instead of deleting it. A non-empty selection, or a
 * cursor next to plain text, returns null → the default delete runs normally.
 *
 * Run: bun src/extensions/footnote-delete-guard.test.mjs
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
import { DirectionMark } from './direction-chip.js';
import { footnoteAtCursor } from './footnote-delete-guard.js';
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

// doc: a voBlock paragraph = "hi " + <fcFootnote> + " bye"
const docJSON = {
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' },
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi ' },
            { type: 'fcFootnote', attrs: { noteId: 'fn_x', note: 'n', source: '', marker: '', verdict: '', status: '' } },
            { type: 'text', text: ' bye' },
          ],
        }],
      }],
    }],
  }],
};

// find the footnote's position + the caret positions just before/after it
const doc = PMNode.fromJSON(schema, docJSON);
let fnPos = -1;
doc.descendants((n, p) => { if (n.type.name === 'fcFootnote') fnPos = p; });
assert.ok(fnPos > 0, 'footnote located');
const afterFn = fnPos + 1;   // cursor sits right AFTER the atom (atom nodeSize = 1)
const beforeFn = fnPos;      // cursor sits right BEFORE the atom

const stateAt = (pos) => EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });

ok('Backspace just AFTER a footnote targets the atom', () => {
  assert.equal(footnoteAtCursor(stateAt(afterFn), 'back'), fnPos);
});

ok('Delete just BEFORE a footnote targets the atom', () => {
  assert.equal(footnoteAtCursor(stateAt(beforeFn), 'fwd'), fnPos);
});

ok('cursor in plain text (no adjacent footnote) → null, default delete runs', () => {
  // caret one char into "hi " (inside the text run) — nothing to resist on either side
  const inText = beforeFn - 1;
  assert.equal(footnoteAtCursor(stateAt(inText), 'back'), null);
  assert.equal(footnoteAtCursor(stateAt(inText), 'fwd'), null);
});

ok('a non-empty selection never resists (returns null both sides)', () => {
  const sel = EditorState.create({ schema, doc, selection: TextSelection.create(doc, beforeFn, afterFn) });
  assert.equal(footnoteAtCursor(sel, 'back'), null);
  assert.equal(footnoteAtCursor(sel, 'fwd'), null);
});

console.log(`\nfootnote-delete-guard.test.mjs — ${pass} checks passed`);
