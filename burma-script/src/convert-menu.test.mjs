import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark, defaultDirectionMarkAttrs } from './extensions/direction-chip.js';
import { VIZ_KINDS } from './extensions/convert-menu.js';

let pass = 0;
function ok(label, fn) { fn(); pass++; }

// The convert menu offers the Make VO block action FIRST (kind '__vo', routed through the shared
// retypeHostToVo — not a mark), then exactly the seven viz kinds Johnny named. Every MARK kind it
// applies must be one directionMark already understands — otherwise a converted run would carry an
// attr the mark can't render, breaking parity with the slash menu.
ok('VIZ_KINDS is Make VO + the seven viz kinds in order', () => {
  assert.deepEqual(
    VIZ_KINDS.map((v) => v.kind),
    ['__vo', 'animation', '3d', 'broll', 'mapdata', 'archive', 'oncam', 'factcheck', 'direction'],
  );
  assert.deepEqual(
    VIZ_KINDS.map((v) => v.label),
    ['Make VO', 'Animation', '3d', 'B-roll', 'Map data', 'Archive', 'On cam', 'Fact-check', 'Direction'],
  );
});

// Every convert kind resolves to the SAME default directionMark attrs the slash menu would store —
// this is the lockstep that keeps a right-click-converted run byte-identical to a /-typed one.
ok('each VIZ_KIND maps to a valid default directionMark status', () => {
  const expected = {
    animation: 'static',
    '3d': 'static',
    mapdata: 'static',
    broll: 'unchecked',
    archive: 'needed',
    oncam: 'static',
    factcheck: 'todo',
    direction: 'default',
  };
  for (const { kind } of VIZ_KINDS) {
    if (kind === '__vo') continue; // block action, not a directionMark
    const attrs = defaultDirectionMarkAttrs(kind);
    assert.equal(attrs.kind, kind === 'direction' ? 'direction' : kind);
    assert.equal(attrs.status, expected[kind]);
  }
});

// A converted run — a text node carrying directionMark(kind,status) — must round-trip byte-for-byte
// through the live schema for EVERY viz kind, proving setMark over a selection yields a valid doc.
ok('every converted viz run round-trips through the live schema', () => {
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

  for (const { kind } of VIZ_KINDS) {
    if (kind === '__vo') continue; // block action, not a directionMark
    const attrs = defaultDirectionMarkAttrs(kind);
    const json = {
      type: 'doc',
      content: [{
        type: 'tableRow',
        attrs: { cols: 1, pairId: null, bookmarkId: null },
        content: [{
          type: 'tableCell',
          attrs: { role: 'full' },
          content: [{
            type: 'oncamBlock',
            attrs: { blockId: 'dir_1', flavor: null, chapterId: null, pendingViz: null },
            content: [{
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Before ' },
                { type: 'text', text: 'converted run', marks: [{ type: 'directionMark', attrs }] },
                { type: 'text', text: ' after' },
              ],
            }],
          }],
        }],
      }],
    };
    const node = PMNode.fromJSON(schema, json);
    node.check();
    assert.deepEqual(JSON.parse(JSON.stringify(node.toJSON())), json, `round-trip failed for ${kind}`);
  }
});

console.log(`convert-menu.test.mjs: ${pass} assertions passed`);
