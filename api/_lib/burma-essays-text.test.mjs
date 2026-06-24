// Coverage for the Burma Essays narrator text helpers (the markdown the TTS reads aloud).
// Run: node api/_lib/burma-essays-text.test.mjs   (also auto-discovered by `bun run test`)
import { stripMarkdown, firstLine, slug, clampNum, chunkText, CHUNK_LIMIT } from './burma-essays-text.js';

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
// No regression: prose with an incidental mid-line pipe or a hyphenated phrase stays untouched.
eq(stripMarkdown('He paused | then spoke.'), 'He paused | then spoke.', 'mid-line pipe in prose preserved (not a table row)');
eq(stripMarkdown('a well-worn path'), 'a well-worn path', 'hyphenated word preserved');
eq(stripMarkdown('cost: 5-10 dollars'), 'cost: 5-10 dollars', 'number range with single hyphen preserved');

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

console.log(`\nburma-essays-text: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
