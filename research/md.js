// Minimal, XSS-safe markdown -> HTML renderer for the research tool.
//
// The input is RESEARCH-REPORT prose written by an LLM (Claude / Gemini /
// OpenAI) that may quote or summarise adversarial web pages, so it is the
// least-trusted content in the app — and its output is assigned straight into
// innerHTML at both call sites. esc() neutralises raw tags by entity-encoding
// & < >, but the markdown LINK transform is the sharp edge: the captured URL
// flows into an href attribute. Two guards make that safe:
//   1. safeHref() whitelists the URL scheme via the URL parser (http/https/
//      mailto only) so a `javascript:` / `data:` / `vbscript:` link can never
//      become a live href — it degrades to the plain link label. Using the URL
//      parser (not a regex) defeats control-char obfuscation like `java\nscript:`,
//      which the parser strips before resolving the scheme.
//   2. The URL is quote-escaped before interpolation so it cannot break out of
//      the double-quoted href attribute (esc() does not touch quotes).

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Returns an attribute-safe href for an allowed scheme, or null to drop the
// link (render the label as plain text). `raw` has already been esc()'d, so &
// appears as &amp; — harmless for the scheme decision, and preserved verbatim
// in the returned href so the report's exact URL text survives.
export function safeHref(raw) {
  if (!raw) return null;
  const v = String(raw).trim();
  try {
    const u = new URL(v, 'https://research.local/');
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
      return v.replace(/"/g, '&quot;');
    }
  } catch {
    /* unparseable URL -> drop the link */
  }
  return null;
}

export function mdToHtml(md) {
  if (!md) return '';
  let html = esc(md);
  html = html.replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`);
  html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // URL capture allows one level of balanced parens so Wikipedia-style
  // disambiguation links — [Taiwan](…/Taiwan_(island)) — keep their closing
  // paren in the href instead of truncating at the first ')' and leaking a
  // stray ')' into the body text. `[^()]` still stops at an unmatched ')',
  // so it never over-consumes into trailing prose or a following link.
  html = html.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)/g, (_, label, url) => {
    const href = safeHref(url);
    return href ? `<a href="${href}" target="_blank" rel="noopener">${label}</a>` : label;
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
  // Ordered items get a distinct <oli> marker so the wrap pass below can emit a
  // numbered <ol> rather than a bulleted <ul> — and, critically, so they get
  // wrapped AT ALL. They were converted *after* the <ul> wrap before, leaving
  // every numbered list as orphan <li> with no list container (no <ol>/<ul>).
  html = html.replace(/^\d+\. (.*)$/gm, '<oli>$1</oli>');
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/(<oli>[\s\S]*?<\/oli>\n?)+/g, (m) => `<ol>${m.replace(/<(\/?)oli>/g, '<$1li>')}</ol>`);
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
