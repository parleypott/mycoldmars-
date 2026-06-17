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
eq(strip('a claim[3] here'), 'a claim here', 'citation marker removed');
eq(strip('> a quote'), 'a quote', 'blockquote marker removed');
eq(strip('line\n\n\n\nline'), 'line\n\nline', 'collapse 3+ blank lines to one');
eq(strip('  trimmed  '), 'trimmed', 'outer whitespace trimmed');

console.log(`\nresearch-tts: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
