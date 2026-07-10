// Coverage for the Burma Essays narrator text helpers (the markdown the TTS reads aloud).
// Run: node api/_lib/burma-essays-text.test.mjs   (also auto-discovered by `bun run test`)
import { stripMarkdown, decodeEntities, firstLine, slug, clampNum, chunkText, CHUNK_LIMIT } from './burma-essays-text.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const deepEq = (got, want, msg) => eq(JSON.stringify(got), JSON.stringify(want), msg);

// ---- RED PROOF: the pre-fix stripMarkdown (no __bold__, no ~~strike~~) leaked symbols into the spoken text.
// Reconstructed verbatim from the shipped function before this fix; asserts it WOULD read stray glyphs aloud.
function stripMarkdownOLD(md) {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^>+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// __bold__: old code left stray underscores ("_bold_") -> TTS says "underscore bold underscore".
eq(stripMarkdownOLD('__bold__ word'), '_bold_ word', 'RED: old code leaks stray underscores on __bold__');
eq(stripMarkdown('__bold__ word'), 'bold word', 'FIX: __bold__ fully stripped');
// ~~strike~~: old code left tildes -> TTS says "tilde tilde".
eq(stripMarkdownOLD('She said ~~no~~ yes'), 'She said ~~no~~ yes', 'RED: old code leaks tildes on ~~strike~~');
eq(stripMarkdown('She said ~~no~~ yes'), 'She said no yes', 'FIX: ~~strike~~ stripped');

// ---- The headline fix, more cases.
eq(stripMarkdown('__Mandalay__ burned.'), 'Mandalay burned.', '__bold__ at line start');
eq(stripMarkdown('a __two word__ b'), 'a two word b', '__bold__ multi-word');
eq(stripMarkdown('~~old plan~~ then ~~newer~~'), 'old plan then newer', 'two strikethroughs keep words, drop markers');
// Inner LONE tilde inside a strike span (a GFM run of one `~` never closes a `~~`
// opener). A struck approximate figure keeps its `~` as content — the old class
// `[^~]+` excluded ALL tildes, so the span never matched and the tildes were read
// ALOUD ("tilde tilde around tilde 5 killed tilde tilde"). MUTATION: the old rule leaks.
eq('He was hit at ~~about ~5pm~~ sharp.'.replace(/~~([^~]+)~~/g, '$1'),
   'He was hit at ~~about ~5pm~~ sharp.', 'RED: old `[^~]+` strike class leaks tildes on an inner-tilde span');
// The strike markers drop (this test's purpose); the surviving inner lone "~5" is then
// spoken as an approximation ("around 5pm") by the tilde pass below — NOT read as "tilde".
eq(stripMarkdown('He was hit at ~~about ~5pm~~ sharp.'), 'He was hit at about around 5pm sharp.',
   'FIX: struck span with a lone inner ~ drops its markers; the inner ~5 is then spoken');
// Unpaired approximation tildes are NOT mistaken for strike AND are now spoken (see the
// dedicated approximation/range block below) — "~5"→"around 5", "~10"→"around 10".
eq(stripMarkdown('approx ~5 to ~10 people'), 'approx around 5 to around 10 people',
   'GUARD: unpaired single ~ not mistaken for strike; spoken as an approximation');

// ---- No regression: the formatting that already worked must still work identically.
eq(stripMarkdown('**bold** text'), 'bold text', '** bold still stripped');
eq(stripMarkdown('an *italic* word'), 'an italic word', '* italic still stripped');
eq(stripMarkdown('an _italic_ word'), 'an italic word', '_ italic still stripped');
eq(stripMarkdown('# Heading'), 'Heading', 'ATX heading');
eq(stripMarkdown('## Two'), 'Two', 'ATX heading 2');
eq(stripMarkdown('- item one\n- item two'), 'item one\nitem two', 'bullet list');
eq(stripMarkdown('1. first\n2. second'), 'first\nsecond', 'numbered list');
// CommonMark list-marker coverage: + is a valid bullet marker and 1) a valid
// ordered marker. Both leaked their literal symbol into the TTS audio before the
// fix ("plus", "close paren"). Mutation guard: reverting to [-*] / \d+\. fails these.
eq(stripMarkdown('+ plus one\n+ plus two'), 'plus one\nplus two', 'plus bullet list (+)');
eq(stripMarkdown('* star one\n+ plus two\n- dash three'), 'star one\nplus two\ndash three', 'mixed -/*/+ bullets');
eq(stripMarkdown('1) first\n2) second'), 'first\nsecond', 'paren-numbered list (1))');
eq(stripMarkdown('  + indented plus'), 'indented plus', 'indented + bullet');
// Unicode bullet glyphs used as LIST MARKERS at line start (•, ‣, ◦, ⁃, ∙, ·). Not
// CommonMark, so the ASCII -/*/+ rule misses them — but they are exactly what a list
// PASTED from Word/Docs/PDF leaves, and what decodeEntities() produces from &bull;/
// &middot;. Left alone the glyph was read ALOUD ("bullet", "middle dot"). RED PROOF:
// stripMarkdownOLD (no unicode-bullet rule) leaves the glyph; the live fn drops it.
eq(stripMarkdownOLD('• First\n• Second'), '• First\n• Second', 'RED: old code leaves the • bullet glyph');
eq(stripMarkdown('• First\n• Second'), 'First\nSecond', 'FIX: • bullet markers dropped');
eq(stripMarkdown('· Alpha\n· Beta'), 'Alpha\nBeta', 'FIX: · (middot) bullet markers dropped');
eq(stripMarkdown('‣ tri\n◦ ring\n⁃ hyph\n∙ op'), 'tri\nring\nhyph\nop', 'FIX: ‣ ◦ ⁃ ∙ bullet markers dropped');
eq(stripMarkdown('  • indented'), 'indented', 'FIX: indented • bullet dropped');
// The module DECODES these entities into the glyph, so it must then not read it aloud.
eq(stripMarkdown('&bull; decoded bullet\n&bull; and again'), 'decoded bullet\nand again', 'FIX: &bull;-decoded line-leading bullet dropped');
// REGRESSION GUARDS: an INLINE interpunct separator is NOT a list marker — leave it
// (and its decoded-entity form) intact, since it is real spoken content.
eq(stripMarkdown('Britain • Burma'), 'Britain • Burma', 'GUARD: inline • separator untouched');
eq(stripMarkdown('the coup &middot; a turning'), 'the coup · a turning', 'GUARD: inline · separator untouched');
eq(stripMarkdown('•glued'), '•glued', 'GUARD: a bullet glyph with NO trailing space is not a list marker');
eq(stripMarkdown('> quoted line'), 'quoted line', 'blockquote');
eq(stripMarkdown('[Newpress](https://newpress.co) link'), 'Newpress link', 'link -> text');
eq(stripMarkdown('![alt](https://x/y.png) caption'), 'caption', 'image removed');
eq(stripMarkdown('use `code` inline'), 'use code inline', 'inline code');
eq(stripMarkdown('```\ncode block\n```\nafter'), 'after', 'fenced code removed');
eq(stripMarkdown('a\n\n\n\nb'), 'a\n\nb', 'collapse blank runs');

// ---- Critically: snake_case / mid-word underscores must NOT be eaten by the bold-__ rule.
eq(stripMarkdown('the media_uploads table'), 'the media_uploads table', 'single underscore (snake_case) preserved');
eq(stripMarkdown('a__b'), 'a__b', 'no spaces, no inner content -> left alone');
eq(stripMarkdown('plain prose, nothing to strip'), 'plain prose, nothing to strip', 'plain prose untouched');

// combined: bold + italic + strike in one line
eq(stripMarkdown('**B** and __b2__ and _i_ and ~~s~~'), 'B and b2 and i and s', 'combined emphasis forms');

// ---- GFM / Obsidian highlight (==important==) — the one common emphasis-wrapper
// the loop didn't unwrap. Old code left the ==markers==, read aloud as "equals equals".
eq(stripMarkdownOLD('this is ==important== text'), 'this is ==important== text', 'RED: old code leaks == highlight markers');
eq(stripMarkdown('this is ==important== text'), 'this is important text', 'FIX: ==highlight== unwrapped to inner text');
eq(stripMarkdown('==big== and ==bold=='), 'big and bold', 'two highlights keep words, drop markers');
eq(stripMarkdown('a ==high **bold** light== span'), 'a high bold light span', 'highlight + nested bold (fixed-point loop)');
// Load-bearing guard: a lone comparison "=" must NEVER be touched (regression fence).
eq(stripMarkdown('the ratio E = mc squared'), 'the ratio E = mc squared', 'single space-flanked = left untouched');
eq(stripMarkdown('5 == 5 dollars'), '5 == 5 dollars', 'unpaired == in prose (no closing pair) untouched');

// ---- RED PROOF: structural markdown (horizontal rules, setext underlines, tables) that the old
// function left intact, so ElevenLabs read the glyphs aloud ("dash dash dash", "vertical bar").
eq(stripMarkdownOLD('A.\n\n---\n\nB.'), 'A.\n\n---\n\nB.', 'RED: old code leaves --- thematic break (read as dashes)');
eq(stripMarkdownOLD('A.\n\n***\n\nB.'), 'A.\n\n***\n\nB.', 'RED: old code leaves *** thematic break');
eq(stripMarkdownOLD('Title\n===\n\nBody.'), 'Title\n===\n\nBody.', 'RED: old code leaves setext === underline');
eq(stripMarkdownOLD('| City | Pop |\n|---|---|\n| Yangon | 5M |'), '| City | Pop |\n|---|---|\n| Yangon | 5M |', 'RED: old code leaves table pipes/dashes');
// FIX: each structural form no longer reaches the narrator as raw markup.
eq(stripMarkdown('First para.\n\n---\n\nSecond para.'), 'First para.\n\nSecond para.', 'FIX: --- thematic break removed');
eq(stripMarkdown('A.\n\n***\n\nB.'), 'A.\n\nB.', 'FIX: *** thematic break removed');
eq(stripMarkdown('A.\n\n___\n\nB.'), 'A.\n\nB.', 'FIX: ___ thematic break removed');
eq(stripMarkdown('A.\n\n- - -\n\nB.'), 'A.\n\nB.', 'FIX: spaced - - - thematic break removed');
eq(stripMarkdown('My Title\n===\n\nBody text here.'), 'My Title\n\nBody text here.', 'FIX: setext H1 underline removed, title kept');
eq(stripMarkdown('A Section\n---\n\nBody.'), 'A Section\n\nBody.', 'FIX: setext H2 underline removed, title kept');
eq(stripMarkdown('| City | Pop |\n|------|-----|\n| Yangon | 5M |'), 'City, Pop\n\nYangon, 5M', 'FIX: table cells spoken, bars/dashes dropped');
eq(stripMarkdown('| One |\n|---|\n| Two |'), 'One\n\nTwo', 'FIX: single-column table');
// BORDERLESS GFM tables (no leading/trailing pipe) — valid GFM that LLM deep-research
// prose (shared research-tts core) routinely emits. The old code's bordered-row rule
// only fired on rows that BOTH start and end with "|", so these leaked their inner "|"
// into the audio as "vertical bar". Detected via the matching-column delimiter row.
eq(stripMarkdownOLD('City | Pop\n--- | ---\nYangon | 5M'), 'City | Pop\n--- | ---\nYangon | 5M', 'RED: old code leaves borderless table pipes');
eq(stripMarkdown('City | Pop\n--- | ---\nYangon | 5M'), 'City, Pop\n\nYangon, 5M', 'FIX: borderless table cells spoken, bars dropped');
eq(stripMarkdown('Name | Score\n:--- | ---:\nAda | 10'), 'Name, Score\n\nAda, 10', 'FIX: borderless table with colon-aligned delimiter');
eq(stripMarkdown('City | State | Pop\n---|---|---\nYangon | Yangon | 5M\nBago | Bago | 1M'), 'City, State, Pop\n\nYangon, Yangon, 5M\nBago, Bago, 1M', 'FIX: multi-row borderless table');
eq(stripMarkdown('| City | Pop\n|---|---\n| Yangon | 5M'), 'City, Pop\n\nYangon, 5M', 'FIX: ragged leading-pipe-only table rows');
// No-regression guard: a pipe-bearing line above a BARE "---" (a thematic break, not a
// matching delimiter) is prose, NOT a table — its "|" and the break are handled apart.
eq(stripMarkdown('Cost | Benefit\n\n---\n\nNext.'), 'Cost | Benefit\n\nNext.', 'no-regression: pipe prose over a thematic break is not a borderless table');
// No regression: prose with an incidental mid-line pipe or a hyphenated phrase stays untouched.
eq(stripMarkdown('He paused | then spoke.'), 'He paused | then spoke.', 'mid-line pipe in prose preserved (not a table row)');
eq(stripMarkdown('a well-worn path'), 'a well-worn path', 'hyphenated word preserved');
eq(stripMarkdown('cost: 5-10 dollars'), 'cost: 5-10 dollars', 'number range with single hyphen preserved');

// ---- RED PROOF: the pre-this-fix function (structural rules present, but NO html-tag /
// autolink / reference-link / footnote / html-comment / closed-ATX handling) leaked these
// straight into the spoken text — raw source URLs, "<br>", and even invisible editor notes.
function stripMarkdownPreHtml(md) {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, inner) =>
      inner.split('|').map((c) => c.trim()).filter(Boolean).join(', '))
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
    .replace(/^[ \t]*=+[ \t]*$/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^>+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// HTML comment — invisible on the page, but the OLD code reads the editor's note aloud.
eq(stripMarkdownPreHtml('Before.<!-- editor note: cut this -->After.'), 'Before.<!-- editor note: cut this -->After.', 'RED: old code reads the HTML comment aloud');
eq(stripMarkdown('Before.<!-- editor note: cut this -->After.'), 'Before.After.', 'FIX: HTML comment stripped');
// Reference link definition — OLD code reads the raw source URL aloud.
eq(stripMarkdownPreHtml('See the report.\n\n[1]: https://example.com/source'), 'See the report.\n\n[1]: https://example.com/source', 'RED: old code reads the ref-link URL aloud');
eq(stripMarkdown('See the report.\n\n[1]: https://example.com/source'), 'See the report.', 'FIX: reference link definition dropped');
// Autolink — OLD code reads the bare URL aloud.
eq(stripMarkdownPreHtml('Read more at <https://example.com/source>.').includes('https://'), true, 'RED: old code leaves the autolink URL');
eq(stripMarkdown('Read more at <https://example.com/source> now.').includes('https://'), false, 'FIX: autolink URL dropped');
// Raw HTML tags — OLD code reads "<br>"/"<em>" aloud.
eq(stripMarkdownPreHtml('Line.<br>Next.<em>x</em>'), 'Line.<br>Next.<em>x</em>', 'RED: old code leaves raw HTML tags');
eq(stripMarkdown('Line.<br>Next.<em>x</em>'), 'Line.\nNext.x', 'FIX: <br> breaks (not glue), inline <em> drops to nothing');
// Reference-style link USE — keep visible text, drop the [id].
eq(stripMarkdown('See [the report][1] for details.'), 'See the report for details.', 'FIX: reference-style link use keeps text, drops [id]');
// Reference-style IMAGES (![alt][id] / ![alt][]) — an image referenced by label.
// Without a dedicated rule the reference-link-USE rule matches only the "[alt][id]"
// part and reduces it to the alt text, LEAVING the leading "!" to leak into the
// audio ("exclamation mark"). RED proof: the ref-link-use transform alone on the
// stripped construct keeps a stray "!". FIX: the whole image is dropped, like an
// inline ![alt](url).
eq('![Burma map][fig1]'.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1'), '!Burma map', 'RED: ref-link-use rule alone leaves the leading "!" husk');
eq(stripMarkdown('See ![the map][fig1] here.\n\n[fig1]: /map.png'), 'See  here.', 'FIX: reference-style image dropped whole (same double-space as an inline image) — no leaked "!"');
eq(stripMarkdown('See ![Burma map][] here.'), 'See  here.', 'FIX: collapsed reference-style image (![alt][]) dropped whole');
eq(stripMarkdown('See ![the map][fig1] here.').includes('!'), false, 'FIX: no "!" husk anywhere in the ref-image output');
eq(stripMarkdown('See [the map][fig1] here.'), 'See the map here.', 'GUARD: a real ref-LINK (no !) still keeps its visible text');
eq(stripMarkdown('Prices rose 5! Then fell.'), 'Prices rose 5! Then fell.', 'GUARD: a plain "!" in prose is untouched');
// Wiki-style links ([[Page]] / [[Page|Display]]) — Obsidian/wiki syntax (Johnny's own
// notes + the PAI memory system link this way). None of the single-bracket link rules
// match double brackets, so pre-fix the WHOLE construct leaked into the audio ("open
// bracket open bracket … close bracket close bracket"). RED-proof: the ref-link-use rule
// alone can't touch it.
eq('See [[Some Page]] here.'.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1'), 'See [[Some Page]] here.', 'RED: single-bracket link rules leave [[wikilink]] fully intact');
eq(stripMarkdown('See [[Some Page]] here.'), 'See Some Page here.', 'FIX: [[Page]] -> page name, brackets dropped');
eq(stripMarkdown('Read [[Burma Essays|the essays]] now.'), 'Read the essays now.', 'FIX: [[Page|Display]] -> Obsidian display alias kept, page + brackets dropped');
eq(stripMarkdown('See [[Some Page]] here.').includes('['), false, 'FIX: no "[" bracket husk anywhere in the wikilink output');
eq(stripMarkdown('He wrote [sic] in the margin.'), 'He wrote [sic] in the margin.', 'GUARD: a single-bracket aside ([sic]) is NOT a wikilink and is untouched');
// Footnotes — inline marker dropped, definition text kept.
eq(stripMarkdown('A claim.[^1]\n\n[^1]: the source note.'), 'A claim.\n\nthe source note.', 'FIX: footnote marker dropped, def text kept');
// Closed ATX heading — drop the trailing ###.
eq(stripMarkdownPreHtml('## The Border ##\n\nBody.'), 'The Border ##\n\nBody.', 'RED: old code leaves trailing ## ("hash hash")');
eq(stripMarkdown('## The Border ##\n\nBody.'), 'The Border\n\nBody.', 'FIX: closed ATX trailing hashes dropped');

// ---- No regression from the new rules: prose with comparison operators, snake_case, C#,
// stray brackets, colons, and ordinary links must all survive untouched.
eq(stripMarkdown('If a < b and c > d then ok.'), 'If a < b and c > d then ok.', 'spaced comparison operators preserved');
eq(stripMarkdown('3 < 5 is true, 9 > 2 also.'), '3 < 5 is true, 9 > 2 also.', 'digit comparisons preserved');
eq(stripMarkdown('value x<y stays as prose.'), 'value x<y stays as prose.', 'angle with no closing > preserved');
eq(stripMarkdown('I write in C#'), 'I write in C#', 'trailing C# (not a closed heading) preserved');
eq(stripMarkdown('Note: this matters a lot.'), 'Note: this matters a lot.', 'prose colon line (not a ref def) preserved');
eq(stripMarkdown('He wrote [sic] in the margin.'), 'He wrote [sic] in the margin.', 'stray bracket word preserved');
eq(stripMarkdown('see item [3] in the list'), 'see item [3] in the list', 'inline bracket-number preserved');
eq(stripMarkdown('[Newpress](https://newpress.co) link'), 'Newpress link', 'inline link still -> text (no regression)');

// ---- RED PROOF + FIX: bare URLs (not wrapped in a markdown link) get read aloud by ElevenLabs
// character-by-character. stripMarkdownOLD never stripped them; the new rule does, while keeping
// any trailing sentence punctuation so the spoken sentence still stops.
eq(stripMarkdownOLD('Reported at https://reuters.com/world/asia today.'),
   'Reported at https://reuters.com/world/asia today.', 'RED: old code leaves a bare URL (read aloud char-by-char)');
eq(stripMarkdown('Reported at https://reuters.com/world/asia today.'),
   'Reported at  today.', 'FIX: bare https URL dropped from the spoken text');
eq(stripMarkdown('See www.bbc.com/news for more.'),
   'See  for more.', 'FIX: bare www. URL dropped');
eq(stripMarkdown('The source was https://example.com/path/to/article.'),
   'The source was .', 'FIX: trailing sentence period kept after a URL drop');
eq(stripMarkdown('Two links http://a.org and https://b.org here.'),
   'Two links  and  here.', 'FIX: multiple bare URLs each dropped');
eq(stripMarkdown('Visit (https://example.com) for details.'),
   'Visit () for details.', 'FIX: paren-wrapped URL dropped, parens stay');
// No regression: prose that merely contains a dotted token but no scheme/www is untouched,
// and a markdown-linked URL still collapses to its visible text (not double-processed).
eq(stripMarkdown('Email me at john@example.com please.'),
   'Email me at john@example.com please.', 'no scheme/www -> email-like token preserved');
eq(stripMarkdown('the file report_2021.pdf is attached'),
   'the file report_2021.pdf is attached', 'bare filename (no scheme) preserved');
eq(stripMarkdown('[BBC](https://www.bbc.com/news) covered it.'),
   'BBC covered it.', 'inline-linked URL still -> text, not stripped twice');

// ---- RED PROOF + FIX: a bare URL whose body contains BALANCED parens (Wikipedia
// disambiguation links — "…/Foo_(bar)", "…/Mercury_(element)" — are ubiquitous in
// research prose). The old `[^\s<>()]+` tail stopped DEAD at the first "(", so the
// URL's "(bar)" tail leaked into the spoken feed as a nonsense fragment. `bareUrlOLD`
// replicates the exact pre-fix rule to prove the leak; the live fn now drops the whole
// URL, mirroring the reader's autolink peel in research/md.js.
const bareUrlOLD = (s) => s.replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi, (m) => (m.match(/[.,;:!?]+$/) || [''])[0]);
eq(bareUrlOLD('See https://en.wikipedia.org/wiki/Foo_(bar) page.'),
   'See (bar) page.', 'RED: old bare-URL rule leaked the URL\'s (bar) tail into speech');
eq(stripMarkdown('See https://en.wikipedia.org/wiki/Foo_(bar) page.'),
   'See  page.', 'FIX: balanced-paren (Wikipedia disambiguation) URL fully dropped');
eq(stripMarkdown('Read https://en.wikipedia.org/wiki/Mercury_(element) here.'),
   'Read  here.', 'FIX: Mercury_(element) URL fully dropped (no leaked tail)');
// No regression: an UNBALANCED closing paren belongs to the prose, not the URL, so it
// (and any trailing punctuation) survives as spoken text.
eq(stripMarkdown('(see https://x.org/a_(b)).'),
   '(see ).', 'FIX: prose ")." after a balanced-paren URL kept; URL body dropped');
eq(stripMarkdown('Visit (https://example.com) for details.'),
   'Visit () for details.', 'no regression: prose-wrapped plain URL still drops, parens stay');

// ---- firstLine
eq(firstLine('\n\n  Hello there  \nsecond'), 'Hello there', 'firstLine trims + finds first non-empty');
eq(firstLine(''), undefined, 'firstLine empty -> undefined');
eq(firstLine(null), undefined, 'firstLine null -> undefined');
eq(firstLine('x'.repeat(100)).length, 80, 'firstLine caps at 80');

// ---- slug
eq(slug('The Human Element!'), 'the-human-element', 'slug lowercases + hyphenates');
eq(slug('  spaces  '), 'spaces', 'slug trims hyphens');
eq(slug(''), 'essay', 'slug empty -> essay');
eq(slug(null), 'essay', 'slug null -> essay');
eq(slug('!!!').length > 0, true, 'slug of only-symbols falls back to essay');
eq(slug('!!!'), 'essay', 'slug only-symbols -> essay');
eq(slug('a'.repeat(60)).length, 40, 'slug caps at 40');

// ---- clampNum
eq(clampNum(42), 42, 'clampNum passes positive');
eq(clampNum('7.5'), 7.5, 'clampNum coerces string');
eq(clampNum(-3), 0, 'clampNum floors negative to 0');
eq(clampNum('abc'), 0, 'clampNum NaN -> 0');
eq(clampNum(Infinity), 0, 'clampNum Infinity -> 0');
eq(clampNum(null), 0, 'clampNum null -> 0');
eq(clampNum(0), 0, 'clampNum zero');

// ==================== chunkText ====================
// chunkText splits an essay into TTS-sized chunks. In generateAudio() a SINGLE bad
// chunk (synth() returns null) fails the WHOLE essay's audio, so two invariants are
// load-bearing: NO chunk empty (empty text 400s on ElevenLabs), NO chunk over `max`
// (rejected by the per-request limit).
const M = CHUNK_LIMIT;

// ---- RED PROOF: the pre-fix inline chunkText, reconstructed verbatim. Asserts it
// emitted an empty chunk (near-max leading paragraph) and over-cap chunks (giant
// sentence / punctuation-less run-on).
function chunkTextOLD(text, max = M) {
  if (text.length <= max) return [text];
  const out = [];
  let buf = '';
  for (const p of text.split(/\n\n+/)) {
    if (p.length > max) {
      const sentences = p.match(/[^.!?]+[.!?]+/g) ?? [p];
      for (const s of sentences) {
        if ((buf + ' ' + s).trim().length > max) { if (buf) out.push(buf.trim()); buf = s; }
        else buf = buf ? buf + ' ' + s : s;
      }
    } else if ((buf + '\n\n' + p).length > max) { out.push(buf.trim()); buf = p; }
    else buf = buf ? buf + '\n\n' + p : p;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
const emptiesIn = (a) => a.filter(c => c.length === 0).length;
const overIn = (a) => a.filter(c => c.length > M).length;

// near-max first paragraph (<= max, so it skips the giant branch) + a small second one
const nearMax = 'A'.repeat(M - 1) + '\n\n' + 'B'.repeat(100);
eq(emptiesIn(chunkTextOLD(nearMax)) > 0, true, 'RED: old chunkText emits an empty chunk on a near-max leading paragraph');
eq(emptiesIn(chunkText(nearMax)), 0, 'FIX: no empty chunk on near-max leading paragraph');
eq(overIn(chunkText(nearMax)), 0, 'FIX: near-max case stays under cap');

// punctuation-less run-on longer than max (the `?? [p]` fallback path)
const runOn = 'word '.repeat(2000).trim(); // ~9999 chars, no . ! ?
eq(overIn(chunkTextOLD(runOn)) > 0, true, 'RED: old chunkText emits an over-cap chunk on a no-punctuation run-on');
eq(overIn(chunkText(runOn)), 0, 'FIX: no-punctuation run-on hard-split under cap');
eq(emptiesIn(chunkText(runOn)), 0, 'FIX: run-on split has no empty chunk');

// a single sentence longer than max
const bigSentence = 'x'.repeat(6000) + '.';
eq(overIn(chunkTextOLD(bigSentence)) > 0, true, 'RED: old chunkText emits an over-cap chunk on a giant sentence');
eq(overIn(chunkText(bigSentence)), 0, 'FIX: giant sentence hard-split under cap');

// ---- INVARIANTS across a battery: every chunk non-empty AND <= max
const battery = [
  'short essay, one line.',
  'p1\n\np2\n\np3',
  nearMax,
  runOn,
  bigSentence,
  'A'.repeat(M) + '\n\n' + 'B'.repeat(M),               // two exactly-max paragraphs
  'Intro. ' + 'mid '.repeat(3000) + 'End.',             // long with punctuation
  ('Para number ' + 'x'.repeat(50) + '. ').repeat(400), // many normal sentences
  'word '.repeat(5000),                                 // very long run-on
];
for (const [i, t] of battery.entries()) {
  const ch = chunkText(t);
  eq(emptiesIn(ch), 0, `INVARIANT: battery[${i}] has no empty chunk`);
  eq(overIn(ch), 0, `INVARIANT: battery[${i}] has no over-cap chunk`);
}

// ---- NO REGRESSION: for inputs the old code already handled correctly,
// new output is byte-identical (the only behavior change is the buggy cases).
const ordinary = [
  'A single short paragraph that fits comfortably.',
  'First paragraph here.\n\nSecond paragraph here.\n\nThird one too.',
  Array.from({ length: 30 }, (_, i) => `Sentence ${i} with some words in it.`).join(' '),
  'Mandalay. ' + 'The river runs slow. '.repeat(100) + 'The end.',
];
for (const [i, t] of ordinary.entries()) {
  deepEq(chunkText(t), chunkTextOLD(t), `NO-REGRESSION: ordinary[${i}] identical to old chunking`);
}

// ---- content preservation: no non-whitespace character is ever dropped.
// (chunks are trimmed + joined, so compare with all whitespace stripped.)
const dense = (s) => s.replace(/\s+/g, '');
for (const t of [runOn, bigSentence, battery[6], battery[7], battery[8]]) {
  eq(dense(chunkText(t).join('')), dense(t), `content preserved across chunks for len=${t.length}`);
}

// ---- RED PROOF: the old sentence regex dropped a giant paragraph's un-terminated tail.
// A paragraph > max with a leading sentence then a long tail with NO terminal . ! ?
const tailDrop = 'Opening sentence. ' + 'trailing words with no period '.repeat(300);
eq(tailDrop.length > M, true, 'tailDrop fixture exceeds the cap (giant-paragraph path)');
eq(dense(chunkTextOLD(tailDrop).join('')) === dense(tailDrop), false,
   'RED: old chunkText drops the un-terminated tail of a giant paragraph');
eq(dense(chunkText(tailDrop).join('')), dense(tailDrop),
   'FIX: un-terminated tail of a giant paragraph is preserved');
eq(overIn(chunkText(tailDrop)), 0, 'FIX: tail-drop fixture stays under cap');
eq(emptiesIn(chunkText(tailDrop)), 0, 'FIX: tail-drop fixture has no empty chunk');

// ---- edge cases
deepEq(chunkText(''), [], 'empty string -> no chunks (was [""] -> would 400)');
deepEq(chunkText('   \n\n  '), [], 'whitespace-only -> no chunks');
deepEq(chunkText('hi'), ['hi'], 'tiny string -> single chunk');
deepEq(chunkText(null), [], 'null -> no chunks (no throw)');
deepEq(chunkText(undefined), [], 'undefined -> no chunks (no throw)');
eq(chunkText('a'.repeat(M)).length, 1, 'exactly max -> single chunk');
eq(chunkText('a'.repeat(M)).every(c => c.length <= M), true, 'exactly-max chunk is within cap');
// custom max honored
eq(overIn(chunkText('z'.repeat(50), 10)), 0, 'custom small max: no over-cap');
eq(chunkText('z'.repeat(50), 10).length, 5, 'custom max=10 splits 50 chars into 5');

// ---- WHITESPACE-SLICE GAP (hardSplit): a no-punctuation run-on with an interior
// whitespace run >= max makes a hard-split window land ENTIRELY inside whitespace.
// The old hardSplit pushed that slice verbatim -> an all-blank chunk of length max
// (NOT length 0, so emptiesIn misses it) -> POSTed to ElevenLabs, 502s the readout.
// blankIn catches the trimmed-empty case the fix now drops.
const blankIn = (a) => a.filter(c => c.trim() === '').length;
// RED PROOF: hardSplit WITHOUT the per-slice trim/skip (the pre-fix form).
const hardSplitOLD = (s, max) => { const out = []; for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)); return out; };
const wsGap = 'ab' + ' '.repeat(2 * M) + 'cd';            // one run-on, interior ws run = 2*max
eq(wsGap.length > M, true, 'wsGap fixture exceeds the cap (hard-split path)');
eq(blankIn(hardSplitOLD(wsGap.trim(), M)) > 0, true, 'RED: un-trimmed hardSplit emits an all-blank chunk');
eq(blankIn(chunkText(wsGap)), 0, 'FIX: no all-blank chunk from an interior whitespace run');
eq(emptiesIn(chunkText(wsGap)), 0, 'FIX: wsGap has no length-0 chunk');
eq(overIn(chunkText(wsGap)), 0, 'FIX: wsGap stays under cap');
eq(dense(chunkText(wsGap).join('')), dense(wsGap), 'FIX: wsGap content (ab/cd) preserved');
// same gap with a custom small max, exercised end-to-end
const wsGapSmall = 'xy' + ' '.repeat(40) + 'zw';
eq(blankIn(chunkText(wsGapSmall, 10)), 0, 'FIX: custom-max interior whitespace yields no blank chunk');
eq(dense(chunkText(wsGapSmall, 10).join('')), 'xyzw', 'FIX: custom-max whitespace-gap content preserved');

// ---- HTML ENTITIES: a present-but-encoded glyph used to be read ALOUD as its raw
// escape ("ampersand a m p semicolon"). RED PROOF reuses stripMarkdownOLD (no entity
// decode at all) to show the leak; the live stripMarkdown decodes to the real char.
eq(stripMarkdownOLD('Britain &amp; Burma'), 'Britain &amp; Burma', 'RED: old code reads "&amp;" aloud as the raw escape');
eq(stripMarkdown('Britain &amp; Burma'), 'Britain & Burma', 'FIX: &amp; -> &');
eq(stripMarkdownOLD('the coup&mdash;a turn'), 'the coup&mdash;a turn', 'RED: old code leaks &mdash;');
eq(stripMarkdown('the coup&mdash;a turn'), 'the coup—a turn', 'FIX: &mdash; -> em dash');
eq(stripMarkdown('it&rsquo;s over &hellip; now'), 'it’s over … now', 'FIX: &rsquo; + &hellip; decoded');
eq(stripMarkdown('said &ldquo;enough&rdquo;'), 'said “enough”', 'FIX: curly quotes decoded');
eq(stripMarkdown('30&deg;C in &amp; out'), '30°C in & out', 'FIX: &deg; + second &amp; both decoded');
eq(stripMarkdown('a&nbsp;hard space'), 'a hard space', 'FIX: &nbsp; -> normal space');
// numeric entities (decimal + hex), the form a generator/Docs-export emits for the em dash
eq(stripMarkdown('use &#8212; here'), 'use — here', 'FIX: decimal numeric entity &#8212; -> em dash');
eq(stripMarkdown('use &#x2014; here'), 'use — here', 'FIX: hex numeric entity &#x2014; -> em dash');
eq(stripMarkdown('&#39;quoted&#39;'), "'quoted'", 'FIX: &#39; -> apostrophe');
// entity-encoded HTML tag: decode then the tag rule drops it (no "<br>" spoken)
eq(stripMarkdown('line&lt;br&gt;break'), 'line\nbreak', 'FIX: &lt;br&gt; decoded to <br> then converted to a line break (not glued into "linebreak")');
// prose comparisons survive: "3 < 5" is NOT a tag, so it stays after decoding
eq(stripMarkdown('3 &lt; 5 and 5 &gt; 3'), '3 < 5 and 5 > 3', 'FIX: decoded < / > in prose preserved (not a tag)');
// unknown / malformed entities are LEFT INTACT, never guessed or crashed on
eq(stripMarkdown('an &foobar; word'), 'an &foobar; word', 'unknown named entity left intact');
eq(stripMarkdown('bad &#999999999999; num'), 'bad &#999999999999; num', 'out-of-range numeric entity left intact (no crash)');
eq(stripMarkdown('lone &#xD800; surrogate'), 'lone &#xD800; surrogate', 'lone-surrogate numeric entity left intact');
// REGRESSION GUARD: a bare ampersand in prose (the common case) is untouched —
// only well-formed &name;/&#n; sequences decode.
eq(stripMarkdown('R&D and AT&T survive'), 'R&D and AT&T survive', 'bare & in prose untouched');
eq(stripMarkdown('Tom & Jerry & co.'), 'Tom & Jerry & co.', 'spaced bare & untouched');
// decodeEntities is exported and null-safe on its own
eq(decodeEntities('&amp;'), '&', 'decodeEntities standalone');
eq(decodeEntities(null), '', 'decodeEntities null-safe');

// ---- BACKSLASH ESCAPES: CommonMark lets authors escape ASCII punctuation so it
// renders literally ("\$5", "2020\.", "\*"). The stripper used to pass the backslash
// through RAW, so ElevenLabs read it ALOUD ("backslash dollar 5"). RED PROOF reuses
// stripMarkdownOLD (no unescape rule); the live stripMarkdown drops the backslash and
// keeps the literal char. The mutation lock: deleting the `\\(...)`->`$1` rule turns
// every FIX line below RED.
eq(stripMarkdownOLD('It cost \\$5 million.'), 'It cost \\$5 million.', 'RED: old code reads "\\$" aloud as "backslash dollar"');
eq(stripMarkdown('It cost \\$5 million.'), 'It cost $5 million.', 'FIX: \\$ -> $ (no backslash spoken)');
eq(stripMarkdown('use the \\* operator'), 'use the * operator', 'FIX: \\* -> * literal asterisk');
eq(stripMarkdown('file\\_name.txt'), 'file_name.txt', 'FIX: \\_ -> _ (no stray backslash/underscore read)');
eq(stripMarkdown('He paid \\$5 then \\$10.'), 'He paid $5 then $10.', 'FIX: every escaped $ in a line unescaped (global)');
eq(stripMarkdown('rules\\: \\[a\\], \\(b\\), \\#c, \\!d'), 'rules: [a], (b), #c, !d', 'FIX: mixed punctuation escapes all cleaned');
// ORDERING PROOF: an escaped list marker prevented interpretation, so unescaping LAST
// keeps the "1." text (a fix placed BEFORE the list rule would eat the "1").
eq(stripMarkdown('1\\. not a list, still text'), '1. not a list, still text', 'FIX: escaped "1\\." keeps its number (unescape runs after the list rule)');
eq(stripMarkdown('the year 2020\\. It ended.'), 'the year 2020. It ended.', 'FIX: "2020\\." period restored, sentence intact');
// REGRESSION GUARDS: prose with NO backslash is byte-identical, and a lone backslash
// before a non-punctuation char (a Windows path tail) is left alone (not our class).
eq(stripMarkdown('no backslashes at all here'), 'no backslashes at all here', 'GUARD: backslash-free prose untouched');
eq(stripMarkdown('a < b and c > d'), 'a < b and c > d', 'GUARD: prose comparisons untouched by the escape rule');
eq(stripMarkdown('path C:\\Users still'), 'path C:\\Users still', 'GUARD: \\U (non-punctuation) left intact — outside CommonMark escape set');

// ---- ESCAPED EMPHASIS MARKERS (ordering bug): an escaped PAIR "\*not italic\*" or
// "\_x\_" is LITERAL punctuation per CommonMark, but the old code only dropped the
// backslash at the END (after emphasis), so the flanking emphasis rules still saw the
// escaped "*"/"_" as a real span, ATE the markers, and STRANDED the two backslashes —
// read aloud as "backslash not italic backslash". RED PROOF: stripMarkdownOLD (no
// escape protection, non-flanking emphasis) reproduces the stranded-backslash leak.
// The FIX protects escapes with an inert sentinel BEFORE any rule, so the escaped
// markers stay literal. Mutation lock: deleting the sentinel protect/restore turns
// the FIX lines RED (the emphasis rules eat the escaped markers again).
eq(stripMarkdownOLD('\\*not italic\\*'), '\\not italic\\', 'RED: old code strands two backslashes on escaped-asterisk pair');
eq(stripMarkdown('\\*not italic\\*'), '*not italic*', 'FIX: escaped \\*…\\* stays literal asterisks (no backslash spoken)');
eq(stripMarkdownOLD('a \\_literal\\_ underscore'), 'a \\literal\\ underscore', 'RED: old code strands two backslashes on escaped-underscore pair');
eq(stripMarkdown('a \\_literal\\_ underscore'), 'a _literal_ underscore', 'FIX: escaped \\_…\\_ stays literal underscores');
eq(stripMarkdown('use the \\*splat\\* glob'), 'use the *splat* glob', 'FIX: a mid-sentence escaped-asterisk pair survives intact');
// GUARD: a REAL emphasis span whose CONTENT holds an escaped marker keeps the inner
// literal and still strips the outer span ("*a\*b*" -> emphasis on "a*b").
eq(stripMarkdown('*a\\*b*'), 'a*b', 'GUARD: escaped marker inside a real emphasis span stays literal, span still stripped');
// GUARD: a real **bold** next to an escaped literal pair — bold strips, literal survives.
eq(stripMarkdown('**real bold** and \\*literal\\*'), 'real bold and *literal*', 'GUARD: real bold stripped, adjacent escaped pair kept literal');

// ---- NESTED EMPHASIS (fixed-point loop): a single left-to-right emphasis pass leaked
// stray markers on NESTED spans, so a literal "*"/"_" reached the TTS ("asterisk").
// RED PROOF: the five emphasis rules applied EXACTLY ONCE (the pre-loop behavior).
function stripEmphasisSinglePass(s) {
  return s
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}
// The load-bearing case: emphatic prose with an italic span INSIDE a bold span — the
// outer ** can't match across the inner single stars, so a single pass strands them.
eq(stripEmphasisSinglePass('The **coup was *deeply* destabilizing** here.'),
   'The *coup was deeply destabilizing* here.',
   'RED: single-pass strands "*" on a bold span wrapping an italic span');
eq(stripMarkdown('The **coup was *deeply* destabilizing** here.'),
   'The coup was deeply destabilizing here.',
   'FIX: nested bold+italic fully cleaned — no marker reaches the audio');
// Same class in the underscore family: __bold__ wrapping an _italic_ (the inner single
// underscores block the outer __ match, exactly as inner single stars block outer **).
eq(stripEmphasisSinglePass('__grim _work_ done__'),
   '_grim work done_',
   'RED: single-pass strands "_" on __bold__ wrapping an _italic_ span');
eq(stripMarkdown('__grim _work_ done__'), 'grim work done',
   'FIX: __bold__ wrapping _italic_ fully cleaned');
// ── Underscore emphasis is INTRAWORD-BLIND (CommonMark) ──
// The single-underscore snake_case contract (media_uploads, above) always held
// because the italic rule needs a matching PAIR of "_". But a word carrying TWO
// intra-word underscores DID trip it: the old bare /_(…)_/ matched "_analysis_"
// inside "data_analysis_v2" and merged it to a garbled run-on word — and worse, a
// real span next to a snake_case word mis-paired ACROSS the intra-word "_" and
// stranded a lone "_" the TTS reads as "underscore". RED PROOF: the single-pass
// underscore rule (bare, no boundary) reproduces both leaks; the boundary-aware
// live stripMarkdown preserves the identifier and cleans only the real span.
eq(stripEmphasisSinglePass('data_analysis_v2'), 'dataanalysisv2',
   'RED: bare underscore rule merges an intra-word snake_case identifier');
eq(stripMarkdown('The file data_analysis_v2.csv leaked.'), 'The file data_analysis_v2.csv leaked.',
   'FIX: multi-underscore snake_case preserved literally — no merge, no stray "_"');
eq(stripEmphasisSinglePass('code_word and _real emphasis_ here'), 'codeword and real emphasis_ here',
   'RED: bare underscore rule strands a lone "_" beside a snake_case word');
eq(stripMarkdown('code_word and _real emphasis_ here'), 'code_word and real emphasis here',
   'FIX: intra-word "_" preserved, adjacent real _italic_ still stripped, no stray "_"');
eq(stripMarkdown('run make_it_happen now'), 'run make_it_happen now',
   'GUARD: triple-underscore identifier untouched');
eq(stripMarkdown('an _italic_ word'), 'an italic word', 'GUARD: genuine _italic_ still stripped');
eq(stripMarkdown('the term _tatmadaw_ means army'), 'the term tatmadaw means army',
   'GUARD: word-bounded _italic_ inside prose still stripped');
// Bare nested pair and triple emphasis.
eq(stripMarkdown('**bold *italic* bold**'), 'bold italic bold', 'FIX: bare nested span leaves no markers');
eq(stripMarkdown('***bold italic***'), 'bold italic', 'FIX: triple ***…*** cleaned (converges first pass)');
// REGRESSION GUARDS: simple, non-nested spans are byte-identical to the single-pass
// behavior (the loop converges on pass 1 and adds nothing).
eq(stripMarkdown('**just bold**'), 'just bold', 'GUARD: simple **bold** unchanged');
eq(stripMarkdown('an *italic* word'), 'an italic word', 'GUARD: simple *italic* unchanged');
eq(stripMarkdown('a __two word__ b'), 'a two word b', 'GUARD: simple __bold__ unchanged');
eq(stripMarkdown('no emphasis here at all'), 'no emphasis here at all', 'GUARD: plain prose untouched');

// ── Asterisk emphasis is FLANKING-AWARE (CommonMark) ──
// A "*" can only OPEN a span when the next char is non-whitespace, and only CLOSE
// one when the prev char is non-whitespace. The old bare /\*(…)\*/ ignored this, so
// TWO whitespace-flanked stars in one line — arithmetic ("2 * 2 ... 5 * 6") or a
// literal-asterisk aside ("a ** b ** c") — mis-paired ACROSS the unrelated text
// between them, EATING the inner stars and mashing the numbers into a garbled run
// read aloud. RED PROOF: the bare single-pass rules reproduce the mangle; the
// flanking-aware live stripMarkdown leaves the arithmetic literal.
eq(stripEmphasisSinglePass('buy 2 * 2 = 4 apples and 5 * 6 too'), 'buy 2  2 = 4 apples and 5  6 too',
   'RED: bare star rule mis-pairs across two space-flanked "*" and mashes the digits');
eq(stripMarkdown('buy 2 * 2 = 4 apples and 5 * 6 too'), 'buy 2 * 2 = 4 apples and 5 * 6 too',
   'FIX: space-flanked arithmetic "*" preserved literally — no star eaten, no digit mash');
eq(stripEmphasisSinglePass('a ** b ** c'), 'a  b  c',
   'RED: bare bold rule eats a space-flanked "** … **" literal-asterisk aside');
eq(stripMarkdown('a ** b ** c'), 'a ** b ** c',
   'FIX: space-flanked "**" pair preserved literally');
eq(stripMarkdown('he multiplied 3 * 4 and 5 * 6 quickly'), 'he multiplied 3 * 4 and 5 * 6 quickly',
   'FIX: multiple space-flanked products left untouched');
// GUARDS: genuine spans (no whitespace just inside the markers) still strip, and the
// fixed-point loop still converges nested spans — byte-identical to prior behavior.
eq(stripMarkdown('a *word* and *two* here'), 'a word and two here', 'GUARD: real *italic* pairs still stripped');
eq(stripMarkdown('**legit bold** stays'), 'legit bold stays', 'GUARD: real **bold** still stripped');
eq(stripMarkdown('**bold with *nested* inside**'), 'bold with nested inside', 'GUARD: nested */** still converges under flanking rules');

// ── GFM task-list checkboxes ("- [ ] todo" / "- [x] done") ──
// The plain-bullet rule only eats the "- " marker, so the "[ ]" / "[x]" checkbox
// survived and ElevenLabs read it ALOUD ("open bracket close bracket", "open
// bracket x close bracket"). RED PROOF: stripMarkdownOLD (bullet rule only, no
// task-list rule) leaves the bracket; the live stripMarkdown drops bullet + box.
eq(stripMarkdownOLD('- [ ] Verify the border crossing'), '[ ] Verify the border crossing',
   'RED: bullet-only strip leaks the "[ ]" checkbox into the audio');
eq(stripMarkdown('- [ ] Verify the border crossing'), 'Verify the border crossing',
   'FIX: unchecked task box dropped, task text kept');
eq(stripMarkdown('- [x] Filed the report'), 'Filed the report', 'FIX: checked (x) task box dropped');
eq(stripMarkdown('* [X] Uppercase X box'), 'Uppercase X box', 'FIX: * bullet + [X] uppercase box dropped');
eq(stripMarkdown('  + [ ] indented task'), 'indented task', 'FIX: indented + task box dropped');
eq(stripMarkdown('- [ ] one\n- [x] two\n- [ ] three'), 'one\ntwo\nthree',
   'FIX: multi-line task list — every checkbox dropped, no lines merged');
// REGRESSION GUARDS: a plain bullet is still just a bullet; a bracket link on a
// bullet still becomes its link text; a bracket in PROSE (not a line-start box) is
// untouched (the rule is scoped to a line-start bullet + single-char [ /x/X ] box).
eq(stripMarkdown('- regular bullet'), 'regular bullet', 'GUARD: plain bullet unaffected by the task rule');
eq(stripMarkdown('- [text](https://x.com) link'), 'text link', 'GUARD: bullet+link still resolves to link text');
eq(stripMarkdown('I marked it [x] in the margin'), 'I marked it [x] in the margin',
   'GUARD: a "[x]" mid-prose (no line-start bullet) is left intact');

// ── Linked images ([![alt](img)](url)) and empty-text links ([](url)) ──
// A linked image is an image wrapped in a link — a clickable photo/map, common in
// essays. It carries NO readable text. The pre-fix code had only the plain image
// rule + the link rule: the image rule ate the inner ![alt](img), leaving a "[]()"
// husk (outer brackets + parens, URL gone) that the link rule couldn't touch (it
// needs >=1 text char), so ElevenLabs read "open bracket close bracket open paren
// close paren" ALOUD. RED PROOF: the pre-fix image+link pair leaves the husk.
const stripLinkedImageOLD = (md) =>
  md.replace(/!\[[^\]]*\]\([^)]+\)/g, '')      // images (pre-fix: runs first, eats the inner image)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');  // inline links -> text (can't touch empty "[]")
