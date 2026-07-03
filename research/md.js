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

// Turn the raw content captured between a ```…``` pair into the code that renders
// inside <pre><code>. CommonMark treats the text on the OPENING fence line (the
// "info string" — almost always a bare language hint like `json`/`bash`/`ts`) as
// metadata, never as code, but the block regex captures it along with the body.
// So when the content spans multiple lines AND the first line is a bare language
// token (letters/digits/+#._-, or empty for a plain ``` fence), drop that line —
// otherwise every ```json / ```bash block would render its language word as a
// stray first line of code. A first line that carries spaces or punctuation is
// real code, not an info string, so it is kept untouched. Then trim the rest,
// matching the prior behavior for the no-info-string case byte-for-byte.
function fenceCode(c) {
  const nl = c.indexOf('\n');
  if (nl !== -1 && /^[A-Za-z0-9+#._-]*$/.test(c.slice(0, nl).trim())) {
    return c.slice(nl + 1).trim();
  }
  return c.trim();
}

// A GFM table delimiter row: one+ cells of optional-colon + dashes, pipe-joined,
// with optional outer pipes. e.g. `| --- | :--: |`, `---|---`, `| :-- |`.
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

// Split one pipe-delimited table line into trimmed cells, dropping the optional
// leading/trailing pipe. `…` code stubs (stashed code spans) contain no
// `|`, so a code span inside a cell survives the split intact.
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

// Render GFM pipe tables. LLM research reports (esp. deep-research runs) emit
// these constantly; without this a table leaked into the reader as a literal
// `| a | b |` paragraph. Runs AFTER the inline transforms so **bold**/[links]/
// `code` inside a cell already rendered, and the emitted <table> is whitelisted
// as block-level by the paragraph pass so it is never wrapped in <p>. A block is
// a table only when a header line containing `|` is followed by a delimiter row
// whose column count matches the header's — so a prose line that merely contains
// a `|` above a `---` thematic break is NOT mistaken for a table.
function renderTables(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    const delim = lines[i + 1];
    if (
      delim !== undefined &&
      header.includes('|') &&
      TABLE_DELIM.test(delim) &&
      splitTableRow(header).length === splitTableRow(delim).length
    ) {
      const headers = splitTableRow(header);
      const cols = headers.length;
      const body = [];
      let j = i + 2;
      // Body rows continue until a blank line or a non-pipe line (the table ends).
      while (j < lines.length && lines[j].trim() !== '' && lines[j].includes('|')) {
        body.push(splitTableRow(lines[j]));
        j++;
      }
      const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`;
      // Pad/truncate every body row to the header's column count (GFM behavior).
      const tbody = body.length
        ? `<tbody>${body
            .map((r) => `<tr>${Array.from({ length: cols }, (_, k) => `<td>${r[k] ?? ''}</td>`).join('')}</tr>`)
            .join('')}</tbody>`
        : '';
      out.push(`<table>${thead}${tbody}</table>`);
      i = j - 1;
      continue;
    }
    out.push(header);
  }
  return out.join('\n');
}

export function mdToHtml(md) {
  if (!md) return '';
  let html = esc(md);
  // Pull code out FIRST and replace each span with an inert sentinel, so its
  // literal content survives the heading/bold/italic/link/list transforms below
  // instead of being mangled by them. Without this, a fenced block that shows
  // example markdown ('# title', '- item', '**x**') rendered a real <h1>/<li>/
  // <strong>, and inline code like `[x](y)` became a LIVE clickable <a> — code
  // spans must render verbatim. Keeping code stashed THROUGH the paragraph split
  // also stops a blank line inside a fenced block from being split apart. The
  // real code text is restored at the very end.
  // The sentinel wraps the stash index in private-use code points (U+E000 /
  // U+E001) that no markdown transform (and esc()) emits or matches, and that
  // carry no ) * # [ ` — so a stub passes every transform below intact.
  const stash = [];
  const stub = (rendered) => `\uE000${stash.push(rendered) - 1}\uE001`;
  html = html.replace(/```([\s\S]*?)```/g, (_, c) => stub(`<pre><code>${fenceCode(c)}</code></pre>`));
  html = html.replace(/`([^`]+)`/g, (_, c) => stub(`<code>${c}</code>`));
  html = html.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  // Thematic breaks (horizontal rules). A line of 3+ of the SAME marker
  // (-, *, or _), optionally spaced, is a CommonMark thematic break — LLM
  // research reports use `---` (and sometimes `***`/`___`) to divide sections
  // constantly. Without this the divider leaked into the reader as a literal
  // `<p>---</p>` paragraph. Converted HERE — after headings, before the list
  // and emphasis passes — so a `***` break can never be eaten by the `**bold**`
  // / `*em*` transforms, and a `- - -` break is never mistaken for a `- ` bullet
  // (a bullet needs `- ` then item text; a break is only markers + spaces). The
  // \1 backref forces all markers to match, so a mixed `-*-` line is left alone.
  // A GFM table's delimiter row (`| --- | --- |`) carries `|`, which is neither
  // a marker nor a space, so it never matches here and reaches renderTables intact.
  html = html.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '<hr>');
  // List MARKERS are block structure and must be claimed BEFORE the inline
  // emphasis pass. A `* ` bullet (asterisk + space) is unambiguously a list
  // marker in CommonMark — emphasis can never be immediately followed by
  // whitespace — but if the emphasis rules below run first they treat the
  // leading `* ` of an item whose text contains a `*emphasis*` span as an
  // emphasis opener: they eat the bullet marker, so the line is no longer a
  // list item, and a stray `*` leaks into the reader ("* Second *important*
  // point" -> "<em> Second </em>important* point"). Converting bullets and
  // numbered items to <li>/<oli> here fixes that; the emphasis/link transforms
  // below then run over the item TEXT and still render correctly. The <ul>/<ol>
  // wrap still happens after the inline pass — the marker tags carry no * [ `
  // for those transforms to mangle.
  // A leading `[ \t]*` claims INDENTED bullets/numbers too. LLM research reports
  // routinely nest sub-points with 2-4 spaces of indent ("- point\n    - sub"),
  // and the marker at absolute line-start only would leave every indented item
  // unconverted — it leaked into the reader as literal `- sub` text stranded
  // between <ul> blocks. Consuming the indent folds sub-items into the list as
  // flat <li> (nesting depth is dropped, but no literal marker leaks). Code
  // spans/fences are already stashed, so an indented `- ` inside code is safe.
  html = html.replace(/^[ \t]*(?:- |\* )(.*)$/gm, '<li>$1</li>');
  html = html.replace(/^[ \t]*\d+\. (.*)$/gm, '<oli>$1</oli>');
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
  // Blockquotes. esc() has already turned a leading `>` into `&gt;`, so without
  // this a `> quoted from the source` line rendered as `<p>&gt; quoted…</p>` —
  // the marker leaked into the reader's report as a literal `>`. LLM research
  // reports quote sources this way constantly. Collapse each run of consecutive
  // `> ` lines into one <blockquote>, stripping the marker (+ its optional single
  // space) and joining wrapped lines with <br>. Runs AFTER the inline transforms
  // so **bold**/*italic*/[links] inside a quote still render; the paragraph pass
  // already whitelists <blockquote> as block-level so it is not re-wrapped in <p>.
  html = html.replace(/^&gt;[^\n]*(?:\n&gt;[^\n]*)*/gm, (m) => {
    const inner = m.replace(/^&gt;[ \t]?/gm, '').replace(/\n/g, '<br>');
    return `<blockquote>${inner}</blockquote>`;
  });
  // Wrap the runs of <li>/<oli> markers (converted up before the inline pass so a
  // `* ` bullet marker is never eaten by emphasis). Ordered items carry the <oli>
  // marker so this emits a numbered <ol> rather than a bulleted <ul> — and,
  // critically, so they get wrapped AT ALL (they used to be converted AFTER the
  // <ul> wrap, leaving every numbered list as orphan <li> with no container).
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/(<oli>[\s\S]*?<\/oli>\n?)+/g, (m) => `<ol>${m.replace(/<(\/?)oli>/g, '<$1li>')}</ol>`);
  // GFM tables: a single-newline block (no blank lines between rows) that the
  // paragraph split would otherwise fuse into one <p> of literal pipes.
  html = renderTables(html);
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      if (/^\s*<(h\d|hr|ul|ol|pre|li|p|blockquote|table)/i.test(block.trim())) return block;
      if (!block.trim()) return '';
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
  // Restore the stashed code spans, then unwrap a standalone fenced block that
  // the paragraph pass wrapped as a lone <p> (a <pre> is block-level and must
  // not nest inside <p> — this reproduces the pre-stash output exactly).
  html = html.replace(/\uE000(\d+)\uE001/g, (_, i) => stash[Number(i)]);
  html = html.replace(/<p>(<pre><code>[\s\S]*?<\/code><\/pre>)<\/p>/g, '$1');
  return html;
}
