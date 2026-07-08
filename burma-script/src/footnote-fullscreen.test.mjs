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
import { footnoteToken } from './document-builder.js';
import { stripClaimBraces, assertionText } from './extensions/footnote.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

// mirror the isFn decode exactly (document-builder inlineContent branch)
const decodeFn = (tok) => {
  const inner = tok.replace(/^\{\s*fn\s*/i, '').replace(/\}$/, '');
  const sep = inner.indexOf('||');
  const NL = /\s*∥\s*/g;
  return {
    note: (sep >= 0 ? inner.slice(0, sep) : inner).trim().replace(NL, '\n'),
    source: (sep >= 0 ? inner.slice(sep + 2) : '').trim().replace(NL, '\n'),
  };
};

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

console.log(`\nfootnote-fullscreen: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