eq(stripLinkedImageOLD('[![Map of Burma](map.png)](https://example.com)'), '[](https://example.com)',
   'RED: pre-fix image+link pair leaves a "[](url)" husk the TTS reads aloud');
eq(stripMarkdown('[![Map of Burma](map.png)](https://example.com)'), '',
   'FIX: linked image dropped whole — no husk reaches the audio');
eq(stripMarkdown('A clickable photo: [![](a.jpg)](b.com) end.'), 'A clickable photo:  end.',
   'FIX: empty-alt linked image dropped, incl. its protocol-less URL (b.com would leak otherwise)');
eq(stripMarkdown('See [](https://example.com) here'), 'See  here',
   'FIX: empty-text link ([](url)) dropped — no husk');
// REGRESSION GUARDS: a normal link still resolves to its text; a plain image is
// still removed; a normal image caption survives.
eq(stripMarkdown('Read [the report](https://r.com) now.'), 'Read the report now.',
   'GUARD: a normal [text](url) link still becomes its text');
eq(stripMarkdown('![alone](x.png) stays gone'), 'stays gone',
   'GUARD: a plain image is still removed on its own');

// ── Tilde-fenced code blocks (~~~), the CommonMark twin of the ``` fence ──
// The stripper dropped ``` blocks but not ~~~ blocks. Without a tilde-fence rule,
// the strike rule (~~…~~) chewed a ~~~ fence into stray single tildes AND the code
// body was read aloud — the exact read-it-aloud failure this module exists to kill.
// RED PROOF: the pre-fix pipeline (backtick fence + strike, no tilde fence) leaves
// "~code~" garbage. The mutation lock: deleting the ~~~ fence rule turns the FIX
// lines RED.
const stripTildeFenceOLD = (md) =>
  md.replace(/```[\s\S]*?```/g, '')          // only the backtick fence existed
    .replace(/~~([^~]+)~~/g, '$1');          // strike rule then mangles the ~~~ fence
