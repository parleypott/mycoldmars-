/*
 * footnote-fullscreen.test.mjs — the full-screen fact-check stage (Johnny 2026-07-08).
 * Locks the two load-bearing pure pieces:
 *   1. NEWLINE ROUND-TRIP — note (RECHECK's multi-line findings) and source (one per line, the
 *      full-screen source list) must survive the single-line {fn} export token. Before this,
 *      an embedded \n TORE the token apart on the paragraph-split rebuild — silent word loss.
 *   2. THE ASSERTION — stripClaimBraces drops the literal {fc …}/{tk …} wrapper so the
 *      full-screen masthead reads as the CLAIM, not markup; assertionText's marker→note
 *      fallback still shows a headline for a blank slash-command footnote.
 */
import assert from 'node:assert/strict';
import { footnoteToken, buildEditorDocument, docToBlocks } from './document-builder.js';
import { stripClaimBraces, assertionText } from './extensions/footnote.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

// mirror the isFn decode exactly (document-builder inlineContent branch). CONVENIENCE ONLY — the
// mirror can drift from the real branch and give false confidence (proven: neuter the real
// `.replace(FN_NL_RE, '\n')` and these mirror checks stay green while the END-TO-END locks below
// go red). Keep BOTH: the mirror is a fast unit check, the end-to-end block is the real guardrail.
const decodeFn = (tok) => {
  const inner = tok.replace(/^\{\s*fn\s*/i, '').replace(/\}$/, '');
  const sep = inner.indexOf('||');
  const NL = /\s*∥\s*/g;
  return {
    note: (sep >= 0 ? inner.slice(0, sep) : inner).trim().replace(NL, '\n'),
    source: (sep >= 0 ? inner.slice(sep + 2) : '').trim().replace(NL, '\n'),
  };
};

// Round-trip a single authored block through the REAL builder (inlineContent parser) and REAL
// serializer (docToBlocks → nodeText) — same pattern as bookmark-roundtrip.test.mjs. Unlike the
// mirror above, this exercises the ACTUAL isFn decode branch AND nodeText's footnote emit, so an
// edit that breaks EITHER side of the {fn} newline round-trip fails here even though the mirror
// checks stay green. Returns the re-derived block text.
const rtText = (block) => {
  const out = docToBlocks(buildEditorDocument([block]));
  const b = out.find((x) => x.text !== undefined || x.title !== undefined) || out[0];
  return b?.text ?? b?.title ?? '';
};
// Pull the FIRST rebuilt fcFootnote node's attrs from a real built doc — locks the PARSE side
// (the isFn branch's note/source decode) directly, not a hand-copy of its regex.
const rebuiltFnAttrs = (block) => {
  let hit = null;
  (function walk(n) { if (!n) return; if (n.type === 'fcFootnote') { hit = hit || n.attrs; } (n.content || []).forEach(walk); })(buildEditorDocument([block]));
  return hit;
};
const voBlock = (text) => ({ id: 'v1', type: 'vo', voStatus: 'todo', text });

ok('multi-line SOURCE (one per line) survives the token round-trip', () => {
  const source = 'https://a.org/one\nhttps://b.org/two\nReuters, 12 May 2021';
  const tok = footnoteToken({ note: 'quote here', source });
  assert.ok(!tok.includes('\n'), 'token stays single-line');
  assert.equal(decodeFn(tok).source, source, 'all three sources rebuild on their own lines');
});

ok('multi-line NOTE (RECHECK findings) survives the token round-trip', () => {
  const note = 'finding line\n\n“a verbatim quote” — Reuters';
  const tok = footnoteToken({ note, source: '' });
  assert.ok(!tok.includes('\n'), 'token stays single-line');
  // \n+ collapses to one separator by design (blank lines are layout, not words)
  assert.equal(decodeFn(tok).note, 'finding line\n“a verbatim quote” — Reuters');
});

ok('a literal ∥ in a citation is scrubbed, never mistaken for a newline marker', () => {
  const tok = footnoteToken({ note: 'a ∥ b', source: '' });
  const back = decodeFn(tok).note;
  assert.ok(!back.includes('∥'), 'no raw delimiter survives');
  assert.ok(back.includes('a') && back.includes('b'), 'the words survive');
});

ok('single-line values round-trip byte-identically (the common case is untouched)', () => {
  const tok = footnoteToken({ note: 'plain note', source: 'https://x.org' });
  assert.deepEqual(decodeFn(tok), { note: 'plain note', source: 'https://x.org' });
});

ok('stripClaimBraces drops the {fc}/{tk}/{fact} wrapper, keeps the claim words', () => {
  assert.equal(stripClaimBraces('{fc the capital moved in 2005}'), 'the capital moved in 2005');
  assert.equal(stripClaimBraces('{tk population figure}'), 'population figure');
  assert.equal(stripClaimBraces('{fact 20-lane highway}'), '20-lane highway');
  assert.equal(stripClaimBraces('bare claim, no braces'), 'bare claim, no braces');
  assert.equal(stripClaimBraces(''), '');
});

ok('assertionText — marker wins; note is the last fallback; empty gives a headline', () => {
  const ed = { state: { doc: { resolve() { throw new Error('no pos'); } } } };
  assert.deepEqual(assertionText(ed, null, { marker: '{fc the claim}' }, 'note'), { text: 'the claim', derived: false });
  assert.deepEqual(assertionText(ed, null, { marker: '' }, 'the note text'), { text: 'the note text', derived: true });
  assert.equal(assertionText(ed, null, {}, '').text, 'untitled fact check');
});

// ── END-TO-END through the REAL parser + serializer (the guardrail the mirror can't be) ──
// These fire if inlineContent's isFn decode, footnoteToken's encode, or nodeText's emit ever
// drops/mangles a multi-line footnote on an export → rebuild cycle. Data-loss-critical: a fact
// check's findings + source list must survive the derived-blocks round-trip byte-for-byte.

ok('a mid-sentence {fn} with multi-line note + source survives a real export → rebuild cycle', () => {
  const tok = footnoteToken({ note: 'finding one\nfinding two', source: 'https://a.org/x\nhttps://b.org/y\nReuters, 12 May' });
  const block = voBlock('the capital moved ' + tok + ' per records');
  assert.equal(rtText(block), block.text, 'the {fn} token round-trips inside the prose byte-for-byte');
});

ok('the rebuilt fcFootnote node recovers the REAL newlines (parse side, not a mirror)', () => {
  const note = 'finding one\nfinding two';
  const source = 'https://a.org/x\nhttps://b.org/y\nReuters, 12 May';
  const attrs = rebuiltFnAttrs(voBlock('claim ' + footnoteToken({ note, source })));
  assert.ok(attrs, 'a real fcFootnote node was rebuilt');
  assert.equal(attrs.note, note, 'multi-line NOTE rebuilds with its \\n intact');
  assert.equal(attrs.source, source, 'multi-line SOURCE list rebuilds one-per-line with \\n intact');
});

ok('a single-line {fn} (the common case) is untouched end-to-end', () => {
  const block = voBlock('a claim ' + footnoteToken({ note: 'plain note', source: 'https://x.org' }) + ' tail');
  assert.equal(rtText(block), block.text);
  const attrs = rebuiltFnAttrs(block);
  assert.equal(attrs.note, 'plain note');
  assert.equal(attrs.source, 'https://x.org');
});

console.log(`\nfootnote-fullscreen: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
