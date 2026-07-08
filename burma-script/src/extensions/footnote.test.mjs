/*
 * footnote.test.mjs — the fact-check footnote (extensions/footnote.js): the green ✓ receipt
 * that rides right after a verified fact while the {fc}/{TK} chip stays live (lineage law).
 *
 * Proves:
 *   1. SCHEMA — an fcFootnote inline atom sits inside any prose block, passes the mirror
 *      save-gate schema (PMNode.check()), and round-trips fromJSON→toJSON byte-exact with
 *      all five attrs (noteId / note / source / marker / verdict) intact.
 *   2. EXPORT LAW — docToBlocks() serializes the footnote as the `{fn note || source}`
 *      token: the writer's fact-check WORDS survive the derived blocks view.
 *   3. REBUILD — inlineContent (via blockToNode) parses that token back into a REAL
 *      fcFootnote node with the same note + source — export → rebuild loses nothing —
 *      and never mis-routes it into a tk/fc mark.
 *   4. TOKEN HYGIENE — braces / `||` inside the note can't break the token (scrubbed).
 *   5. Attr edit (the fly-out's setNodeMarkup path) round-trips the mirror schema too.
 *
 * Run: bun src/extensions/footnote.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { docToBlocks, footnoteToken, buildEditorDocument } from '../document-builder.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

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

const docFrom = (json) => PMNode.fromJSON(schema, json);

const FN_ATTRS = {
  noteId: 'fn_test1',
  note: 'Confirmed: the Irrawaddy is named for the elephant.',
  source: 'https://example.org/irrawaddy',
  marker: 'fc river named after an Elephant',
  verdict: 'supported',
  status: '',   // '' = the verified green ✓ receipt; 'needed' = a red-square /footnote to-do
};

const docWithFootnote = {
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'voBlock', attrs: { blockId: 'blk_v1', status: 'todo' },
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'there was a river named after an Elephant ' },
            { type: 'fcFootnote', attrs: FN_ATTRS },
            { type: 'text', text: ' flowing from the mountains.' },
          ],
        }],
      }],
    }],
  }],
};

// ── 1: schema + byte-exact round-trip ───────────────────────────────────────────────────────
ok('fcFootnote passes the mirror schema and round-trips byte-exact', () => {
  const doc = docFrom(docWithFootnote);
  doc.check();
  // byte-exact over the NORMALIZED form (fromJSON fills declared attr defaults like
  // flavor/chapterId — same as every saved doc) — the round-trip law is reparse-stable.
  const normalized = clone(doc.toJSON());
  assert.deepEqual(clone(docFrom(normalized).toJSON()), normalized, 'fromJSON → toJSON byte-exact');
  let found = null;
  doc.descendants((n) => { if (n.type.name === 'fcFootnote') found = n; });
  assert.ok(found, 'footnote present');
  assert.deepEqual({ ...found.attrs }, FN_ATTRS, 'all six attrs intact');
});

// ── 2: export law — the words survive docToBlocks ──────────────────────────────────────────
ok('docToBlocks serializes the footnote as the {fn …} token (no words dropped)', () => {
  const blocks = docToBlocks(docWithFootnote);
  const vo = blocks.find((b) => b.type === 'vo');
  assert.ok(vo, 'vo block exported');
  assert.ok(vo.text.includes('{fn Confirmed: the Irrawaddy is named for the elephant. || https://example.org/irrawaddy}'),
    `token present in export, got: ${vo.text}`);
  assert.ok(vo.text.includes('there was a river named after an Elephant'), 'prose intact');
});

// ── 3: rebuild — the token parses back into a real fcFootnote node ─────────────────────────
ok('a rebuilt doc turns the {fn …} token back into an fcFootnote node', () => {
  const blocks = docToBlocks(docWithFootnote);
  const rebuilt = buildEditorDocument(blocks);
  const doc = docFrom(rebuilt);
  doc.check();
  let fn = null;
  doc.descendants((n) => { if (n.type.name === 'fcFootnote') fn = n; });
  assert.ok(fn, 'footnote node rebuilt from the token');
  assert.equal(fn.attrs.note, 'Confirmed: the Irrawaddy is named for the elephant.');
  assert.equal(fn.attrs.source, 'https://example.org/irrawaddy');
  // and it must NOT have leaked into a tk/fc mark instead
  let leakedSpan = false;
  doc.descendants((n) => {
    if (n.isText && (n.marks || []).some((m) => m.type.name === 'tkSpan' || m.type.name === 'factCheckSpan')) {
      if (n.text.includes('Irrawaddy')) leakedSpan = true;
    }
  });
  assert.ok(!leakedSpan, 'the fn token never routes into a tk/fc span');
});

// ── 4: token hygiene ────────────────────────────────────────────────────────────────────────
ok('braces and || inside the note cannot break the token', () => {
  const tok = footnoteToken({ note: 'weird {stuff} with || pipes', source: 'src {x}' });
  assert.ok(!/[{}]/.test(tok.slice(1, -1)), 'inner braces scrubbed');
  assert.equal((tok.match(/\|\|/g) || []).length, 1, 'exactly one separator survives');
});

// ── 5: attr edit (the fly-out save path) keeps the doc valid ───────────────────────────────
ok('editing note/source attrs round-trips the mirror schema', () => {
  const doc = docFrom(docWithFootnote);
  let pos = null;
  doc.descendants((n, p) => { if (n.type.name === 'fcFootnote') pos = p; });
  const edited = docFrom(clone(doc.toJSON()));
  // simulate the setNodeMarkup the panel dispatches
  const json = clone(edited.toJSON());
  const para = json.content[0].content[0].content[0].content[0];
  const fn = para.content.find((n) => n.type === 'fcFootnote');
  fn.attrs.note = 'Edited context after a second look.';
  fn.attrs.source = 'https://example.org/v2';
  const redoc = docFrom(json);
  redoc.check();
  assert.ok(typeof pos === 'number', 'footnote position found');
});

console.log(`footnote.test.mjs: ${pass} assertions passed`);