eq(stripTildeFenceOLD('Intro.\n\n~~~js\nconst secret = 42;\n~~~\n\nOutro.'),
   'Intro.\n\n~js\nconst secret = 42;\n~\n\nOutro.',
   'RED: pre-fix leaves stray tildes + reads the code body aloud on a ~~~ fence');
eq(stripMarkdown('Intro.\n\n~~~js\nconst secret = 42;\n~~~\n\nOutro.'), 'Intro.\n\nOutro.',
   'FIX: a ~~~ tilde-fenced code block is dropped whole, like a ``` block');
eq(stripMarkdown('~~~\nplain fenced code\n~~~'), '',
   'FIX: an unlabelled ~~~ fence is dropped');
// REGRESSION GUARDS: a 2-tilde strikethrough must NOT be swallowed as a fence, and
// prose containing a lone tilde stays intact.
eq(stripMarkdown('She said ~~no~~ then ~~maybe~~ finally.'), 'She said no then maybe finally.',
   'GUARD: two ~~strike~~ spans still resolve to words, not eaten as a fence');
eq(stripMarkdown('The file is ~/notes.txt on disk.'), 'The file is ~/notes.txt on disk.',
   'GUARD: a lone prose tilde (home-dir path) is left untouched');

// ── Blockquotes that CONTAIN structural markdown (heading / list / table) ──
// The blockquote-strip rule used to run LAST (after emphasis), so it fired AFTER
// the line-anchored heading/bullet/numbered/table rules. A ">"-prefixed line
// therefore hid its inner marker from those rules, and the marker leaked into the
// spoken audio: "> ## Quote" → "## Quote" read as "hash hash", "> - point" → "-
// point", "> 1. one" → "1. one". A pull-quote wrapping a heading or list is common
// in essays. The fix moves the blockquote strip to run BEFORE the structural rules.
// RED PROOF: reconstruct the OLD order (structural rules first, blockquote last).
function stripBlockquoteOLD(md) {
  return md
    .replace(/^#+\s*/gm, '')                 // headings ran while ">" still prefixed
    .replace(/^\s*[-*+]\s+/gm, '')            // bullets ditto
    .replace(/^\s*\d+[.)]\s+/gm, '')          // numbered ditto
    .replace(/^>+\s*/gm, '')                  // blockquote stripped LAST — too late
    .trim();
}
eq(stripBlockquoteOLD('> ## A quote heading'), '## A quote heading',
   'RED: old order leaves "## " (read "hash hash") on a blockquoted heading');
