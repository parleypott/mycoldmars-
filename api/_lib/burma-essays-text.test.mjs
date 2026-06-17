// Coverage for the Burma Essays narrator text helpers (the markdown the TTS reads aloud).
// Run: node api/_lib/burma-essays-text.test.mjs   (also auto-discovered by `bun run test`)
import { stripMarkdown, firstLine, slug, clampNum } from './burma-essays-text.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

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

// ---- No regression: the formatting that already worked must still work identically.
eq(stripMarkdown('**bold** text'), 'bold text', '** bold still stripped');
eq(stripMarkdown('an *italic* word'), 'an italic word', '* italic still stripped');
eq(stripMarkdown('an _italic_ word'), 'an italic word', '_ italic still stripped');
eq(stripMarkdown('# Heading'), 'Heading', 'ATX heading');
eq(stripMarkdown('## Two'), 'Two', 'ATX heading 2');
eq(stripMarkdown('- item one\n- item two'), 'item one\nitem two', 'bullet list');
eq(stripMarkdown('1. first\n2. second'), 'first\nsecond', 'numbered list');
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

console.log(`\nburma-essays-text: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
