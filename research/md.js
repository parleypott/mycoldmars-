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
  html = html.replace(/~~~+([\s\S]*?)~~~+/g, (_, c) => stub(`<pre><code>${fenceCode(c)}</code></pre>`));
  html = html.replace(/```([\s\S]*?)```/g, (_, c) => stub(`<pre><code>${fenceCode(c)}</code></pre>`));
  html = html.replace(/`([^`]+)`/g, (_, c) => stub(`<code>${c}</code>`));
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
  html = html.replace(
    /^[ \t]*(?:[-*+])[ \t]+\[([ xX])\][ \t]*(.*)$/gm,
    (_, mark, text) =>
      `<li><input type="checkbox" disabled${mark === 'x' || mark === 'X' ? ' checked' : ''}>${text ? ' ' + text : ''}</li>`
  );
  html = html.replace(/^[ \t]*(?:- |\* )(.*)$/gm, '<li>$1</li>');
  // Ordered items. CommonMark allows BOTH `1.` and `1)` as ordered-list
  // delimiters, and LLM research prose emits paren-delimited lists ("1) foo\n
  // 2) bar") constantly. Matching only `\d+\. ` left a `1)` list leaking into the
  // reader as a fused literal `<p>1) foo<br>2) bar</p>` — its ")" text preserved
  // and the whole list collapsed into one paragraph. The TTS narrator
  // (api/_lib/burma-essays-text.js) already accepts both delimiters, so the
  // VISUAL reader was again the lone inconsistent path. `[.)]` claims both; the
  // `<oli>` marker still folds into the numbered <ol> wrap below.
  html = html.replace(/^[ \t]*\d+[.)] (.*)$/gm, '<oli>$1</oli>');
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
  html = html.replace(/\*\*\*([^\s*](?:[^\n]*?[^\s*])?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*([^\s*](?:[^\n]*?[^\s*])?)\*\*/g, '<strong>$1</strong>');
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
  html = html.replace(/(^|[^*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*/g, '$1<em>$2</em>');
  // Underscore emphasis (__bold__, _italic_) and GFM strikethrough (~~struck~~).
  // The TTS stripMarkdown already unwraps all three; the visual reader leaked
  // them as literal `_italic_` / `__bold__` / `~~cancelled~~` markers — LLM
  // research prose emits underscore emphasis and strikethrough often enough to
  // reach the reader. Underscore uses CommonMark's INTRAWORD rule: a `_` only
  // opens/closes emphasis at a word boundary, so snake_case identifiers and URL
  // path segments (foo_bar_baz) are left literal — the `(^|[^\w])` prefix and
  // `(?![\w])` tail enforce that (asterisk has no intraword restriction, which
  // is why the rules above don't need it). Double-underscore runs before single
  // so `__bold__` isn't half-eaten. Strikethrough needs no flanking guard: a
  // doubled `~~` is vanishingly rare outside real strike spans, and code (where
  // `~` could appear) is already stashed.
  html = html.replace(/(^|[^\w])__(\S(?:[^_\n]*?\S)?)__(?![\w])/g, '$1<strong>$2</strong>');
  html = html.replace(/(^|[^\w])_(\S(?:[^_\n]*?\S)?)_(?![\w])/g, '$1<em>$2</em>');
  html = html.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
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
  html = html.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)/g, (_, label, dest) => {
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
    return href ? `<a href="${href}" target="_blank" rel="noopener">${label}</a>` : label;
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