eq(stripMarkdown('> ## A quote heading'), 'A quote heading',
   'FIX: blockquoted heading fully unwrapped — no hashes reach the audio');
eq(stripBlockquoteOLD('> - first point\n> - second point'), '- first point\n- second point',
   'RED: old order leaves the "- " bullet on a blockquoted list');
eq(stripMarkdown('> - first point\n> - second point'), 'first point\nsecond point',
   'FIX: blockquoted bullet list unwrapped, markers gone');
eq(stripMarkdown('> 1. one\n> 2. two'), 'one\ntwo',
   'FIX: blockquoted numbered list unwrapped ("1." would read "one dot" otherwise)');
eq(stripMarkdown('> - [ ] todo item'), 'todo item',
   'FIX: blockquoted task-list checkbox + bullet both stripped');
eq(stripMarkdown('> ---'), '',
   'FIX: a blockquoted thematic break is dropped, not read as "dash dash dash"');
eq(stripMarkdown('> | City | Pop |\n> |---|---|\n> | Yangon | 5M |'), 'City, Pop\n\nYangon, 5M',
   'FIX: a blockquoted table speaks its cells (bars gone) instead of "vertical bar"');
// Nesting: consecutive ">>" and spaced "> > " are both fully unwrapped.
eq(stripMarkdown('>> deeply nested'), 'deeply nested', 'FIX: nested >> blockquote unwrapped');
eq(stripMarkdown('> > spaced nest'), 'spaced nest', 'FIX: spaced "> > " blockquote unwrapped');
// REGRESSION GUARDS: a plain quote still resolves to its text; blockquoted emphasis
// still resolves; and a mid-sentence ">" comparison in PROSE is never touched.
eq(stripMarkdown('> just a quote'), 'just a quote', 'GUARD: plain blockquote → its text');
eq(stripMarkdown('> **important** note'), 'important note', 'GUARD: blockquoted bold still unwrapped');
eq(stripMarkdown('if 5 > 3 then done'), 'if 5 > 3 then done', 'GUARD: prose "5 > 3" comparison untouched');
eq(stripMarkdown('The ratio a > b holds.'), 'The ratio a > b holds.', 'GUARD: prose "a > b" untouched');

