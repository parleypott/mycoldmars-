// Locks the FOLIO page-number core of the BURGUNDY reader
// (public/burgundy/index.html): buildFolio() + setFolio(), the "real book
// page" feature added in commit 29a708e. Extracted from the shipped HTML at
// runtime so a drift in index.html breaks this test.
//
// WHY THIS IS LOAD-BEARING: the folio prints a page number (one page = 250
// words, the trade-book standard) and Johnny's stated contract is that "page
// 217 means the same prose here, in the writing tool, and in any future
// print." So the per-paragraph page number MUST agree with a standard
// word/page estimator (ceil), and it must never exceed the book's total page
// count. This test pins that contract.
//
// THE BUG THIS FIXES (found iter #3, 2026-07-15): the per-paragraph page used
// `Math.floor(cum / 250) + 1` while FOLIO_TOTAL uses `Math.ceil(cum / 250)`.
// Those two formulas DIVERGE at exact 250-word boundaries: a paragraph ending
// at cumulative word 500 got floor(500/250)+1 = 3 (should be page 2 — words
// 251..500 are page 2), i.e. bumped one page early; and for a book totaling
// exactly N*250 words the LAST paragraph got bookpage N+1 while FOLIO_TOTAL
// stayed N, so the folio read "page N+1 of N". The fix makes the per-paragraph
// formula identical to FOLIO_TOTAL's: Math.max(1, Math.ceil(cum / 250)).
//
// Contract locked here:
//  - FOLIO_WPP is exactly 250 (the cross-surface trade standard).
//  - buildFolio: cumulative word count; a paragraph's bookpage = the page its
//    LAST word sits on = max(1, ceil(cumSoFar/250)); empty/whitespace
//    paragraphs add 0 words (the `if (t)` guard) but still get a bookpage.
//  - INVARIANT: no paragraph's bookpage ever exceeds FOLIO_TOTAL — the last
//    paragraph's bookpage EQUALS FOLIO_TOTAL (never "page N+1 of N").
//  - setFolio: null/no-bookpage -> hidden; otherwise unhidden, "· N ·" text,
//    and a "page N of TOTAL" title.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

// --- pull FOLIO_WPP straight from source (lock the constant) --------------
const mWpp = html.match(/^const FOLIO_WPP = (\d+);/m);
assert.ok(mWpp, 'could not extract FOLIO_WPP — did the constant move/rename?');
const FOLIO_WPP = Number(mWpp[1]);
assert.equal(FOLIO_WPP, 250, 'FOLIO_WPP must be 250 (the trade word/page standard — Johnnys cross-surface page-number contract)');

// --- slice buildFolio() + setFolio() verbatim ----------------------------
const mBuild = html.match(/function buildFolio\(\)\s*\{[\s\S]*?\n\}/);
const mSet = html.match(/function setFolio\(p\)\s*\{[\s\S]*?\n\}/);
assert.ok(mBuild, 'could not extract buildFolio() — did the signature change?');
assert.ok(mSet, 'could not extract setFolio() — did the signature change?');

// buildFolio reads FOLIO_WPP (global), assigns FOLIO_TOTAL (global), reads document.
globalThis.FOLIO_WPP = FOLIO_WPP;
globalThis.FOLIO_TOTAL = 1;
const buildFolio = (0, eval)('(' + mBuild[0] + ')');
// setFolio references $ (element getter) and FOLIO_TOTAL as free globals.
const setFolio = (0, eval)('(' + mSet[0] + ')');

