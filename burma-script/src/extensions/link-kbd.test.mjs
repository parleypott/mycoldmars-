/*
 * link-kbd.test.mjs — Cmd+K hyperlinks (extensions/link-kbd.js + the MARKS_ALLOWLIST
 * admission of StarterKit v3's `link` mark in blocks.js).
 *
 * Proves:
 *   1. The live/mirror schema registers the link mark AND every prose cart admits it —
 *      a linked run inside a voBlock passes PMNode.check() and round-trips byte-exact
 *      (the save-gate law; before this fix the allowlist silently DROPPED link marks).
 *   2. docToBlocks keeps every word of a linked run (href lives in the canonical doc
 *      JSON, same contract as bold/italic).
 *   3. normalizeHref: bare domains get https://, explicit schemes survive (https/mailto),
 *      empty / whitespace / the untouched "https://" prefill mean REMOVE (return '').
 *
 * Run: bun src/extensions/link-kbd.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { normalizeHref } from './link-kbd.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { docToBlocks } from '../document-builder.js';
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

const linkedDoc = {
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'voBlock', attrs: { blockId: 'blk_l1', status: 'todo' },
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'see the ' },
            { type: 'text', text: 'UN migration report', marks: [{ type: 'link', attrs: { href: 'https://example.org/report' } }] },
            { type: 'text', text: ' for the numbers.' },
          ],
        }],
      }],
    }],
  }],
};

// ── 1: schema admits the link mark inside a cart, byte-exact round-trip ────────────────────
ok('a linked run inside a voBlock passes the mirror schema and survives reparse', () => {
  assert.ok(schema.marks.link, 'link mark registered (StarterKit v3)');
  const doc = docFrom(linkedDoc);
  doc.check();
  const normalized = clone(doc.toJSON());
  assert.deepEqual(clone(docFrom(normalized).toJSON()), normalized, 'reparse-stable');
  let linked = null;
  doc.descendants((n) => {
    if (n.isText && (n.marks || []).some((m) => m.type.name === 'link')) linked = n;
  });
  assert.ok(linked, 'the link mark SURVIVED the node allowlist (was silently dropped before)');
  assert.equal(linked.marks.find((m) => m.type.name === 'link').attrs.href, 'https://example.org/report');
});

// ── 2: export keeps the words ───────────────────────────────────────────────────────────────
ok('docToBlocks keeps every word of a linked run', () => {
  const vo = docToBlocks(linkedDoc).find((b) => b.type === 'vo');
  assert.ok(vo.text.includes('see the UN migration report for the numbers.'), vo.text);
});

// ── 3: href normalization ───────────────────────────────────────────────────────────────────
ok('normalizeHref: bare domain → https://, schemes kept, empty/prefill → remove', () => {
  assert.equal(normalizeHref('example.com/story'), 'https://example.com/story');
  assert.equal(normalizeHref('  www.nytimes.com  '), 'https://www.nytimes.com');
  assert.equal(normalizeHref('https://a.b/c'), 'https://a.b/c');
  assert.equal(normalizeHref('mailto:x@y.z'), 'mailto:x@y.z');
  assert.equal(normalizeHref(''), '');
  assert.equal(normalizeHref('   '), '');
  assert.equal(normalizeHref('https://'), '', 'the untouched prompt prefill means remove');
  assert.equal(normalizeHref(null), '');
});

console.log(`link-kbd.test.mjs: ${pass} assertions passed`);
