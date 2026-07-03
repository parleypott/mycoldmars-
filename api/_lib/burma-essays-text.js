// Pure text helpers for the Burma Essays narrator (api/burma-essays.js).
// Extracted so they can be unit-tested headlessly — stripMarkdown feeds the
// ElevenLabs TTS, so any markdown symbol it misses gets read ALOUD to the
// listener ("underscore", "tilde"), which is the whole reason it exists.

// HTML entities → their real characters. An essay paragraph pasted from a web
// source / Google-Docs HTML export / a generator often carries entities in
// place of punctuation: "Britain &amp; Burma", "the coup&mdash;a turning point",
// "it&rsquo;s over &hellip;", "30&deg;C", numeric "&#8212;" / "&#x2014;". The
// stripper used to pass them through RAW, so ElevenLabs read the literal escape
// aloud — "ampersand a m p semicolon", "ampersand m dash semicolon" — the exact
// read-it-aloud failure mode this whole module exists to kill. Decode runs FIRST
// so a decoded char is then handled like any other (e.g. an entity-encoded
// "&lt;br&gt;" becomes "<br>" and is dropped by the HTML-tag rule below).
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', minus: '−', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  sbquo: '‚', bdquo: '„', laquo: '«', raquo: '»',
  deg: '°', copy: '©', reg: '®', trade: '™',
  times: '×', divide: '÷', middot: '·', bull: '•',
  dagger: '†', Dagger: '‡', sect: '§', para: '¶',
  euro: '€', pound: '£', cent: '¢', yen: '¥',
  frac12: '½', frac14: '¼', frac34: '¾',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à',
  acirc: 'â', ccedil: 'ç', ntilde: 'ñ', uuml: 'ü',
  ouml: 'ö', auml: 'ä', szlig: 'ß', oslash: 'ø', aring: 'å',
};

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const cp = (body[1] === 'x' || body[1] === 'X')
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Drop only well-formed, representable code points; leave anything weird
      // (out of range, a lone surrogate, NUL) as the literal text rather than
      // guessing — a malformed numeric entity is better spoken than crashed on.
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return m;
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    // Named entities are case-sensitive; an unknown name is left intact.
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : m;
  });
}

