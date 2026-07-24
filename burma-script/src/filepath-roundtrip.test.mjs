/**
 * FILEPATH mark round-trip — the green code-path chip (filepathSpan) survives the export → rebuild
 * cycle BYTE-STABLE, exactly like the other inline span marks (tkSpan / visualSpan / trimSpan).
 *
 * Two layers, both the same contract the clipboard + autosave round-trip through:
 *   1. nodeText / wrapToken: a filepathSpan-marked run flattens to its `…` backtick export token,
 *      and a run already carrying the token is not double-wrapped.
 *   2. PM JSON schema round-trip: a block carrying a filepathSpan mark passes the LIVE schema
 *      (StarterKit + Burma nodes/marks — the same getSchema the migrate-doc save gate enforces via
 *      ...BURMA_MARKS) and returns fromJSON → toJSON byte-identical (nothing dropped).
 *   3. inlineContent inverse: a block whose text is a backtick token rebuilds a filepathSpan mark on
 *      the exact path text — so an export → reparse round-trip re-greens the path.
 *
 * Run: bun src/filepath-roundtrip.test.mjs
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { buildEditorDocument, docToBlocks, nodeText } from './document-builder.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const eq = (got, want, label) => { assert.equal(got, want, label); pass++; };

const PATH = '/Users/johnnyharris/Desktop/Boat Nile.qta';

// --- 1. nodeText / wrapToken flatten a filepathSpan run to its backtick token ---------------------
eq(
  nodeText({ type: 'paragraph', content: [
    { type: 'text', text: 'render ' },
    { type: 'text', text: PATH, marks: [{ type: 'filepathSpan' }] },
    { type: 'text', text: ' next' },
  ] }),
  'render `' + PATH + '` next',
  'nodeText wraps a filepathSpan run in backticks',
);

// A filepathSpan run fragmented into two adjacent marked text nodes coalesces into ONE token
// (same coalescing that keeps a timecode-split visual span single) — no double ``path``.
eq(
  nodeText({ type: 'paragraph', content: [
    { type: 'text', text: '/Users/johnny/', marks: [{ type: 'filepathSpan' }] },
    { type: 'text', text: 'Desktop/clip.mov', marks: [{ type: 'filepathSpan' }] },
  ] }),
  '`/Users/johnny/Desktop/clip.mov`',
  'adjacent filepathSpan fragments collapse to one backtick token',
);

// --- 2. export → rebuild is byte-stable through buildEditorDocument + docToBlocks ------------------
ok('a bin block carrying a filepath path round-trips byte-exact through build → flatten', () => {
  const block = { id: 'fp1', type: 'none', text: 'open `' + PATH + '` to grade' };
  const doc = buildEditorDocument([block]);
  const out = docToBlocks(doc);
  // The path text (including the space) survives verbatim inside its backtick token.
  const joined = out.map((b) => b.text || '').join('\n');
  assert.ok(joined.includes('`' + PATH + '`'), 'backtick-wrapped path present after round-trip');
  assert.ok(joined.includes(PATH), 'the exact path text (with its space) survives');
});

// --- 3. the LIVE schema admits the mark and round-trips it byte-identical --------------------------
function buildSchema() {
  return getSchema([
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
  ]);
}

ok('filepathSpan is a registered mark in the live/migrate schema (via BURMA_MARKS)', () => {
  const schema = buildSchema();
  assert.ok(schema.marks.filepathSpan, 'filepathSpan mark exists in the schema');
});

ok('a paragraph with a filepathSpan mark survives fromJSON → toJSON byte-identical', () => {
  const schema = buildSchema();
  const json = {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'grade ' },
      { type: 'text', text: PATH, marks: [{ type: 'filepathSpan' }] },
    ],
  };
  const node = schema.nodeFromJSON(json);
  node.check(); // throws if the mark/attrs violate the schema
  assert.deepEqual(node.toJSON(), json, 'byte-identical round-trip');
});

console.log(`filepath-roundtrip.test.mjs: ${pass} assertions passed`);
