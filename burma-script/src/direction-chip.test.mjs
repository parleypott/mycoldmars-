import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import {
  directionChipText,
  nextDirectionChipAttrs,
  defaultDirectionChipAttrs,
} from './extensions/direction-chip.js';

let pass = 0;

function ok(label, fn) {
  fn();
  pass++;
}

ok('archive text + cycle', () => {
  const needed = defaultDirectionChipAttrs('archive');
  assert.equal(directionChipText(needed), 'ARCHIVE NEEDED');
  const found = nextDirectionChipAttrs(needed);
  assert.deepEqual(found, { kind: 'archive', status: 'found', filePath: '' });
  assert.equal(directionChipText(found), 'ARCHIVE FOUND (file path)');
  assert.deepEqual(nextDirectionChipAttrs(found), { kind: 'archive', status: 'needed', filePath: '' });
});

ok('factcheck text + cycle', () => {
  const todo = defaultDirectionChipAttrs('factcheck');
  assert.equal(directionChipText(todo), 'NEEDS FACT CHECK + SOURCE');
  const sourced = nextDirectionChipAttrs(todo);
  assert.deepEqual(sourced, { kind: 'factcheck', status: 'sourced', filePath: '' });
  assert.equal(directionChipText(sourced), 'SOURCED');
});

ok('broll text + cycle', () => {
  const unchecked = defaultDirectionChipAttrs('broll');
  assert.equal(directionChipText(unchecked), '[ ] B-ROLL (shot)');
  const checked = nextDirectionChipAttrs(unchecked);
  assert.deepEqual(checked, { kind: 'broll', status: 'checked', filePath: '' });
  assert.equal(directionChipText(checked), '[x] B-ROLL (shot)');
  assert.deepEqual(nextDirectionChipAttrs(checked), { kind: 'broll', status: 'unchecked', filePath: '' });
});

ok('schema accepts inline directionChip and round-trips attrs', () => {
  const schema = getSchema([
    StarterKit.configure({
      heading: false, blockquote: false, codeBlock: false, code: false,
      horizontalRule: false,
      strike: false,
      dropcursor: false, gapcursor: false,
    }),
    Dropcursor.configure({ color: '#d23b2c', width: 2 }),
    Gapcursor,
    ...BURMA_TABLE_NODES,
    ...BURMA_NODES,
    ...BURMA_MARKS,
  ]);

  const json = {
    type: 'doc',
    content: [{
      type: 'tableRow',
      attrs: { cols: 1, pairId: null },
      content: [{
        type: 'tableCell',
        attrs: { role: 'full' },
        content: [{
          type: 'oncamBlock',
          attrs: { blockId: 'dir_1', flavor: null, chapterId: null },
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Before ' },
              {
                type: 'directionChip',
                attrs: { kind: 'archive', status: 'found', filePath: 'palau/archive.mov' },
              },
              { type: 'text', text: ' after' },
            ],
          }],
        }],
      }],
    }],
  };

  const node = PMNode.fromJSON(schema, json);
  node.check();
  const chip = node.firstChild.firstChild.firstChild.firstChild.content.content[1];
  assert.equal(chip.type.name, 'directionChip');
  // ProseMirror builds attrs objects with a NULL prototype (Object.create(null)), so a strict
  // deepEqual against a plain-object literal fails on the prototype alone even when every value
  // matches. Normalize both sides through JSON (structural value equality, prototype-agnostic) —
  // this still proves kind/status/filePath round-trip byte-for-byte through the live schema.
  assert.deepEqual(
    JSON.parse(JSON.stringify(chip.attrs)),
    { kind: 'archive', status: 'found', filePath: 'palau/archive.mov' },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(node.toJSON())), json);

  // A SPLIT row carrying a real pairId must round-trip its pairId (AND its said/shown lanes)
  // byte-for-byte through fromJSON -> toJSON. Cells are schema-valid (block+ content) so
  // node.check() passes — this proves the attr survives on a genuinely valid document node,
  // not a structurally-hollow one, and uses the real said/shown lane roles.
  const pairedRowJson = {
    type: 'tableRow',
    attrs: { cols: 2, pairId: 'pair_palau_5' },
    content: [
      {
        type: 'tableCell',
        attrs: { role: 'said' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'what was said' }] }],
      },
      {
        type: 'tableCell',
        attrs: { role: 'shown' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'what is shown' }] }],
      },
    ],
  };
  const pairedRow = PMNode.fromJSON(schema, pairedRowJson);
  pairedRow.check();
  assert.equal(pairedRow.attrs.pairId, 'pair_palau_5');
  assert.deepEqual(JSON.parse(JSON.stringify(pairedRow.toJSON())), pairedRowJson);
});

console.log(`direction-chip: ${pass} passed, 0 failed`);
