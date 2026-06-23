// Lock for the Westchester House Hunter's TWO LLM-output -> innerHTML markdown
// render boundaries (public/westchester/index.html), on Johnny's ACTIVE house hunt:
//
//   renderMd(s)              -> the AGENT-CHAT bubble renderer (line ~8901). Strips a
//                               trailing [REMEMBER: ...] line, then escapeHtml()s the
//                               content and applies **bold** / `code` / \n->br. Its
//                               output is assigned into the agent-chat innerHTML.
//   renderModalMarkdown(s)   -> the GENERATE-MODAL renderer (line ~8266) for the
//                               Claude-generated district overview / decision narrative.
//                               Escapes [&<>], then renders ### headings / **bold** /
//                               *italic* / - lists / paragraphs into the modal innerHTML.
//
// Both consume the LEAST-trusted content in the tool (Claude/agent output), and both
// land in innerHTML -- so the escape is the load-bearing XSS+correctness boundary.
// Neither was covered (escapeHtml was flagged untested despite its security role, obs
// 4142). NO live bug -- the escape-first ordering is correct in both -- so this is a
// verifier-layer LOCK, not a fix. ZERO source change: EXTRACTS the real shipped
// functions from index.html at runtime (brace-match + new Function) so the lock can't
// drift from a hand-copied mirror.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, '..', 'public', 'westchester', 'index.html');
const html = readFileSync(HTML_PATH, 'utf8');

// Brace-match a `function NAME(` body out of the source.
function fnSrc(src, name) {
  const s = src.indexOf('function ' + name + '(');
  assert.ok(s >= 0, 'function not found: ' + name);
  let i = src.indexOf('{', s), d = 0, e = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) { e = i + 1; break; } }
  }
  assert.ok(e > 0, 'could not brace-match: ' + name);
  return src.slice(s, e);
}

const ESC_SRC = fnSrc(html, 'escapeHtml');
const MD_SRC = fnSrc(html, 'renderMd');
const MODAL_SRC = fnSrc(html, 'renderModalMarkdown');

// Build a live {escapeHtml, renderMd, renderModalMarkdown} from (possibly mutated)
// function sources. renderMd references escapeHtml; renderModalMarkdown is self-contained.
function build(escSrc = ESC_SRC, mdSrc = MD_SRC, modalSrc = MODAL_SRC) {
  return new Function(
    `${escSrc}\n${mdSrc}\n${modalSrc}\n` +
    `return { escapeHtml, renderMd, renderModalMarkdown };`
  )();
}

const R = build();

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗', name); } }
function eq(name, a, b) { ok(name + ` (got ${JSON.stringify(a)})`, a === b); }

// ───────── inline RED proofs: the escape boundary is load-bearing ─────────
// An UN-escaped renderMd (the bug if someone drops escapeHtml) would pass a hostile
// LLM reply straight into the chat innerHTML as a live element.
{
  const hostile = '<img src=x onerror=alert(1)>';
  const oldMd = (s) => String(s || '')   // reconstruct renderMd WITHOUT the escape
    .replace(/\[REMEMBER:\s*.+?\]\s*$/m, '').trim()
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
  ok('RED proof: un-escaped renderMd LEAKS a live <img', /<img\b/i.test(oldMd(hostile)));
  ok('RED proof: shipped renderMd neutralizes the <img', !/<img\b/i.test(R.renderMd(hostile)));

  const oldModal = (s) => '<p>' + String(s || '') + '</p>'; // no [&<>] escape
  ok('RED proof: un-escaped modal LEAKS a live <script', /<script\b/i.test(oldModal('<script>x</script>')));
  ok('RED proof: shipped modal neutralizes the <script', !/<script\b/i.test(R.renderModalMarkdown('<script>x</script>')));
}