// ---- FIX: URL captures allow ONE level of balanced parens (Wikipedia-style links).
// RED PROOF via a pre-fix reconstruction (naive `[^)]+` URL capture): it truncated at
// the FIRST ")", leaking the URL tail + a stray ")" into the spoken text ("Myanmar
// close paren", "dot png close paren"). These disambiguation links are ubiquitous in
// the geopolitical/historical essays this narrator serves. Mirrors research/md.js's fix.
function stripLinksNaive(md) {
  return String(md ?? '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
eq(stripLinksNaive('See [Myanmar](https://en.wikipedia.org/wiki/Myanmar_(Burma)) today.'),
   'See Myanmar) today.', 'RED: naive capture leaks a stray ")" from a paren URL');
eq(stripLinksNaive('Photo ![map](https://x.org/Burma_(Myanmar).png) here.'),
   'Photo .png) here.', 'RED: naive capture leaks the ".png)" image-URL tail');
eq(stripMarkdown('See [Myanmar](https://en.wikipedia.org/wiki/Myanmar_(Burma)) today.'),
   'See Myanmar today.',
   'FIX: link with a parenthetical in the URL keeps only the label, no stray ")"');
eq(stripMarkdown('Photo ![map](https://x.org/Burma_(Myanmar).png) here.'),
   'Photo  here.',
   'FIX: image with a parenthetical in the URL fully dropped, no ".png)" tail');
eq(stripMarkdown('A [![m](https://a.org/p_(1).png)](https://b.org/x_(2)) end.'),
   'A  end.',
   'FIX: linked image with parens in BOTH URLs fully dropped, no leaked tail');
eq(stripMarkdown('Cite [Kachin State](https://en.wikipedia.org/wiki/Kachin_(state)).'),
   'Cite Kachin State.',
   'FIX: paren-URL link at end of sentence keeps the terminal period');
// REGRESSION GUARDS: ordinary (paren-free) links/images behave exactly as before.
eq(stripMarkdown('[Newpress](https://newpress.co) and ![i](https://y.org/z.png) ok'),
   'Newpress and  ok',
   'GUARD: plain link + plain image unchanged by the balanced-paren upgrade');
eq(stripMarkdown('[the report][1] then [Newpress](https://newpress.co).'),
   'the report then Newpress.',
   'GUARD: reference-style link + inline link both still resolve');

// ---- <br> line-break tags: a BREAK, not nothing. The generic tag-strip drops every
// tag to '', which GLUES the words on either side of a <br> ("St<br>Apt" -> "StApt",
// read aloud as one mashed word). The dedicated rule converts <br>/<br/>/<br /> (any
// case) to a newline FIRST so the words separate. Mutation proof: delete the
// `.replace(/<br\s*\/?>/gi, '\n')` line and every FIX below goes RED (the glue returns),
// while the GUARD (inline emphasis wrapping a word) stays byte-identical.
eq(stripMarkdown('123 Main St<br>Apt 4'), '123 Main St\nApt 4',
   'FIX: <br> becomes a line break, not glue ("St<br>Apt" no longer mashes)');
eq(stripMarkdown('line<br/>next'), 'line\nnext',
   'FIX: self-closing <br/> also breaks instead of gluing');
eq(stripMarkdown('a<br />b'), 'a\nb',
   'FIX: <br /> with a space breaks instead of gluing');
eq(stripMarkdown('A<BR>B'), 'A\nB',
   'FIX: uppercase <BR> breaks too (case-insensitive)');
eq(stripMarkdown('un<em>believable</em>'), 'unbelievable',
   'GUARD: an inline tag wrapping mid-word still drops to nothing (word stays joined)');

// ── EMPTY-URL images and links ([alt]()  /  [text]()) ──
// A degenerate but real markdown shape: brackets + EMPTY parens. Google-Docs/HTML
// exports emit `![alt]()` for a broken/unresolved image; an LLM writing a research
// report emits `[text]()` when it wants to cite a source but has no resolved URL.
// The pre-fix image/link regexes required >=1 URL char (`+`), so they SKIPPED the
// empty-paren form and the raw "![alt]()" / "[text]()" leaked into the audio
// (read aloud as "exclamation mark open bracket … close paren"). The fix loosens
// both quantifiers to `*`: an empty-URL image drops whole (image alt is never
// spoken here anyway), an empty-URL link keeps its visible text.
// MUTATION PROOF: revert either `*` back to `+` and the matching FIX below goes RED.
eq(stripMarkdown('See ![Burma map]() below'), 'See  below',
   'FIX: empty-URL image husk "![alt]()" dropped whole — nothing reaches the audio');
eq(stripMarkdown('A photo ![the coast]() here.').includes('!'), false,
   'FIX: no "!" / bracket husk survives an empty-URL image');
eq(stripMarkdown('Read [the report]() now'), 'Read the report now',
   'FIX: empty-URL link "[text]()" keeps its visible text (no raw brackets/parens)');
eq(/[[\]()]/.test(stripMarkdown('Read [the report]() now')), false,
   'FIX: no bracket/paren husk survives an empty-URL link');
// REGRESSION GUARDS: the `+`->`*` loosening is byte-identical for every non-empty case.
eq(stripMarkdown('See ![Burma map](/img/burma.png) below'), 'See  below',
   'GUARD: a normal image with a real URL is still dropped whole');
eq(stripMarkdown('Read [the report](https://x.com) now'), 'Read the report now',
   'GUARD: a normal link with a real URL still resolves to its text');
eq(stripMarkdown('See [Myanmar](https://e.org/M_(Burma)) here'), 'See Myanmar here',
   'GUARD: balanced-paren URL still handled (no stray ")" leak)');

// ---- CommonMark HARD BREAK: a backslash at END of a line is a line break, not a
// literal backslash. The escape rule at the top only protects "\" before PUNCTUATION,
// so a trailing hard-break "\" slipped through and leaked into the audio, read aloud
// as "backslash". The reader twin (research/md.js) already renders it as <br>; this is
// the narrator catching up. MUTATION PROOF: delete the `.replace(/\\(?=\r?\n)/g,'')`
// line in stripMarkdown and the two FIX asserts below go RED (the "\" reappears).
eq(stripMarkdown('The toll rose sharply\\\nby the next morning.'),
   'The toll rose sharply\nby the next morning.',
   'FIX: hard-break "\\" at line end dropped, newline kept (no "backslash" read aloud)');
eq(stripMarkdown('First point\\\nSecond point\\\nThird.').includes('\\'), false,
   'FIX: no literal backslash survives consecutive hard breaks');
// REGRESSION GUARDS: the rule ONLY targets a "\" immediately before a newline.
eq(stripMarkdown('Costs \\$5 and 30\\% more.'), 'Costs $5 and 30% more.',
   'GUARD: backslash-escaped punctuation ("\\$", "\\%") still keeps the literal char');
eq(stripMarkdown('Not \\*italic\\* here.'), 'Not *italic* here.',
   'GUARD: escaped emphasis markers ("\\*") stay literal, not stripped as a hard break');
eq(stripMarkdown('path C:\\Users stays'), 'path C:\\Users stays',
   'GUARD: a backslash before a LETTER (Windows path) is untouched — no newline follows');
eq(stripMarkdown('literal backslash \\\\\nnext line.'), 'literal backslash \\\nnext line.',
   'GUARD: an ESCAPED backslash "\\\\" before a newline is a literal "\\" (CommonMark), not a hard break');

// ---- MULTI-BACKTICK inline code spans (CommonMark). A run of N>=2 backticks opens a
// span closed by the next run of EXACTLY N backticks, so the code body can carry
// SHORTER backtick runs verbatim (``a`b`` -> a`b). The old single-tick-only rule
// mis-stripped these: the first inner backtick closed a spurious single span and the
// leftover ticks were read ALOUD as "backtick". Reachable because this stripMarkdown
// is the shared TTS core for research-tts, and deep-research prose emits ``…`` spans
// whenever a code/shell sample itself contains a backtick. Mirrors the reader twin
// (research/md.js), so the two must stay in lockstep — no stray backtick in either.
// RED PROOF: the single-tick-only pass (the pre-fix behavior) leaks stray backticks.
const stripInlineCodeOLD = (s) => s.replace(/`([^`]+)`/g, '$1');
eq(stripInlineCodeOLD('Run ``git commit -m `msg``` now').includes('`'), true,
   'RED: single-tick-only rule leaks stray backticks on a ``…`` span');
