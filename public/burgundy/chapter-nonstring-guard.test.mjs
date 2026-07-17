// Locks the NON-STRING title/paragraph guards in chapterHTML(), the per-chapter
// renderer of the BERGUNDY reader (public/burgundy/index.html). Extracted from
// the shipped HTML at runtime so a drift in index.html breaks this test.
//
// Bug fixed + locked here (regression from the 1930s-British typography commit
// ef2bb25): that commit added an asterism check `p.trim()` and a chapter-title
// scrubber `(c.title || '').replace(...)` — both calling STRING methods on the
// raw value. BERGUNDY is "a novel in progress"; a malformed / mid-edit publish
// can leave a NON-STRING paragraph element (null, a number, an object) or a
// non-string chapter title. `.trim()`/`.replace()` on that throws a TypeError,
// and chapterHTML runs inside render()'s forEach OUTSIDE any try/catch, so a
// SINGLE bad element bricks the ENTIRE reader on the "opening the book…" spinner.
// Everything USED to flow through esc() (which does String(s ?? '')) and was
// safe; the typography commit reintroduced the raw dereference the burgundy
// hardening lineage had already closed at every other level (root object,
// chapter entry, paragraphs array). The fix coerces title + each paragraph to a
// string first — byte-identical for every well-formed chapter.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');
const m = html.match(/function chapterHTML\(ch, ci, esc\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not extract chapterHTML() from index.html — did the function signature change?');
// chapterHTML now closes over the module-level mdInline() (the shared inline-format
// helper Johnny extracted in dd9d299) — extract it too so the source-locked eval
// resolves it. Both are pulled verbatim from index.html, so a drift in either breaks
// this test.
const md = html.match(/function mdInline\(s\)\s*\{[\s\S]*?\n\}/);
assert.ok(md, 'could not extract mdInline() from index.html — did the function signature change?');
const escSrc = `s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')`;
const chapterHTML = (0, eval)(`(function(){ const esc = ${escSrc}; ${md[0]} return ${m[0]}; })()`);

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// ── 1. non-string paragraph elements must NOT throw ──────────────────────────
for (const bad of [null, undefined, 5, 0, true, { p: 'x' }, ['a']]) {
  let out;
  assert.doesNotThrow(() => { out = chapterHTML({ title: 'A Chapter', paragraphs: ['real', bad, 'more'] }, 0, esc); },
    `chapterHTML threw on a non-string paragraph element: ${JSON.stringify(bad)}`);
  ok(/real/.test(out) && /more/.test(out), `well-formed neighbours still render around ${JSON.stringify(bad)}`);
}

// ── 2. non-string chapter TITLE must NOT throw ───────────────────────────────
for (const bad of [5, 0, true, { t: 'x' }, ['a']]) {
  assert.doesNotThrow(() => chapterHTML({ title: bad, paragraphs: ['body'] }, 0, esc),
    `chapterHTML threw on a non-string title: ${JSON.stringify(bad)}`);
  pass++;
}

// ── 3. byte-identical output for well-formed string data ─────────────────────
const good = chapterHTML({ title: 'Chapter 3: The Word', paragraphs: ['First para.', '* * *', 'Second.'] }, 2, esc);
ok(good.includes('Chapter III'), 'roman numeral for the chapter number');
ok(good.includes('The Word'), 'leading "chapter N:" scrubbed, remainder kept as title');
ok(good.includes('class="asterism"'), 'a "* * *" paragraph renders as an asterism scene break');
ok(good.includes('First para.') && good.includes('Second.'), 'ordinary paragraphs render verbatim');

// ── 4. mutation proof: the pre-fix raw-dereference forms DO throw ────────────
// (these reconstruct exactly what ef2bb25 shipped, to prove the guard is load-bearing)
const rawParaForm = (p) => /^[\s*·—-]{2,}$/.test(p.trim());
assert.throws(() => rawParaForm(null), 'pre-fix asterism check must throw on a non-string paragraph');
pass++;
const rawTitleForm = (t) => (t || '').replace(/^\s*chapter\s+/i, '');
assert.throws(() => rawTitleForm(5), 'pre-fix title scrubber must throw on a non-string title');
pass++;

console.log(`chapter-nonstring-guard: ${pass} assertions passed`);
