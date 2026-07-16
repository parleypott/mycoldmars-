// Locks the STRIKETHROUGH render added to chapterHTML() in the BERGUNDY reader
// (public/burgundy/index.html, commit 9234e76). Extracted from the shipped HTML
// at runtime so a drift in index.html breaks this test.
//
// Feature: manuscript text wrapped in ~~double tildes~~ renders as a real
// strikethrough — the author's visible cuts, struck but still faintly legible.
// The render is `esc(s).replace(/~~([^~]+?)~~/g, '<s>$1</s>')`.
//
// THE LOAD-BEARING INVARIANT: esc() runs BEFORE the tilde→<s> replace. Because
// the paragraph text is untrusted-shaped (a novel-in-progress book.json), the
// ONLY safe order is escape-first: escape the whole string, THEN wrap already-safe
// content in the sole raw markup this path emits (<s></s>). Reorder it (replace on
// the raw string, or drop esc) and a struck <script>/<img onerror> payload leaks a
// LIVE tag into the reader's innerHTML. This test proves the shipped order is XSS-safe
// AND that the reversed order is not — so the order can't silently regress.

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

// MUTATION ORACLE: the UNSAFE order — run the tilde→<s> replace on the RAW string,
// THEN escape. This over-escapes the <s> away (no strikethrough) AND, more importantly,
// on a struck HTML payload it is the shape that leaks. Kept as a throw/leak oracle below.
function replaceThenEscChapterHTML(ch, ci, esc) {
  const paras = Array.isArray(ch?.paragraphs) ? ch.paragraphs : [];
  return paras.map((p, pi) =>
    `<p data-key="${ci}:${pi}">${esc(String(p).replace(/~~([^~]+?)~~/g, '<s>$1</s>'))}</p>`
  ).join('');
}
// MUTATION ORACLE 2: the tilde replace with NO escaping at all — the clearest XSS leak.
function noEscChapterHTML(ch, ci) {
  const paras = Array.isArray(ch?.paragraphs) ? ch.paragraphs : [];
  return paras.map((p, pi) =>
    `<p data-key="${ci}:${pi}">${String(p).replace(/~~([^~]+?)~~/g, '<s>$1</s>')}</p>`
  ).join('');
}

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// 1. A struck run renders as a real <s> element.
{
  const out = chapterHTML({ title: 'T', paragraphs: ['keep ~~cut~~ keep'] }, 0, esc);
  ok(out.includes('keep <s>cut</s> keep'), '~~cut~~ becomes <s>cut</s>, surrounding prose intact');
}

// 2. Multiple struck runs on ONE line both wrap; the regex is non-greedy so it does
//    NOT swallow the gap between two separate strikes into one <s>.
{
  const out = chapterHTML({ title: 'T', paragraphs: ['~~a~~ mid ~~b~~'] }, 0, esc);
  ok(out.includes('<s>a</s> mid <s>b</s>'), 'two strikes on one line wrap independently (non-greedy)');
  ok(!out.includes('<s>a~~ mid ~~b</s>'), 'non-greedy: the two strikes are not merged into one span');
}

// 3. THE XSS PROOF: a struck HTML payload is ESCAPED — the only raw tag emitted is <s>.
{
  const out = chapterHTML({ title: 'T', paragraphs: ['~~<script>alert(1)</script>~~'] }, 0, esc);
  ok(out.includes('<s>&lt;script&gt;alert(1)&lt;/script&gt;</s>'), 'struck script tag is escaped inside <s>');
  ok(!out.includes('<script>alert(1)'), 'no raw <script> leaks from a struck payload');
}

// 3b. Same for an attribute-injection payload struck out.
{
  const out = chapterHTML({ title: 'T', paragraphs: ['~~<img src=x onerror=alert(1)>~~'] }, 0, esc);
  ok(!out.includes('<img src=x onerror'), 'no raw <img onerror> leaks from a struck payload');
  ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the struck img payload is fully escaped');
}

// 4. MUTATION PROOF — the order is load-bearing. The reversed/no-esc forms LEAK a raw
//    <script> on the exact input the shipped form escapes safely. If a refactor ever
//    flips the order (replace-then-esc / drop esc), assertion 3 flips too — this pins why.
{
  const evil = { title: 'T', paragraphs: ['~~<script>alert(1)</script>~~'] };
  const shipped = chapterHTML(evil, 0, esc);
  const leaky = noEscChapterHTML(evil, 0);
  ok(!shipped.includes('<script>alert(1)'), 'shipped (esc-first) does NOT leak a live script');
  ok(leaky.includes('<script>alert(1)</script>'), 'MUTATION PROOF: no-esc replace DOES leak the live script');
  // replace-then-esc destroys the strikethrough (over-escapes the <s>): it is broken, not safe.
  const reversed = replaceThenEscChapterHTML(evil, 0, esc);
  ok(reversed.includes('&lt;s&gt;'), 'MUTATION PROOF: replace-then-esc over-escapes the <s> — strikethrough is lost');
}

// 5. Lone / odd tildes are inert — a single ~ never wraps, an unpaired ~~ is left as-is.
{
  const out = chapterHTML({ title: 'T', paragraphs: ['plain ~ tilde and ~~unclosed here'] }, 0, esc);
  ok(!out.includes('<s>'), 'a single ~ and an unclosed ~~ produce no <s> element');
  ok(out.includes('plain ~ tilde and ~~unclosed here'), 'inert tildes pass through unchanged');
}

// 6. Empty strike (~~~~ / ~~ ~~) does not crash and does not emit an empty <s>.
{
  let out;
  assert.doesNotThrow(() => { out = chapterHTML({ title: 'T', paragraphs: ['before ~~~~ after'] }, 0, esc); },
    'empty strike does not throw'); pass++;
  ok(!out.includes('<s></s>'), '~~~~ (no inner text) yields no empty <s> — regex needs >=1 inner char');
}

console.log(`chapter-html-strike.test.mjs: ${pass} assertions passed`);