// --- mock DOM ------------------------------------------------------------
const mkPara = (text) => ({ dataset: {}, textContent: text });
// a front-matter (prologue) paragraph — carries data-key for annotation but
// must be excluded from the folio count.
const mkProl = (text) => ({ dataset: {}, textContent: text, prologue: true });
function setParas(paras) {
  globalThis.document = {
    querySelectorAll(sel) {
      assert.equal(sel, '.chapter:not(.prologue) p[data-key]', 'buildFolio selector drifted (must exclude the .prologue front matter)');
      return paras.slice();
    },
  };
}
// mock that HONORS the shipped selector's `:not(.prologue)` filter, so a revert
// of index.html back to `.chapter p[data-key]` changes the paragraphs buildFolio
// sees and turns the front-matter-exclusion assertions RED.
function setMixedParas(paras) {
  globalThis.document = {
    querySelectorAll(sel) {
      const excludeProl = sel.includes(':not(.prologue)');
      return paras.filter((p) => !(excludeProl && p.prologue));
    },
  };
}
// N-word paragraph helper (N single-char words joined by spaces).
const words = (n) => Array.from({ length: n }, () => 'x').join(' ');

// ------------------------------------------------------------------------
// 1. The boundary case — a paragraph ending EXACTLY on a page boundary stays
//    on the page it just filled (the bug labeled it one page early).
// ------------------------------------------------------------------------
{
  const p1 = mkPara(words(250)); // fills page 1 exactly
  const p2 = mkPara(words(250)); // fills page 2 exactly
  const p3 = mkPara(words(10));  // spills onto page 3
  setParas([p1, p2, p3]);
  buildFolio();
  assert.equal(p1.dataset.bookpage, 1, 'a paragraph ending at word 250 is on page 1 (was 2 under floor+1)');
  assert.equal(p2.dataset.bookpage, 2, 'a paragraph ending at word 500 is on page 2 (was 3 under floor+1)');
  assert.equal(p3.dataset.bookpage, 3, 'the paragraph carrying words 501+ is on page 3');
  assert.equal(globalThis.FOLIO_TOTAL, 3, 'total pages = ceil(510/250) = 3');
  // THE INVARIANT the bug violated: no bookpage exceeds the total.
  assert.ok(p1.dataset.bookpage <= globalThis.FOLIO_TOTAL);
  assert.ok(p2.dataset.bookpage <= globalThis.FOLIO_TOTAL);
  assert.ok(p3.dataset.bookpage <= globalThis.FOLIO_TOTAL);
}

// ------------------------------------------------------------------------
// 2. "page N+1 of N" — a book totaling EXACTLY N*250 words: the last
//    paragraph's bookpage must EQUAL the total, never exceed it.
// ------------------------------------------------------------------------
{
  const last = mkPara(words(250));
  setParas([mkPara(words(250)), mkPara(words(250)), last]); // exactly 750 = 3*250
  buildFolio();
  assert.equal(globalThis.FOLIO_TOTAL, 3, 'total = ceil(750/250) = 3');
  assert.equal(last.dataset.bookpage, 3, 'last paragraph is "page 3 of 3", NOT "page 4 of 3"');
  assert.equal(last.dataset.bookpage, globalThis.FOLIO_TOTAL, 'last page label equals the total');
}

// ------------------------------------------------------------------------
// 3. Non-boundary counts — byte-identical to the old floor+1 form (regression
//    guard: the fix must ONLY change exact-multiple-of-250 boundaries).
// ------------------------------------------------------------------------
{
  const p1 = mkPara(words(1));    // cum 1   -> page 1
  const p2 = mkPara(words(248));  // cum 249 -> page 1
  const p3 = mkPara(words(2));    // cum 251 -> page 2 (first word of page 2)
  const p4 = mkPara(words(300));  // cum 551 -> page 3
  setParas([p1, p2, p3, p4]);
  buildFolio();
  assert.equal(p1.dataset.bookpage, 1);
  assert.equal(p2.dataset.bookpage, 1, 'word 249 is still page 1');
  assert.equal(p3.dataset.bookpage, 2, 'word 251 is the first word of page 2');
  assert.equal(p4.dataset.bookpage, 3, 'word 551 is on page 3');
  // For every one of these (cum not a multiple of 250), floor(cum/250)+1 === ceil(cum/250),
  // so the fix left them unchanged.
}

