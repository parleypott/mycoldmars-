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
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { normalizeHref, isSingleUrl, linkPasteTransaction, isDangerousUrl } from './link-kbd.js';
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
    horizontalRule: false, dropcursor: false, gapcursor: false,
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

// ── 3b: dangerous-scheme rejection — the XSS input gate ─────────────────────────────────────
// normalizeHref persists the href into the doc JSON; TipTap's render-time isAllowedUri blanks
// javascript:/data:/vbscript: TODAY, but the doc must never STORE an executable href (any
// consumer outside that one sanitizer — a worklist/HTML export, a "copy link", a renderer swap —
// would make it live). Reject at the input gate so the stored href is always safe.
ok('isDangerousUrl flags javascript:/data:/vbscript: incl. case + whitespace obfuscation', () => {
  assert.equal(isDangerousUrl('javascript:alert(1)'), true);
  assert.equal(isDangerousUrl('JavaScript:alert(document.cookie)'), true, 'case-insensitive');
  assert.equal(isDangerousUrl('  javascript:alert(1)'), true, 'leading whitespace ignored');
  assert.equal(isDangerousUrl('java\tscript:alert(1)'), true, 'embedded tab stripped like a browser');
  assert.equal(isDangerousUrl('java\nscript:alert(1)'), true, 'embedded newline stripped');
  assert.equal(isDangerousUrl('data:text/html,<script>alert(1)</script>'), true);
  assert.equal(isDangerousUrl('vbscript:msgbox(1)'), true);
  // Legit schemes and bare hosts are NEVER flagged (byte-identical downstream).
  assert.equal(isDangerousUrl('https://example.org/x'), false);
  assert.equal(isDangerousUrl('mailto:a@b.c'), false);
  assert.equal(isDangerousUrl('tel:+15551234'), false);
  assert.equal(isDangerousUrl('example.com/data:thing'), false, 'data: mid-path on a real host is not a scheme');
  assert.equal(isDangerousUrl(''), false);
  assert.equal(isDangerousUrl(null), false);
});

ok('normalizeHref REJECTS dangerous schemes to "" (remove) while every legit href is unchanged', () => {
  // The load-bearing assertions: without the isDangerousUrl gate these return the raw payload.
  assert.equal(normalizeHref('javascript:alert(document.cookie)'), '', 'javascript: never persisted');
  assert.equal(normalizeHref('JavaScript:alert(1)'), '', 'case-obfuscated javascript: never persisted');
  assert.equal(normalizeHref('  javascript:alert(1)  '), '', 'whitespace-wrapped javascript: never persisted');
  assert.equal(normalizeHref('data:text/html,<script>1</script>'), '', 'data: never persisted');
  assert.equal(normalizeHref('vbscript:x'), '', 'vbscript: never persisted');
  // Regression guard: legitimate hrefs are byte-identical to the pre-gate behavior.
  assert.equal(normalizeHref('https://a.b/c'), 'https://a.b/c');
  assert.equal(normalizeHref('mailto:x@y.z'), 'mailto:x@y.z');
  assert.equal(normalizeHref('example.com/story'), 'https://example.com/story');
});

ok('isSingleUrl refuses a dangerous scheme so paste-to-link never wraps it', () => {
  assert.equal(isSingleUrl('javascript:alert(1)'), false, 'was true before the gate — paste would have wrapped it');
  assert.equal(isSingleUrl('data:text/html,x'), false);
  assert.equal(isSingleUrl('vbscript:x'), false);
  // A qualifying paste of a dangerous URL is now a no-op transaction (default paste proceeds).
  const doc = docFrom({
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{
        type: 'tableCell', attrs: { role: 'full' },
        content: [{
          type: 'voBlock', attrs: { blockId: 'blk_x1', status: 'todo' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see the report here.' }] }],
        }],
      }],
    }],
  });
  let from = -1;
  doc.descendants((node, p) => { if (node.isText && node.text.includes('the report')) from = p + node.text.indexOf('the report'); });
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, from, from + 'the report'.length) });
  assert.equal(linkPasteTransaction(state, 'javascript:alert(1)'), null, 'no link mark created from a javascript: paste');
});

// ── 4: isSingleUrl — the paste-to-link gate ─────────────────────────────────────────────────
ok('isSingleUrl: schemed/bare-domain URLs pass, prose and blank text fail', () => {
  assert.equal(isSingleUrl('https://example.org/report'), true);
  assert.equal(isSingleUrl('www.nytimes.com/2024/07/09/world/story.html'), true);
  assert.equal(isSingleUrl('example.com'), true);
  assert.equal(isSingleUrl('mailto:x@y.z'), true);
  assert.equal(isSingleUrl('see https://example.org/report for the numbers'), false, 'prose containing a URL is not itself a URL');
  assert.equal(isSingleUrl('  '), false);
  assert.equal(isSingleUrl(''), false);
  assert.equal(isSingleUrl(null), false);
  assert.equal(isSingleUrl('not a url at all'), false);
});

// ── 5: linkPasteTransaction — wraps the selection, never replaces the text ──────────────────
ok('linkPasteTransaction wraps a non-empty selection in a link mark without touching the text', () => {
  const doc = docFrom({
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{
        type: 'tableCell', attrs: { role: 'full' },
        content: [{
          type: 'voBlock', attrs: { blockId: 'blk_p1', status: 'todo' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see the report for the numbers.' }] }],
        }],
      }],
    }],
  });
  let from = -1;
  doc.descendants((node, p) => { if (node.isText && node.text.includes('the report')) from = p + node.text.indexOf('the report'); });
  assert.ok(from >= 0, 'found "the report" in the doc');
  const to = from + 'the report'.length;
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
  const tr = linkPasteTransaction(state, 'https://example.org/report');
  assert.ok(tr, 'a qualifying paste returns a transaction');
  const next = tr.doc;
  assert.equal(next.textBetween(0, next.content.size, ' '), doc.textBetween(0, doc.content.size, ' '), 'text is byte-identical — only a mark was added');
  let linked = null;
  next.descendants((n) => { if (n.isText && n.text === 'the report') linked = n; });
  assert.ok(linked, 'the selected run is intact');
  assert.equal(linked.marks.find((m) => m.type.name === 'link')?.attrs.href, 'https://example.org/report');
});

ok('linkPasteTransaction is a no-op for empty selection or non-URL clipboard text', () => {
  const doc = docFrom(linkedDoc);
  let caret = -1;
  doc.descendants((node, p) => { if (caret < 0 && node.isText) caret = p + 1; });
  const collapsed = EditorState.create({ doc, selection: TextSelection.create(doc, caret, caret) });
  assert.equal(linkPasteTransaction(collapsed, 'https://example.org'), null, 'empty selection never intercepts paste');
  let from = -1;
  doc.descendants((node, p) => { if (node.isText && node.text.includes('numbers')) from = p + node.text.indexOf('numbers'); });
  const nonEmpty = EditorState.create({ doc, selection: TextSelection.create(doc, from, from + 7) });
  assert.equal(linkPasteTransaction(nonEmpty, 'just some prose, not a url'), null, 'non-URL clipboard text is a no-op');
});

console.log(`link-kbd.test.mjs: ${pass} assertions passed`);
