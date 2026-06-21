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

// ── esc still covers the raw-tag boundary ──
eq(esc('<script>'), '&lt;script&gt;', 'esc neutralizes a tag');
eq(esc('a & b'), 'a &amp; b', 'esc ampersand');
eq(esc(null), '', 'esc null -> empty');
ok(!/<script>/.test(mdToHtml('here is <script>alert(1)</script> inline')), 'raw <script> in report neutralized');

// ── NO-REGRESSION: normal markdown is byte-identical to the old renderer ──
// (old===new on every input WITHOUT a dangerous scheme or breakout quote, since
//  the only change is the link transform and a safe URL round-trips identically)
const normalDocs = [
  '# Heading one\n\nsome **bold** and *italic* text.',
  '## Findings\n\n- first point\n- second point\n\nmore prose.',
  'inline `code` and a block:\n\n```\nconst x = 1;\n```',
  'a paragraph\nwith a soft break.\n\n1. ordered\n2. list',
  'a safe [citation](https://example.com/article) mid-sentence.',
  'mixed [link](https://a.com) and **bold** and `code` together.',
  '###### deep heading\n\n> not transformed but present',
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