export function stripMarkdown(md) {
  let s = decodeEntities(String(md ?? ''))
    .replace(/```[\s\S]*?```/g, '')        // fenced code blocks (backtick)
    // Tilde-fenced code blocks (CommonMark allows ~~~ as well as ```). Without
    // this, the code BODY got read aloud AND the fence tildes leaked: the strike
    // rule below (~~…~~) partially chewed a ~~~ fence into stray single tildes
    // ("~js … ~"), read as "tilde". Requires THREE tildes to open/close, so a
    // 2-tilde ~~strikethrough~~ span never starts a fence match. Runs BEFORE the
    // strike rule, mirroring the backtick fence above.
    .replace(/~~~[\s\S]*?~~~/g, '')
    // HTML comments (<!-- editor note -->) — invisible on the page, but read ALOUD
    // by the TTS as the raw note. Strip before anything else.
    .replace(/<!--[\s\S]*?-->/g, '')
    // Blockquote markers (>, > , >>, > > ). MUST run BEFORE the line-anchored
    // structural rules below (headings ^#, bullets ^-, numbered ^1., task-lists,
    // thematic breaks, table rows) — otherwise a quoted list/heading keeps its
    // ">" prefix so those rules never see it, and the inner marker leaks into the
    // audio: "> ## A quote" → "## A quote" read as "hash hash", "> - point" → "-
    // point", "> 1. one" → "1. one". A blockquote pull-quote containing a heading
    // or list is common in essays. Strips every nesting level (>[space]) so a
    // ">> deeply" or spaced "> > " quote is fully unwrapped. Anchored to line
    // start, so a prose comparison ("5 > 3", "a > b") is never touched.
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
    .replace(/`([^`]+)`/g, '$1')           // inline code
    // Linked images ([![alt](img)](url)) — an image wrapped in a link. It carries
    // NO readable text, so drop the whole construct. MUST run before the plain
    // image rule below: otherwise that rule eats the inner ![alt](img) and leaves
    // a "[]()" husk (the outer []() with the URL gone) that the TTS reads aloud as
    // "open bracket close bracket open paren close paren". Common in essays as a
    // clickable photo/map.
    //
    // The URL captures below allow ONE level of balanced parens —
    // `(?:[^()]|\([^()]*\))` — not the naive `[^)]+`. A bare `[^)]+` truncates at
    // the FIRST ")", so a Wikipedia-style disambiguation link
    // ("[Myanmar](…/Myanmar_(Burma))") or an image path with a parenthetical
    // ("…/Burma_(Myanmar).png") left the rest of the URL — and a stray ")" —
    // leaking into the audio ("Myanmar close paren", "dot png close paren"). These
    // links are ubiquitous in geopolitical/historical essays, so it's a real
    // read-it-aloud leak, not a corner case. Mirrors the fix already shipped in
    // research/md.js's link/image transforms.
    .replace(/\[!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)\]\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))+\)/g, '')  // images
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))+\)/g, '$1') // inline links -> link text
    // Empty-text inline links ([](url)) — no readable text; drop entirely so the
    // "[]()" husk never reaches the audio. The link rule above needs >=1 text char,
    // so it skips these on its own.
    .replace(/\[\]\([^)]*\)/g, '')
    // Reference-style IMAGES (![alt][id] / ![alt][]) — an image referenced by a
    // label instead of an inline (url). Carries NO readable text, so drop the WHOLE
    // construct, mirroring the inline-image rule above. MUST run BEFORE the
    // reference-link-USE rule below: that rule matches only the "[alt][id]" part and
    // reduces it to the alt text, leaving the leading "!" to leak into the audio
    // (read aloud as "exclamation mark"). Common when an essay defines its images
    // once at the bottom and references them by label (![Burma map][fig1]).
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
    // Reference-style link USE — [text][id] / [text][] -> keep the visible text, drop [id].
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    // Footnote definition lines ([^id]: text) -> keep the text, drop the marker.
    // (Runs before the ref-def rule below so the def line's text survives.)
    .replace(/^[ \t]*\[\^[^\]]+\]:[ \t]*/gm, '')
    // Reference link DEFINITIONS ([id]: https://… "title") on their own line -> drop,
    // else ElevenLabs reads the raw source URL aloud. Must start with [id]: + a target.
    .replace(/^[ \t]*\[[^\]]+\]:[ \t]+\S.*$/gm, '')
    // Inline footnote refs [^id] -> drop (reads "bracket caret one" otherwise).
    .replace(/\[\^[^\]]+\]/g, '')
    // Raw inline HTML tags AND autolinks (<br>, <em>, </strong>, <https://…>, <mailto:…>)
    // -> drop. Requires a letter or "/" right after "<" AND a closing ">", so prose
    // comparisons ("a < b", "3 < 5", "x<y" with no close) are left untouched.
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    // Bare URLs (https://… or www.…) on their own, NOT wrapped in [text](url)
    // or <autolink> (both already handled above). ElevenLabs reads a raw link
    // aloud character-by-character ("h t t p s colon slash slash…"), so a source
    // URL pasted into essay prose gets spoken. Drop the URL but KEEP any trailing
    // sentence punctuation, so "…reported at https://reuters.com." still stops.
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi, (m) => (m.match(/[.,;:!?]+$/) || [''])[0])
    // Table separator rows (|---|:--:|) — strip BEFORE the row→comma pass below,
    // else the dashes read as "dash dash dash" or leak in as a bogus cell.
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/gm, '')
    // Pipe-bordered table rows (| City | Pop |) — speak the cells, drop the bars
    // (else ElevenLabs reads "vertical bar"). Only fires on lines that BOTH
    // start and end with a pipe, so prose containing a stray "|" is untouched.
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, inner) =>
      inner.split('|').map((c) => c.trim()).filter(Boolean).join(', '))
    // Thematic breaks (---, ***, ___, or spaced - - -) on their own line — these
    // dodge the bullet rule below (no trailing content) and get read aloud.
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
    // Setext heading underline (=== under a title); the H2 dash form is already
    // killed by the thematic-break rule above. Keeps the title text as prose.
    .replace(/^[ \t]*=+[ \t]*$/gm, '')
    // Closed ATX headings (## Title ##) — drop the trailing ### (else "Title hash hash").
    // Scoped to lines that START with # so prose ending in " #" is untouched.
    .replace(/^(#+[ \t]+.*?)[ \t]+#+[ \t]*$/gm, '$1')
    .replace(/^#+\s*/gm, '')               // ATX headings (leading)
    // GFM task-list items ("- [ ] todo", "- [x] done", "* [X] done"). Must run
    // BEFORE the plain-bullet rule below: that rule only eats the "- " marker, so
    // the "[ ]" / "[x]" checkbox survived and ElevenLabs read it ALOUD ("open
    // bracket close bracket", "open bracket x close bracket") — the exact read-it-
    // aloud failure this module exists to kill. Drop the bullet AND the checkbox,
    // keep the task text. Uses [ \t] (not \s) so it never eats the trailing newline
    // and merges lines. Scoped to a line-start bullet, so prose "[x]" is untouched.
    .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]*/gm, '')  // task-list checkboxes
    // Bullet lists. CommonMark allows THREE bullet markers — -, *, AND + — so a
    // "+ point" list leaked its literal "+" into the audio (read aloud as "plus").
    .replace(/^\s*[-*+]\s+/gm, '')         // bullet lists (-, *, +)
    // Numbered lists. CommonMark allows BOTH "1." and "1)" as ordered markers, so
    // a "1) point" list leaked its literal ")" into the audio (read as "close paren").
    .replace(/^\s*\d+[.)]\s+/gm, '');      // numbered lists (1. and 1))

  // Inline emphasis (~~strike~~, **bold**, __bold__, *italic*, _italic_). Run to a
  // FIXED POINT, not once. A single left-to-right pass leaves stray markers on NESTED
  // spans: "The **coup was *deeply* destabilizing**" → "The *coup was deeply
  // destabilizing*" — the outer ** can't match across the inner single stars, and the
  // later italic pass strips only the inner pair, so a literal "*" leaked into the
  // audio (read aloud as "asterisk"), the exact failure this module exists to kill.
  // Each rule only ever DROPS markers, so the string strictly shrinks until stable and
  // the loop always terminates. Simple spans converge on the first pass (byte-identical
  // to the old single-pass behavior); only nested spans get additional cleanup.
  let prev;
  do {
    prev = s;
    s = s
      .replace(/~~([^~]+)~~/g, '$1')       // strikethrough (else reads "tilde")
      // GFM / Obsidian highlight (==important==). The one common emphasis-wrapper
      // the loop didn't unwrap: the ==markers== leaked into the audio (read as
      // "equals equals"), same read-it-aloud class as the strike/bold/italic marks
      // beside it. Requires TWO equals on each side with a non-"=" body, so a lone
      // comparison "E = mc" (single, space-flanked "=") is never touched.
      .replace(/==([^=]+)==/g, '$1')       // highlight == (else reads "equals")
      // Asterisk emphasis is FLANKING-AWARE per CommonMark: a "*" can only OPEN a
      // span when the char right after it is not whitespace, and only CLOSE one when
      // the char right before it is not whitespace. The old bare /\*\*(…)\*\*/ (and
      // the italic /\*(…)\*/ below) ignored flanking, so two whitespace-flanked stars
      // in one line — arithmetic like "buy 2 * 2 and 5 * 6", or a literal-asterisk
      // aside "a ** b ** c" — mis-paired ACROSS the unrelated text between them,
      // EATING the inner stars and mashing "2 * 2 ... 5 * 6" into "2  2 ... 5  6"
      // (a garbled run read aloud). The flanking lookarounds ((?=[^\s*]) after the
      // opener, (?<=[^\s*]) before the closer) fix it while still stripping genuine
      // **bold**/*italic* spans; the fixed-point loop still converges nested spans.
      .replace(/\*\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*\*/g, '$1')   // bold ** (flanking-aware)
      // Underscore emphasis is INTRAWORD-BLIND per CommonMark: a "_" opens/closes
      // emphasis only at a word boundary, so snake_case identifiers are NEVER
      // emphasis and must stay literal (matching the media_uploads contract). The
      // old bare /_(…)_/ fired on intra-word DOUBLE underscores: "data_analysis_v2"
      // lost its "_analysis_" -> "dataanalysisv2" (a garbled run-on word read
      // aloud), and worse, a real span sitting next to a snake_case word
      // ("code_word and _real emphasis_") mis-paired across the intra-word "_" and
      // STRANDED a lone "_" that the TTS reads aloud as "underscore" — the exact
      // leak this module exists to kill. The boundary lookarounds (no letter/number
      // immediately outside the outer underscores) fix both while still stripping
      // genuine _italic_ / __bold__ spans. The * forms stay intra-word-capable
      // (CommonMark treats * and _ differently), so they are unchanged.
      .replace(/(?<![\p{L}\p{N}])__([^_]+)__(?![\p{L}\p{N}])/gu, '$1')  // bold __ (boundary-aware)
      .replace(/\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*/g, '$1')       // italic * (flanking-aware)
      .replace(/(?<![\p{L}\p{N}])_([^_]+)_(?![\p{L}\p{N}])/gu, '$1');   // italic _ (boundary-aware)
  } while (s !== prev);

  return s
    // CommonMark backslash escapes (\$ \* \# \. \- \_ \[ …). Authors — and markdown
    // generators / paste sources — escape ASCII punctuation so it renders literally:
    // "It cost \$5", "the year 2020\." (to stop the auto-list), "use the \* operator".
    // The stripper passed the backslash through RAW, so ElevenLabs read it ALOUD
    // ("backslash dollar 5", "twenty twenty backslash"), the exact read-it-aloud
    // failure this whole module exists to kill. Runs LAST — after every structural
    // rule — so an escape has already done its job of PREVENTING interpretation (an
    // escaped "1\." never matched the numbered-list rule, so its "1" still survives
    // to here); we only now drop the backslash and keep the literal punctuation.
    .replace(/\\([!-\/:-@\[-`{-~])/g, '$1') // \X (ASCII punctuation) -> X
    .replace(/\n{3,}/g, '\n\n')            // collapse blank runs
    .trim();
}

