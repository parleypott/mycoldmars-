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

// ── NO-REGRESSION: normal markdown is byte-identical to the old renderer ──
// (old===new on every input WITHOUT a dangerous scheme or breakout quote, since
//  the only changes are the link transform and the ordered-list <ol> wrap — so
//  ordered-list inputs are EXCLUDED here and locked explicitly above instead)
const normalDocs = [
  '# Heading one\n\nsome **bold** and *italic* text.',
  '## Findings\n\n- first point\n- second point\n\nmore prose.',
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

console.log(`\nresearch/md.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗', f); process.exit(1); }
