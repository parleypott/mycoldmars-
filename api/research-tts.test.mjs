// Coverage for the research-readout TTS chunker + markdown stripper (api/research-tts.js).
// chunkText splits text so NO chunk exceeds the ElevenLabs per-request budget and NO chunk
// is empty (an empty chunk is POSTed verbatim and 502s the whole readout).
// Run: node api/research-tts.test.mjs   (also auto-discovered by `bun run test`)
import { chunkText, strip } from './research-tts.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

const MAX = 4800;

// ---------------------------------------------------------------------------
// RED PROOF — the pre-fix chunkText, reconstructed verbatim. It (A) pushed an
// empty chunk when buf was empty and a near-max paragraph arrived, and (B) emitted
// a single sentence / punctuation-less run longer than the cap as one over-cap chunk.
// ---------------------------------------------------------------------------
function chunkTextOLD(text, max = MAX) {
  if (text.length <= max) return [text];
  const out = [];
  const paragraphs = text.split(/\n\n+/);
  let buf = '';
  for (const p of paragraphs) {
    if (p.length > max) {
      const sentences = p.match(/[^.!?]+[.!?]+/g) ?? [p];
      for (const s of sentences) {
        if ((buf + ' ' + s).trim().length > max) {
          if (buf) out.push(buf.trim());
          buf = s;
        } else { buf = buf ? buf + ' ' + s : s; }
      }
    } else if ((buf + '\n\n' + p).length > max) {
      out.push(buf.trim()); buf = p;
    } else { buf = buf ? buf + '\n\n' + p : p; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// (A) leading near-max paragraph: old code pushes a leading "" chunk.
const A = 'x'.repeat(MAX - 1) + '\n\n' + 'y'.repeat(100);
ok(chunkTextOLD(A).some(c => c.length === 0), 'RED(A): old code emits an empty chunk');
ok(!chunkText(A).some(c => c.length === 0), 'FIX(A): no empty chunk emitted');

// (B) punctuation-less run bigger than max: old code emits one over-cap chunk.
const B = 'w'.repeat(6000) + '\n\n' + 'z'.repeat(50);
ok(chunkTextOLD(B).some(c => c.length > MAX), 'RED(B): old code emits an over-cap chunk');
ok(!chunkText(B).some(c => c.length > MAX), 'FIX(B): every chunk is within the cap');

// ---------------------------------------------------------------------------
// The two load-bearing invariants of chunkText: every chunk non-empty AND <= max.
// ---------------------------------------------------------------------------
const invariantOK = (chunks, label) => {
  ok(chunks.length > 0, `${label}: produces at least one chunk`);
  ok(chunks.every(c => c.length > 0), `${label}: no empty chunk`);
  ok(chunks.every(c => c.length <= MAX), `${label}: no chunk over max`);
};

invariantOK(chunkText(A), 'A near-max leading para');
invariantOK(chunkText(B), 'B punctuation-less run');
invariantOK(chunkText('w'.repeat(MAX)), 'exact-max single block returns whole');           // <= max -> [text]
eq(chunkText('w'.repeat(MAX)).length, 1, 'exactly max length is one chunk');
invariantOK(chunkText('y'.repeat(MAX) + '\n\n' + 'z'.repeat(50)), 'first para exactly max + more');
invariantOK(chunkText('a'.repeat(MAX + 1)), 'single run one over the cap hard-splits');

// A single very long sentence (with terminator) longer than the cap -> hard-split, all <= max.
const longSentence = 'word '.repeat(2000).trim() + '.';   // ~10000 chars, one sentence
invariantOK(chunkText(longSentence), 'one giant sentence');
ok(chunkText(longSentence).length >= 2, 'giant sentence splits into multiple chunks');

// ---------------------------------------------------------------------------
// Normal behavior is preserved (no regression for ordinary research text).
// ---------------------------------------------------------------------------
eq(chunkText('short text').length, 1, 'short text -> single chunk');
eq(chunkText('short text')[0], 'short text', 'short text unchanged');

// Small paragraphs that fit together collapse into one chunk, joined by blank lines.
const small = 'Para one.\n\nPara two.\n\nPara three.';
eq(chunkText(small).length, 1, 'small paras combine into one chunk');
eq(chunkText(small)[0], 'Para one.\n\nPara two.\n\nPara three.', 'combined chunk keeps paragraph separators');

// Two big-ish paragraphs that cannot share a chunk split in order, each within cap.
const p1 = 'A'.repeat(3000), p2 = 'B'.repeat(3000);
const two = chunkText(p1 + '\n\n' + p2);
eq(two.length, 2, 'two 3000-char paras -> two chunks');
eq(two[0], p1, 'first chunk is first paragraph');
eq(two[1], p2, 'second chunk is second paragraph');
invariantOK(two, 'two big paras');

// A paragraph over the cap but made of sentences that each fit -> sentence-level packing, all <= max.
const sentence = 'This is a sentence. ';
const bigPara = sentence.repeat(300).trim();   // > max, but each sentence is short
const packed = chunkText(bigPara);
invariantOK(packed, 'sentence-packed big paragraph');
ok(packed.length >= 2, 'big sentence paragraph splits into multiple chunks');

// Content preservation on the hard-split path: every word survives across the splits.
const splitWords = chunkText('a'.repeat(MAX + 1)).join('');
eq(splitWords.length, MAX + 1, 'hard-split preserves all characters');

// ---------------------------------------------------------------------------
// TAIL-DROP — a paragraph over the cap that ends in an un-terminated run (no
// trailing . ! ?). The old sentence regex /[^.!?]+[.!?]+/g matched terminated
// sentences ONLY, so the trailing run was silently dropped from the readout —
// the listener never hears the conclusion. The fix adds |[^.!?]+$ so the tail
// is captured. (chunkTextOLD above carries the old regex = the RED reference.)
// ---------------------------------------------------------------------------
const C = 'A'.repeat(MAX - 20) + '. ' + 'CONCLUSION_WITH_NO_PERIOD';
ok(!chunkTextOLD(C).join(' ').includes('CONCLUSION'), 'RED(C): old regex drops the un-terminated tail');
ok(chunkText(C).join(' ').includes('CONCLUSION'), 'FIX(C): un-terminated tail is preserved');
invariantOK(chunkText(C), 'C tail-after-cap paragraph');

// Same shape but the tail is its own short paragraph with no terminator -> preserved.
const C2 = 'B'.repeat(3000) + '. ' + 'C'.repeat(3000) + '\n\n' + 'final words no period';
ok(chunkText(C2).join(' ').includes('final words no period'), 'FIX(C2): trailing un-terminated paragraph kept');

// WHITESPACE-ONLY short text -> NO chunk (old code returned ['   '], a whitespace
// chunk POSTed to ElevenLabs that 502s the whole readout).
eq(chunkText('   ').length, 0, 'whitespace-only short text -> no chunk');
eq(chunkText('').length, 0, 'empty string -> no chunk');
eq(chunkText('\n\n  \n').length, 0, 'whitespace+newlines -> no chunk');
ok(!chunkText('   ').some(c => !c.trim()), 'FIX: never emits a blank short chunk');
// Non-string input is coerced, not crashed.
eq(chunkText(null).length, 0, 'null input -> no chunk (no crash)');
eq(chunkText(undefined).length, 0, 'undefined input -> no chunk (no crash)');

// ---------------------------------------------------------------------------
// strip() — markdown -> speech cleaner (so the narrator never reads symbols aloud).
// ---------------------------------------------------------------------------
eq(strip('# Heading'), 'Heading', 'strip ATX heading marker');
eq(strip('## Sub heading'), 'Sub heading', 'strip level-2 heading');
eq(strip('**bold** word'), 'bold word', 'strip bold');
eq(strip('*italic* word'), 'italic word', 'strip italic');
eq(strip('_under_ word'), 'under word', 'strip underscore emphasis');
eq(strip('`code` inline'), 'code inline', 'inline code keeps content');
eq(strip('```\nblock\n```'), '', 'fenced code block removed');
eq(strip('see [the docs](http://x.com)'), 'see the docs', 'link -> text only');
eq(strip('![alt](http://img.png) gone'), 'gone', 'image removed entirely');
eq(strip('- one\n- two'), 'one\ntwo', 'bullet list markers removed');
eq(strip('1. first\n2. second'), 'first\nsecond', 'numbered list markers removed');
// CommonMark also allows "+" bullets and "1)" ordered markers — both leaked their
// literal symbol into the readout ("plus", "close paren") before the fix.
eq(strip('+ plus a\n+ plus b'), 'plus a\nplus b', 'plus (+) bullet markers removed');
eq(strip('1) one\n2) two'), 'one\ntwo', 'paren (1)) numbered markers removed');
eq(strip('a claim[3] here'), 'a claim here', 'citation marker removed');
eq(strip('claim at end [12]'), 'claim at end', 'trailing citation marker removed + trimmed');
eq(strip('> a quote'), 'a quote', 'blockquote marker removed');
eq(strip('line\n\n\n\nline'), 'line\n\nline', 'collapse 3+ blank lines to one');
eq(strip('  trimmed  '), 'trimmed', 'outer whitespace trimmed');

// ---------------------------------------------------------------------------
// CONSOLIDATION LOCK — strip() now delegates to the shared, hardened stripMarkdown
// core. These cover the leaks the OLD divergent-weaker local copy MISSED. Deep-
// research output is markdown-rich (URLs, tables, HR, __bold__, ~~strike~~, HTML
// comments, autolinks), so each of these was reaching ElevenLabs and being read
// aloud as symbols. Reverting strip() to a weaker copy turns these RED.
// ---------------------------------------------------------------------------
ok(!strip('reported at https://reuters.com today').includes('reuters'), 'bare URL dropped (not spelled out)');
ok(!strip('see www.example.org/path here').includes('example'), 'bare www URL dropped');
eq(strip('…reported at https://reuters.com.'), '…reported at .', 'bare URL dropped but sentence period kept');
eq(strip('__strong__ text'), 'strong text', 'double-underscore bold stripped (was leaking "_strong_")');
eq(strip('~~old~~ new'), 'old new', 'strikethrough stripped (was reading "tilde")');
ok(!strip('above\n\n---\n\nbelow').includes('---'), 'thematic break (---) removed');
ok(!strip('text <!-- editor note --> more').includes('note'), 'HTML comment removed');
ok(!strip('link <https://x.com> here').includes('x.com'), 'autolink removed');
{
  const t = strip('| City | Pop |\n| --- | --- |\n| Yangon | 5M |');
  ok(!t.includes('|'), 'table pipes removed');
  ok(!t.includes('---'), 'table separator row removed');
  ok(t.includes('Yangon') && t.includes('5M'), 'table cell content spoken');
}

console.log(`\nresearch-tts: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
