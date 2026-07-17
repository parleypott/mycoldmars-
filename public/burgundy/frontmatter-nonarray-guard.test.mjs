// Locks the NON-ARRAY paragraphs guard on the editable front-matter note in
// render() (public/burgundy/index.html). The BURGUNDY reader publishes a
// `book.frontmatter` note from the tool; render() shows it when the note has
// content:
//
//   if (fm && ((Array.isArray(fm.paragraphs) && fm.paragraphs.length)
//              || String(fm.title || '').trim())) { … }
//
// Bug fixed + locked here (regression latent in dd9d299 "render the published
// front-matter note"): the IF condition correctly array-checks fm.paragraphs,
// but the render BODY used the divergent-WEAKER `(fm.paragraphs || [])`. A
// corrupt / mid-edit publish where fm.title is set AND fm.paragraphs is a
// truthy NON-array (an object, a string, a number) satisfies the IF via the
// title clause, then `(fm.paragraphs || []).map(...)` throws a TypeError.
// render() runs OUTSIDE any try/catch, so a single bad publish bricks the
// ENTIRE reader on the "opening the book…" spinner — the exact class the
// burgundy hardening lineage already closed at the root/chapter/paragraph
// levels. Fix: `(Array.isArray(fm.paragraphs) ? fm.paragraphs : [])` — matches
// the IF guard, byte-identical for every well-formed array publish.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// ── 1. SOURCE LOCK: the fixed array-guard is present in render() ─────────────
ok(/\(Array\.isArray\(fm\.paragraphs\)\s*\?\s*fm\.paragraphs\s*:\s*\[\]\)\.map\(/.test(html),
  'render() must guard the front-matter paragraphs with Array.isArray(...) ? ... : []');
// the pre-fix weaker form must be gone
ok(!/\(fm\.paragraphs\s*\|\|\s*\[\]\)\.map\(/.test(html),
  'the divergent-weaker (fm.paragraphs || []).map form must not survive');

// ── 2. MODEL the render rule with a `fixed` toggle, proving the crash ────────
// mirrors the exact IF condition + body branch from render()
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mdInline = s => esc(s); // stand-in; the crash is in the array deref, not the formatter
function renderFrontMatter(fm, { fixed }) {
  if (fm && ((Array.isArray(fm.paragraphs) && fm.paragraphs.length) || String(fm.title || '').trim())) {
    const paras = fixed ? (Array.isArray(fm.paragraphs) ? fm.paragraphs : []) : (fm.paragraphs || []);
    return `<section>${String(fm.title || '').trim() ? `<div>${esc(fm.title)}</div>` : ''}` +
      paras.map(p => `<p>${mdInline(String(p ?? ''))}</p>`).join('') + `</section>`;
  }
  return '<section class="baked-in">…</section>';
}

// the crash inputs: title set, paragraphs a truthy NON-array
const crashCases = [
  { title: 'A Note', paragraphs: { 0: 'x' } },   // object
  { title: 'A Note', paragraphs: 'just a string' }, // string
  { title: 'A Note', paragraphs: 5 },             // number
  { title: 'A Note', paragraphs: true },          // boolean
];
for (const fm of crashCases) {
  assert.throws(() => renderFrontMatter(fm, { fixed: false }),
    `pre-fix (fm.paragraphs || []).map must throw on non-array paragraphs: ${JSON.stringify(fm.paragraphs)}`);
  pass++;
  assert.doesNotThrow(() => renderFrontMatter(fm, { fixed: true }),
    `fixed guard must not throw on non-array paragraphs: ${JSON.stringify(fm.paragraphs)}`);
  const out = renderFrontMatter(fm, { fixed: true });
  ok(out.includes('A Note') && !out.includes('<p>'), 'corrupt paragraphs render the title with zero note paras (no crash, no leak)');
}

// ── 3. byte-identical for a well-formed array publish ────────────────────────
const good = { title: 'What This Is', paragraphs: ['Line one.', 'Line two.'], sign: 'Johnny' };
const a = renderFrontMatter(good, { fixed: false });
const b = renderFrontMatter(good, { fixed: true });
ok(a === b, 'fixed and pre-fix forms are byte-identical on a well-formed array publish (zero regression)');
ok(b.includes('Line one.') && b.includes('Line two.'), 'both note paragraphs render');

// ── 4. empty/absent frontmatter falls back to the baked-in note ──────────────
for (const fm of [null, undefined, {}, { paragraphs: [] }, { title: '   ' }]) {
  const out = renderFrontMatter(fm, { fixed: true });
  ok(out.includes('baked-in'), `empty frontmatter ${JSON.stringify(fm)} falls back to the baked-in note`);
}

console.log(`frontmatter-nonarray-guard: ${pass} assertions passed`);
