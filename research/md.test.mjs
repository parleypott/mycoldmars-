// Locks the research tool's markdown -> HTML render boundary. mdToHtml renders
// LLM RESEARCH-REPORT prose (Claude / Gemini / OpenAI output that may quote or
// summarise adversarial web pages — the least-trusted content in the app) and
// its result is assigned straight into innerHTML at both call sites in app.js.
// esc() neutralises raw tags, but the markdown LINK transform was the sharp
// edge: the captured URL flowed unescaped into an href attribute with no scheme
// check. Two real XSS gaps lived there before this fix:
//   (1) no scheme whitelist -> a `javascript:` / `data:` link rendered a LIVE href
//   (2) the URL was not quote-escaped -> a `"` broke out of the href attribute
//       and injected an event handler (onmouseover=...)
// This test imports the REAL shipped functions and is mutation-proven: revert
// either guard in research/md.js and a case below goes RED.
//
// Run: node research/md.test.mjs   (or via `bun run test`)

import { mdToHtml, safeHref, esc } from './md.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); } }
function eq(a, b, name) { ok(a === b, `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ── RED PROOF: reconstruct the OLD shipped link transform and show both holes ──
// The old line was:
//   html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
//     '<a href="$2" target="_blank" rel="noopener">$1</a>')
function oldMd(md) {
  if (!md) return '';
  const oesc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let h = oesc(md);
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return h;
}
const jsAttack = '[click me](javascript:alert(1))';
const attrAttack = '[x](http://e.com" onmouseover="alert(1))';
// The old renderer produced a LIVE javascript: href and an injected handler.
ok(/href="javascript:/.test(oldMd(jsAttack)), 'RED PROOF: old renderer emits a live javascript: href');
ok(/onmouseover=/.test(oldMd(attrAttack)), 'RED PROOF: old renderer lets a quote break out and inject onmouseover');
// The shipped (new) renderer neutralises BOTH.
ok(!/href="javascript:/.test(mdToHtml(jsAttack)), 'FIX: no live javascript: href in output');
ok(!/<a /.test(mdToHtml(jsAttack)), 'FIX: javascript: link rendered as plain text, no <a>');
ok(/click me/.test(mdToHtml(jsAttack)), 'FIX: the link label survives as plain text');
ok(!/onmouseover=/.test(mdToHtml(attrAttack)), 'FIX: no attribute-breakout handler in output');
ok(!/<a /.test(mdToHtml(attrAttack)), 'FIX: attribute-breakout link rendered as plain text, no <a>');

// ── scheme whitelist: dangerous schemes are dropped (label only, no href) ──
for (const bad of [
  '[a](javascript:alert(1))',
  '[a](JavaScript:alert(1))',
  '[a](data:text/html,<script>alert(1)</script>)',
  '[a](vbscript:msgbox(1))',
  '[a](file:///etc/passwd)',
]) {
  ok(!/<a /.test(mdToHtml(bad)), `dangerous scheme dropped: ${bad}`);
  ok(/\ba\b/.test(mdToHtml(bad)), `label preserved for dropped link: ${bad}`);
}
// control-char obfuscation: the URL parser strips tab/newline/CR before resolving
// the scheme, so `java\nscript:` is still recognised + blocked (a naive regex would miss it)
ok(safeHref('java\nscript:alert(1)') === null, 'control-char obfuscated javascript: scheme blocked');
ok(safeHref('\tjavascript:alert(1)') === null, 'leading-tab javascript: scheme blocked');

// ── safe schemes preserved ──
ok(/<a href="https:\/\/anthropic\.com"/.test(mdToHtml('[Anthropic](https://anthropic.com)')), 'https link preserved');
ok(/<a href="http:\/\/example\.com\/p"/.test(mdToHtml('[x](http://example.com/p)')), 'http link preserved');
ok(/<a href="mailto:a@b\.com"/.test(mdToHtml('[mail](mailto:a@b.com)')), 'mailto link preserved');
ok(/target="_blank"/.test(mdToHtml('[x](https://e.com)')), 'rel/target attrs preserved on safe link');
// relative + anchor + protocol-relative resolve to http(s) -> allowed
eq(safeHref('docs/page'), 'docs/page', 'relative link allowed (resolves to https base)');
eq(safeHref('#section'), '#section', 'anchor link allowed');
eq(safeHref('//cdn.example.com/x'), '//cdn.example.com/x', 'protocol-relative link allowed');

// ── quote-escape: a quote in a SAFE url is escaped, never breaks the attribute ──
{
  const out = mdToHtml('[x](https://e.com/?q="a")');
  ok(!/\son\w+=/.test(out), 'quote in safe url cannot inject an event handler');
  ok(out.includes('&quot;'), 'quote in url is entity-escaped to &quot;');
}
eq(safeHref('https://e.com/?q="x"'), 'https://e.com/?q=&quot;x&quot;', 'safeHref escapes embedded quotes');

// ── safeHref unit edges ──
eq(safeHref(''), null, 'safeHref empty -> null');
eq(safeHref(null), null, 'safeHref null -> null');
eq(safeHref(undefined), null, 'safeHref undefined -> null');
// non-scheme text resolves as a RELATIVE path against the https base -> allowed
// (a harmless relative link; the security property is the scheme whitelist, not
//  parseability). A genuine dangerous scheme is what gets blocked:
eq(safeHref('plain text without a scheme'), 'plain text without a scheme', 'safeHref non-scheme text allowed as relative');
eq(safeHref('javascript:alert(1)'), null, 'safeHref dangerous scheme -> null');
eq(safeHref('  https://e.com  '), 'https://e.com', 'safeHref trims surrounding whitespace');

// ── balanced-paren URLs: Wikipedia disambiguation links keep their closing ) ──
// LLM research output constantly cites URLs like …/Taiwan_(island). The old
// link regex captured the URL as [^)]+ and stopped at the FIRST ')', truncating
// the href (a broken/404 link) and leaking a stray ')' into the body text.
{
  const wiki = '[Taiwan](https://en.wikipedia.org/wiki/Taiwan_(island))';
  const out = mdToHtml(wiki);
  // RED PROOF: the old link transform truncates the href at the inner ')'
  ok(/href="https:\/\/en\.wikipedia\.org\/wiki\/Taiwan_\(island"[ >]/.test(oldMd(wiki)),
     'RED PROOF: old renderer truncates the href at the first )');
  ok(/<\/a>\)/.test(oldMd(wiki)), 'RED PROOF: old renderer leaks a stray ) after the link');
  // FIX: the closing paren is kept inside the href, nothing leaks after the link
  ok(out.includes('href="https://en.wikipedia.org/wiki/Taiwan_(island)"'),
     'FIX: balanced-paren href is complete (keeps the closing paren)');
  ok(!/<\/a>\)/.test(out), 'FIX: no stray ) leaked into the body after the link');
  ok(/>Taiwan<\/a>/.test(out), 'FIX: label unchanged');
}
// a paren mid-URL is preserved too
ok(mdToHtml('[foo](https://e.com/a_(b)_c)').includes('href="https://e.com/a_(b)_c"'),
   'mid-URL balanced paren preserved');
// ── CommonMark link TITLES: [t](url "title") — strip the title, KEEP the link ──
// LLM research prose emits titled links constantly. Before the fix, the whole
// `url "title"` went to safeHref, whose URL parser rejected the embedded space/
// quotes and returned null, so the ENTIRE link was dropped (label rendered as
// bare text, href lost). RED PROOF: the old single-arg transform (no title
// split) dropped the link — its output has no <a href>.
function oldTitleMd(md) {
  const oesc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let h = oesc(md);
  // Reproduce the pre-fix link transform: pass the FULL dest (incl. title) to
  // the same scheme-checked href logic mdToHtml used, with no title split.
  h = h.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)/g, (_, label, dest) => {
    let href = null;
    try { const u = new URL(String(dest).trim(), 'https://research.local/');
      if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') href = String(dest).trim().replace(/"/g, '&quot;'); } catch {}
    return href ? `<a href="${href}" target="_blank" rel="noopener">${label}</a>` : label;
  });
  return h;
}
ok(!/<a /.test(oldTitleMd('[the source](https://example.com "Great Page")')),
   'RED PROOF: old renderer DROPPED a titled link (no <a> emitted)');
for (const [name, md] of [
  ['double-quote', '[the source](https://example.com "Great Page")'],
  ['single-quote', "[src](https://example.com 'A Title')"],
  ['paren',        '[src](https://example.com (A Title))'],
]) {
  const out = mdToHtml(md);
  ok(out.includes('href="https://example.com"'), `FIX: ${name} title stripped, href preserved`);
  ok(!/Great Page|A Title/.test(out), `FIX: ${name} title text not leaked into output`);
}
// no-title link is byte-identical (guard against over-stripping)
ok(mdToHtml('[src](https://example.com)').includes('href="https://example.com"'),
   'GUARD: untitled link unchanged');
// a spaced-but-not-a-title dest keeps the whole string (no regression, no drop)
ok(mdToHtml('[x](foo bar baz)').includes('href="foo bar baz"'),
   'GUARD: spaced non-title dest is not treated as a title');
// the balanced matcher must NOT over-consume into trailing prose or a next link
{
  const trail = mdToHtml('see [a](http://x.com) and (a note)');
  ok(trail.includes('href="http://x.com"') && trail.includes('(a note)'),
     'trailing (prose) after a link is not swallowed into the href');
  const two = mdToHtml('[a](http://x.com) [b](http://y.com)');
  ok(/href="http:\/\/x\.com"/.test(two) && /href="http:\/\/y\.com"/.test(two),
     'two adjacent links: the first does not over-consume the second');
}
// a dangerous scheme whose payload has parens is STILL dropped (now fully captured)
ok(!/<a /.test(mdToHtml('[click me](javascript:alert(1))')),
   'paren-bearing javascript: payload still dropped, no <a>');

// ── CommonMark ANGLE-BRACKET link DESTINATION: [t](<url>) ──
// This is a valid, citation-common form. Before the fix, the autolink pass ate
// the `<url>` inside the parens and stashed it as an <a> BEFORE the inline link
// pass ran, so the stub was jammed into the href — producing a DOUBLE-NESTED
// `<a href="<a href=…>…</a>">` (broken, non-clickable link) in a reader whose
// whole job is real citations. The `href="<a` signature below is the exact
// corruption; it must never appear. Fix = a `](` lookbehind on both autolink
// passes + stripping the &lt;…&gt; wrapper in the inline link handler.
{
  const out = mdToHtml('[x](<https://a.com/b>)');
  // RED PROOF: the corruption was a nested anchor inside the href attribute.
  ok(!/href="<a/.test(out), 'angle-dest link is NOT double-nested (no href="<a)');
  ok(!/&lt;|&gt;/.test(out), 'angle-dest link does not leak &lt;/&gt; brackets');
  ok((out.match(/<a /g) || []).length === 1, 'angle-dest link renders exactly ONE anchor');
  ok(out.includes('href="https://a.com/b"'), 'angle-dest bare URL becomes the href');
  ok(/>x<\/a>/.test(out), 'angle-dest link keeps its label text');
}
// angle dest WITH a title: strip both wrapper and title, keep one clean link
{
  const out = mdToHtml('[x](<https://a.com/b> "Great Page")');
  ok(out.includes('href="https://a.com/b"') && !/href="<a/.test(out) && !/Great Page/.test(out),
     'angle-dest + title: wrapper and title stripped, single clean href');
}
// angle dest whose URL carries a balanced paren keeps the paren (Wikipedia-style)
ok(mdToHtml('[T](<https://en.wikipedia.org/wiki/Taiwan_(island)>)')
     .includes('href="https://en.wikipedia.org/wiki/Taiwan_(island)"'),
   'angle-dest URL with a balanced paren is preserved');
// SECURITY: a dangerous scheme in an angle dest is STILL dropped to plain text
ok(!/<a /.test(mdToHtml('[bad](<javascript:alert(1)>)')),
   'angle-dest javascript: scheme dropped, no <a>');
// REGRESSION: a standalone autolink AFTER a link (space-separated, not `](`) still
// linkifies — the lookbehind must not disarm real autolinks.
{
  const out = mdToHtml('[a](https://a.com) <https://b.com>');
  ok((out.match(/<a /g) || []).length === 2, 'link + trailing standalone autolink = two anchors');
}

// ── code spans render VERBATIM (regression: their content used to be mangled) ──
// Code was transformed into <pre>/<code> but its inner text still flowed through
// every LATER transform, so a fenced block showing example markdown rendered a
// real <h1>/<li>/<strong>, and inline code like `[x](y)` became a LIVE clickable
// <a>. Now code is stashed to an inert sentinel before those passes and restored
// after, so it renders literally. fullOldMd (below) reproduces the old bug for
// the RED proofs.
{
  const fence = 'Here is code:\n\n```\n- not a list\n# not a heading\n**not bold**\nvisit [x](y)\n```';
  const out = mdToHtml(fence);
  // FIX: nothing inside the fenced block was turned into a tag
  ok(out.includes('# not a heading') && !/<h1>/.test(out), 'fenced: # line is literal, not an <h1>');
  ok(out.includes('- not a list') && !/<li>/.test(out), 'fenced: - line is literal, not an <li>');
  ok(out.includes('**not bold**') && !/<strong>/.test(out), 'fenced: ** is literal, not <strong>');
  ok(out.includes('visit [x](y)') && !/<a /.test(out), 'fenced: [x](y) is literal, not a live <a>');
  // RED PROOF: the old renderer mangled all four inside the code block
  const oldFence = fullOldMd(fence);
  ok(/<h1>not a heading<\/h1>/.test(oldFence), 'RED PROOF: old renderer emits <h1> inside the code block');
  ok(/<a [^>]*>x<\/a>/.test(oldFence), 'RED PROOF: old renderer emits a live <a> inside the code block');
}
{
  // inline code containing a link pattern must stay literal, NOT become a real link
  const out = mdToHtml('use `[label](https://evil.example)` verbatim');
  ok(/<code>\[label\]\(https:\/\/evil\.example\)<\/code>/.test(out), 'FIX: inline code with a link pattern is literal');
  ok(!/<a /.test(out), 'FIX: inline code does not produce a real <a>');
  ok(/<a [^>]*>label<\/a>/.test(fullOldMd('use `[label](https://evil.example)` verbatim')),
     'RED PROOF: old renderer turned inline code into a live link');
}
{
  // a standalone fenced block is block-level: rendered <pre> must NOT nest in <p>
  const out = mdToHtml('intro\n\n```\ncode\n```\n\noutro');
  ok(/<pre><code>code<\/code><\/pre>/.test(out), 'standalone fence renders a <pre>');
  ok(!/<p><pre>/.test(out), 'standalone fence is not wrapped in <p>');
  ok(/<p>intro<\/p>/.test(out) && /<p>outro<\/p>/.test(out), 'surrounding prose still becomes paragraphs');
}
{
  // a blank line INSIDE a fenced block must not split the block into two paragraphs
  const out = mdToHtml('```\nline one\n\nline three\n```');
  ok(/<pre><code>line one\n\nline three<\/code><\/pre>/.test(out), 'FIX: blank line inside a fence stays inside the <pre>');
  ok(!/<p>/.test(out), 'FIX: an internal blank line does not spawn a stray <p>');
  ok(/<pre><code>line one<\/code>/.test(fullOldMd('```\nline one\n\nline three\n```')) === false
     || /line three<\/code><\/pre><\/p>/.test(fullOldMd('```\nline one\n\nline three\n```')),
     'RED PROOF: old renderer split the fence across the blank line');
}
{
  // a fenced block's language INFO STRING (```json / ```bash / ```c++) is metadata,
  // never code — it must NOT render as a stray first line inside the <pre>.
  const j = mdToHtml('Here:\n\n```json\n{ "a": 1 }\n```');
  ok(/<pre><code>\{ "a": 1 \}<\/code><\/pre>/.test(j), 'FIX: ```json language hint stripped, only code renders');
  ok(!/>json/.test(j), 'FIX: the word "json" does not leak into the code block');
  const b = mdToHtml('```bash\nls -la\n```');
  ok(/<pre><code>ls -la<\/code><\/pre>/.test(b), 'FIX: ```bash hint stripped');
  const cpp = mdToHtml('```c++\nint x;\n```');
  ok(/<pre><code>int x;<\/code><\/pre>/.test(cpp), 'FIX: ```c++ hint stripped (+/# are valid info-string chars)');
  // a plain ``` fence (no language) is byte-identical to before — first line is empty
  ok(/<pre><code>code line<\/code><\/pre>/.test(mdToHtml('```\ncode line\n```')), 'plain fence unchanged (empty info string)');
  // a first line that is REAL code (carries spaces/punctuation) is NOT an info string — keep it
  const inlineFirst = mdToHtml('```const a = 1;\nconst b = 2;```');
  ok(/const a = 1;\nconst b = 2;/.test(inlineFirst), 'code-shaped first line is preserved, not eaten as an info string');
  // RED PROOF: the old renderer left the language word inside the code block
  ok(/<pre><code>json\n\{ "a": 1 \}<\/code><\/pre>/.test(fullOldMd('```json\n{ "a": 1 }\n```')),
     'RED PROOF: old renderer leaked the "json" language word as the first code line');
}

// ── ordered lists wrap in <ol> (regression: they used to render as orphan <li>) ──
// The ordered-item -> <li> conversion used to run AFTER the <li>-run -> <ul> wrap,
// so every numbered list emitted bare <li> with NO list container. RED PROOF: the
// genuine old renderer (fullOldMd, below) leaves the orphan-<li> bug in place.
{
  const olOut = mdToHtml('1. first\n2. second\n3. third');
  ok(/<ol>/.test(olOut), 'ordered list is wrapped in <ol>');
  ok(/<ol><li>first<\/li>/.test(olOut), 'ordered list opens with <ol><li>');
  ok(/<\/li>\n?<\/ol>/.test(olOut), 'ordered list closes with </li></ol>');
  ok(!/<ul>/.test(olOut), 'ordered list does NOT use <ul>');
  ok(!/<\/?oli>/.test(olOut), 'no leaked <oli> marker tag in output');
  // RED PROOF: the old renderer left ordered items as orphan <li>, no <ol>/<ul>
  const oldOl = fullOldMd('1. first\n2. second\n3. third');
  ok(!/<ol>/.test(oldOl) && /<li>first<\/li>/.test(oldOl), 'RED PROOF: old renderer emits orphan <li>, no <ol>');
}
// ── ordered lists honor a non-1 START NUMBER via <ol start="N"> ──
// CommonMark numbers an ordered list from its FIRST item's value. The old wrap
// discarded the digit and always emitted a bare <ol>, so a list beginning at any
// number other than 1 — or a numbered run RESUMED after intervening prose —
// rendered the wrong visible numbers (browsers renumber <ol> from 1). A very
// common deep-research shape: "Step 3:"-style enumerations and lists split by an
// explanatory paragraph.
{
  const nonOne = mdToHtml('3. Third item\n4. Fourth item');
  ok(/<ol start="3">/.test(nonOne), 'FIX: list starting at 3 -> <ol start="3">');
  ok(/<ol start="3"><li>Third item<\/li>/.test(nonOne), 'FIX: start attr on the opening <ol>, clean item text');
  ok(!/3\. Third item/.test(nonOne), 'FIX: the "3." digit is consumed, not leaked into the item text');

  // paren-delimited lists carry the start too
  ok(/<ol start="9"><li>nine<\/li>/.test(mdToHtml('9) nine\n10) ten')), 'FIX: "9)"-delimited list -> <ol start="9">');

  // a numbered run resumed after prose keeps counting from its own first number
  const split = mdToHtml('1. a\n2. b\n\nSome prose.\n\n5. e\n6. f');
  ok(/<ol><li>a<\/li>/.test(split), 'split list: the first run (starts at 1) stays a bare <ol>');
  ok(/<ol start="5"><li>e<\/li>/.test(split), 'FIX: the resumed run honors its start (5)');

  // CommonMark honors an explicit start of 0
  ok(/<ol start="0"><li>zero<\/li>/.test(mdToHtml('0. zero\n1. one')), 'FIX: explicit start of 0 is honored');

  // GUARD: a list that DOES start at 1 must emit a bare <ol> (no start attr) —
  // byte-identical to the pre-fix output, so no regression on the common case.
  eq(mdToHtml('1. first\n2. second'), '<ol><li>first</li>\n<li>second</li></ol>', 'GUARD: start-at-1 list is a bare <ol>, unchanged');
  ok(!/start=/.test(mdToHtml('1. one\n2. two\n3. three')), 'GUARD: no spurious start attr on a 1-2-3 list');

  // RED PROOF: the old wrap dropped the digit and always emitted a bare <ol>, so
  // a 3-starting list mis-rendered as 1,2 (no start attr at all).
  const oldNumbered = (md) => {
    let h = String(md).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    h = h.replace(/^[ \t]*\d+[.)] (.*)$/gm, '<oli>$1</oli>');
    h = h.replace(/(<oli>[\s\S]*?<\/oli>\n?)+/g, (m) => `<ol>${m.replace(/<(\/?)oli>/g, '<$1li>')}</ol>`);
    return h;
  };
  ok(!/start=/.test(oldNumbered('3. Third\n4. Fourth')), 'RED PROOF: old wrap emits a bare <ol> for a 3-starting list (wrong numbers)');
}
// unordered lists stay <ul> (must not regress to <ol>)
{
  const ulOut = mdToHtml('- a\n- b');
  ok(/<ul><li>a<\/li>/.test(ulOut), 'unordered list still wrapped in <ul>');
  ok(!/<ol>/.test(ulOut), 'unordered list does NOT use <ol>');
}
// a bulleted list and a numbered list in the same doc become two separate lists
{
  const mixed = mdToHtml('- bullet\n\n1. number');
  ok(/<ul><li>bullet<\/li>/.test(mixed), 'mixed doc: bullet run -> <ul>');
  ok(/<ol><li>number<\/li>/.test(mixed), 'mixed doc: number run -> <ol>');
}
// ── `* ` bullet whose text contains *emphasis* stays a list item ──
// The emphasis pass used to run BEFORE list-marker conversion, so the leading
// `* ` of an asterisk-bulleted item was treated as an emphasis OPENER: it ate
// the bullet, the line stopped being a list item, and a stray `*` leaked into
// the reader. A `* ` (asterisk + space) is unambiguously a CommonMark bullet —
// emphasis can never be immediately followed by whitespace — so the marker must
// be claimed first. RED PROOF: the genuine old ordering (emOldMd, below)
// reproduces the mangle.
{
  const one = mdToHtml('* Second *important* point');
  ok(/<ul><li>Second <em>important<\/em> point<\/li><\/ul>/.test(one),
     'FIX: `* ` bullet with *emphasis* renders as an <li> with <em> inside');
  ok(!/<em> Second <\/em>/.test(one), 'FIX: leading `* ` bullet is NOT eaten as an emphasis opener');

  const two = mdToHtml('* one *em* and *two* here');
  ok(/<li>one <em>em<\/em> and <em>two<\/em> here<\/li>/.test(two),
     'FIX: `* ` bullet with two emphasis spans renders both, keeps the item');

  const boldMix = mdToHtml('* **Bold:** and *em* mixed');
  ok(/<li><strong>Bold:<\/strong> and <em>em<\/em> mixed<\/li>/.test(boldMix),
     'FIX: `* ` bullet mixing **bold** + *em* renders both inside one <li>');

  // A `-` bulleted item with emphasis was never mangled (only `* ` was), but lock it too.
  const dash = mdToHtml('- point with *stress*');
  ok(/<li>point with <em>stress<\/em><\/li>/.test(dash), '`-` bullet with *emphasis* renders cleanly');

  // RED PROOF: emphasis-before-list-conversion eats the `* ` marker and leaks a stray `*`.
  const oesc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function emOldMd(md) {
    let h = oesc(md);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');   // runs BEFORE list conversion (old bug)
    h = h.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
    return h;
  }
  const old = emOldMd('* Second *important* point');
  ok(/<em> Second <\/em>/.test(old) && !/<li>/.test(old),
     'RED PROOF: old ordering eats the `* ` marker, no <li>, stray `*` leaks');
}

// ── blockquotes render as <blockquote>, not a leaked `>` marker ──
// esc() turns a leading `>` into `&gt;`; before the blockquote transform a
// quoted source line rendered as <p>&gt; …</p>, leaking the marker into the
// reader's report. LLM research reports quote sources with `> ` constantly.
{
  const q = mdToHtml('Claim.\n\n> The source says X.\n\nProse.');
  ok(/<blockquote>The source says X\.<\/blockquote>/.test(q), 'FIX: `> ` line renders a <blockquote>');
  ok(!/&gt;/.test(q), 'FIX: no leaked &gt; marker in the output');
  ok(/<p>Claim\.<\/p>/.test(q) && /<p>Prose\.<\/p>/.test(q), 'surrounding prose still becomes paragraphs');
  // RED PROOF: the genuine old renderer (no blockquote transform) leaks the marker
  const old = fullOldMd('> The source says X.');
  ok(/<p>&gt; The source says X\.<\/p>/.test(old), 'RED PROOF: old renderer leaks `&gt;` inside a <p>');
  ok(!/<blockquote>/.test(old), 'RED PROOF: old renderer never emits <blockquote>');
}
{
  // multi-line quote: consecutive `> ` lines collapse into ONE blockquote, joined <br>
  const multi = mdToHtml('> line one\n> line two');
  ok(/<blockquote>line one<br>line two<\/blockquote>/.test(multi), 'multi-line quote joins with <br> in one <blockquote>');
  ok((multi.match(/<blockquote>/g) || []).length === 1, 'multi-line quote is a single <blockquote>');
}
{
  // NESTED blockquotes (`>> inner`, `> > inner`): every marker in the leading run
  // must be stripped, never leaked as a literal `>`. Flattened into one quote.
  const nested = mdToHtml('> outer\n>> nested\n> back');
  ok(!/&gt;/.test(nested), 'FIX: nested `>>` leaks NO literal &gt; marker');
  ok(/<blockquote>outer<br>nested<br>back<\/blockquote>/.test(nested), 'nested quote flattens into one <blockquote>, markers stripped');
  // a bare `>> deeply nested` (no outer single-marker line) still strips both
  const deep = mdToHtml('>> deeply nested');
  ok(/<blockquote>deeply nested<\/blockquote>/.test(deep), 'bare `>>` strips both markers');
  ok(!/&gt;/.test(deep), 'bare `>>` leaks no &gt;');
  // space-separated nesting `> > x` also collapses cleanly
  const spaced = mdToHtml('> level one\n> > spaced');
  ok(/<blockquote>level one<br>spaced<\/blockquote>/.test(spaced), '`> > ` spaced nesting strips both markers');
  ok(!/&gt;/.test(spaced), 'spaced nesting leaks no &gt;');
  // RED PROOF: the single-marker strip (old form) leaves the extra `&gt;` behind
  const oldStrip = (m) => m.replace(/^&gt;[^\n]*(?:\n&gt;[^\n]*)*/gm, (mm) =>
    `<blockquote>${mm.replace(/^&gt;[ \t]?/gm, '').replace(/\n/g, '<br>')}</blockquote>`);
  ok(/&gt;/.test(oldStrip('&gt;&gt; nested')), 'RED PROOF: old single-marker strip leaks a &gt; on `>>`');
  // content that merely starts with a `>` after the real marker is NOT over-stripped
  const arrow = mdToHtml('> -&gt; keep this arrow');
  ok(/<blockquote>-&gt; keep this arrow<\/blockquote>/.test(mdToHtml('> -> keep this arrow')), 'a lone `>` in quote CONTENT is preserved, not eaten as a marker');
}
{
  // inline formatting survives inside a quote (transform runs after bold/italic/link)
  const rich = mdToHtml('> quoting **bold** and [a link](https://example.com) inside');
  ok(/<strong>bold<\/strong>/.test(rich), 'bold renders inside a blockquote');
  ok(/<a href="https:\/\/example\.com"[^>]*>a link<\/a>/.test(rich), 'link renders inside a blockquote');
}
{
  // a `>` in the MIDDLE of a line is NOT a blockquote — must stay escaped in a <p>
  const mid = mdToHtml('A value 5 > 3 in prose.');
  ok(/<p>A value 5 &gt; 3 in prose\.<\/p>/.test(mid), 'mid-line `>` stays escaped, not a blockquote');
  ok(!/<blockquote>/.test(mid), 'mid-line `>` does not spawn a <blockquote>');
}

// ── GFM tables render as <table>, not a leaked `| a | b |` paragraph ──
// LLM research reports (esp. deep-research runs) emit pipe tables constantly.
// Before this fix mdToHtml fused every row into one <p> of literal pipes.
const TBL = '| Country | Pop |\n| --- | --- |\n| Taiwan | 23M |\n| Palau | 18k |';
const tblOut = mdToHtml(TBL);
ok(/<table>/.test(tblOut) && /<\/table>/.test(tblOut), 'table: emits a <table> element');
ok(/<thead><tr><th>Country<\/th><th>Pop<\/th><\/tr><\/thead>/.test(tblOut), 'table: header row -> <thead><th>');
ok(/<tbody>.*<td>Taiwan<\/td><td>23M<\/td>.*<\/tbody>/s.test(tblOut), 'table: body row -> <tbody><td>');
ok(!/\| Country/.test(tblOut) && !/---/.test(tblOut), 'table: no leaked pipes or delimiter dashes');
ok(!/<p>[^<]*<table>/.test(tblOut) && !/<table>[\s\S]*<\/table>[\s\S]*<\/p>/.test(tblOut),
   'table: <table> is NOT wrapped in a stray <p>');
// inline formatting survives inside cells
const tblFmt = mdToHtml('| Name | Link |\n| --- | --- |\n| **bold** | [T](https://e.com) |');
ok(/<td><strong>bold<\/strong><\/td>/.test(tblFmt), 'table: **bold** renders inside a cell');
ok(/<td><a href="https:\/\/e.com"[^>]*>T<\/a><\/td>/.test(tblFmt), 'table: [link] renders inside a cell');
// ragged rows pad/truncate to the header width
const tblRag = mdToHtml('| A | B |\n| --- | --- |\n| only-one |');
ok(/<tr><td>only-one<\/td><td><\/td><\/tr>/.test(tblRag), 'table: short row padded to header width');
// single-column table works
ok(/<table><thead><tr><th>H<\/th><\/tr><\/thead><tbody><tr><td>a<\/td><\/tr><\/tbody><\/table>/
   .test(mdToHtml('| H |\n| --- |\n| a |')), 'table: single-column table renders');
// outer pipes optional
ok(/<table>/.test(mdToHtml('A | B\n--- | ---\n1 | 2')), 'table: outer pipes are optional');
// FALSE-POSITIVE GUARD: a prose line with a `|` above a `---` break is NOT a table
// (column counts differ: 2 header cells vs 1 delimiter cell).
const notTbl = mdToHtml('intro with a | here\n---\nmore');
ok(!/<table>/.test(notTbl), 'table: prose-pipe above a bare --- is NOT mistaken for a table');
// a normal paragraph containing a lone pipe is untouched
ok(!/<table>/.test(mdToHtml('two paths: A | B, pick one.')), 'table: a lone inline pipe stays prose');

// ── esc still covers the raw-tag boundary ──
eq(esc('<script>'), '&lt;script&gt;', 'esc neutralizes a tag');
eq(esc('a & b'), 'a &amp; b', 'esc ampersand');
eq(esc(null), '', 'esc null -> empty');
ok(!/<script>/.test(mdToHtml('here is <script>alert(1)</script> inline')), 'raw <script> in report neutralized');

// ── thematic breaks (horizontal rules): `---`/`***`/`___` -> <hr>, not a
//    literal `<p>---</p>` paragraph. LLM research reports divide sections with
//    these constantly; without the transform the divider leaked into the reader.
//    (Mutation-lock: delete the `<hr>` replace line in md.js and the four FIX
//    assertions go RED while every guard below stays green.)
{
  const dash = mdToHtml('First section.\n\n---\n\nSecond section.');
  ok(dash.includes('<hr>') && !dash.includes('---'), 'FIX: `---` renders <hr>, no literal dashes leak');
  ok(mdToHtml('A\n\n***\n\nB').includes('<hr>'), 'FIX: `***` thematic break renders <hr>');
  ok(mdToHtml('A\n\n___\n\nB').includes('<hr>'), 'FIX: `___` thematic break renders <hr>');
  ok(mdToHtml('A\n\n- - -\n\nB').includes('<hr>'), 'FIX: spaced `- - -` break renders <hr>');
  // <hr> is block-level: it must stand alone, never wrapped in <p>.
  eq(mdToHtml('---'), '<hr>', 'FIX: a lone thematic break is not wrapped in <p>');
  // GUARDS: things that look close but are NOT thematic breaks stay untouched.
  const bullets = mdToHtml('- item one\n- item two');
  ok(bullets.includes('<ul>') && bullets.includes('<li>item one</li>') && !bullets.includes('<hr>'),
     'GUARD: `- ` bullets stay a list, never an <hr>');
  ok(mdToHtml('text **bold** here').includes('<strong>bold</strong>') && !mdToHtml('text **bold** here').includes('<hr>'),
     'GUARD: **bold** is never eaten as a `***` break');
  ok(!mdToHtml('A\n\n--\n\nB').includes('<hr>'), 'GUARD: only two dashes is not a break');
  ok(!mdToHtml('A\n\n-*-\n\nB').includes('<hr>'), 'GUARD: mixed markers (`-*-`) are not a break');
  const tbl = mdToHtml('| A | B |\n| --- | --- |\n| 1 | 2 |');
  ok(tbl.includes('<table>') && tbl.includes('<td>1</td>') && !tbl.includes('<hr>'),
     'GUARD: a table delimiter row is not swallowed by the <hr> transform');
}

// ── indented / nested list items convert instead of leaking literal markers ──
// The bullet/number regexes used to require the marker at absolute line-start, so
// LLM sub-points nested with 2-4 spaces of indent ("- point\n    - sub") were left
// unconverted and leaked into the reader as literal `- sub` text stranded between
// <ul> blocks. Allowing a leading `[ \t]*` folds them into the list as flat <li>
// (nesting depth dropped, but no literal marker leaks).
// (Mutation-lock: revert either list regex to `^(?:- |\* )` / `^\d+\. ` in md.js
//  and the FIX assertions go RED while the top-level GUARDs stay green.)
{
  const nested = mdToHtml('Top points:\n\n- First item\n    - nested sub-item\n    - another sub\n- Second item');
  ok(/<li>nested sub-item<\/li>/.test(nested) && /<li>another sub<\/li>/.test(nested),
     'FIX: indented `- ` sub-items convert to <li>');
  ok(!/- nested sub-item/.test(nested) && !/- another sub/.test(nested),
     'FIX: no literal `- ` marker leaks between the <ul> blocks');
  ok((nested.match(/<ul>/g) || []).length === 1, 'FIX: sub-items fold into a single <ul>, not stranded outside it');
  // indented ordered items too
  const numNest = mdToHtml('Steps:\n\n1. one\n   2. sub-step\n3. three');
  ok(/<ol>/.test(numNest) && /<li>sub-step<\/li>/.test(numNest) && !/2\. sub-step/.test(numNest),
     'FIX: indented `N. ` sub-items convert to <li> inside the <ol>');
  // GUARD: top-level (zero-indent) lists are byte-identical to before.
  eq(mdToHtml('- a\n- b'), '<ul><li>a</li>\n<li>b</li></ul>', 'GUARD: top-level bullets unchanged');
  eq(mdToHtml('1. first\n2. second'), '<ol><li>first</li>\n<li>second</li></ol>', 'GUARD: top-level numbers unchanged');
  // RED PROOF: the genuine old renderer leaves the indented marker as literal text.
  const old = fullOldMd('- First item\n    - nested sub-item\n- Second item');
  ok(/- nested sub-item/.test(old) && !/<li>nested sub-item<\/li>/.test(old),
     'RED PROOF: old renderer leaks the indented `- ` marker as literal text');
}

// ── underscore emphasis (_i_ / __b__) + GFM strikethrough (~~s~~) ──
// The TTS stripMarkdown unwraps all three; the visual reader used to leak them
// as literal markers. Fixed with CommonMark intraword flanking so snake_case /
// URL path segments stay literal. RED PROOF: the old renderer (asterisk-only)
// emitted the raw markers; FIX renders the tag; GUARD: intraword `_` untouched.
{
  ok(/He was _deeply_ shaken/.test(fullOldMd('He was _deeply_ shaken.')),
     'RED PROOF: old renderer leaks literal _italic_ markers');
  ok(/is __very__ important/.test(fullOldMd('This is __very__ important.')),
     'RED PROOF: old renderer leaks literal __bold__ markers');
  ok(/~~cancelled~~/.test(fullOldMd('The plan was ~~cancelled~~ delayed.')),
     'RED PROOF: old renderer leaks literal ~~strike~~ markers');

  eq(mdToHtml('He was _deeply_ shaken.'), '<p>He was <em>deeply</em> shaken.</p>',
     'FIX: _italic_ renders as <em>');
  eq(mdToHtml('This is __very__ important.'), '<p>This is <strong>very</strong> important.</p>',
     'FIX: __bold__ renders as <strong>');
  eq(mdToHtml('The plan was ~~cancelled~~ delayed.'), '<p>The plan was <del>cancelled</del> delayed.</p>',
     'FIX: ~~strike~~ renders as <del>');
  eq(mdToHtml('__lead__ then _tail_ done'), '<p><strong>lead</strong> then <em>tail</em> done</p>',
     'FIX: bold and italic underscore in one line both render');

  // GUARD: intraword underscores are NEVER emphasis (CommonMark) — a mangled
  // snake_case identifier or URL path segment is the whole regression risk.
  eq(mdToHtml('Call some_helper_fn now.'), '<p>Call some_helper_fn now.</p>',
     'GUARD: snake_case stays literal');
  eq(mdToHtml('the a__b__c token'), '<p>the a__b__c token</p>',
     'GUARD: mid-word __ stays literal');
  eq(mdToHtml('fully _re_shaped word'), '<p>fully _re_shaped word</p>',
     'GUARD: underscore that would close before a word char stays literal');
  eq(mdToHtml('See [wiki](https://en.wikipedia.org/wiki/Foo_bar_baz).'),
     '<p>See <a href="https://en.wikipedia.org/wiki/Foo_bar_baz" target="_blank" rel="noopener">wiki</a>.</p>',
     'GUARD: underscores in a link URL path are untouched');
  // GUARD: asterisk emphasis (the pre-existing rule) is unchanged.
  eq(mdToHtml('He was *deeply* shaken.'), '<p>He was <em>deeply</em> shaken.</p>',
     'GUARD: asterisk *italic* still renders');
}

// ── list → paragraph: trailing prose after a list gets its <p> wrapper ──
// The <li>/<oli> wrap's trailing `\n?` ate one newline of a blank-line separator,
// collapsing "…list…\n\nprose" to a single-newline run that the paragraph splitter
// fused into the list block — so the trailing paragraph rendered as bare, unwrapped
// text glued to the list (no <p>, no block margins). Every other block
// (heading/blockquote/table/code) kept its <p>; a list was the lone leak, and it's
// an extremely common deep-research shape (bulleted findings, then a paragraph).
// RED PROOF: the old renderer emits the prose with no <p>; FIX wraps it; GUARD: a
// BLOCK after a list stays fused (valid HTML, no spurious <p>) and a loose list is
// unchanged.
{
  const listThenProse = '- first point\n- second point\n\nmore prose.';
  const old = fullOldMd(listThenProse);
  ok(/<\/ul>\nmore prose\./.test(old) && !/<p>more prose/.test(old),
     'RED PROOF: old renderer leaves prose after a list unwrapped (no <p>)');
  eq(mdToHtml(listThenProse),
     '<ul><li>first point</li>\n<li>second point</li>\n</ul>\n<p>more prose.</p>',
     'FIX: prose after an unordered list is wrapped in <p>');
  eq(mdToHtml('1. a\n2. b\n\ntrailing paragraph.'),
     '<ol><li>a</li>\n<li>b</li>\n</ol>\n<p>trailing paragraph.</p>',
     'FIX: prose after an ordered list is wrapped in <p>');
  eq(mdToHtml('1. one\n2. two\n\n*emph* after'),
     '<ol><li>one</li>\n<li>two</li>\n</ol>\n<p><em>emph</em> after</p>',
     'FIX: an inline-starting paragraph after a list is still wrapped');
  eq(mdToHtml('- a\n- b\n\nPara one.\n\nPara two.'),
     '<ul><li>a</li>\n<li>b</li>\n</ul>\n<p>Para one.</p>\n<p>Para two.</p>',
     'FIX: first of several trailing paragraphs is wrapped too');
  eq(mdToHtml('- a\n- b\n\n# Head'),
     '<ul><li>a</li>\n<li>b</li>\n</ul>\n<h1>Head</h1>',
     'GUARD: a heading after a list is not <p>-wrapped (both blocks, no <p> needed)');
  eq(mdToHtml('- a\n\n- b'),
     '<ul><li>a</li>\n</ul>\n<ul><li>b</li></ul>',
     'GUARD: loose list (blank line between items) unchanged');
}

// ── NO-REGRESSION: normal markdown is byte-identical to the old renderer ──
// (old===new on every input WITHOUT a dangerous scheme or breakout quote, since
//  the only changes are the link transform and the ordered-list <ol> wrap — so
//  ordered-list inputs are EXCLUDED here and locked explicitly above instead)
const normalDocs = [
  '# Heading one\n\nsome **bold** and *italic* text.',
  // (list → prose is NO LONGER byte-identical to the old renderer — the fix wraps
  //  the trailing paragraph in <p>; locked explicitly in the list→paragraph block
  //  above instead of this equivalence battery.)
  'inline `code` and a block:\n\n```\nconst x = 1;\n```',
  'a safe [citation](https://example.com/article) mid-sentence.',
  'mixed [link](https://a.com) and **bold** and `code` together.',
  '###### deep heading\n\nplain trailing paragraph.',
  '',
];
for (const doc of normalDocs) {
  // Run the FULL old renderer (not just the link line) for a true equivalence check.
  eq(mdToHtml(doc), fullOldMd(doc), `no-regression: normal markdown unchanged (${JSON.stringify(doc.slice(0, 24))})`);
}

// the complete old renderer, link bug included, for the equivalence battery above
function fullOldMd(md) {
  if (!md) return '';
  const oesc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = oesc(md);
  html = html.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`);
  html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/^(\d+)\. (.*)$/gm, '<li>$2</li>');
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      if (/^\s*<(h\d|ul|ol|pre|li|p|blockquote)/i.test(block.trim())) return block;
      if (!block.trim()) return '';
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
  return html;
}

// ── reference-style links: [text][1] + [1]: url definitions ──
// Citation-heavy deep-research reports emit numbered references — `[the report][1]`
// in the prose with `[1]: https://…` definitions at the bottom — plus collapsed
// `[label][]` and shortcut `[label]` forms. Before this the definition LINE leaked
// as a literal `<p>[1]: https://…</p>` and every reference leaked as literal bracket
// text (the inline `[label](url)` transform only matches parenthesised links).
// (Mutation-lock: delete either the definition-collect `refs` block or the
//  resolution `if (refs.size)` block in md.js and the FIX assertions go RED while
//  the GUARDs — undefined/dangerous/array-notation — stay green.)
{
  // RED PROOF: the genuine old renderer leaks both the reference AND its definition.
  const oldFull = fullOldMd('See [the report][1] for details.\n\n[1]: https://example.com/report');
  ok(/\[the report\]\[1\]/.test(oldFull), 'RED PROOF: old renderer leaks the [text][1] reference as literal text');
  ok(/\[1\]: https:\/\/example\.com\/report/.test(oldFull), 'RED PROOF: old renderer leaks the [1]: url definition line');

  // FULL reference: [text][1] resolves, the definition line is stripped.
  const full = mdToHtml('See [the report][1] for details.\n\n[1]: https://example.com/report');
  ok(/<a href="https:\/\/example\.com\/report"[^>]*>the report<\/a>/.test(full),
     'FIX: [text][1] resolves to the defined link');
  ok(!/\[1\]:/.test(full) && !/\[the report\]/.test(full), 'FIX: definition line + bracket syntax gone');

  // COLLAPSED reference: [OpenAI][] reuses its own text as the label.
  const coll = mdToHtml('Read [OpenAI][] docs.\n\n[OpenAI]: https://openai.com "OpenAI"');
  ok(/<a href="https:\/\/openai\.com"[^>]*>OpenAI<\/a>/.test(coll), 'FIX: collapsed [OpenAI][] resolves (title stripped)');
  ok(!/openai\.com"/.test(coll) || /<a /.test(coll), 'FIX: collapsed ref title never leaks into the body');

  // SHORTCUT reference: bare [1] whose text is a defined label.
  const sc = mdToHtml('As shown in [1] and [2].\n\n[1]: https://a.com\n[2]: https://b.com');
  ok(/<a href="https:\/\/a\.com"[^>]*>1<\/a>/.test(sc) && /<a href="https:\/\/b\.com"[^>]*>2<\/a>/.test(sc),
     'FIX: shortcut [1]/[2] citations resolve to their definitions');
  ok(!/\[1\]:/.test(sc) && !/\[2\]:/.test(sc), 'FIX: both definition lines stripped');

  // CASE-INSENSITIVE + whitespace-collapsed label matching (CommonMark).
  ok(/<a href="https:\/\/example\.com"[^>]*>Report<\/a>/.test(
       mdToHtml('The [Report] confirms it.\n\n[report]: https://example.com')),
     'FIX: reference labels match case-insensitively');

  // GUARD: an UNDEFINED reference is left byte-identical — no over-linkifying.
  eq(mdToHtml('See [missing][9] and [fig 3] here.'),
     '<p>See [missing][9] and [fig 3] here.</p>',
     'GUARD: undefined references stay literal (no regression)');
  // GUARD: array/index notation is never turned into a link.
  eq(mdToHtml('The value arr[0] and list[i] unchanged.'),
     '<p>The value arr[0] and list[i] unchanged.</p>',
     'GUARD: bracket notation with no matching definition is untouched');
  // GUARD: a dangerous-scheme definition never produces a live href.
  const danger = mdToHtml('Click [here][x].\n\n[x]: javascript:alert(1)');
  ok(!/<a /.test(danger) && !/href="javascript:/.test(danger),
     'GUARD: a reference to a javascript: definition never becomes a live link');
  // GUARD: a `[x]: y` INSIDE a code span is not treated as a definition.
  const inCode = mdToHtml('Text `[1]: not-a-def` stays.\n\nAnd [1] here.\n\n[1]: https://real.com');
  ok(/<code>\[1\]: not-a-def<\/code>/.test(inCode), 'GUARD: a `[x]: y` in a code span is not a definition');
  ok(/<a href="https:\/\/real\.com"[^>]*>1<\/a>/.test(inCode), 'GUARD: the real [1] definition still resolves');
  // GUARD: inline parenthesised links are unaffected by the reference passes.
  ok(/<a href="https:\/\/n\.com"[^>]*>link<\/a>/.test(mdToHtml('A normal [link](https://n.com) too.')),
     'GUARD: inline [label](url) links still work');
}

// ── images `![alt](url)` render the ALT text, not `!` + a spurious link ──
// The inline link transform matches `[alt](url)`, so an image leaked as
// `!<a href=url>alt</a>` — the `!` leaked AND the reader (which has no image
// support) emitted a live link to the image binary. Now the image is reduced to
// its alt text before the link pass.
// (Mutation-lock: delete the `![alt](url)` replace line in md.js and the FIX
//  assertions go RED; the plain-link GUARD stays green.)
{
  // RED PROOF: the genuine old renderer leaks `!` and linkifies the image URL.
  const oldImg = fullOldMd('See ![a chart](https://example.com/chart.png) here.');
  ok(/!<a [^>]*href="https:\/\/example\.com\/chart\.png"[^>]*>a chart<\/a>/.test(oldImg),
     'RED PROOF: old renderer leaks `!` and turns the image into a live link');

  const out = mdToHtml('See ![a chart](https://example.com/chart.png) here.');
  eq(out, '<p>See a chart here.</p>', 'FIX: image renders its alt text, no `!` and no <a>');
  ok(!/<a /.test(out), 'FIX: image does not produce a live link');
  ok(!/chart\.png/.test(out), 'FIX: the image URL is not leaked into the reader');

  // empty alt collapses to nothing
  eq(mdToHtml('![](https://e.com/x.png)'), '', 'FIX: empty-alt image collapses to empty');
  // image with a balanced-paren URL still fully consumed (no stray `)` leak)
  eq(mdToHtml('![map](https://e.com/Foo_(bar).png)'), '<p>map</p>',
     'FIX: balanced-paren image URL fully consumed');
  // a linked image `[![alt](img)](url)` degrades to a text link (alt as label)
  ok(/<a href="https:\/\/dest\.com"[^>]*>logo<\/a>/.test(
       mdToHtml('[![logo](https://img.com/l.png)](https://dest.com)')),
     'FIX: linked image degrades to a text link with the alt as its label');
  // GUARD: a normal (non-image) link is unaffected by the image pass.
  ok(/<a href="https:\/\/n\.com"[^>]*>link<\/a>/.test(mdToHtml('A [link](https://n.com) here.')),
     'GUARD: a plain [link](url) is untouched by the image transform');
  // GUARD: a bare `!` in prose (not an image) stays literal.
  eq(mdToHtml('Wow! That is great.'), '<p>Wow! That is great.</p>', 'GUARD: a lone `!` in prose stays literal');
}

// ── triple emphasis `***word***` -> nested <strong><em>, not crossed tags ──
// The `**bold**` pass half-ate a `***…***` run, producing malformed/crossed
// tags (<strong>*word</strong>* then a garbled <em>). A dedicated triple rule
// before the bold/italic passes renders it as proper nested emphasis.
// (Mutation-lock: delete the `***…***` replace line in md.js and the FIX
//  assertions go RED; the **bold**/*em*/`***`-break GUARDs stay green.)
{
  // RED PROOF: the genuine old renderer produces CROSSED tags (</strong> closes
  // before </em> — invalid nesting) instead of clean nested emphasis.
  const oldTri = fullOldMd('This is ***very*** important.');
  ok(/<strong><em>very<\/strong><\/em>/.test(oldTri),
     'RED PROOF: old renderer emits crossed <strong><em>…</strong></em> tags');
  ok(!/<strong><em>very<\/em><\/strong>/.test(oldTri), 'RED PROOF: old renderer does NOT emit clean nested tags');

  eq(mdToHtml('This is ***very*** important.'), '<p>This is <strong><em>very</em></strong> important.</p>',
     'FIX: ***word*** renders as nested <strong><em>');
  ok(!/<strong>\*/.test(mdToHtml('***x***')), 'FIX: no stray `*` leaks inside the strong tag');
  eq(mdToHtml('***x***'), '<p><strong><em>x</em></strong></p>', 'FIX: a lone ***x*** renders clean nested tags');
  // triple + neighbouring double/single all render in one line
  eq(mdToHtml('***a*** and **b** and *c*'),
     '<p><strong><em>a</em></strong> and <strong>b</strong> and <em>c</em></p>',
     'FIX: triple, double, and single emphasis coexist on one line');
  // GUARD: plain **bold** and *italic* are unchanged.
  eq(mdToHtml('**bold** here'), '<p><strong>bold</strong> here</p>', 'GUARD: **bold** unchanged');
  eq(mdToHtml('*italic* here'), '<p><em>italic</em> here</p>', 'GUARD: *italic* unchanged');
  // GUARD: a standalone `***` line is still a thematic break, never emphasis.
  ok(mdToHtml('A\n\n***\n\nB').includes('<hr>'), 'GUARD: standalone `***` stays a thematic break');
}

// ── setext headings: `Title\n===` -> <h1>, `Title\n---` -> <h2> ──
// LLM research prose uses setext headings; before this the `===` underline leaked
// as a literal paragraph and the `-` underline was eaten by the thematic-break
// rule (Title became a <p> followed by a stray <hr>).
// (Mutation-lock: delete either setext replace line in md.js and its FIX
//  assertion goes RED; the blank-line-above and marker-above GUARDs stay green.)
{
  // RED PROOF: the genuine old renderer leaks the underline / splits into <p>+<hr>.
  const oldH1 = fullOldMd('Section Title\n===');
  ok(/===/.test(oldH1) && !/<h1>Section Title<\/h1>/.test(oldH1),
     'RED PROOF: old renderer leaks the `===` underline, no <h1>');
  const oldH2 = fullOldMd('Section Title\n---');
  ok(!/<h2>Section Title<\/h2>/.test(oldH2), 'RED PROOF: old renderer does NOT emit a setext <h2>');

  eq(mdToHtml('Section Title\n==='), '<h1>Section Title</h1>', 'FIX: `Title\\n===` renders <h1>');
  eq(mdToHtml('Section Title\n---'), '<h2>Section Title</h2>', 'FIX: `Title\\n---` (no blank above) renders <h2>');
  ok(/<h2>Findings<\/h2>/.test(mdToHtml('Findings\n---\n\nbody text')),
     'FIX: setext <h2> heading, then following prose is a separate paragraph');
  ok(mdToHtml('Findings\n---').includes('<h2>') && !mdToHtml('Findings\n---').includes('<hr>'),
     'FIX: the `---` underline becomes an <h2>, NOT a stray <hr>');
  // inline emphasis inside a setext heading still renders (runs after this pass)
  ok(/<h1>A <strong>Bold<\/strong> Title<\/h1>/.test(mdToHtml('A **Bold** Title\n===')),
     'FIX: inline **bold** inside a setext heading still renders');

  // GUARD: a `---` preceded by a BLANK line has no text above -> thematic break.
  const br = mdToHtml('First section.\n\n---\n\nSecond section.');
  ok(br.includes('<hr>') && !br.includes('<h2>'), 'GUARD: `---` after a blank line stays a thematic break');
  // GUARD: a bullet list is not consumed as a setext heading.
  eq(mdToHtml('- a\n- b'), '<ul><li>a</li>\n<li>b</li></ul>', 'GUARD: `- ` bullets stay a list, not an <h2>');
  // GUARD: an ordered list is untouched.
  ok(/<ol>/.test(mdToHtml('1. one\n2. two')), 'GUARD: numbered list stays an <ol>');
  // GUARD: `--` (two dashes) after a blank line is not a heading nor a break.
  ok(!mdToHtml('A\n\n--\n\nB').includes('<h2>'), 'GUARD: `--` above nothing is not a setext heading');
}

// ── ATX headings strip the optional CommonMark CLOSING `#` sequence ──────────
// `## Heading ##` -> <h2>Heading</h2>. Before this the greedy `(.*)` capture kept
// the trailing `##` as literal text ("Heading ##") — LLM research prose emits
// closed ATX headings often enough to reach the reader.
// (Mutation-lock: revert md.js's combined heading rule to a greedy `(.*)` capture
//  and the closing-sequence FIX assertions go RED; the open-heading + level +
//  fused-`#` GUARDs stay green.)
{
  // RED PROOF: the genuine old renderer leaks the trailing closing hashes.
  const oldClosed = fullOldMd('## Heading ##');
  ok(/Heading ##/.test(oldClosed), 'RED PROOF: old renderer leaks the trailing `##` into the heading');

  eq(mdToHtml('## Heading ##'), '<h2>Heading</h2>', 'FIX: closed ATX heading drops the trailing `##`');
  eq(mdToHtml('# Title #'), '<h1>Title</h1>', 'FIX: closer run length need not match the opener');
  eq(mdToHtml('### Deep ###'), '<h3>Deep</h3>', 'FIX: closing sequence stripped at h3');
  eq(mdToHtml('## Spaced  ##  '), '<h2>Spaced</h2>', 'FIX: trailing spaces after the closer are trimmed');
  // GUARD: an OPEN heading (the common case) is unchanged.
  eq(mdToHtml('## Findings'), '<h2>Findings</h2>', 'GUARD: open ATX heading is unchanged');
  eq(mdToHtml('###### deep'), '<h6>deep</h6>', 'GUARD: six-hash heading still maps to <h6>');
  // GUARD: a `#` FUSED to the content (no preceding space) is literal, not a closer.
  eq(mdToHtml('## C#'), '<h2>C#</h2>', 'GUARD: fused `#` (no space) stays part of the heading text');
  // GUARD: a MID-line `#` is untouched.
  eq(mdToHtml('## a # b'), '<h2>a # b</h2>', 'GUARD: an interior `#` is not a closer');
  // GUARD: inline emphasis inside a closed heading still renders.
  ok(/<h2><strong>Bold<\/strong><\/h2>/.test(mdToHtml('## **Bold** ##')),
     'GUARD: inline **bold** inside a closed heading still renders');
  // GUARD: seven leading `#` is not a heading (needs the space after 1-6).
  ok(!/<h[1-6]>/.test(mdToHtml('####### too many')), 'GUARD: 7+ hashes is not an ATX heading');
}

// ── Single `*em*` is CommonMark FLANKING-AWARE ───────────────────────────────
// Whitespace-flanked asterisks — arithmetic ("3 * 4 * 5"), a bare glob
// ("* wildcard *") — must NOT be read as an emphasis span and italicise the
// prose between them. RED PROOF: the genuine old non-flanking rule (emOldMd,
// below) reproduces the mangle. LLM research reports emit `a * b` multiplication
// and standalone `*` often enough to reach the innerHTML reader.
{
  const oesc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // The OLD single-asterisk rule, in isolation, on already-escaped text.
  const emOldMd = (md) => oesc(md).replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  // RED PROOF: the old rule mis-pairs the two arithmetic asterisks.
  ok(/<em> 4 <\/em>/.test(emOldMd('Multiply 3 * 4 * 5 now')),
     'RED PROOF: old rule italicises the prose between two whitespace-flanked `*`');

  // FIX: arithmetic with bare `*` is left literal (no <em> injected).
  const arith = mdToHtml('Multiply 3 * 4 * 5 now');
  ok(!/<em>/.test(arith), 'FIX: `3 * 4 * 5` arithmetic emits no <em>');
  ok(/3 \* 4 \* 5/.test(arith), 'FIX: the literal asterisks survive in the body');

  // FIX: two space-flanked asterisks around real words stay literal.
  const glob = mdToHtml('Use a bare * wildcard * here.');
  ok(!/<em>/.test(glob), 'FIX: `* wildcard *` (space-flanked) is not emphasis');

  // GUARD: a genuine, tightly-wrapped `*italic*` still renders.
  eq(mdToHtml('A real *italic* word.'), '<p>A real <em>italic</em> word.</p>',
     'GUARD: tightly-wrapped *italic* still becomes <em>');
  // GUARD: single-char emphasis `*x*` still works (optional inner group).
  eq(mdToHtml('note *x* here'), '<p>note <em>x</em> here</p>',
     'GUARD: single-char *x* emphasis still renders');
  // GUARD: an opener with a trailing space cannot open (left-flanking).
  ok(!/<em>/.test(mdToHtml('a* b *c')), 'GUARD: `a* b *c` — no left-flanking opener, no <em>');
}

// ── `**bold**` / `***bi***` are CommonMark FLANKING-AWARE too ─────────────────
// The single-`*` and `_` rules were made flanking-aware; `**`/`***` were not.
// So two whitespace-flanked `**` — power notation ("2 ** 10 to 2 ** 20"), a bare
// "** note **" — mis-paired and BOLDED the prose between them
// ("2 <strong> 10 to 2 </strong> 20"). Technical deep-research reports emit
// `a ** b` power notation often enough to reach the innerHTML reader. The fix
// pins both `**`/`***` edges to a non-whitespace, non-`*` char (and tightens the
// single-`*` edges to `[^\s*]` so a leftover asterisk from a declined `**` run
// isn't re-grabbed as single-em). RED PROOF: the genuine old non-flanking
// `**`/`***`/`*` passes, in isolation, reproduce the mangle.
{
  const oesc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const emOldMd = (md) =>
    oesc(md)
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(\S(?:[^*\n]*?\S)?)\*/g, '$1<em>$2</em>');

  // RED PROOF: the old rule bolds the prose between two whitespace-flanked `**`.
  ok(/<strong> 10 to 2 <\/strong>/.test(emOldMd('2 ** 10 to 2 ** 20')),
     'RED PROOF: old rule bolds the prose between two whitespace-flanked `**`');

  // FIX: power notation with bare `**` is left literal (no <strong> injected).
  const pow = mdToHtml('values range from 2 ** 10 to 2 ** 20 bits');
  ok(!/<strong>/.test(pow), 'FIX: `2 ** 10 to 2 ** 20` power notation emits no <strong>');
  ok(/2 \*\* 10 to 2 \*\* 20/.test(pow), 'FIX: the literal `**` asterisks survive in the body');

  // FIX: a whitespace-padded triple stays fully literal (no half-eaten <strong>).
  const tri = mdToHtml('a *** b *** c literal');
  ok(!/<strong>/.test(tri) && /a \*\*\* b \*\*\* c/.test(tri),
     'FIX: `a *** b *** c` (space-flanked triple) stays literal');

  // GUARD: genuine, tightly-wrapped bold / bold-italic still render.
  eq(mdToHtml('real **bold** here'), '<p>real <strong>bold</strong> here</p>',
     'GUARD: tightly-wrapped **bold** still becomes <strong>');
  eq(mdToHtml('real ***both*** here'), '<p>real <strong><em>both</em></strong> here</p>',
     'GUARD: tightly-wrapped ***both*** still becomes <strong><em>');
  // GUARD: single-char bold / bold-italic still work (optional inner group).
  eq(mdToHtml('one **X** two'), '<p>one <strong>X</strong> two</p>',
     'GUARD: single-char **X** still renders');
  eq(mdToHtml('one ***X*** two'), '<p>one <strong><em>X</em></strong> two</p>',
     'GUARD: single-char ***X*** still renders');
  // GUARD: **bold** containing a nested *italic* still renders both.
  eq(mdToHtml('**bold with *italic* inside**'),
     '<p><strong>bold with <em>italic</em> inside</strong></p>',
     'GUARD: **bold** with a nested *italic* renders both');
}

// ── CommonMark AUTOLINKS: `<https://…>` / `<mailto:…>` / bare `<email>` ──
// esc() turns the delimiters into &lt;/&gt;, so with no autolink rule the whole
// `<url>` leaked into the reader as literal text — while the TTS narrator already
// treated it as a link (the visual reader was the inconsistent one). The fix
// routes the destination through safeHref and stashes the rendered <a>.
{
  // RED PROOF: without an autolink rule the delimiters survive esc() and the
  // autolink renders as literal `&lt;…&gt;` text (no <a> tag). oldMd (top of file)
  // has no autolink handling, so it reproduces the leak.
  const leak = oldMd('See <https://example.com> here');
  ok(/&lt;https:\/\/example\.com&gt;/.test(leak) && !/<a /.test(leak),
     'RED PROOF: without the rule, <https://…> leaks as literal &lt;…&gt; text');

  // FIX: a scheme autolink becomes a real, scheme-checked link.
  const auto = mdToHtml('See <https://example.com> here');
  ok(/<a href="https:\/\/example\.com" target="_blank" rel="noopener">https:\/\/example\.com<\/a>/.test(auto),
     'FIX: <https://…> renders a clickable link with the URL as label');
  ok(!/&lt;https/.test(auto), 'FIX: no literal &lt;https leaks alongside the link');

  // FIX: mailto autolink and bare-email autolink both linkify (email -> mailto:).
  ok(/<a href="mailto:hi@newpress\.co"/.test(mdToHtml('Mail <mailto:hi@newpress.co> now')),
     'FIX: <mailto:…> autolink linkified');
  ok(/<a href="mailto:hi@newpress\.co"[^>]*>hi@newpress\.co<\/a>/.test(mdToHtml('Reach <hi@newpress.co> today')),
     'FIX: bare <email> autolink linkified via mailto: with the email as label');

  // GUARD: a dangerous scheme in an autolink is NOT linkified — safeHref drops it
  // and the text stays literal (this is the load-bearing security assertion;
  // neutering the safeHref call turns it RED by emitting a live javascript: href).
  const danger = mdToHtml('Danger <javascript:alert(1)> here');
  ok(!/<a /.test(danger) && !/href="javascript:/.test(danger),
     'GUARD: <javascript:…> autolink is never a live href — stays literal');
  ok(!/<a /.test(mdToHtml('FTP <ftp://x.com/f> here')),
     'GUARD: a non-whitelisted scheme (<ftp://…>) is left literal, not linkified');

  // GUARD: prose that merely contains < and > is untouched (spaces / no scheme).
  eq(mdToHtml('Compare a < b and c > d'), '<p>Compare a &lt; b and c &gt; d</p>',
     'GUARD: prose comparison "a < b … c > d" stays literal');
  eq(mdToHtml('A heart <3 always'), '<p>A heart &lt;3 always</p>',
     'GUARD: bare "<3" (no scheme/@) stays literal');

  // GUARD: a disambiguation URL keeps its parens; an existing [label](url) link
  // and a query-string `&` still render exactly as before (no regression).
  ok(/wiki\/Burma_\(Myanmar\)<\/a>/.test(mdToHtml('<https://en.wikipedia.org/wiki/Burma_(Myanmar)>')),
     'GUARD: autolink with balanced parens keeps them in href+label');
  eq(mdToHtml('[label](https://normal.com) still works'),
     '<p><a href="https://normal.com" target="_blank" rel="noopener">label</a> still works</p>',
     'GUARD: existing inline [label](url) link unaffected by the autolink pass');
}

// ── GFM task-list checkboxes render a checkbox, not the literal [ ]/[x] marker ──
// A deep-research report routinely emits action-item checklists ("- [ ] do X",
// "- [x] done"). The reader used to run these through the GENERIC bullet rule,
// which captured "[ ] do X" as the item TEXT and leaked the raw checkbox marker
// into the report ("<li>[ ] do X</li>"). The TTS narrator already strips these,
// so the visual reader was the lone inconsistent path. FIX: a task-list rule runs
// BEFORE the bullet rule and renders a disabled checkbox. Mutation-proof: revert
// the fix (remove the task-list rule) and every FIX assertion below goes RED.
{
  const box = mdToHtml('- [ ] open task\n- [x] done task');
  ok(/<ul>/.test(box) && !/\[ \]/.test(box) && !/\[x\]/.test(box),
     'FIX: task-list [ ]/[x] markers are gone — no literal checkbox leaks into the reader');
  ok(/<li><input type="checkbox" disabled> open task<\/li>/.test(box),
     'FIX: "- [ ] open task" renders an unchecked disabled checkbox + text');
  ok(/<li><input type="checkbox" disabled checked> done task<\/li>/.test(box),
     'FIX: "- [x] done task" renders a CHECKED disabled checkbox + text');
  ok(/<ul><li><input[\s\S]*<\/li>\n?<li><input[\s\S]*<\/li><\/ul>/.test(box),
     'FIX: consecutive task items fold into one <ul>');

  // Uppercase [X] and a `*`/`+` bullet marker are all valid GFM task syntax.
  ok(/<input type="checkbox" disabled checked>/.test(mdToHtml('* [X] shout done')),
     'FIX: "* [X]" (uppercase, asterisk bullet) renders checked');
  ok(/<input type="checkbox" disabled>/.test(mdToHtml('+ [ ] plus bullet task')),
     'FIX: "+ [ ] …" (plus bullet) renders an unchecked checkbox');

  // Task text still flows through the inline emphasis pass.
  ok(/<li><input type="checkbox" disabled> ship <em>the<\/em> fix<\/li>/.test(mdToHtml('- [ ] ship *the* fix')),
     'FIX: emphasis inside a task item still renders (<em> inside the <li>)');

  // GUARD: a plain bullet with a bracketed aside is NOT mistaken for a task item.
  const plain = mdToHtml('- see note [1] below');
  ok(/<li>see note \[1\] below<\/li>/.test(plain) && !/<input/.test(plain),
     'GUARD: a normal "- text [1]" bullet is untouched (no checkbox)');
  // GUARD: prose "[x]" mid-sentence (no leading bullet) is never a checkbox.
  ok(!/<input/.test(mdToHtml('The value [x] is unknown here')),
     'GUARD: mid-prose "[x]" is not turned into a checkbox');

  // RED PROOF: the old path (generic bullet rule with no task rule) leaks the marker.
  const oldTask = (() => {
    let h = esc('- [ ] open task');
    h = h.replace(/^[ \t]*(?:- |\* )(.*)$/gm, '<li>$1</li>');
    return h;
  })();
  ok(/<li>\[ \] open task<\/li>/.test(oldTask),
     'RED PROOF: without the task rule the generic bullet leaks "[ ] open task"');
}

// ── Ordered lists with a `)` delimiter (CommonMark allows both `1.` and `1)`) ──
// The renderer matched only `\d+\. `, so a paren-delimited ordered list leaked
// into the reader as a fused literal `<p>1) foo<br>2) bar</p>` — the ")" text
// preserved and the whole list collapsed into one paragraph. The TTS narrator
// already accepts both delimiters, so the visual reader was the inconsistent one.
{
  const paren = mdToHtml('1) first\n2) second');
  // FIX: a `1)`/`2)` list becomes a real <ol> with clean item text (no ")" leak).
  ok(/<ol>/.test(paren), 'FIX: "1)"-delimited list renders an <ol>');
  ok(/<li>first<\/li>/.test(paren) && /<li>second<\/li>/.test(paren),
     'FIX: paren-list item text is clean (no leaked ")")');
  ok(!/1\)/.test(paren) && !/<p>/.test(paren),
     'FIX: no literal "1)" and no fused <p> paragraph survives');

  // GUARD: the classic `1.` delimiter still renders an <ol> (no regression).
  ok(/<ol>/.test(mdToHtml('1. one\n2. two')), 'GUARD: "1."-delimited list still an <ol>');
  // GUARD: paren-list emphasis inside an item still renders.
  ok(/<li>ship <em>the<\/em> fix<\/li>/.test(mdToHtml('1) ship *the* fix')),
     'GUARD: emphasis inside a paren-list item still renders');

  // RED PROOF: the OLD dot-only rule leaves a `1)` list as an unclaimed line —
  // it never becomes an <oli>, so it falls through to a literal paragraph.
  const oldOrdered = (() => {
    let h = esc('1) first\n2) second');
    h = h.replace(/^[ \t]*\d+\. (.*)$/gm, '<oli>$1</oli>');
    return h;
  })();
  ok(!/<oli>/.test(oldOrdered),
     'RED PROOF: the dot-only rule fails to claim a "1)" list (no <oli> produced)');
}

// ── Reference-link DEFINITION with an ANGLE-BRACKET destination ──
// `[a]: <https://x/y>` is a CommonMark-legal ref definition. The autolink pass
// used to run BEFORE the ref-def collector, so it ate the `&lt;url&gt;` on the
// definition line into a stashed <a>, the collector captured that sentinel as
// the dest, and stash-restore re-expanded it INSIDE the later ref-link's href —
// producing a mangled double-nested `<a href="<a href=...>...</a>">a</a>`.
// FIX: collect (and strip) ref definitions BEFORE the autolink pass, and strip a
// wrapping `<…>` from the destination.
{
  const ang = mdToHtml('[a]\n\n[a]: <https://x.com/y>').trim();
  // FIX: one clean anchor, bare URL in the href, no nested <a>.
  ok(ang === '<p><a href="https://x.com/y" target="_blank" rel="noopener">a</a></p>',
     'FIX: angle-bracket ref dest renders one clean <a> with a bare href');
  ok(!/href="<a/.test(ang) && (ang.match(/<a /g) || []).length === 1,
     'FIX: no double-nested <a> (exactly one anchor)');
  ok(!/&lt;|&gt;/.test(ang), 'FIX: the angle brackets are stripped, not leaked');

  // GUARD: a BARE (non-angle) ref dest is byte-identical — no regression.
  ok(mdToHtml('[a]\n\n[a]: https://x.com/y').trim() === ang,
     'GUARD: angle-dest output matches the bare-dest output exactly');
  // GUARD: full/collapsed and titled refs still resolve.
  ok(/<a href="https:\/\/ex.com\/z"[^>]*>the report<\/a>/.test(
       mdToHtml('[the report][1]\n\n[1]: https://ex.com/z')),
     'GUARD: full reference still resolves');
  // GUARD: an inline autolink on a NON-definition line still renders.
  ok(/see <a href="https:\/\/foo.com\/bar"[^>]*>https:\/\/foo.com\/bar<\/a> here/.test(
       mdToHtml('see <https://foo.com/bar> here')),
     'GUARD: inline autolink outside a ref-def still works');
  // GUARD: a dangerous angle-bracket dest is dropped (scheme whitelist holds).
  ok(mdToHtml('[a]\n\n[a]: <javascript:alert(1)>').trim() === '<p>[a]</p>',
     'GUARD: javascript: angle dest drops the link (no live href)');

  // RED PROOF: with the OLD ordering (autolink BEFORE ref-def collect, no strip),
  // the angle dest double-nests. Re-derive that path over the shipped helpers.
  const oldPath = (() => {
    let h = esc('[a]\n\n[a]: <https://x.com/y>');
    const stash = [];
    const stub = (r) => `${stash.push(r) - 1}`;
    // autolink FIRST (the buggy order)
    h = h.replace(/&lt;([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]+?)&gt;/g, (whole, url) => {
      const href = safeHref(url);
      return href ? stub(`<a href="${href}" target="_blank" rel="noopener">${url}</a>`) : whole;
    });
    // then ref-def collect WITHOUT stripping angle brackets
    const refs = new Map();
    h = h.replace(/^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(\S+)[ \t]*$/gm, (_, label, dest) => {
      refs.set(label.trim().toLowerCase(), dest);
      return '';
    });
    // shortcut ref resolution
    h = h.replace(/\[([^\]\n]+)\]/g, (whole, label) => {
      const dest = refs.get(label.trim().toLowerCase());
      if (dest === undefined) return whole;
      const href = safeHref(dest);
      return href ? `<a href="${href}" target="_blank" rel="noopener">${label}</a>` : whole;
    });
    h = h.replace(/(\d+)/g, (_, i) => stash[Number(i)]);
    return h;
  })();
  ok(/href="<a /.test(oldPath),
     'RED PROOF: the OLD autolink-first ordering double-nests the <a> tag');
}

// ── CommonMark BACKSLASH ESCAPES (research/md.js) ──────────────────────────
// A `\` before an ASCII-punctuation char makes it LITERAL and strips its
// markdown meaning. Before the fix mdToHtml had NO backslash handling, so an
// escaped `\*word\*` was italicised AND leaked its backslashes, and `\#`/`\[`/`\$`
// leaked the backslash into the report. The TTS narrator
// (api/_lib/burma-essays-text.js) already unescaped these — the visual reader was
// the lone inconsistent path. LLM research prose emits escapes constantly
// (showing literal markdown, `\$` before a price, `2 \* 3` for a literal star).
{
  // RED PROOF: the OLD (no-escape) path leaked backslashes AND spuriously emphasised.
  // Reconstruct just the single-`*` emphasis pass the shipped renderer runs, with
  // NO backslash handling in front of it — exactly the pre-fix behavior.
  const oldEscPath = (() => {
    let h = esc('a \\*escaped\\* star');
    h = h.replace(/(^|[^*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*/g, '$1<em>$2</em>');
    return h;
  })();
  ok(/\\<em>escaped\\<\/em>/.test(oldEscPath),
     'RED PROOF: old no-escape path leaks backslashes and wraps escaped \\*…\\* in <em>');

  // FIX: escaped delimiters render as their LITERAL char — no <em>, no backslash.
  eq(mdToHtml('a \\*escaped\\* star'), '<p>a *escaped* star</p>',
     'escaped \\*…\\* -> literal asterisks, no emphasis, no backslash');
  eq(mdToHtml('2 \\* 3 = 6'), '<p>2 * 3 = 6</p>',
     'escaped multiply asterisk stays literal');
  eq(mdToHtml('escaped \\_underscore\\_ word'), '<p>escaped _underscore_ word</p>',
     'escaped \\_…\\_ -> literal underscores, no emphasis');
  eq(mdToHtml('\\# not a heading'), '<p># not a heading</p>',
     'escaped \\# -> literal hash, not an <h1>');
  eq(mdToHtml('a \\[not a link\\] here'), '<p>a [not a link] here</p>',
     'escaped \\[ \\] -> literal brackets');
  eq(mdToHtml('price is \\$5 today'), '<p>price is $5 today</p>',
     'escaped \\$ -> literal dollar sign');
  eq(mdToHtml('a backslash \\\\ then text'), '<p>a backslash \\ then text</p>',
     'escaped \\\\ -> one literal backslash');
  // Entity-producing escapes stay HTML-safe (esc() ran first, so `\<` is `\&lt;`).
  eq(mdToHtml('escaped \\<tag\\> here'), '<p>escaped &lt;tag&gt; here</p>',
     'escaped \\< \\> -> literal, entity-encoded (no live tag)');
  eq(mdToHtml('escaped \\& ampersand'), '<p>escaped &amp; ampersand</p>',
     'escaped \\& -> literal ampersand, entity-encoded');

  // NON-REGRESSION: a backslash before a NON-punctuation char is NOT an escape
  // (a Windows path, a LaTeX macro) and must survive untouched; real markdown
  // must still render.
  eq(mdToHtml('LaTeX \\alpha stays'), '<p>LaTeX \\alpha stays</p>',
     'backslash + letter is not an escape — left literal');
  eq(mdToHtml('C:\\\\Users\\\\Johnny'), '<p>C:\\Users\\Johnny</p>',
     'windows path double-backslash collapses per CommonMark, no mangling');
  eq(mdToHtml('**bold** and *italic*'), '<p><strong>bold</strong> and <em>italic</em></p>',
     'REGRESSION: unescaped emphasis still renders');
  eq(mdToHtml('`\\*in code\\*`'), '<p><code>\\*in code\\*</code></p>',
     'REGRESSION: backslash escapes are INERT inside code spans (verbatim)');
}

// ── TILDE fenced code blocks (`~~~`) render VERBATIM like ``` fences ──────────
// CommonMark allows a 3+ tilde fence as an alternative to backticks; the canonical
// reason to use `~~~` is to show a block that itself CONTAINS ``` backticks, so
// research prose about code/markdown emits them. Before the fix, a tilde fence was
// never stashed: its body ran through every heading/emphasis transform (`**x**` ->
// <strong>, `# y` -> <h1> INSIDE the code) and the `~~~` markers leaked. The TTS
// narrator (api/_lib/burma-essays-text.js) already drops tilde fences, so the
// VISUAL reader was the lone leaking path. Mutation-proven: delete the tilde-stash
// line in research/md.js and the load-bearing assertions below go RED.
{
  const body = mdToHtml('~~~js\nconst x = **not bold**;\n# not heading\n~~~');
  eq(body, '<pre><code>const x = **not bold**;\n# not heading</code></pre>',
     'FIX: tilde-fenced body renders verbatim in <pre><code>');
  // LOAD-BEARING (mutation lock): the fenced body must NOT be transformed and the
  // markers must NOT leak. Remove the tilde stash and every one of these fails.
  ok(!/<strong>/.test(body), 'MUTATION: `**x**` inside a tilde fence is NOT bolded');
  ok(!/<h1>/.test(body), 'MUTATION: `# y` inside a tilde fence is NOT a heading');
  ok(!/~~~/.test(body), 'MUTATION: the `~~~` fence markers do not leak into the reader');

  // A tilde fence containing ``` backticks preserves them as literal code text
  // (the whole point of choosing `~~~`). Stashing tilde FIRST is what makes the
  // inner ``` survive instead of being eaten as a nested backtick fence.
  eq(mdToHtml('~~~\nshow: ```js\ncode();\n``` end\n~~~'),
     '<pre><code>show: ```js\ncode();\n``` end</code></pre>',
     'FIX: ``` backticks inside a tilde fence survive as literal code');

  // GUARDS / REGRESSION: nothing about strikethrough, lone tildes, or backtick
  // fences changes.
  eq(mdToHtml('This is ~~struck~~ text.'), '<p>This is <del>struck</del> text.</p>',
     'REGRESSION: inline ~~strike~~ (2 tildes) still renders <del>');
  eq(mdToHtml('~~a~~ and ~~b~~'), '<p><del>a</del> and <del>b</del></p>',
     'REGRESSION: adjacent 2-tilde strike spans unaffected by the 3+ fence rule');
  eq(mdToHtml('Approx ~5 to ~10 items.'), '<p>Approx ~5 to ~10 items.</p>',
     'REGRESSION: lone tildes in prose are left literal');
  eq(mdToHtml('```js\nconst y = 1;\n```'), '<pre><code>const y = 1;</code></pre>',
     'REGRESSION: backtick fences still render verbatim');
}

// ── Pandoc/GFM FOOTNOTES are NOT reference links (no broken-link corruption) ──
// A `[^id]: text` line is a footnote definition and `[^id]` in the prose is a
// footnote reference — deep-research LLMs (Claude/Gemini/OpenAI) emit these
// constantly, with the citation URL living in the definition. Before the fix,
// the reference-definition collector captured `[^1]: note` as a link def
// (label `^1` -> dest `note`) and the shortcut resolver then turned the footnote
// ref `[^1]` into a BROKEN link `<a href="note">^1</a>` — a bogus relative href,
// active content corruption in the reader. The fix skips `^`-prefixed labels in
// the def collector, so the ref never resolves and both render as honest literal
// text with the citation still visible. Mutation-proven: delete the
// `if (label.startsWith('^')) return _;` guard in research/md.js and the
// load-bearing assertions below go RED (the broken <a href> reappears).
{
  const ftn = mdToHtml('text[^1]\n\n[^1]: note');
  // LOAD-BEARING (mutation lock): the footnote ref must NOT become a link, and
  // there must be no bogus relative href anywhere.
  ok(!/<a /.test(ftn), 'MUTATION: a footnote `[^1]` is NOT linkified');
  ok(!/href="note"/.test(ftn), 'MUTATION: no bogus relative href="note" is emitted');
  eq(ftn, '<p>text[^1]</p>\n<p>[^1]: note</p>',
     'FIX: `[^1]` ref + `[^1]: note` def render as honest literal text');

  // The citation URL in a footnote DEFINITION stays visible AND — since the
  // GFM bare-autolink pass runs — becomes a clickable link (the definition line
  // is honest visible prose; a clickable citation is exactly the improvement).
  // The footnote REF itself (`[^src]`) still stays literal (asserted below), so
  // the load-bearing footnote-guard behavior is unchanged; only the def's bare
  // URL is now linkified, consistent with every other bare URL in the report.
  const withUrl = mdToHtml('See it[^src].\n\n[^src]: https://example.com/paper');
  ok(/example\.com\/paper/.test(withUrl),
     'FIX: the footnote definition URL is preserved (visible), not swallowed');
  ok(/<a href="https:\/\/example\.com\/paper" target="_blank" rel="noopener">https:\/\/example\.com\/paper<\/a>/.test(withUrl),
     'FIX: the footnote definition URL is now a clickable link (GFM bare autolink)');
  ok(/See it\[\^src\]\./.test(withUrl),
     'LOAD-BEARING: the footnote REF `[^src]` still stays literal, not linkified');

  // Word-id footnotes behave the same way.
  ok(!/<a /.test(mdToHtml('Claim[^note] here.\n\n[^note]: because reasons')),
     'MUTATION: a word-id footnote `[^note]` is NOT linkified');

  // REGRESSION: real numbered reference links + shortcut refs are byte-identical.
  eq(mdToHtml('The [report][1] says.\n\n[1]: https://x.com/r'),
     '<p>The <a href="https://x.com/r" target="_blank" rel="noopener">report</a> says.</p>\n',
     'REGRESSION: full reference link `[report][1]` still resolves');
  eq(mdToHtml('See [1].\n\n[1]: https://x.com'),
     '<p>See <a href="https://x.com" target="_blank" rel="noopener">1</a>.</p>\n',
     'REGRESSION: shortcut reference `[1]` still resolves');
  // A footnote and a real numbered ref can coexist in one report: the footnote
  // stays literal, the real ref still links.
  const mixed = mdToHtml('Both[^1] and [see][2].\n\n[2]: https://x.com');
  ok(/<a href="https:\/\/x\.com"/.test(mixed), 'REGRESSION: the real `[see][2]` ref links');
  ok(/\[\^1\]/.test(mixed), 'FIX: the coexisting footnote `[^1]` stays literal');
}

// ── HTML COMMENTS: dropped, not leaked (parity with the TTS narrator) ──────────
// The narrator (api/_lib/burma-essays-text.js) strips `<!--…-->` so it is never
// read aloud; the visual reader used to leak the comment as literal
// `&lt;!-- … --&gt;` text. Mutation-proven: delete the
// `html.replace(/&lt;!--[\s\S]*?--&gt;/g, '')` line in research/md.js and the
// first two assertions below go RED (the escaped-comment text reappears).
{
  const c = mdToHtml('Before <!-- reviewer: verify this stat --> after.');
  ok(!/reviewer: verify this stat/.test(c), 'MUTATION: HTML comment body is dropped');
  ok(!/&lt;!--|--&gt;/.test(c), 'MUTATION: no escaped comment delimiters leak into the reader');
  eq(c, '<p>Before  after.</p>', 'FIX: comment removed, surrounding prose intact');

  // Multi-line comments close at their own terminator.
  ok(!/secret/.test(mdToHtml('a\n<!--\nsecret\nnote\n-->\nb')),
     'FIX: a multi-line HTML comment is fully removed');
  // Two comments on one line don't merge (non-greedy): the text between survives.
  ok(/keep me/.test(mdToHtml('<!-- one -->keep me<!-- two -->')),
     'FIX: non-greedy strip keeps text between two comments');
  // A comment shown INSIDE a code span is protected (stashed before the strip).
  const inCode = mdToHtml('Use `<!-- x -->` in HTML.');
  ok(/&lt;!-- x --&gt;/.test(inCode), 'REGRESSION: a comment inside a code span is preserved verbatim');
}

// ── ==highlight== renders as <mark>, flanking-aware (parity with the narrator) ─
// The narrator unwraps `==…==`; the visual reader used to leak literal `==` marks.
// Mutation-proven: delete the `==(...)==` -> <mark> line in research/md.js and the
// first two assertions go RED (the literal `==` markers reappear).
{
  const h = mdToHtml('This is ==really important== to note.');
  ok(/<mark>really important<\/mark>/.test(h), 'MUTATION: ==highlight== renders as <mark>');
  ok(!/==/.test(h), 'MUTATION: the == markers do not leak into the reader');

  // Single-char highlight via the optional inner group.
  ok(/<mark>x<\/mark>/.test(mdToHtml('==x==')), 'FIX: single-char ==x== highlights');

  // FLANKING: a whitespace-flanked chained comparison is NOT a highlight span.
  const cmp = mdToHtml('if a == b == c then stop');
  ok(!/<mark>/.test(cmp), 'FIX: "a == b == c" comparison is not mistaken for a highlight');
  ok(/a == b == c/.test(cmp), 'FIX: the literal comparison text is preserved');
  ok(!/<mark>/.test(mdToHtml('x == y')), 'FIX: a lone "x == y" is not highlighted');

  // Nested emphasis inside a highlight still renders (emphasis runs first).
  ok(/<mark><strong>hot<\/strong><\/mark>/.test(mdToHtml('==**hot**==')),
     'FIX: ==**bold**== nests <strong> inside <mark>');
  // A link inside a highlight still linkifies.
  ok(/<mark>see <a href="https:\/\/x\.com"/.test(mdToHtml('==see [it](https://x.com)==')),
     'FIX: a link inside a highlight still renders');
}

// ── A block element GLUED to a lead-in line (no blank line) interrupts the ──
// paragraph. LLM research reports constantly write a lead-in immediately
// followed by a list ("Key findings:\n- a\n- b") with no blank line between.
// Before the fix the \n{2,} paragraph splitter treated the whole run as one
// block; the lead-in text failed the "starts with a block tag" test, so the
// entire run — list included — was <p>-wrapped with its newlines turned to
// <br>, emitting invalid `<p>Key findings:<br><ul><li>a</li><br><li>b</li></ul></p>`
// (a <ul> nested inside a <p>, with stray <br> between the items). MUTATION:
// delete the pre-split paragraph-break injection in md.js and these go RED.
{
  const h = mdToHtml('Key findings:\n- a\n- b');
  ok(/<p>Key findings:<\/p>/.test(h), 'MUTATION: lead-in glued to a list closes its own <p>');
  ok(/<ul><li>a<\/li>\s*<li>b<\/li><\/ul>/.test(h), 'MUTATION: the list is a clean sibling <ul>');
  ok(!/<ul>[\s\S]*<br>[\s\S]*<\/ul>/.test(h), 'MUTATION: no stray <br> injected between the list items');
  ok(!/<p>[^<]*<ul>/.test(h), 'MUTATION: the <ul> is never nested inside a <p>');

  // A glued ORDERED list, heading, blockquote, and table interrupt too.
  ok(/<p>Steps:<\/p>\s*<ol>/.test(mdToHtml('Steps:\n1. first\n2. second')),
     'FIX: lead-in glued to a numbered list interrupts into an <ol>');
  ok(/<p>intro para<\/p>\s*<h2>Section<\/h2>/.test(mdToHtml('intro para\n## Section')),
     'FIX: a heading interrupts a preceding paragraph line');
  ok(/<p>He said:<\/p>\s*<blockquote>/.test(mdToHtml('He said:\n> a quote')),
     'FIX: a blockquote interrupts a preceding paragraph line');
  ok(/<p>Data:<\/p>\s*<table>/.test(mdToHtml('Data:\na | b\n--- | ---\n1 | 2')),
     'FIX: a table interrupts a preceding paragraph line');

  // A lead-in ending in an inline tag then `:` still splits (prefix is the `:`).
  ok(/<p>Key <strong>findings<\/strong>:<\/p>\s*<ul>/.test(mdToHtml('Key **findings**:\n- a\n- b')),
     'FIX: lead-in ending in bold + colon still interrupts into the list');

  // ── A lead-in that ENDS in an inline element (the label itself is bolded) ──
  // glued to a list — `**Key findings:**\n- a\n- b`, an extremely common
  // deep-research pattern. The rendered lead-in is `<strong>Key findings:</strong>`
  // whose trailing `>` the original `[^\n>]` guard EXCLUDED, so the whole run was
  // still <p>-wrapped into invalid `<p><strong>…</strong><br><ul>…</ul></p>`.
  // MUTATION: revert the injection prefix to the bare `[^\n>]` and every FIX below
  // goes RED (the inline-close alternation is what admits these).
  {
    const b = mdToHtml('**Key findings:**\n- first\n- second');
    ok(/<p><strong>Key findings:<\/strong><\/p>\s*<ul>/.test(b),
       'FIX: a fully-bolded lead-in label closes its own <p> before the list');
    ok(!/<p>[\s\S]*?<br>[\s\S]*?<ul>/.test(b), 'MUTATION: no <br>+<ul> fused inside a <p>');
    ok(!/<ul>[\s\S]*?<br>[\s\S]*?<li>/.test(b), 'MUTATION: no stray <br> between the list items');
  }
  ok(/<p><em>Note:<\/em><\/p>\s*<ul>/.test(mdToHtml('*Note:*\n- a\n- b')),
     'FIX: an italic lead-in label interrupts into the list');
  ok(/<p><strong><em>Critical:<\/em><\/strong><\/p>\s*<ul>/.test(mdToHtml('***Critical:***\n- a\n- b')),
     'FIX: a bold-italic lead-in label interrupts into the list');
  ok(/<p><a [^>]*>See report<\/a>:<\/p>\s*<ul>/.test(mdToHtml('[See report](https://x.com):\n- a\n- b')),
     'FIX: a link lead-in interrupts into the list');
  ok(/<p><strong>Steps:<\/strong><\/p>\s*<ol>/.test(mdToHtml('**Steps:**\n1. one\n2. two')),
     'FIX: a bolded lead-in interrupts into an ordered list');
  ok(/<p><strong>intro<\/strong><\/p>\s*<h2>Section<\/h2>/.test(mdToHtml('**intro**\n## Section')),
     'FIX: a bolded lead-in interrupts into a heading');

  // NO-REGRESSION: a bolded word mid-paragraph (NOT before a block) is untouched.
  ok(/<p>This is <strong>bold<\/strong> text\.<\/p>/.test(mdToHtml('This is **bold** text.')),
     'FIX: bold inside a plain paragraph injects no phantom break');

  // NO-REGRESSION: two ADJACENT block elements (a loose list) are untouched —
  // the `[^\n>]` prefix excludes a `>` (tag close), so no spurious break is
  // injected between `</ul>` and the next `<ul>`.
  const loose = mdToHtml('- one\n\n- two');
  ok(!/<p>/.test(loose), 'FIX: a loose list injects no phantom <p> between its items');
}

// ── Hard-break markers are DROPPED, not rendered ──────────────────────────────
// The paragraph pass converts every intra-paragraph newline to <br> (this renderer
// preserves the author's line structure). CommonMark hard-break MARKERS — a trailing
// `\` or trailing spaces right before the newline — must be dropped along with the
// newline, not left in the reader. The old bare `\n`→`<br>` kept them: `word\`+newline
// leaked a literal backslash (`word\<br>`) and a two-space break kept trailing spaces.
{
  const BS = String.fromCharCode(92); // a single literal backslash
  const bsBreak = mdToHtml('line one' + BS + '\nline two');
  eq(bsBreak, '<p>line one<br>line two</p>',
     'FIX: a trailing backslash hard break drops the backslash');
  // MUTATION: with the old bare `\n`→`<br>`, the backslash survives as a literal.
  ok(!/line one\\<br>/.test(bsBreak), 'MUTATION: no stray backslash leaks before the <br>');

  eq(mdToHtml('line one  \nline two'), '<p>line one<br>line two</p>',
     'FIX: a two-space hard break drops the trailing spaces');

  // NO-REGRESSION: a plain soft newline still becomes a <br> (line structure kept).
  eq(mdToHtml('plain\nsoft'), '<p>plain<br>soft</p>',
     'NO-REGRESSION: a plain newline still renders as <br>');

  // NO-REGRESSION (load-bearing): a USER-escaped `\\` is an escaped literal
  // backslash and must survive as `\`. It is stubbed as a \uE0xx placeholder
  // BEFORE this pass and restored after, so the hard-break strip never eats it.
  ok(/escaped \\ literal/.test(mdToHtml('escaped ' + BS + BS + ' literal')),
     'NO-REGRESSION: an escaped \\\\ still renders one literal backslash');

  // NO-REGRESSION: a mid-line backslash not before a newline is untouched.
  ok(/C:\\Users/.test(mdToHtml('a path C:' + BS + 'Users here')),
     'NO-REGRESSION: a mid-line backslash is left alone');
}

// ── GFM EXTENDED AUTOLINKS: a bare http(s) URL in prose becomes clickable ──
// Deep-research reports cite sources as raw URLs constantly; before this they
// rendered as non-clickable plain text. The pass is strictly additive: existing
// links (inline `[](url)`, reference, angle-bracket autolink) are matched by the
// FIRST alternative and returned verbatim, so they can never be double-wrapped.
{
  // Baseline (mutation target): a bare URL now renders as a real link.
  const bare = mdToHtml('See https://example.com/report for details.');
  ok(/<a href="https:\/\/example\.com\/report" target="_blank" rel="noopener">https:\/\/example\.com\/report<\/a>/
     .test(bare), 'FIX: a bare https URL becomes a clickable <a>');
  // MUTATION: remove the bare-URL pass and this URL stays literal text (no <a>).
  ok(/<a /.test(bare), 'MUTATION: bare URL is linkified (no <a> means the pass was reverted)');

  // GFM trailing punctuation: a sentence-ending period is NOT part of the link.
  eq(mdToHtml('link: https://example.com.'),
     '<p>link: <a href="https://example.com" target="_blank" rel="noopener">https://example.com</a>.</p>',
     'FIX: a trailing sentence period is peeled off the URL and kept as text');

  // Unbalanced closing paren (from wrapping parens) is peeled; balanced kept.
  eq(mdToHtml('(https://example.com)'),
     '<p>(<a href="https://example.com" target="_blank" rel="noopener">https://example.com</a>)</p>',
     'FIX: an unbalanced wrapping ) is peeled off the URL');
  ok(/href="https:\/\/en\.wikipedia\.org\/wiki\/Taiwan_\(island\)"/
     .test(mdToHtml('https://en.wikipedia.org/wiki/Taiwan_(island)')),
     'FIX: a balanced ) inside the URL (Wikipedia disambiguation) is kept in the href');

  // NO-REGRESSION (load-bearing): an EXISTING inline link is untouched — the URL
  // inside its href/label is consumed by the anchor alternative, never re-matched.
  eq(mdToHtml('[the report](https://example.com/r)'),
     '<p><a href="https://example.com/r" target="_blank" rel="noopener">the report</a></p>',
     'NO-REGRESSION: an existing [](url) link is not double-wrapped');
  // A bare-looking URL as the VISIBLE label of an inline link stays single-wrapped.
  const labelIsUrl = mdToHtml('[https://example.com](https://example.com)');
  eq((labelIsUrl.match(/<a /g) || []).length, 1,
     'NO-REGRESSION: a URL used as a link label is not turned into a nested <a>');

  // SECURITY: a bare URL is still scheme-gated by safeHref, and its text carries
  // no live markup (the whole string is esc()'d up front). Only http(s) is matched
  // at all, so a javascript: scheme is never even a candidate — confirm no live js href.
  ok(!/href="javascript:/.test(mdToHtml('javascript:alert(1) https://ok.com')),
     'SECURITY: bare-URL pass only linkifies http(s), never a javascript: scheme');

  // NO-REGRESSION: prose with no scheme (a bare domain / www.) is left as text.
  ok(!/<a /.test(mdToHtml('visit example.com or www.example.com')),
     'NO-REGRESSION: bare www./domain (no scheme) is deliberately NOT linkified');

  // NO-REGRESSION: a URL inside a code span stays literal (code is stashed early).
  ok(!/<a /.test(mdToHtml('`https://example.com`')),
     'NO-REGRESSION: a URL inside a code span is not linkified');
}

console.log(`\nresearch/md.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗', f); process.exit(1); }
