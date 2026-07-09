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

// CommonMark reference-label normalisation: trim, collapse internal whitespace
// to a single space, and case-fold. `[The Report]`, `[the report]`, and
// `[the   report]` all resolve to the same definition. Used for BOTH the
// definition side (`[label]: url`) and every reference side (full/collapsed/
// shortcut), so the two always agree.
function normRefLabel(s) {
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
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

// Read GFM column alignment from a delimiter cell: `:--`=left, `:-:`=center,
// `--:`=right, plain `---`=none. Returns '' for none so a column with no colon
// emits NO style attr (byte-identical to the pre-alignment output -> zero
// regression on unaligned tables; right-aligned numeric columns are the single
// most common shape in a research report, so honoring the colon matters).
function cellAlign(cell) {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
}
const alignAttr = (a) => (a ? ` style="text-align:${a}"` : '');

// Render the (already-inline-processed, `&gt;`-stripped) body of a blockquote.
// The leading `> ` prefix hid list/heading/thematic-break markers from the
// line-anchored block passes in mdToHtml (they run at absolute line-start, but a
// quoted `- item` sits behind `&gt; `), so a quoted list/heading/rule leaked its
// RAW marker into the reader (`> - a` -> `- a`, `> # x` -> `# x`). The TTS
// narrator (api/_lib/burma-essays-text.js) strips the `>` markers FIRST so those
// structures get processed — the VISUAL reader was the divergent-weaker path.
// Re-run the marker passes here on the quote body: consecutive bullet/numbered
// items fold into one nested <ul>/<ol>, an ATX heading (with optional closing
// `#` run) and a thematic break convert, and every OTHER (prose) line joins with
// <br> exactly as before. A plain `> quoted prose` block has no leading markers,
// so every line falls to the prose run and the output is byte-identical to the
// old `.replace(/\n/g, '<br>')` behavior — zero regression. (Inline transforms —
// **bold**, [links], `code` — already ran on this text upstream, so a quoted
// `- **bold** point` keeps its <strong>. Tables inside a blockquote stay as the
// prior <br>-joined pipes: still rare, and not made worse.)
function renderQuoteInner(body) {
  const out = [];
  let list = null; // { tag: 'ul'|'ol', items: [] }
  let run = []; // buffered prose lines, joined with <br> like before
  const flushList = () => {
    if (list) { out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`); list = null; }
  };
  const flushRun = () => {
    if (run.length) { out.push(run.join('<br>')); run = []; }
  };
  for (const line of body.split('\n')) {
    let m;
    if ((m = line.match(/^[ \t]*[-*+] (.*)$/))) {
      flushRun();
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(`<li>${m[1]}</li>`);
    } else if ((m = line.match(/^[ \t]*\d+[.)] (.*)$/))) {
      flushRun();
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(`<li>${m[1]}</li>`);
    } else if ((m = line.match(/^(#{1,6}) (.*?)(?:[ \t]+#+)?[ \t]*$/))) {
      flushRun(); flushList();
      out.push(`<h${m[1].length}>${m[2]}</h${m[1].length}>`);
    } else if (/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) {
      flushRun(); flushList();
      out.push('<hr>');
    } else {
      flushList();
      run.push(line);
    }
  }
  flushRun();
  flushList();
  return out.join('');
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
      // Per-column alignment from the delimiter row (padded to header width).
      const delimCells = splitTableRow(delim);
      const aligns = Array.from({ length: cols }, (_, k) => cellAlign(delimCells[k] ?? ''));
      const body = [];
      let j = i + 2;
      // Body rows continue until a blank line or a non-pipe line (the table ends).
      while (j < lines.length && lines[j].trim() !== '' && lines[j].includes('|')) {
        body.push(splitTableRow(lines[j]));
        j++;
      }
      const thead = `<thead><tr>${headers.map((h, k) => `<th${alignAttr(aligns[k])}>${h}</th>`).join('')}</tr></thead>`;
      // Pad/truncate every body row to the header's column count (GFM behavior).
      const tbody = body.length
        ? `<tbody>${body
            .map((r) => `<tr>${Array.from({ length: cols }, (_, k) => `<td${alignAttr(aligns[k])}>${r[k] ?? ''}</td>`).join('')}</tr>`)
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
  // TILDE fenced code blocks (`~~~`). CommonMark allows a fence of 3+ tildes as
  // an alternative to backticks \u2014 the canonical reason to reach for `~~~` is to
  // show a block that itself CONTAINS ``` backticks, so research prose about code
  // or markdown emits them. Stash these FIRST (before the backtick pass) so a
  // ``` run inside a tilde fence is preserved as literal code text, not mistaken
  // for a nested backtick fence. Without this the tilde-fenced body was never
  // protected: its content ran through every heading/emphasis transform below
  // (`**x**` -> <strong>, `# y` -> <h1> INSIDE the code) and the `~~~` markers
  // leaked into the reader \u2014 the TTS narrator (api/_lib/burma-essays-text.js)
  // already drops tilde fences, so the VISUAL reader was the lone leaking path.
  // esc() leaves `~` untouched, so the fences survive to here intact; the inline
  // `~~strike~~` rule below needs 3+ tildes to be a fence, so 2-tilde strike
  // spans are unaffected. Same fenceCode() info-string handling as backticks.
  // A fenced block written INSIDE a blockquote ("&gt; ```\n&gt; code\n&gt; ```")
  // carried its "&gt; " quote markers INTO the captured code body, because this fence
  // stash runs BEFORE the blockquote pass below — so the interior prefixes were baked
  // into the <pre> and the reader rendered "> code" verbatim inside the code block
  // (an LLM quoting a source's code sample as a blockquote emits exactly this). Capture
  // an OPTIONAL blockquote prefix immediately preceding the OPENING fence: when present,
  // strip the leading "&gt; " run from every content line so the code is clean, and
  // RE-EMIT the opener's own prefix untouched so the blockquote pass below still wraps
  // the block in <blockquote>. A non-quoted fence (the common case) has no such prefix,
  // so `pfx` is undefined and the content passes through byte-identically; even a stray
  // "&gt;" right before a fence is a no-op unless the CONTENT lines are actually
  // "&gt; "-prefixed — the single case this strip is meant to change.
  const stashFence = (pfx, c) =>
    (pfx || '') + stub(`<pre><code>${fenceCode(pfx ? c.replace(/^(?:&gt;[ \t]?)+/gm, '') : c)}</code></pre>`);
  html = html.replace(/((?:&gt;[ \t]?)+)?~~~+([\s\S]*?)~~~+/g, (_, pfx, c) => stashFence(pfx, c));
  html = html.replace(/((?:&gt;[ \t]?)+)?```([\s\S]*?)```/g, (_, pfx, c) => stashFence(pfx, c));
  // UNCLOSED fence fallback. The two passes above require a CLOSING fence, so a
  // report truncated at the token cap mid-code-block — or an LLM that opens a
  // ``` / ~~~ fence and never closes it — leaked the raw fence marker and ran the
  // code lines through every prose transform below (rendered as a <p> with <br>s,
  // the language hint dangling as a text line). CommonMark: when the end of the
  // document is reached with no closing fence, the code block contains every line
  // after the opener. After the two passes above, every balanced fence is already
  // an inert stub carrying no backtick/tilde, so any ``` or ~~~ still sitting at a
  // line start is necessarily an unclosed opener — capture from it to EOF as code.
  // Non-global (there is at most one leftover opener per fence char, and the first
  // one owns the rest of the document) and line-anchored via (^|\n) so a stray
  // inline triple-tick inside prose is left untouched. Same blockquote-prefix +
  // fenceCode() info-string handling as the closed passes, so a truncated ```json
  // block still drops its language hint and renders clean code.
  html = html.replace(/(^|\n)((?:&gt;[ \t]?)+)?(?:```|~~~+)([\s\S]*)$/, (_, lead, pfx, c) => lead + stashFence(pfx, c));
  // MULTI-backtick inline code spans (CommonMark). A run of N>=2 backticks opens
  // a span that closes at the next run of EXACTLY N backticks, so the content can
  // carry SHORTER backtick runs verbatim — this is the canonical way to show a
  // literal backtick, e.g. ``a`b`` -> <code>a`b</code>, or `` ` `` -> <code>`</code>.
  // The single-backtick rule below only handles N=1, so a 2+-tick span was
  // mis-parsed: ``a`b`` rendered `<code>a</code>b`` ` — the inner tick prematurely
  // closed a spurious single span and the closing run leaked into the reader as
  // literal backticks. Research reports about code, shell, or markdown emit these
  // whenever the code sample itself contains a backtick. Runs AFTER the ``` fence
  // stash (a real fenced block is already an inert stub) and BEFORE the single-tick
  // rule (so a lone `code` still matches that). `(?!\`)` on the closer rejects a run
  // LONGER than N (the real closer is elsewhere); the greedy `(\`{2,})` opener
  // claims the full opening run. Per CommonMark, ONE leading + trailing space is
  // stripped when both are present and the content isn't all spaces (that is what
  // lets `` ` `` render a bare backtick). Content is already esc()'d up-front, so
  // stashing it keeps it verbatim and XSS-safe, exactly like the single-tick span.
  html = html.replace(/(`{2,})([\s\S]+?)\1(?!`)/g, (_, ticks, c) => {
    let body = c;
    if (body.length > 1 && body.startsWith(' ') && body.endsWith(' ') && body.trim() !== '') {
      body = body.slice(1, -1);
    }
    return stub(`<code>${body}</code>`);
  });
  html = html.replace(/`([^`]+)`/g, (_, c) => stub(`<code>${c}</code>`));
  // HTML COMMENTS (`<!-- editor note -->`). esc() has turned the delimiters into
  // `&lt;!-- … --&gt;`, so without a rule the comment leaked into the reader as
  // literal `<!-- … -->` text. A comment is meant to be INVISIBLE on the page, so
  // drop it entirely — the TTS narrator (api/_lib/burma-essays-text.js) likewise
  // strips `<!--…-->` so it is never read aloud, and the VISUAL reader was the lone
  // leaking path. Runs AFTER code stashing, so a comment shown INSIDE a code span
  // (`` `<!-- x -->` ``) is already an inert stub and survives verbatim; only real,
  // out-of-code comments are removed. Non-greedy `[\s\S]*?` stops at the first
  // `--&gt;`, so two comments on a line don't merge and a multi-line comment closes
  // at its own terminator.
  html = html.replace(/&lt;!--[\s\S]*?--&gt;/g, '');
  // CommonMark BACKSLASH ESCAPES. A `\` before any ASCII-punctuation char makes
  // that char LITERAL and strips its markdown meaning — `\*not italic\*` renders
  // the visible text `*not italic*`, `\#` a literal `#`, `\[x\]` literal brackets.
  // Without this the reader treated the escaped delimiter as live syntax: an
  // escaped `\*word\*` was italicised AND leaked its backslashes ("\<em>word\</em>"),
  // and an escaped `\#`/`\[`/`\-` leaked its backslash into the report. LLM
  // research prose emits these constantly (showing literal markdown, `\$` before a
  // price, `2 \* 3` to force literal asterisks). The TTS narrator
  // (api/_lib/burma-essays-text.js) already unescapes them — the VISUAL reader was
  // the lone inconsistent path. Runs AFTER code stashing (backslash escapes are
  // INERT inside code spans per CommonMark) and BEFORE every structural/emphasis
  // pass, stashing each escaped char as an inert stub so no downstream transform
  // can treat it as a delimiter; it restores verbatim at the end with the code
  // spans. `& < >` are already entity-encoded by esc(), so an escaped `\<`/`\&`/`\>`
  // arrives as `\&lt;`/`\&amp;`/`\&gt;` — handled first, stashing the entity so the
  // literal `<`/`&`/`>` survives HTML-safe. The plain branch mirrors the narrator's
  // exact escapable class; a backslash before a NON-punctuation char (a Windows
  // path `C:\Users`, a LaTeX `\alpha`) is not an escape and is left untouched.
  html = html.replace(/\\(&(?:amp|lt|gt);)/g, (_, ent) => stub(ent));
  html = html.replace(/\\([!-\/:-@\[-`{-~])/g, (_, ch) => stub(ch));
  // Pandoc/GFM FOOTNOTES. A `[^id]: text` line is a footnote DEFINITION and a
  // bare `[^id]` in the prose is its REFERENCE — citation-heavy deep-research LLMs
  // emit these constantly. Before this, mdToHtml deliberately left BOTH literal:
  // the reference-link definition pass below skips `^`-labels (capturing one stored
  // `refs["^1"]="text"` and mis-linked the ref into a broken `<a href="text">`), so
  // the fix at the time was to render them as honest literal text — but that means
  // the reader still showed a raw `[^1]` in the prose and a bare `[^1]: source`
  // paragraph, the exact leaked-markup class this module kills everywhere else, and
  // one the TTS narrator (api/_lib/burma-essays-text.js) already handles cleanly
  // (drops the ref, unwraps the def to its text). Render them instead: the
  // reference becomes a superscript marker, and the definition becomes a footnote
  // paragraph led by that same marker. STASH the `<sup>` so it sails through every
  // structural/emphasis transform below intact (id is already esc()'d); the
  // definition's remaining TEXT stays live so its own inline markdown (emphasis,
  // links) still renders. Runs BEFORE the ref-definition pass so a `[^id]:` line is
  // claimed HERE — its stubbed replacement no longer starts with `[`, so that pass
  // can't match it — and BEFORE the inline link pass so a bare `[^id]` never
  // mis-resolves as a shortcut link. Def line first (anchored `^…:`), then any
  // remaining inline refs. Only single-line defs are handled (the common LLM form),
  // matching the narrator twin. The `^` right after `[` distinguishes a footnote
  // from an ordinary `[label]` link/reference, so normal links are untouched.
  html = html
    .replace(/^[ \t]{0,3}\[\^([^\]\n]+)\]:[ \t]*/gm, (_, id) => `${stub(`<sup>${id}</sup>`)} `)
    .replace(/\[\^([^\]\n]+)\]/g, (_, id) => stub(`<sup>${id}</sup>`));
  // Reference-style link DEFINITIONS. Citation-heavy deep-research reports emit
  // numbered references — `[the report][1]` in the prose and `[1]: https://…`
  // definitions at the bottom. Before this, the definition line leaked into the
  // reader as a literal `<p>[1]: https://…</p>` and every `[label][ref]` /
  // shortcut `[label]` reference leaked as literal bracket text (the inline
  // `[label](url)` transform only matches parenthesised links). Collect each
  // definition into `refs` (normalised label -> destination) and STRIP its line
  // here — after code is stashed (so a `[x]: y` inside a code span is untouched)
  // and, critically, BEFORE the autolink pass below: a CommonMark-legal
  // angle-bracket destination (`[a]: <https://x/y>`) would otherwise be eaten by
  // the autolink rule first (turning `&lt;…&gt;` into a stashed <a>), captured as
  // the dest, and re-wrapped into a double-nested `<a href="<a …>">` on stash
  // restore. Running here (before autolink, before the heading/list/paragraph
  // passes so the stripped line can never become a <p>/<li>) sidesteps that. A
  // definition is `[label]: dest` with up to 3 leading spaces and an OPTIONAL
  // trailing title ("…" / '…' / (…)); the destination is the first whitespace-
  // delimited token, with a wrapping `<…>` (esc()'d to `&lt;…&gt;`) stripped to
  // the bare URL. Resolution happens after the inline link pass below.
  const refs = new Map();
  html = html.replace(
    /^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*$/gm,
    (_, label, dest) => {
      // Pandoc/GFM FOOTNOTES, not link definitions. A `[^id]: text` line is a
      // footnote definition and `[^id]` in the prose is a footnote reference —
      // deep-research LLMs emit these constantly (the def carries the citation).
      // A `^`-prefixed label is NEVER a reference-link label here: capturing it
      // stored `refs["^1"]="text"`, and the shortcut resolver below then turned
      // the footnote ref `[^1]` into a BROKEN link `<a href="text">^1</a>` — a
      // bogus relative href, active content corruption in the reader. Skip it
      // (return the line verbatim, already esc()'d, so it renders as honest
      // literal text with the citation still visible) instead of mis-linking it.
      // The resolver leaves `[^1]` literal because its label never enters `refs`.
      if (label.startsWith('^')) return _;
      const key = normRefLabel(label);
      // Strip a CommonMark angle-bracket wrapper: `<url>` -> `url` (esc()'d form
      // is `&lt;url&gt;`). Without this the brackets leak into href/text later.
      const d = dest.replace(/^&lt;([\s\S]*)&gt;$/, '$1');
      if (!refs.has(key)) refs.set(key, d); // first definition wins (CommonMark)
      return '';
    },
  );
  // CommonMark AUTOLINKS: `<https://…>`, `<mailto:…>`, and a bare-email
  // `<name@host>`. esc() has already turned the delimiters into &lt;/&gt;, so
  // without a rule the whole autolink leaked into the reader as literal
  // `<https://…>` text — and the TTS narrator (api/_lib/burma-essays-text.js)
  // already treats these as autolinks, so the VISUAL reader was the inconsistent
  // one. Match a scheme-URI (or bare email) between the escaped brackets with no
  // spaces/brackets inside, route the destination through safeHref (so a
  // `<javascript:…>`/`<data:…>` autolink can NEVER become a live href — it drops
  // back to literal text), and STASH the rendered <a> so it sails through every
  // heading/emphasis/list/paragraph transform below intact, exactly like a code
  // span. A prose comparison ("a &lt; b &gt; c") carries spaces and a bare "&lt;3"
  // has no scheme/@, so neither matches — they stay literal, unchanged.
  // The `(?<!\]\()` lookbehind skips a `<url>` that is really an inline-link
  // DESTINATION — `[label](<url>)` is CommonMark's angle-bracket dest form, and
  // esc() leaves the `](` before the `&lt;` intact. Without this guard the
  // autolink rule stashed the dest as an <a> BEFORE the inline `[label](url)`
  // pass ran, and that stub then got jammed into the href attribute, producing a
  // double-nested `<a href="<a …>…</a>">` — active corruption of a valid,
  // citation-common link. Deferring these to the inline link pass (which now
  // strips the &lt;…&gt; wrapper) renders one correct <a>. A standalone autolink
  // after a link ("[a](x) &lt;https://b&gt;") is preceded by a space, not `](`,
  // so it still matches here.
  html = html.replace(/(?<!\]\()&lt;([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]+?)&gt;/g, (whole, url) => {
    const href = safeHref(url);
    return href ? stub(`<a href="${href}" target="_blank" rel="noopener">${url}</a>`) : whole;
  });
  html = html.replace(/(?<!\]\()&lt;([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+?)&gt;/g, (whole, mail) => {
    const href = safeHref(`mailto:${mail}`);
    return href ? stub(`<a href="${href}" target="_blank" rel="noopener">${mail}</a>`) : whole;
  });
  // ATX headings (`# ` … `###### `). One combined rule: the leading run of 1-6
  // `#` sets the level (greedy, so `## x` is an <h2>, never <h1> + a literal `# x`)
  // and must be followed by a space. CommonMark also allows an OPTIONAL CLOSING
  // sequence of `#`s — `## Heading ##` -> <h2>Heading</h2>: a trailing `#` run,
  // when separated from the content by whitespace, is a decorative closer, not
  // text. The old per-level rules captured `(.*)` greedily, so a closed heading
  // leaked its trailing `##` into the reader ("Heading ##"). LLM research prose
  // emits closed ATX headings often enough to reach the report. `(.*?)` is
  // non-greedy and the `(?:[ \t]+#+)?[ \t]*$` tail strips a whitespace-separated
  // closing run (plus any trailing spaces); a `#` fused to the content ("foo#",
  // no preceding space) is NOT a closer and stays literal, and a mid-line `#`
  // ("a # b") is untouched. Seven+ leading `#` never matches (the 7th breaks the
  // required space), exactly like the old rules.
  html = html.replace(/^(#{1,6}) (.*?)(?:[ \t]+#+)?[ \t]*$/gm, (_, h, t) => `<h${h.length}>${t}</h${h.length}>`);
  // Setext headings: a text line immediately followed by a line of `=` (-> h1)
  // or `-` (-> h2). LLM research prose emits these constantly. Without this, the
  // `===` underline leaked as a literal paragraph and the `-` underline was eaten
  // by the thematic-break rule below (Title became a <p> followed by a stray
  // <hr>). Runs BEFORE thematic breaks so a `---` UNDERLINE (a non-blank text
  // line directly above it, no blank line between) becomes an <h2> — while a
  // `---` preceded by a BLANK line has no text line above, so it stays a
  // thematic break. The text line is skipped when it is blank or already a block
  // (an ATX heading / <hr> / list marker / blockquote) so a real bullet or ATX
  // heading sitting above a rule is left for the thematic-break + list passes.
  const setext = (whole, text, marker) =>
    /^\s*$/.test(text) ||
    /^\s*<(?:h\d|hr|ul|ol|li|pre|blockquote|table)/i.test(text) ||
    /^[ \t]*(?:[-*+] |\d+\. |&gt;)/.test(text)
      ? whole
      : `<${marker}>${text.trim()}</${marker}>`;
  html = html.replace(/^([^\n]+)\n[ \t]*=+[ \t]*$/gm, (m, t) => setext(m, t, 'h1'));
  html = html.replace(/^([^\n]+)\n[ \t]*-+[ \t]*$/gm, (m, t) => setext(m, t, 'h2'));
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
  // A heading (or thematic break) can be DIRECTLY followed by body prose with NO
  // blank line between — LLM research reports write "## Section\nBody text..."
  // constantly. The \n{2,} paragraph splitter below treats that whole run as ONE
  // block; because it STARTS with a block tag (<h2>/<hr>) it passes the block
  // whitelist verbatim, so the trailing prose is emitted BARE — no <p>, no block
  // margins, glued straight onto the </h2>. (This is the inverse of the two
  // already-fixed glue cases: list->paragraph at the `</ul>\n` restore below, and
  // paragraph->block just above the split.) Insert the missing blank line after a
  // heading close / <hr> that is followed by a single newline + real content, so
  // the splitter separates them and the prose gets its <p>. Placed HERE — right
  // after the ATX/setext/thematic passes and BEFORE the list/blockquote/table
  // passes — so the only block tags present are top-level <h1-6>/<hr> (a QUOTED
  // heading is still a raw `&gt; ##` line, a list is still a `- ` line): this can
  // never insert a break INSIDE a <blockquote>/<table> and split its innards.
  // Requiring a non-newline next char skips the already-separated `\n\n` case (no
  // double blank); inserting a break before a following BLOCK element is harmless
  // (both halves pass the whitelist verbatim and rejoin), so it only ever ADDS the
  // missing <p> around trailing prose. Byte-identical when a blank line is present.
  html = html.replace(/(<\/h[1-6]>|<hr>)\n(?=[^\n])/g, '$1\n\n');
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
  // GFM TASK-LIST items ("- [ ] todo", "- [x] done", "* [X] done"). Must run
  // BEFORE the generic bullet rule below — that rule would capture the raw
  // "[ ] todo" as the item TEXT, so the reader showed the literal `[ ]`/`[x]`
  // checkbox marker (the TTS narrator, api/_lib/burma-essays-text.js, already
  // strips these, so the VISUAL reader was again the lone inconsistent path).
  // Render a disabled checkbox like GitHub: the checked state is a STATIC boolean
  // derived from the [x] match (never interpolated text), and esc() has already
  // run, so the emitted `<input>` is real markup that carries no ) * # [ ` — it
  // sails through every inline transform below, and the plain `<li>` still folds
  // into the <ul> wrap. The task TEXT flows through the same inline passes as any
  // list item. Requires the GFM space after the bullet, so prose "[x]" is safe.
  // The leading `[ \t]*` is now CAPTURED (not just consumed) so an indented item
  // carries its depth as a `data-d="<cols>"` attribute — the nest pass below folds
  // deeper items into real sublists. A ZERO-indent item still emits a BARE `<li>`
  // (no attr), so every flat/top-level list is byte-identical to before and the
  // wrap + nest passes treat it exactly as they always did. Tab counts as 4 cols.
  html = html.replace(
    /^([ \t]*)(?:[-*+])[ \t]+\[([ xX])\][ \t]*(.*)$/gm,
    (_, ind, mark, text) => {
      const d = ind.replace(/\t/g, '    ').length;
      const box = `<input type="checkbox" disabled${mark === 'x' || mark === 'X' ? ' checked' : ''}>${text ? ' ' + text : ''}`;
      return d ? `<li data-d="${d}">${box}</li>` : `<li>${box}</li>`;
    }
  );
  // CommonMark allows THREE bullet markers — `-`, `*`, AND `+` — so a `+ point`
  // list is as valid as a `- ` one; LLM research prose emits `+` bullets often
  // enough to reach the reader. The task-list rule just above already accepts
  // `[-*+]`, but this generic rule long matched only `- `/`* `, so a plain `+ `
  // bullet leaked into the reader as literal `+ text` glued after the list — the
  // TTS narrator (api/_lib/burma-essays-text.js) already strips all three markers,
  // so the VISUAL reader was again the lone inconsistent path. `[-*+] ` claims all
  // three; `+` carries no emphasis/thematic-break meaning (those use `- * _`), so
  // this is purely additive and byte-identical for every `-`/`*` list.
  html = html.replace(/^([ \t]*)(?:[-*+] )(.*)$/gm, (_, ind, t) => {
    const d = ind.replace(/\t/g, '    ').length;
    return d ? `<li data-d="${d}">${t}</li>` : `<li>${t}</li>`;
  });
  // Ordered items. CommonMark allows BOTH `1.` and `1)` as ordered-list
  // delimiters, and LLM research prose emits paren-delimited lists ("1) foo\n
  // 2) bar") constantly. Matching only `\d+\. ` left a `1)` list leaking into the
  // reader as a fused literal `<p>1) foo<br>2) bar</p>` — its ")" text preserved
  // and the whole list collapsed into one paragraph. The TTS narrator
  // (api/_lib/burma-essays-text.js) already accepts both delimiters, so the
  // VISUAL reader was again the lone inconsistent path. `[.)]` claims both; the
  // `<oli>` marker still folds into the numbered <ol> wrap below.
  // Capture the START NUMBER into the marker so the <ol> wrap below can honor a
  // list that does NOT begin at 1. CommonMark numbers an ordered list from its
  // FIRST item's value: "3. a\n4. b" is `<ol start="3">`, and a list CONTINUED
  // after intervening prose ("...\n\n5. e\n6. f") keeps counting from 5. Dropping
  // the digit here (the old `(.*)` capture) made every ordered list restart at 1,
  // so a research report that enumerated "Step 3:"-style or resumed a numbered run
  // rendered the WRONG visible numbers (browsers renumber a bare <ol> from 1). The
  // `n="\d+"` attribute is digits-only, so it is inert through the inline passes.
  html = html.replace(/^([ \t]*)(\d+)[.)] (.*)$/gm, (_, ind, n, t) => {
    const d = ind.replace(/\t/g, '    ').length;
    return d ? `<oli n="${n}" data-d="${d}">${t}</oli>` : `<oli n="${n}">${t}</oli>`;
  });
  // Triple emphasis `***word***` -> nested <strong><em>. Must run BEFORE the
  // `**bold**` and `*em*` passes: those would half-eat a `***…***` run into
  // crossed/malformed tags (<strong>*word</strong>* then a garbled <em>). The
  // `***` thematic-break line was already claimed above (it is markers-only),
  // so only an INLINE `***word***` (carrying word chars) reaches here.
  // Both `***` and `**` are FLANKING-AWARE, same as the single-`*` and `_`
  // rules: the opener must be immediately followed by a non-whitespace char and
  // the closer immediately preceded by one. The old `(.+?)` capture ignored
  // that, so two whitespace-flanked `**` — exponentiation ("2 ** 10 to 2 ** 20"),
  // a bare "** note **" — mis-paired and bolded the prose between them
  // ("2 <strong> 10 to 2 </strong> 20"). Technical deep-research reports emit
  // `a ** b` power notation often enough to reach the innerHTML reader.
  // `[^\s*](?:[^\n]*?[^\s*])?` pins both ends to a non-whitespace, non-`*` char.
  // Excluding `\n` keeps a run from bridging across lines (matching the old `.+?`
  // single-line behavior); the inner class stays `[^\n]` (not `[^*]`) so a nested
  // `*italic*` inside `**bold**` still renders. Excluding `*` at the two EDGES
  // (not just whitespace) stops a whitespace-padded triple like "a *** b *** c"
  // from being half-eaten into a spurious <strong> — the `**` opener refuses to
  // treat the third `*` of a `***` run as its first content char.
  //   The MIDDLE class is `(?:[^*\n]|\*(?!\*))*?` for `**` (and
  // `(?:[^*\n]|\*(?!\*\*))*?` for `***`), NOT the old `[^\n]*?`. The old class
  // let the non-greedy middle BRIDGE across a second delimiter run: "a **b** c
  // **d** e" — two separate bold spans — was captured from the first `**` all the
  // way to the last `**`, swallowing the middle `** c **` and bolding the whole
  // stretch ("<strong>b** c **d</strong>"). Bolding several terms in one sentence
  // is one of the most common shapes in a research report, so it reached the
  // reader constantly. Allowing a SINGLE `*` (a star not followed by another) still
  // lets a nested `*italic*` render inside `**bold**`, but a `**` run now ends the
  // content, so the closer is claimed at the FIRST following `**` and each pair
  // stays independent. (The `*`, `_`, `__`, `~~`, `==` rules never bridged: their
  // middles already exclude the delimiter char; only `**`/`***` used `[^\n]*?`.)
  // CROSSED-RUN emphasis, claimed BEFORE the independent passes below. A span
  // opened `***`/closed `**` (or opened `**`/closed `***`) with a lone `*` on the
  // other side is standard CommonMark for italicising the FIRST (`***word* rest**`)
  // or LAST (`**rest *word***`) piece of a bold phrase — LLM research prose emits
  // both. The `***`/`**`/`*` passes each pair their OWN delimiters, so left to them
  // these two shapes emit CROSSED tags (`<em><strong>word</em> rest</strong>`) —
  // invalid HTML the browser only silently reparses. That is exactly the malformed
  // nesting the `***` pass just below was written to avoid; these two runs finish
  // the job. Each edge is flanking-pinned (non-space, non-`*`) like every rule
  // here, and each interior is star-free, so a run fires ONLY on the exact crossed
  // shape — `***a***`, `**a**`, `**a *b* c**`, `*a **b** c*` never match and are
  // left byte-identical for the correctly-nested passes to handle.
  html = html.replace(/\*\*\*([^\s*][^*\n]*?)\*([^*\n]*?[^\s*])\*\*/g, '<strong><em>$1</em>$2</strong>');
  html = html.replace(/\*\*([^\s*][^*\n]*?)\*([^\s*][^*\n]*?)\*\*\*/g, '<strong>$1<em>$2</em></strong>');
  html = html.replace(/\*\*\*([^\s*](?:(?:[^*\n]|\*(?!\*\*))*?[^\s*])?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // A `**bold**` span may cross ONE soft line break: an LLM report that soft-wraps
  // at ~80 cols emits a bolded key phrase spanning a wrap ("**a long bolded\nphrase
  // here**"), and the old line-scoped `[^*\n]` middle left its `**` markers LITERAL
  // (the run couldn't bridge the `\n`). The middle now allows a single `\n(?!\n)` —
  // a soft break, NOT a blank-line paragraph boundary — so the span joins across the
  // wrap while a `\n\n` still ends it. Critically the middle also now EXCLUDES `<>`
  // (it only allowed `\n` to stop bridging before): at this stage adjacent list
  // items are already `<li>…</li>\n<li>…` and paragraphs are split on `\n\n` (both
  // BEFORE the `<p>` wrap at the block pass below), so excluding `<>` stops a run
  // from bridging across a `</li>`/`<br>`/inline tag on the next line — the job the
  // `\n` exclusion used to do. No legit bold CONTENT carries a raw `<`/`>` here
  // (esc() made every prose `<`/`>` an entity, inline code is a \uE0xx stub, nested
  // `*italic*`/links aren't tagged until after this pass), so the exclusion is inert
  // on real spans and byte-identical for every single-line `**bold**`.
  html = html.replace(/\*\*([^\s*](?:(?:[^*<>\n]|\*(?!\*)|\n(?!\n))*?[^\s*])?)\*\*/g, '<strong>$1</strong>');
  // Single `*em*` is FLANKING-AWARE per CommonMark: an opening `*` must be
  // immediately followed by a non-whitespace char (left-flanking) and a closing
  // `*` immediately preceded by one (right-flanking). The old `[^*\n]+` capture
  // ignored that, so two whitespace-flanked asterisks — arithmetic ("3 * 4 * 5"),
  // a bare glob ("* wildcard *") — mis-paired and italicised the prose between
  // them ("3 <em> 4 </em> 5"). LLM research reports emit `a * b` multiplication
  // and standalone `*` often enough to reach the reader.
  // `[^\s*](?:[^*\n]*?[^\s*])?` pins both ends to a non-whitespace, non-`*` char
  // (mirrors the underscore rule below and the TTS stripMarkdown fix). Using
  // `[^\s*]` rather than `\S` at the edges also means a LEFTOVER asterisk from a
  // whitespace-flanked `**`/`***` run just above (which those flanking-aware
  // rules correctly declined to bold — e.g. "2 ** 10 to 2 ** 20") is NOT grabbed
  // as single-em content; without it the stray `*`s mis-paired into
  // "2 <em>* 10 to 2 *</em> 20". Every real, tightly-wrapped `*italic*` (and
  // single-char `*x*` via the optional inner group) is unchanged.
  // The inner content now also crosses ONE soft line break — `\n(?![\n<])` — so an
  // `*italic*` phrase the LLM soft-wrapped at ~80 cols joins across the wrap instead
  // of leaking its `*` markers, while a `\n\n` paragraph break OR a `\n` that opens
  // an already-emitted tag (`\n<li>`) still ends it. `<>` stays ALLOWED in content
  // (only the newline is tag-guarded): single `*em*` runs AFTER the `**bold**`/`***`
  // passes and legitimately WRAPS their emitted `<strong>` (`*text **bold** text*`),
  // so excluding `<>` would eat the inner tag. The flanking edges `[^\s*]` keep
  // spaced arithmetic ("3 * 4\n5 * 6") literal across the wrap. Byte-identical for
  // every single-line `*italic*`.
  html = html.replace(/(^|[^*])\*([^\s*](?:(?:[^*\n]|\n(?![\n<]))*?[^\s*])?)\*/g, '$1<em>$2</em>');
  // Underscore emphasis (__bold__, _italic_) and GFM strikethrough (~~struck~~).
  // The TTS stripMarkdown already unwraps all three; the visual reader leaked
  // them as literal `_italic_` / `__bold__` / `~~cancelled~~` markers — LLM
  // research prose emits underscore emphasis and strikethrough often enough to
  // reach the reader. Underscore uses CommonMark's INTRAWORD rule: a `_` only
  // opens/closes emphasis at a word boundary, so snake_case identifiers and URL
  // path segments (foo_bar_baz) are left literal — the `(^|[^\w])` prefix and
  // `(?![\w])` tail enforce that (asterisk has no intraword restriction, which
  // is why the rules above don't need it). Double-underscore runs before single
  // so `__bold__` isn't half-eaten. Double-underscore also crosses a SOFT line
  // break — `__a long bold\nphrase__` — via `\n(?![\n<])`: one soft wrap joins,
  // but a `\n\n` paragraph break OR a `\n` that opens an already-emitted tag
  // (`\n<li>` / `\n<br>`) stops it. NOTE this differs from the `**bold**` rule,
  // which excludes `<>` outright: `**` runs BEFORE the `*em*`/`__` passes so its
  // content never holds a rendered tag, but `__`/`~~`/`==` run AFTER them and
  // legitimately WRAP emitted `<em>`/`<strong>` (`__bold *it*__`), so `<>` must
  // stay allowed in the content — only the newline is tag-boundary-guarded.
  // Byte-identical for single-line spans. Single `_italic_` now ALSO crosses one
  // soft wrap (same `\n(?![\n<])` guard) — it's boundary-aware (word-boundary
  // enforced), so it carries the same low false-positive risk as `__`, unlike the
  // flanking-only single `*` above. Strikethrough needs no flanking guard: a
  // doubled `~~` is vanishingly rare outside real strike spans, and code (where
  // `~` could appear) is already stashed.
  html = html.replace(/(^|[^\w])__(\S(?:(?:[^_\n]|\n(?![\n<]))*?\S)?)__(?![\w])/g, '$1<strong>$2</strong>');
  html = html.replace(/(^|[^\w])_(\S(?:(?:[^_\n]|\n(?![\n<]))*?\S)?)_(?![\w])/g, '$1<em>$2</em>');
  // Content is `(?:[^~\n]|~(?!~))+?`, NOT `[^~\n]+?`: a struck span may carry a
  // LONE `~` (a GFM run of one tilde never closes a `~~` opener), so a struck
  // approximate figure — `~~around ~5 million~~`, common in a revised-casualty
  // aside — kept its inner `~` as literal content in GFM but leaked its `~~`
  // markers into the reader here (the old class excluded ALL tildes, so the span
  // never matched). Mirrors the `**bold**` rule's `\*(?!\*)` guard: a single `~`
  // (not followed by another) is content; a `~~` run ends it, so the closer is
  // still claimed at the first following `~~` and adjacent spans stay independent.
  // Byte-identical for every strike span without an inner lone tilde. Also joins
  // across a single soft line break via `\n(?![\n<])` (stops at `\n\n` and at a
  // `\n` that opens an emitted tag) — `<>` stays allowed in content because a
  // strike may WRAP a rendered `<em>` (`~~struck *word*~~`, run after `*em*`).
  html = html.replace(/~~((?:[^~\n]|~(?!~)|\n(?![\n<]))+?)~~/g, '<del>$1</del>');
  // GFM/Obsidian HIGHLIGHT (`==important==`) -> <mark>. The TTS narrator
  // (api/_lib/burma-essays-text.js) already unwraps `==…==` (so it isn't read aloud
  // as "equals equals"); the VISUAL reader leaked the literal `==markers==`. Render
  // a real highlight rather than stripping — the visual medium HAS color, so <mark>
  // is the faithful rendering. FLANKING-AWARE like the `*em*`/`_em_` rules: the
  // opener `==` must be immediately followed by a non-space, non-`=` char and the
  // closer immediately preceded by one, so a whitespace-flanked chained comparison
  // ("a == b == c", "x == y") is NOT mistaken for a highlight span and stays literal
  // — a strictly tighter rule than the narrator's naive `==([^=]+)==`. `=` is
  // untouched by esc() and by every transform above (setext/thematic-break use only
  // `- * _`), so the markers survive intact to here. Runs after the emphasis passes,
  // so a nested `==**bold**==` already rendered its <strong> and just gets wrapped.
  // Joins across a single soft line break via `\n(?![\n<])` (stops at `\n\n` and
  // at a `\n` that opens an emitted tag); `<>` stays allowed in content precisely
  // BECAUSE it wraps that emitted <strong> — same tag-boundary guard as `__`/`~~`.
  html = html.replace(/==([^\s=](?:(?:[^=\n]|\n(?![\n<]))*?[^\s=])?)==/g, '<mark>$1</mark>');
  // URL capture allows one level of balanced parens so Wikipedia-style
  // disambiguation links — [Taiwan](…/Taiwan_(island)) — keep their closing
  // paren in the href instead of truncating at the first ')' and leaking a
  // stray ')' into the body text. `[^()]` still stops at an unmatched ')',
  // so it never over-consumes into trailing prose or a following link.
  // Images `![alt](url)`: the reader has no image support, so render the ALT
  // text (dropping the leading `!` and the URL) instead of leaking a literal `!`
  // followed by a spurious link. Runs BEFORE the inline link transform so the
  // `[alt](url)` remnant is never linkified. A linked image `[![alt](img)](url)`
  // degrades to a plain text link (its alt becomes the link label).
  html = html.replace(/!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g, (_, alt) => alt);
  // Inline links `[label](dest)`. The label capture allows one level of BALANCED
  // brackets — `[ref [1]](url)` / `[Smith [2023]](url)` — because citation-heavy
  // research prose nests a bracketed marker inside the link text; the old
  // `[^\]]+` stopped at the FIRST inner `]`, so `[ (` never lined up and the whole
  // link leaked as literal `[ref [1]](url)`. The `*` also admits an EMPTY label
  // `[](url)` (a model wrapping a bare URL) — rendered with the URL as its own
  // visible text instead of leaking a `[]` husk with an autolinked dest.
  html = html.replace(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\(((?:[^()]|\([^()]*\))+)\)/g, (_, label, dest) => {
    // Split off an optional CommonMark link TITLE: `[t](url "title")` /
    // `(url 'title')` / `(url (title))`. The title is metadata, never part of
    // the href — LLM research prose emits titled links constantly. Before this,
    // the whole `url "title"` string went to safeHref, whose URL parser rejected
    // the embedded space/quotes and returned null, so the ENTIRE link was
    // dropped (label rendered as bare text, href lost). A real link destination
    // carries no unescaped whitespace, so the href is the first whitespace-
    // delimited token; only strip the remainder when it matches a title (else
    // keep the whole string — no regression for malformed/spaced dests).
    const m = dest.match(/^(\S+)\s+(?:"[^"]*"|'[^']*'|\([^()]*\))$/);
    // CommonMark ANGLE-BRACKET destination: `[t](<url>)` (and `[t](<url> "title")`)
    // wraps the dest in `< >` — esc()'d here to `&lt;…&gt;` — the explicit form an
    // LLM reaches for when a URL is unusual. Strip the wrapper to the bare URL so
    // safeHref sees a real scheme; without it the dest kept its `&lt;…&gt;` and
    // safeHref built a broken relative href. (The autolink pass above, now guarded
    // with a `](` lookbehind, no longer eats this before we get here.)
    const url = (m ? m[1] : dest).replace(/^&lt;([\s\S]*)&gt;$/, '$1');
    const href = safeHref(url);
    // Empty label (`[](url)`) shows the URL as its own text; both are already
    // esc()'d so this stays safe whether or not a valid href resolves.
    const text = label || url;
    return href ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : text;
  });
  // Reference-style link RESOLUTION, using the `refs` map collected above. Runs
  // after the inline `[label](url)` pass (those are already <a> tags, so no bare
  // `[…]` remains for these to touch). FULL/COLLAPSED first — `[text][ref]` (and
  // `[text][]`, which reuses `text` as the label) — so the shortcut pass below
  // can't eat the leading `[text]` of a full reference. Then SHORTCUT — a bare
  // `[text]` whose text is itself a defined label (`[1]` with a `[1]: url`
  // definition). Both linkify ONLY when the label resolves to a definition with
  // an allowed scheme; an unknown or dangerous reference is left byte-identical
  // to the input, so undefined bracket text (`[fig 3]`, array notation) is
  // untouched — no regression for prose that merely uses square brackets.
  if (refs.size) {
    const refLink = (whole, label, key) => {
      const dest = refs.get(normRefLabel(key));
      if (dest === undefined) return whole;
      const href = safeHref(dest);
      return href ? `<a href="${href}" target="_blank" rel="noopener">${label}</a>` : whole;
    };
    html = html.replace(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g, (whole, label, ref) =>
      refLink(whole, label, ref.trim() || label),
    );
    html = html.replace(/\[([^\]\n]+)\]/g, (whole, label) => refLink(whole, label, label));
  }
  // GFM extended autolinks (conservative subset): a BARE `http(s)://` URL typed
  // directly in the prose — not wrapped in `<…>`, not a `[label](url)` / reference
  // link — becomes a clickable <a>. Citation-heavy deep-research reports cite
  // sources as raw URLs constantly; before this they rendered as non-clickable
  // plain text (readable, but you couldn't click a source). STRICTLY ADDITIVE and
  // regression-proof by construction: one left-to-right pass whose FIRST alternative
  // matches an already-rendered anchor (`<a …>…</a>` — from the inline/reference
  // link passes above; angle-bracket autolinks are already inert stubs) and returns
  // it VERBATIM. Because the engine consumes a whole existing anchor when it reaches
  // `<a`, the URL sitting inside its href/label is never separately matched — an
  // existing link can NEVER be double-wrapped or altered. The SECOND alternative
  // therefore only ever fires on genuinely bare URL text. safeHref still gates the
  // scheme (defence-in-depth; only http(s) reaches here anyway) and quote-escapes
  // the href; the whole string was esc()'d up front so the link TEXT carries no live
  // `< > &`. Also linkifies GFM extended `www.` autolinks (third alternative): a
  // bare `www.host.tld…` gets an `http://` scheme PREPENDED for the href while the
  // link TEXT stays the bare `www.` string, exactly per GFM. Deep-research reports
  // cite plenty of sources as `www.nytimes.com/…` with no scheme; before this they
  // rendered as dead plain text. Conservatively scoped: the `www.` must be followed
  // by at least TWO dot-separated labels (host + TLD, e.g. `www.a.com`), so a bare
  // schemeless domain WITHOUT the `www.` prefix (`example.com`, `vs.`, `e.g.`) is
  // still left literal — that form IS genuinely ambiguous and GFM leaves it alone
  // too. safeHref gates the prepended scheme just like the http(s) branch. GFM
  // trailing-punctuation handling: a run of sentence punctuation (. , ; : ! ? ' "),
  // an UNBALANCED closing `)`, or a trailing escaped entity (`&gt;`/`&quot;`/… — a
  // `>` or closing quote that followed the URL in prose) is peeled off the match and
  // re-emitted as literal text, so "(see https://x.org/a_(b))." links
  // `https://x.org/a_(b)` and keeps the `).`. Worst case a stray trailing char stays
  // inside a NEW link — never a broken existing link. Runs after the inline+reference
  // link passes (so anchors exist to protect) and after every emphasis pass (so a `_`
  // or `~~` in the URL is already past its transform); the new anchor is emitted live
  // and, like the inline links above, sails through the blockquote/paragraph passes
  // (which only touch leading markers and newlines, never a URL's interior).
  html = html.replace(/(<a [^>]*>[\s\S]*?<\/a>)|(https?:\/\/[^\s<]+)|(www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+[^\s<]*)/g, (m, anchor, bare, wwwUrl) => {
    if (anchor) return anchor;
    const isWww = !bare && !!wwwUrl;
    let url = bare || wwwUrl;
    for (;;) {
      const last = url[url.length - 1];
      if (last && '.,;:!?\'"'.includes(last)) { url = url.slice(0, -1); continue; }
      if (last === ')' && (url.split(')').length - 1) > (url.split('(').length - 1)) {
        url = url.slice(0, -1);
        continue;
      }
      const ent = url.match(/&(?:gt|lt|quot|amp);$/);
      if (ent) { url = url.slice(0, -ent[0].length); continue; }
      break;
    }
    if (!url) return m;
    const href = safeHref(isWww ? 'http://' + url : url);
    return href
      ? `<a href="${href}" target="_blank" rel="noopener">${url}</a>` + m.slice(url.length)
      : m;
  });
  // Loose lists: CommonMark separates items with a blank line, but the <li>/<oli>
  // wrap below only tolerates a SINGLE newline between items, so a loose list
  // ("- a\n\n- b\n\n- c" — an extremely common deep-research shape, many LLMs put
  // a blank line between every bullet) SHATTERED into one <ul>/<ol> per item: each
  // bullet became its own single-item list with block margins, instead of one
  // cohesive list. Collapse a blank-line gap that sits DIRECTLY between two
  // consecutive item markers to a single newline — only that exact `</li>\n\n<li>`
  // (and `</oli>\n\n<oli >`) adjacency, so a trailing blank BEFORE a non-item block
  // is untouched and the list->paragraph boundary the paragraph pass relies on
  // survives (a naive `\n*` in the wrap over-consumed that blank and mangled the
  // following paragraph into `<p></ul>…</p>`). Byte-identical for every tight list.
  html = html.replace(/(<\/li>)\n{2,}(?=<li[ >])/g, '$1\n');
  html = html.replace(/(<\/oli>)\n{2,}(?=<oli )/g, '$1\n');
  // Wrap the runs of <li>/<oli> markers (converted up before the inline pass so a
  // `* ` bullet marker is never eaten by emphasis). Ordered items carry the <oli>
  // marker so this emits a numbered <ol> rather than a bulleted <ul> — and,
  // critically, so they get wrapped AT ALL (they used to be converted AFTER the
  // <ul> wrap, leaving every numbered list as orphan <li> with no container).
  html = html.replace(/(<li(?: data-d="\d+")?>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/(<oli n="\d+"(?: data-d="\d+")?>[\s\S]*?<\/oli>\n?)+/g, (m) => {
    // The run is guaranteed to begin with the first item's <oli n="N"…> marker.
    const start = parseInt(m.match(/^<oli n="(\d+)"/)[1], 10);
    const attr = Number.isFinite(start) && start !== 1 ? ` start="${start}"` : '';
    const items = m
      .replace(/<oli n="\d+"( data-d="\d+")?>/g, (_, dd) => `<li${dd || ''}>`)
      .replace(/<\/oli>/g, '</li>');
    return `<ol${attr}>${items}</ol>`;
  });
  // NEST indented list items into real sublists. The marker passes above tag any
  // INDENTED item with `data-d="<cols>"`; a flat/top-level list carries NO such
  // attr, so this pass returns it BYTE-IDENTICAL (the `includes('data-d="')` gate
  // makes every flat list a guaranteed no-op — the reason the top-level GUARD
  // assertions stay green). Only a list that actually had indented items is
  // rebuilt: items are re-parsed in order and folded by RELATIVE depth (a deeper
  // item becomes a child of the nearest shallower one) via a small stack, so the
  // absolute column count never matters — only the ordering. LLM deep-research
  // reports lean on multi-level bullet outlines constantly; before this the reader
  // FLATTENED every sub-point onto one level (documented tradeoff), losing the
  // hierarchy the author encoded.
  //
  // MIXED-TYPE nesting: the wrap passes above segregate items by marker type —
  // `- ` bullets into a <ul>, `N.` numbers into an <ol> — so a numbered item with
  // an INDENTED bullet sub-list ("1. Finding\n    - detail\n    - detail") emitted
  // TWO ADJACENT blocks: `<ol>…</ol><ul data-d…>…</ul>`. A per-block nester (the old
  // code) could only fold WITHIN one block, so the bullet sub-list popped out as a
  // SIBLING of the <ol> and the parent list even RESTARTED its numbering after it —
  // and this "numbered finding, bulleted sub-points" shape is the single most common
  // structure an LLM research report emits. So the nester now spans a RUN of adjacent
  // list blocks (they abut with no separator; a real paragraph gap keeps two lists in
  // SEPARATE runs) and carries each item's OWN tag from its source block, so a child
  // sub-list renders with the correct <ul>/<ol> nested INSIDE its parent <li>. A run
  // with no data-d anywhere (every flat list, and two flat different-type lists that
  // merely abut) is still returned BYTE-IDENTICAL — the regression firewall the GUARD
  // assertions rely on. Same-type nesting is unchanged (child tag == parent tag). The
  // top-level <ol start="N"> is preserved; sub-lists (and a numbered run RESUMED after
  // a sub-list) renumber via the browser default — no worse than before, correct here.
  // Runs BEFORE the blockquote pass, whose own lists (renderQuoteInner) are emitted
  // later and self-contained, so this never double-processes them.
  html = html.replace(/(?:<(?:ul|ol)(?: start="\d+")?>[\s\S]*?<\/(?:ul|ol)>)+/g, (run) => {
    if (!run.includes('data-d="')) return run;
    const items = [];
    let topTag = null, topStart = '';
    run.replace(/<(ul|ol)( start="\d+")?>([\s\S]*?)<\/\1>/g, (_, tag, startAttr, inner) => {
      if (topTag === null) { topTag = tag; topStart = startAttr || ''; }
      inner.replace(/<li(?: data-d="(\d+)")?>([\s\S]*?)<\/li>/g, (__, d, body) => {
        items.push({ tag, depth: d ? parseInt(d, 10) : 0, body });
        return '';
      });
      return '';
    });
    const root = { children: [] };
    const stack = [{ node: root, depth: -1 }];
    for (const it of items) {
      while (stack.length > 1 && stack[stack.length - 1].depth >= it.depth) stack.pop();
      const node = { tag: it.tag, body: it.body, children: [] };
      stack[stack.length - 1].node.children.push(node);
      stack.push({ node, depth: it.depth });
    }
    // Each list level's tag is its items' shared tag (a sub-list is emitted with the
    // child's OWN tag, not the parent's — the mixed-type fix); the root inherits the
    // first block's tag + start attr. `top` gets the start attr, sub-lists renumber.
    const emit = (nodes, listTag, startAttr) =>
      `<${listTag}${startAttr}>` +
      nodes.map((n) => `<li>${n.body}${n.children.length ? emit(n.children, n.children[0].tag, '') : ''}</li>`).join('') +
      `</${listTag}>`;
    return emit(root.children, topTag, topStart);
  });
  // Blockquotes. esc() has already turned a leading `>` into `&gt;`, so without
  // this a `> quoted from the source` line rendered as `<p>&gt; quoted…</p>` —
  // the marker leaked into the reader's report as a literal `>`. LLM research
  // reports quote sources this way constantly. Collapse each run of consecutive
  // `> ` lines into one <blockquote>, stripping the marker (+ its optional single
  // space); renderQuoteInner then handles the body — inline **bold**/*italic*/
  // [links] already rendered upstream, a quoted list/heading/rule folds into a
  // real <ul>/<ol>/<h*>/<hr>, and prose lines join with <br> as before. Runs AFTER
  // the two <li>/<oli> WRAP passes above ON PURPOSE: renderQuoteInner emits its own
  // <ul>/<ol>, so running before the wrap would let the global `<li>`-run wrap
  // grab the quote's inner items and double-nest them (`<ul><ul>…`). The paragraph
  // pass below whitelists <blockquote> as block-level so it is not re-wrapped in <p>.
  // NESTED quotes (`>> inner`, `> > inner`) esc() to a run of `&gt;` markers; strip
  // the WHOLE leading run per line so no extra `&gt;` leaks. `(?:&gt;[ \t]?)+` eats
  // consecutive markers with their optional single space; content that merely
  // starts with a lone `>` after the marker ("> -> arrow" -> `&gt; -&gt; arrow`)
  // is safe — the second `&gt;` isn't at line-start-after-a-marker.
  html = html.replace(/^&gt;[^\n]*(?:\n&gt;[^\n]*)*/gm, (m) => {
    const inner = renderQuoteInner(m.replace(/^(?:&gt;[ \t]?)+/gm, ''));
    return `<blockquote>${inner}</blockquote>`;
  });
  // GFM tables: a single-newline block (no blank lines between rows) that the
  // paragraph split would otherwise fuse into one <p> of literal pipes.
  html = renderTables(html);
  // A paragraph that FOLLOWS a list (blank line between) loses its <p> wrapper.
  // The <li>/<oli> wrap above ends each group with a trailing `\n?`, which eats
  // ONE of the two newlines of a blank-line separator — so "- a\n- b\n\nText"
  // collapses to `<ul>…</ul>\nText` with a single newline left. The \n{2,}
  // paragraph splitter then treats the whole run as ONE block; because it STARTS
  // with `<ul>` it passes through the block whitelist verbatim, and the trailing
  // paragraph is emitted as bare, unwrapped text glued to the list (no <p>, no
  // block margins). Every other block (heading/blockquote/table/code) preserves
  // its `\n\n`, so a list was the lone type that fused its following paragraph —
  // an extremely common deep-research shape (bulleted findings, then a paragraph
  // explaining them). Restore the blank line after a list closer that is followed
  // by a single newline + real content, so the splitter separates them and the
  // paragraph gets its <p>. Requiring a non-newline next char skips the case where
  // the separator survived intact (`\n\n` already present) and a trailing list at
  // end-of-string. Inserting a break before a following BLOCK element is harmless
  // (both halves pass the whitelist verbatim and rejoin), so no exclusion is
  // needed; it only ever ADDS the missing <p> around trailing prose/inline text.
  html = html.replace(/(<\/(?:ul|ol)>)\n(?=[^\n])/g, '$1\n\n');
  // A block-level element (list, heading, blockquote, table, hr) can directly
  // FOLLOW a paragraph line with NO blank line between — LLM research reports
  // emit a lead-in glued to a list constantly ("Key findings:\n- a\n- b"). The
  // \n{2,} splitter below treats that whole run as ONE block; the leading text
  // then fails the "starts with a block tag" test, so the entire run (list and
  // all) gets <p>-wrapped with its newlines turned to <br> — producing invalid
  // `<p>lead<br><ul><li>a</li><br><li>b</li></ul></p>` that renders wrong. Inject
  // a paragraph break so the splitter separates the lead-in <p> from the block
  // element. Mirrors the block whitelist below (minus <li>, which only exists
  // inside an already-wrapped list, and <pre>, which is stashed as a placeholder
  // at this point). The `[^\n>]` prefix requires the preceding char to be real
  // text — a `>` (tag close) is excluded, so two ADJACENT block elements
  // (`</ul>\n<ul>` from a loose list) are left untouched; after esc() every
  // literal `>` in prose is `&gt;`, so `>` here only ever ends one of our tags.
  // BUT a lead-in can END in an INLINE element and still be a lead-in that needs
  // separating: a bolded label glued to its list — `**Key findings:**\n- a\n- b`,
  // an extremely common deep-research pattern — renders to `<strong>Key
  // findings:</strong>` whose trailing `>` the `[^\n>]` guard wrongly excluded, so
  // the whole run still got <p>-wrapped into invalid
  // `<p><strong>…</strong><br><ul>…</ul></p>`. So ALSO accept a preceding inline
  // closing tag (</strong>, </em>, </del>, </mark>, </a> — the only inline tags
  // this renderer emits before this stage; </code>/<pre> are still \uE0xx stubs
  // here, already matched by [^\n>]). A BLOCK closer (</ul>, </li>, </h1>…) is NOT
  // in that set, so the loose-list `</ul>\n<ul>` adjacency stays untouched.
  html = html.replace(/((?:[^\n>]|<\/(?:strong|em|del|mark|a)>))\n(<(?:h[1-6]|hr|ul|ol|blockquote|table)[ >])/gi, '$1\n\n$2');
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      if (/^\s*<(h\d|hr|ul|ol|pre|li|p|blockquote|table)/i.test(block.trim())) return block;
      if (!block.trim()) return '';
      // Every intra-paragraph newline becomes a <br> (this renderer preserves the
      // author's line structure). But CommonMark hard-break MARKERS — a trailing
      // `\` or trailing spaces right before the newline — must be DROPPED, not
      // rendered. The old bare `\n`→`<br>` kept them, so `line one\` + newline
      // leaked a literal backslash into the reader (`line one\<br>`) and a
      // two-space break kept its trailing spaces. Strip an optional run of
      // trailing spaces/tabs and one optional trailing backslash along with the
      // newline. The `\` here is only ever a LITERAL one: a user-escaped `\\`
      // was stubbed as a \uE0xx placeholder earlier (restored below, after this
      // pass), so this never eats a real escaped backslash — only the bare
      // line-continuation marker CommonMark also discards.
      return `<p>${block.replace(/[ \t]*\\?\n/g, '<br>')}</p>`;
    })
    .join('\n');
  // CommonMark ENTITY & NUMERIC CHARACTER REFERENCES. esc() up front turned every
  // raw `&` into `&amp;`, so an entity the model actually emitted — `&amp;`, `&lt;`,
  // `&copy;`, `&#169;`, `&#x27;` — became DOUBLE-escaped (`&amp;` -> `&amp;amp;`),
  // rendering the literal text "&amp;"/"&copy;" in the reader instead of the char.
  // Research prose (and the web pages it summarises) emit entities constantly:
  // "AT&amp;T", "R&amp;D", "&copy; 2026", `&lt;div&gt;` in HTML discussion. Collapse
  // an `&amp;` that is IMMEDIATELY followed by a valid entity BODY (named, decimal,
  // or hex) back to a single `&…;` so it renders as the intended character. Runs
  // BEFORE the code-stub restore, so entities inside a code span/block (which
  // CommonMark leaves LITERAL) are still stubbed and stay `&amp;` verbatim.
  // XSS-safe: the result is a character REFERENCE — the SAME inert class esc()
  // itself emits and relies on. HTML decodes references in text/data context to
  // inert character tokens (a decoded `<` never opens a tag), so `&amp;lt;script&gt;`
  // -> `&lt;script&gt;` -> visible text "<script>", never live markup. A bare `&`
  // (AT&T, "5 & 6", "?a=1&b=2") is NOT followed by a `;`-terminated entity body,
  // so it stays `&amp;` — real query strings use `&key=value`, never `&word;`.
  html = html.replace(
    /&amp;(#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};|[a-zA-Z][a-zA-Z0-9]{0,31};)/g,
    '&$1'
  );
  // Restore the stashed code spans, then unwrap a standalone fenced block that
  // the paragraph pass wrapped as a lone <p> (a <pre> is block-level and must
  // not nest inside <p> — this reproduces the pre-stash output exactly).
  html = html.replace(/\uE000(\d+)\uE001/g, (_, i) => stash[Number(i)]);
  // The `\s*` inside the <p> is load-bearing: a fenced block INDENTED under a
  // list item ("1. Step\n\n   ```\n   run\n   ```") arrives at the paragraph
  // pass as leading spaces + the code stub, so it wraps as `<p>   <pre>…</pre></p>`.
  // A flush-only unwrap (`<p><pre>`) missed that leading whitespace and leaked
  // invalid HTML — a block-level <pre> nested in an inline <p>, stray indent
  // visible — into the reader. Deep-research "steps"/methodology sections emit
  // list-nested code constantly, so it's a real leak, not a corner case.
  // Tolerating surrounding whitespace also drops the meaningless indent.
  html = html.replace(/<p>\s*(<pre><code>[\s\S]*?<\/code><\/pre>)\s*<\/p>/g, '$1');
  return html;
}
