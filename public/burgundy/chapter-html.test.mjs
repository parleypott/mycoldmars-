// Locks chapterHTML(), the per-chapter renderer of the BERGUNDY reader
// (public/burgundy/index.html). Extracted from the shipped HTML at runtime so a
// drift in index.html breaks this test.
//
// Bug fixed + locked here: render() built each chapter with a bare
// `ch.paragraphs.map(...)`. BERGUNDY is "a novel in progress" that Johnny keeps
// adding chapters to; a chapter drafted with a title but no paragraphs array yet
// (or a malformed/legacy book.json where paragraphs is null/a string) made
// `.map` throw a TypeError. render() is called OUTSIDE any try/catch, so that
// single crash stranded the ENTIRE reader on the "opening the book…" spinner —
// no chapters, no notes, nothing. The `Array.isArray(ch.paragraphs) ? … : []`
// guard renders such a chapter's heading with an empty body instead of crashing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');
const m = html.match(/function chapterHTML\(ch, ci, esc\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not extract chapterHTML() from index.html — did the function signature change?');
const chapterHTML = (0, eval)('(' + m[0] + ')');

// A minimal esc mirroring the reader's (enough to prove escaping is applied).
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The pre-fix form, kept here to PROVE the test is load-bearing: this is exactly
// what the shipped render() did before the guard.
function buggyChapterHTML(ch, ci, esc) {
  return `<section class="chapter" data-ch="${ci}">
      <div class="ch-head">
        <div class="ch-num">chapter ${ci + 1}</div>
        <div class="ch-title">${esc(ch.title || '')}</div>
        <div class="ch-rule"></div>
      </div>
      ${ch.paragraphs.map((p, pi) => `<p data-key="${ci}:${pi}">${esc(p)}</p>`).join('')}
    </section>`;
}

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };

// 1. Well-formed chapter renders every paragraph with the right data-key.
{
  const out = chapterHTML({ title: 'The Basement', paragraphs: ['one', 'two'] }, 0, esc);
  ok(out.includes('<p data-key="0:0">one</p>'), 'first paragraph rendered with key 0:0');
  ok(out.includes('<p data-key="0:1">two</p>'), 'second paragraph rendered with key 0:1');
  ok(out.includes('chapter 1'), 'chapter number is 1-based');
  ok(out.includes('The Basement'), 'chapter title rendered');
}

// 2. Byte-identical to the pre-fix form for a well-formed chapter (zero regression).
{
  const ch = { title: "Mira's wing", paragraphs: ['a', 'b', 'c'] };
  eq(chapterHTML(ch, 2, esc), buggyChapterHTML(ch, 2, esc), 'guarded form matches old output on well-formed chapter');
}

// 3. THE BUG: a chapter drafted with a title but NO paragraphs array.
//    Fixed form renders the heading with an empty body; old form THREW.
{
  const drafting = { title: 'Chapter 5 (drafting)' };
  let out;
  assert.doesNotThrow(() => { out = chapterHTML(drafting, 4, esc); },
    'FIXED: a paragraphs-less chapter does not crash render()'); pass++;
  ok(out.includes('Chapter 5 (drafting)'), 'drafting chapter still shows its title');
  ok(!out.includes('<p data-key'), 'drafting chapter renders no paragraph nodes');
  assert.throws(() => buggyChapterHTML(drafting, 4, esc), TypeError,
    'MUTATION PROOF: pre-fix form threw TypeError on the same input'); pass++;
}

// 4. Malformed/legacy paragraphs values (null, string, object) never throw.
for (const bad of [null, 'a whole chapter as one string', { 0: 'x' }, 42]) {
  let out;
  assert.doesNotThrow(() => { out = chapterHTML({ title: 'T', paragraphs: bad }, 0, esc),
    `paragraphs=${JSON.stringify(bad)} does not throw`; }); pass++;
  ok(!out.includes('<p data-key'), `paragraphs=${JSON.stringify(bad)} yields no paragraph nodes`);
}

// 4b. THE ENTRY ITSELF is null/non-object — a malformed publish leaving a hole
//     in the chapters array. render() does chapters.forEach(ch => chapterHTML(ch,…)),
//     with NO try/catch, so a single null entry (ch.paragraphs → TypeError) bricked
//     the WHOLE reader. The `ch && typeof ch === 'object' ? ch : {}` coercion renders
//     an empty chapter shell instead, so the rest of the book still renders.
for (const badCh of [null, undefined, 42, 'a bare string chapter', true]) {
  let out;
  assert.doesNotThrow(() => { out = chapterHTML(badCh, 3, esc); },
    `FIXED: chapter entry = ${JSON.stringify(badCh)} does not crash render()`); pass++;
  ok(out.includes('chapter 4'), `null-entry ${JSON.stringify(badCh)} still renders its 1-based number`);
  ok(!out.includes('<p data-key'), `null-entry ${JSON.stringify(badCh)} yields no paragraph nodes`);
  ok(out.includes('<div class="ch-title"></div>'), `null-entry ${JSON.stringify(badCh)} renders empty title, not "undefined"`);
}
// MUTATION PROOF: the pre-fix form (bare ch.paragraphs / ch.title) threw on a null entry.
assert.throws(() => buggyChapterHTML(null, 3, esc), TypeError,
  'MUTATION PROOF: pre-fix form threw TypeError on a null chapter entry'); pass++;

// 5. Paragraph text is HTML-escaped (author content is untrusted-shaped).
{
  const out = chapterHTML({ title: 'X', paragraphs: ['<script>alert(1)</script>'] }, 0, esc);
  ok(out.includes('&lt;script&gt;'), 'paragraph text is escaped');
  ok(!out.includes('<script>alert(1)'), 'no raw script tag leaks');
}

// 6. Missing title falls back to empty (guarded by esc(ch.title || '')).
{
  const out = chapterHTML({ paragraphs: ['body'] }, 0, esc);
  ok(out.includes('<div class="ch-title"></div>'), 'missing title renders empty, not "undefined"');
}

console.log(`chapter-html.test.mjs: ${pass} assertions passed`);