// ───────── renderMd: XSS escape boundary ─────────
ok('renderMd: <script> neutralized', !/<script\b/i.test(R.renderMd('<script>alert(1)</script>')));
ok('renderMd: raw < escaped to &lt;', R.renderMd('a < b').includes('&lt;'));
ok('renderMd: raw > escaped to &gt;', R.renderMd('a > b').includes('&gt;'));
ok('renderMd: raw & escaped to &amp;', R.renderMd('Tom & Jerry').includes('&amp;'));
ok('renderMd: " escaped to &quot;', R.renderMd('say "hi"').includes('&quot;'));
ok("renderMd: ' escaped to &#39;", R.renderMd("it's").includes('&#39;'));
// escape-FIRST ordering: markdown wraps already-escaped content, never a live tag.
{
  const out = R.renderMd('**<img src=x onerror=alert(1)>**');
  ok('renderMd: escape-first wraps a hostile bold in <strong>', out.includes('<strong>'));
  ok('renderMd: escape-first leaks NO raw <img', !/<img\b/i.test(out));
  ok('renderMd: escape-first escaped the inner <', out.includes('&lt;img'));
}

// ───────── renderMd: markdown correctness ─────────
eq('renderMd: **bold** -> <strong>', R.renderMd('Hello **world**'), 'Hello <strong>world</strong>');
eq('renderMd: `code` -> <code>', R.renderMd('run `npm i` now'), 'run <code>npm i</code> now');
eq('renderMd: \\n -> <br>', R.renderMd('line1\nline2'), 'line1<br>line2');
eq('renderMd: plain text passthrough', R.renderMd('just words'), 'just words');
// strips a trailing [REMEMBER: ...] line (the agent's memory directive, not shown).
eq('renderMd: trailing [REMEMBER] stripped', R.renderMd('keep this\n[REMEMBER: budget is 2M]'), 'keep this');
ok('renderMd: [REMEMBER] strip leaves no bracket', !R.renderMd('a\n[REMEMBER: x]').includes('REMEMBER'));
eq('renderMd: null -> ""', R.renderMd(null), '');
eq('renderMd: undefined -> ""', R.renderMd(undefined), '');
eq('renderMd: empty -> ""', R.renderMd(''), '');
ok('renderMd: no double-escape of & in **bold**', R.renderMd('**A & B**') === '<strong>A &amp; B</strong>');

// ───────── renderModalMarkdown: XSS escape boundary ─────────
ok('modal: <script> neutralized', !/<script\b/i.test(R.renderModalMarkdown('<script>alert(1)</script>')));
ok('modal: raw < escaped', R.renderModalMarkdown('a < b').includes('&lt;'));
ok('modal: raw > escaped', R.renderModalMarkdown('a > b').includes('&gt;'));
ok('modal: raw & escaped', R.renderModalMarkdown('Tom & Jerry').includes('&amp;'));
{
  const out = R.renderModalMarkdown('**<b>hi</b>**');
  ok('modal: escape-first wraps hostile bold in <strong>', out.includes('<strong>'));
  ok('modal: escape-first leaks NO raw <b>', !/<b>/i.test(out));
}

// ───────── renderModalMarkdown: markdown correctness ─────────
eq('modal: ### -> <h3>', R.renderModalMarkdown('### Overview'), '<h3>Overview</h3>');
ok('modal: **bold** -> <strong>', R.renderModalMarkdown('**weighty** point').includes('<strong>weighty</strong>'));
ok('modal: *italic* -> <em>', R.renderModalMarkdown('an *aside* here').includes('<em>aside</em>'));
ok('modal: bold beats italic (no stray <em> inside **)', R.renderModalMarkdown('**bold**').includes('<strong>bold</strong>'));
{
  const out = R.renderModalMarkdown('- one\n- two');
  ok('modal: list opens <ul>', out.includes('<ul>'));
  ok('modal: list items -> <li>', out.includes('<li>one</li>') && out.includes('<li>two</li>'));
  ok('modal: list closes </ul>', out.includes('</ul>'));
}
ok('modal: bullet • also a list item', R.renderModalMarkdown('• dot').includes('<li>dot</li>'));
{
  // list-before-heading: the <ul> must close before the <h3> (the code's explicit guard).
  const out = R.renderModalMarkdown('- item\n### After');
  const ulClose = out.indexOf('</ul>');
  const h3 = out.indexOf('<h3>After</h3>');
  ok('modal: heading after a list closes the <ul> first', ulClose >= 0 && h3 >= 0 && ulClose < h3);
}
{
  const out = R.renderModalMarkdown('Para one.\n\nPara two.');
  ok('modal: blank-line separated paragraphs both wrap <p>',
     (out.match(/<p>/g) || []).length === 2);
}
eq('modal: null -> ""', R.renderModalMarkdown(null), '');
eq('modal: undefined -> ""', R.renderModalMarkdown(undefined), '');
eq('modal: empty -> ""', R.renderModalMarkdown(''), '');