eq(stripMarkdown('Run ``git commit -m `msg``` now'), 'Run git commit -m msg now',
   'FIX: multi-backtick span stripped clean — no backtick read aloud');
eq(stripMarkdown('Use ``a || b`` and ``rm `pwd``` here').includes('`'), false,
   'FIX: two ``…`` spans on one line leave no backtick');
eq(stripMarkdown('``a`b`` inline'), 'a`b inline',
   'FIX: ``a`b`` drops delimiters; the inner backtick is genuine code content, kept in lockstep with the reader');
// A bare-backtick showcase `` ` `` -> the char itself; per CommonMark ONE flanking
// space is stripped when both present. TTS keeps the lone backtick as content (a
// research report literally discussing "the ` character") rather than eating text.
eq(stripMarkdown('the `` ` `` char'), 'the ` char',
   'multi-tick: bare-backtick showcase keeps the single literal backtick, drops delimiters');
// GUARD: a plain single-backtick span is byte-identical to before (the common case).
eq(stripMarkdown('the `fps` field'), 'the fps field',
   'GUARD: single-backtick inline code unchanged by the multi-tick rule');
eq(stripMarkdown('no ticks at all here'), 'no ticks at all here',
   'GUARD: tick-free prose untouched');

// ---- Approximation / range tildes (else the TTS reads "tilde"). A "~" before a number
// (approximation: "~5,000") or between two numbers (range: "5~10") is NOT markdown; it
// survived every rule above and leaked into the audio ("tilde 5 thousand", "5 tilde 10").
// The reader twin (research/md.js) keeps it VISIBLE — correct on the page — but the
// narrator must SPEAK it. These positive/anti-leak assertions are the mutation lock:
// removing either tilde pass turns them RED (range -> "5 to 10", approx -> "around N",
// and no surviving "~"); broadening the regex to eat "~/" turns the home-dir guard RED.
// FIX: approximation tilde -> "around"
eq(stripMarkdown('roughly ~5,000 people fled'), 'roughly around 5,000 people fled', 'approx ~N -> "around N"');
eq(stripMarkdown('the crowd swelled to ~1 million'), 'the crowd swelled to around 1 million', 'approx ~1 million');
eq(stripMarkdown('~200 killed in the crackdown'), 'around 200 killed in the crackdown', 'leading approx tilde -> around');
eq(stripMarkdown('near ~ 30 degrees').includes('~'), false, 'approx tilde with a trailing space is still killed');
// FIX: range tilde between digits -> " to " (dropping it would GLUE "5~10" -> "510").
eq(stripMarkdown('the range was 5~10 killed'), 'the range was 5 to 10 killed', 'range 5~10 -> "5 to 10"');
eq(stripMarkdown('5 ~ 10 dead'), '5 to 10 dead', 'spaced range 5 ~ 10 -> "5 to 10"');
eq(stripMarkdown('estimates of 5~10 thousand').includes('~'), false, 'range tilde killed, never glued into one number');
// Fullwidth ～ (U+FF5E) / 〜 (U+301C) — CJK source prose (Taiwan/Burma/Japan) — handled too.
eq(stripMarkdown('CJK range 5〜10 people'), 'CJK range 5 to 10 people', 'fullwidth 〜 range -> "5 to 10"');
eq(stripMarkdown('fullwidth ～30 percent'), 'fullwidth around 30 percent', 'fullwidth ～ approximation -> around');
// GUARD over-reach: a home-dir "~/path" and a standalone "~" in prose stay untouched.
eq(stripMarkdown('see ~/Documents/notes for the path'), 'see ~/Documents/notes for the path', 'home-dir ~/ untouched (no digit after)');
eq(stripMarkdown('the ~ symbol on its own'), 'the ~ symbol on its own', 'standalone prose ~ untouched');
// ~~strike~~ detection still works (the fix runs AFTER the strike loop).
eq(stripMarkdown('she said ~~no~~ definitely'), 'she said no definitely', 'strike still stripped after the tilde fix');
// An author-ESCAPED "\~" stays a literal "~" (restored last), NOT converted to "around".
eq(stripMarkdown('a literal \\~5 tilde'), 'a literal ~5 tilde', 'escaped \\~ stays literal, not "around"');