export function firstLine(t) {
  return (t || '').split('\n').map((s) => s.trim()).find(Boolean)?.slice(0, 80);
}

export function slug(t) {
  return (t || 'essay').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'essay';
}

export function clampNum(n) {
  n = Number(n);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Default per-request size for the ElevenLabs TTS call (api/burma-essays.js).
export const CHUNK_LIMIT = 4800;

// Split an essay into TTS-sized chunks. Two hard invariants, because in
// generateAudio() a SINGLE bad chunk (synth() returns null) fails the WHOLE
// essay's audio: (1) NO chunk is ever empty — an empty string POSTed to
// ElevenLabs 400s; (2) NO chunk ever exceeds `max` — an over-cap chunk is
// rejected by the per-request limit. The old inline version broke both: an
// empty leading buffer was flushed verbatim when a near-max first paragraph
// arrived, and a single sentence (or punctuation-less run-on, via the `?? [p]`
// fallback) longer than `max` was emitted as one over-cap chunk. Same bug
// class as the research-tts chunker.
export function chunkText(text, max = CHUNK_LIMIT) {
  text = typeof text === 'string' ? text : '';
  if (text.length <= max) return text.trim() ? [text] : [];
  const out = [];
  let buf = '';
  const flush = () => { const t = buf.trim(); if (t) out.push(t); buf = ''; };
  // Emit a single over-long string in <=max slices, never empty, never over cap.
  // Each slice is trimmed and whitespace-only slices are dropped — an interior
  // whitespace run >= max would otherwise yield an all-blank chunk, which POSTed
  // to ElevenLabs fails the whole readout (the very thing this fn guards). This
  // matches the hardened research-tts twin.
  const hardSplit = (s) => { for (let i = 0; i < s.length; i += max) { const piece = s.slice(i, i + max).trim(); if (piece) out.push(piece); } };

  for (const p of text.split(/\n\n+/)) {
    if (p.length > max) {
      // Match terminated sentences AND any un-terminated trailing run, so a
      // giant paragraph that doesn't end in . ! ? doesn't silently drop its tail.
      const sentences = p.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [p];
      for (const s of sentences) {
        if (s.length > max) { flush(); hardSplit(s.trim()); continue; }
        if ((buf + ' ' + s).trim().length > max) { flush(); buf = s; }
        else buf = buf ? buf + ' ' + s : s;
      }
    } else if ((buf + '\n\n' + p).length > max) { flush(); buf = p; }
    else buf = buf ? buf + '\n\n' + p : p;
  }
  flush();
  return out;
}