// ------------------------------------------------------------------------
// 4. Empty / whitespace paragraphs add 0 words but still get a bookpage.
// ------------------------------------------------------------------------
{
  const blank = mkPara('   ');
  const real = mkPara(words(10));
  setParas([blank, real]);
  buildFolio();
  assert.equal(blank.dataset.bookpage, 1, 'a blank leading paragraph is page 1');
  assert.equal(real.dataset.bookpage, 1, '10 words -> still page 1');
  assert.equal(globalThis.FOLIO_TOTAL, 1);
}

// ------------------------------------------------------------------------
// 5. Empty book -> FOLIO_TOTAL floors at 1 (never 0).
// ------------------------------------------------------------------------
{
  setParas([]);
  buildFolio();
  assert.equal(globalThis.FOLIO_TOTAL, 1, 'no paragraphs -> total is 1, not 0');
}

// ------------------------------------------------------------------------
// 5b. FRONT MATTER IS NOT COUNTED (regression fix, iter #29, 2026-07-18).
//     Commit 7e03e59 made the prologue (Johnny's front-matter note) annotatable
//     by giving its paragraphs data-key. That pulled the note into buildFolio's
//     `.chapter p[data-key]` count, inflating EVERY chapter's page number by the
//     note's word count and breaking the cross-surface page contract. The fix
//     scopes the selector to `.chapter:not(.prologue) p[data-key]` (mirroring
//     flatParas). This block proves the front matter no longer shifts the pages —
//     and, via setMixedParas honoring the shipped selector, a revert goes RED.
// ------------------------------------------------------------------------
{
  const fm0 = mkProl(words(250)); // Johnny's note — ~one page of front matter
  const fm1 = mkProl(words(120));
  const ch1 = mkPara(words(10));  // first real chapter paragraph
  const ch2 = mkPara(words(300)); // rest of chapter 1
  setMixedParas([fm0, fm1, ch1, ch2]);
  buildFolio();
  // chapter 1 opens on page 1 — NOT page 2/3, which is where 370 words of front
  // matter would have pushed it under the buggy selector.
  assert.equal(ch1.dataset.bookpage, 1, 'front matter must NOT push chapter 1 off page 1 — folio counts manuscript prose only');
  assert.equal(ch2.dataset.bookpage, 2, 'chapter prose paginates from word 1 (cum 310 -> page 2), front matter excluded');
  assert.equal(globalThis.FOLIO_TOTAL, 2, 'total counts chapter prose only (310 words -> 2 pages), not the 370 front-matter words');
  // the excluded front-matter paragraphs never receive a bookpage, so setFolio
  // keeps the folio bare while the reader is in the note.
  assert.equal(fm0.dataset.bookpage, undefined, 'a front-matter paragraph gets no bookpage (folio hidden there)');
  assert.equal(fm1.dataset.bookpage, undefined, 'a front-matter paragraph gets no bookpage (folio hidden there)');
}

// ------------------------------------------------------------------------
// 6. setFolio display contract.
// ------------------------------------------------------------------------
{
  let cls = new Set(['hidden']);
  const el = {
    textContent: '', title: '',
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) },
  };
  globalThis.$ = (id) => (id === 'folio' ? el : null);
  globalThis.FOLIO_TOTAL = 42;

  // (a) null paragraph -> hidden, no text written.
  setFolio(null);
  assert.ok(cls.has('hidden'), 'null paragraph hides the folio');

  // (b) paragraph with no bookpage (title/front matter) -> hidden.
  setFolio({ dataset: {} });
  assert.ok(cls.has('hidden'), 'a paragraph with no bookpage hides the folio (front matter stays bare)');

  // (c) real paragraph -> unhidden, "· N ·", "page N of TOTAL" title.
  setFolio({ dataset: { bookpage: 17 } });
  assert.ok(!cls.has('hidden'), 'a real paragraph unhides the folio');
  assert.equal(el.textContent, '· 17 ·', 'folio shows the centered-dot page number');
  assert.equal(el.title, 'page 17 of 42 — a page is 250 words', 'title shows page of total');
}

console.log('folio-page-math: all folio page-number assertions passed');
