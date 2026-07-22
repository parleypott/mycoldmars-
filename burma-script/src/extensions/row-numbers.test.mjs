/*
 * row-numbers.test.mjs — the MASTER ROW NUMBERS decoration contract (row-numbers.js).
 *
 * Proves:
 *   1. 1:1 WITH THE WALK — buildRowNumberDecorations decorates every TOP-LEVEL row and
 *      NOTHING else; each decoration's range and number match workspaces.js walkRows
 *      exactly (single enumeration truth — margin number == workspace index, always).
 *   2. DOM CONTRACT — each decoration carries {'data-rownum': '<n>'} (what the CSS
 *      ::before renders) as a NODE decoration spanning the whole row.
 *   3. DYNAMIC — inserting a row at the top renumbers everything below on rebuild.
 *   4. NESTED ROWS — a Palau nested said|shown row inside a wrapper cell gets NO
 *      decoration of its own; bare top-level strays (trailing ¶) are never numbered.
 *   5. COLLAB LOOP LAW (source pin) — row-numbers.js dispatches nothing: no dispatch
 *      call, no appendTransaction. Decoration-only, forever.
 *
 * Run: bun src/extensions/row-numbers.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { buildRowNumberDecorations } from './row-numbers.js';
import { walkRows } from '../workspaces.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

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
const cell = (blocks, role = 'full') => ({ type: 'tableCell', attrs: { role }, content: blocks });
const row = (blocks) => ({ type: 'tableRow', attrs: { cols: 1, pairId: null }, content: [cell(blocks)] });
const vo = (id, text) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const DOC = docFrom({
  type: 'doc',
  content: [
    row([vo('r1', 'row one')]),
    { // Palau wrapper with a NESTED said|shown row
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [cell([
        vo('r2', 'row two'),
        {
          type: 'tableRow', attrs: { cols: 2, pairId: 'pair_n' },
          content: [cell([vo('r2s', 'nested said')], 'said'), cell([vo('r2v', 'nested shown')], 'shown')],
        },
      ])],
    },
    row([vo('r3', 'row three')]),
    { type: 'paragraph' }, // trailing peace-treaty ¶ — never numbered
  ],
});

ok('decorations match walkRows 1:1 — count, range, number', () => {
  const rows = walkRows(DOC);
  const decos = buildRowNumberDecorations(DOC).find().sort((a, b) => a.from - b.from);
  assert.equal(decos.length, rows.length, 'exactly one decoration per TOP-LEVEL row');
  rows.forEach((r, i) => {
    assert.equal(decos[i].from, r.pos, `row ${r.index}: decoration starts at the row`);
    assert.equal(decos[i].to, r.pos + r.node.nodeSize, `row ${r.index}: node decoration spans the whole row`);
    assert.equal(decos[i].spec.rownum, r.index, `row ${r.index}: number == walkRows index`);
  });
});

ok('DOM contract: the decoration carries data-rownum="<n>" for the CSS ::before', () => {
  const decos = buildRowNumberDecorations(DOC).find().sort((a, b) => a.from - b.from);
  decos.forEach((d, i) => {
    // Decoration.node attrs land on the row element; prosemirror-view stores them on the
    // decoration's type. Assert through it — this IS the attribute the stylesheet keys on.
    assert.equal(d.type.attrs['data-rownum'], String(i + 1));
  });
});

ok('nested rows and bare strays get NO decoration', () => {
  const rows = walkRows(DOC);
  const decos = buildRowNumberDecorations(DOC).find();
  assert.equal(rows.length, 3, 'fixture: three top-level rows');
  assert.equal(decos.length, 3);
  // The nested row lives strictly INSIDE the wrapper's range — no decoration may start there.
  const wrapper = rows[1];
  for (const d of decos) {
    assert.ok(!(d.from > wrapper.pos && d.from < wrapper.pos + wrapper.node.nodeSize),
      'no decoration starts inside the wrapper (the nested row is unnumbered)');
  }
});

ok('dynamic: inserting a row at the top renumbers everything below', () => {
  const grown = docFrom({
    type: 'doc',
    content: [row([vo('r0', 'new first row')]), ...DOC.toJSON().content],
  });
  const decos = buildRowNumberDecorations(grown).find().sort((a, b) => a.from - b.from);
  assert.deepEqual(decos.map((d) => d.spec.rownum), [1, 2, 3, 4], 'old 1/2/3 became 2/3/4');
  const old = buildRowNumberDecorations(DOC).find().sort((a, b) => a.from - b.from);
  assert.deepEqual(old.map((d) => d.spec.rownum), [1, 2, 3]);
});

ok('COLLAB LOOP LAW pin: row-numbers.js dispatches nothing', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'row-numbers.js'), 'utf8');
  assert.ok(!/\bdispatch\s*\(/.test(src), 'no dispatch() call anywhere in the plugin');
  assert.ok(!/appendTransaction/.test(src), 'no appendTransaction — decorations only');
});

console.log(`row-numbers.test.mjs: ${pass} assertions passed`);