// ───────── divergent-copy note: both are markdown renderers but they DIVERGE by
// design (renderMd: 5-entity escapeHtml + code; modal: 3-entity + headings/lists).
// Both land in TEXT context (no attribute built from content), so the modal's
// 3-entity escape is sufficient. Lock that both neutralize a live tag identically. ─────────
ok('both: neither renderer leaks a live <script>',
   !/<script\b/i.test(R.renderMd('<script>a</script>')) &&
   !/<script\b/i.test(R.renderModalMarkdown('<script>a</script>')));

// ───────── MUTATION proofs: the lock has teeth (mutate the extracted source,
// rebuild, confirm the relevant assertion goes RED). index.html on disk untouched. ─────────
let mutCaught = 0;
// M1: drop escapeHtml() in renderMd -> hostile <img survives.
try {
  const M = build(ESC_SRC, MD_SRC.replace('escapeHtml(cleaned)', '(cleaned)'), MODAL_SRC);
  const leaks = /<img\b/i.test(M.renderMd('<img src=x onerror=alert(1)>'));
  ok('MUT M1: dropping escapeHtml in renderMd is detectable', leaks); if (leaks) mutCaught++;
} catch (e) { console.error('M1 mutate failed', e.message); fail++; }
// M2: defeat the `<` escape in renderModalMarkdown (map '<' -> '<') -> hostile <script survives.
try {
  const broken = MODAL_SRC.replace("'<':'&lt;'", "'<':'<'");
  ok('MUT M2 precondition: escape map was found+mutated', broken !== MODAL_SRC);
  const M = build(ESC_SRC, MD_SRC, broken);
  const leaks = /<script\b/i.test(M.renderModalMarkdown('<script>x</script>'));
  ok('MUT M2: defeating the modal `<` escape is detectable', leaks); if (leaks) mutCaught++;
} catch (e) { console.error('M2 mutate failed', e.message); fail++; }
// M3: break modal bold (drop the <strong> wrap) -> ** survives literally.
try {
  const M = build(ESC_SRC, MD_SRC, MODAL_SRC.replace('<strong>$1</strong>', '$1'));
  const broken = !M.renderModalMarkdown('**bold**').includes('<strong>');
  ok('MUT M3: breaking modal bold is detectable', broken); if (broken) mutCaught++;
} catch (e) { console.error('M3 mutate failed', e.message); fail++; }
// M4: break renderMd code (drop the <code> wrap) -> backticks survive literally.
try {
  const M = build(ESC_SRC, MD_SRC.replace('<code>$1</code>', '$1'), MODAL_SRC);
  const broken = !M.renderMd('run `x` now').includes('<code>');
  ok('MUT M4: breaking renderMd code is detectable', broken); if (broken) mutCaught++;
} catch (e) { console.error('M4 mutate failed', e.message); fail++; }

ok('MUTATION: all 4 source mutations detected', mutCaught === 4);

console.log(`\nwestchester-markdown: ${pass} passed, ${fail} failed (mutations caught: ${mutCaught}/4)`);
if (fail > 0) process.exit(1);