// ---- Pandoc sub/superscript around numbers (chemical formulas, area units, ordinals —
// common in Johnny's climate/geoscience prose). Left raw these leaked "tilde"/"caret",
// AND (regression introduced iter #11) the approx-tilde pass MANGLED a subscript
// "H~2~O" into "Haround 2~O" — the exact read-it-aloud failure this module kills. FIX:
// fold the digits in BEFORE the range/approx passes ("CO~2~"->"CO2", "km^2^"->"km2",
// "20^th^"->"20th") AND guard the approx pass with a left word-boundary so it can never
// fire mid-word again. These assertions are the mutation lock: dropping the subscript
// pass turns the CO2/H2O cases RED ("COaround 2~"/"Haround 2~O"); dropping the
// superscript passes turns the km2/ordinal cases RED; loosening the approx lookbehind
// re-mangles a subscript.
eq(stripMarkdown('CO~2~ emissions rose sharply'), 'CO2 emissions rose sharply', 'subscript CO~2~ -> CO2');
eq(stripMarkdown('water is H~2~O today'), 'water is H2O today', 'subscript H~2~O -> H2O');
eq(stripMarkdown('high SO~2~ levels').includes('around'), false, 'subscript NOT misread as approximation "around"');
eq(stripMarkdown('high SO~2~ levels').includes('~'), false, 'subscript tildes fully folded, none leak');
eq(stripMarkdown('the area is 44,000 km^2^ wide'), 'the area is 44,000 km2 wide', 'superscript unit km^2^ -> km2');
eq(stripMarkdown('it holds 5 m^3^ of water'), 'it holds 5 m3 of water', 'superscript unit m^3^ -> m3');
eq(stripMarkdown('in the 20^th^ century everything changed'), 'in the 20th century everything changed', 'superscript ordinal 20^th^ -> 20th');
eq(stripMarkdown('the 1^st^ and 2^nd^ waves').includes('^'), false, 'superscript ordinals fully folded, no caret leaks');
// A real approximation still fires when the "~" sits at a word boundary (start/space/paren) —
// the fix must NOT over-correct and kill legitimate "around N".
eq(stripMarkdown('(~2,000) marched'), '(around 2,000) marched', 'approx after "(" still fires');
eq(stripMarkdown('reached near ~30 degrees'), 'reached near around 30 degrees', 'approx after a space still fires');
// A digit^digit exponent ("10^6^") is deliberately left alone rather than misspoken "106".
eq(stripMarkdown('roughly 10^6^ people').includes('106'), false, 'digit^digit exponent NOT misfolded into "106"');

console.log(`\nburma-essays-text: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
