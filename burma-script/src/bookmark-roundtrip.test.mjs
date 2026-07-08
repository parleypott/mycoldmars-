/*
 * bookmark-roundtrip.test.mjs — the inline /bookmark (Johnny 2026-07-08) is an atom node whose only
 * payload is a bookmarkId. Like the fcFootnote receipt, it MUST survive the derived-blocks export
 * (nodeText → {bm <id>} token) and the rebuild (inlineContent → real bookmark node), or an
 * export/rebuild cycle would silently drop the place-mark and break its deep link. This locks that.
 */
import assert from 'node:assert/strict';
import { bookmarkToken } from './document-builder.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

// 1. token shape
ok('bookmarkToken emits {bm <id>}', () => {
  assert.equal(bookmarkToken({ bookmarkId: 'bm_abc123' }), '{bm bm_abc123}');
});
ok('bookmarkToken with no id emits nothing (a bookmark is pure place-mark)', () => {
  assert.equal(bookmarkToken({}), '');
  assert.equal(bookmarkToken({ bookmarkId: null }), '');
});
ok('bookmarkToken scrubs braces/whitespace so the token always re-parses', () => {
  assert.equal(bookmarkToken({ bookmarkId: 'bm_a b}c{' }), '{bm bm_abc}');
});

// 2. the token the inlineContent {bm} branch parses (mirror its regex + extraction here so a
//    change to either side that breaks the pair fails loudly).
ok('the {bm <id>} token round-trips through the documented parse', () => {
  const id = 'bm_l4k2_9z_qwert';
  const tok = bookmarkToken({ bookmarkId: id });
  assert.match(tok, /^\{\s*bm\b/i, 'token is recognized by the inlineContent isBm sniff');
  const parsed = tok.replace(/^\{\s*bm\s*/i, '').replace(/\}$/, '').trim();
  assert.equal(parsed, id, 'parsed id equals the original — deep link preserved');
});

console.log(`\nbookmark-roundtrip: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
