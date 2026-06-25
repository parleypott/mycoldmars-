// Locks chunkParsedDoc + buildAnnotatedText — the Hunter Script Copilot's Google
// Docs INGEST chunker. After a script is parsed into structured elements
// (headings / paragraphs / beats / section breaks), chunkParsedDoc slices it
// into titled, size-bounded chunks that become the corpus the copilot trains on.
// buildAnnotatedText is the function that flattens elements (with their colored
// runs) into the annotated text both the chunker AND the corpus consume.
//
// Zero prior coverage. This is a verifier-layer LOCK (no source change) on the
// chunker bug class that has bitten this repo repeatedly elsewhere — chunkers
// that LOSE content, DUPLICATE it, emit EMPTY chunks, or silently DROP an
// over-cap element (research-tts, burma-essays PWA). The load-bearing invariant
// here is CONTENT CONSERVATION across a size split: every input element's text
// must survive into exactly one chunk, even when a section overflows maxChars.
//
// It also pins two deliberate sharp edges discovered while locking it, so a
// future "fix" can't silently change them without a failing test + a human look:
//   (a) a single element whose annotated text alone exceeds maxChars is NOT
//       split — it ships as one over-cap chunk (content preserved, never dropped);
//   (b) any finished chunk whose trimmed text is <= 50 chars is DROPPED as noise.
//
// Imports the REAL shipped functions (no mirror) so the lock can't drift.

import { chunkParsedDoc, buildAnnotatedText } from './google-docs-parser.js';

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) { if (cond) passed++; else { failed++; fails.push(name); } }
function eq(name, a, b) {
  ok(name, a === b);
  if (a !== b && fails[fails.length - 1] === name) {
    fails[fails.length - 1] = `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`;
  }
}

// Element constructors matching the parser's structured shapes.
const para = (text, runs) => (runs ? { type: 'paragraph', text, runs } : { type: 'paragraph', text });
const heading = (text) => ({ type: 'heading', text });
const beat = (voice, visual) => ({ type: 'beat', voice: { text: voice }, visual: { text: visual } });
const sbreak = () => ({ type: 'section_break' });

// ── buildAnnotatedText: element flattening shapes ──
eq('BAT heading -> "\\n## X\\n"', buildAnnotatedText([heading('ACT ONE')]), '\n## ACT ONE\n');
eq('BAT paragraph falls back to el.text when no runs', buildAnnotatedText([para('plain line')]), 'plain line');
eq('BAT paragraph annotates a highlighted run', // #FFFF00 -> YELLOW via approximateColorName
   buildAnnotatedText([para('x', [{ text: 'wide shot', style: { highlight: '#FFFF00' } }])]),
   '[YELLOW: wide shot]');
eq('BAT beat emits ---BEAT--- + VOICE/VISUAL lines',
   buildAnnotatedText([beat('hello', 'a road')]), '---BEAT---\nVOICE: hello\nVISUAL: a road');
eq('BAT section_break -> ---', buildAnnotatedText([sbreak()]), '---');
eq('BAT empty element list -> empty string', buildAnnotatedText([]), '');

// ── chunkParsedDoc: empties & the <=50-char noise drop ──
eq('empty doc -> no chunks', chunkParsedDoc({ elements: [] }).length, 0);
eq('a single sub-50-char paragraph is DROPPED as noise', chunkParsedDoc({ elements: [para('tiny')] }).length, 0);
// Lock the threshold direction: content JUST over 50 survives. ("z"*60 -> >50.)
ok('a >50-char paragraph survives the noise drop', chunkParsedDoc({ elements: [para('z'.repeat(60))] }).length === 1);

// ── chunkParsedDoc: opening chunk, title, beatCount ──
const longLine = 'word '.repeat(20); // ~100 chars, clears the 50-char floor
{
  const c = chunkParsedDoc({ elements: [para(longLine)] });
  eq('lone paragraph -> 1 chunk', c.length, 1);
  eq("untitled-doc first chunk is 'Opening'", c[0].title, 'Opening');
  eq('beatCount 0 when no beats', c[0].beatCount, 0);
  ok('opening chunk text carries the paragraph', c[0].text.includes(longLine.trim()));
}
{
  const c = chunkParsedDoc({ elements: [para(longLine), beat('v one', 'vis one'), beat('v two', 'vis two')] });
  eq('beatCount counts beat elements in the chunk', c[0].beatCount, 2);
}

// ── chunkParsedDoc: heading boundaries ──
{
  // A heading only starts a NEW chunk once the current chunk has content. So a
  // leading heading folds into 'Opening' (it can't title an empty chunk), while
  // a LATER heading opens its own titled chunk. Pin this exact behavior.
  const c = chunkParsedDoc({ elements: [heading('A'), para(longLine), heading('B'), para(longLine)] });
  eq('heading boundary -> 2 chunks', c.length, 2);
  eq("leading heading folds into 'Opening' (no empty chunk titled by it)", c[0].title, 'Opening');
  eq('a later heading titles its own chunk', c[1].title, 'B');
  // CONSERVATION: heading A's text is not lost just because it didn't title a chunk.
  ok("leading heading A's text still lives in the opening chunk", c[0].text.includes('## A'));
  ok("heading B's text lives in the second chunk", c[1].text.includes('## B'));
}

// ── chunkParsedDoc: CONTENT CONSERVATION across a forced size split (the load-bearing invariant) ──
{
  // 6 distinct paragraphs, maxChars small enough to force multiple splits.
  const paras = Array.from({ length: 6 }, (_, i) => para(`para${i} ` + 'z'.repeat(20)));
  const chunks = chunkParsedDoc({ elements: paras }, 60);
  ok('size split produces >1 chunk', chunks.length > 1);
  ok("a continued section is titled '… (cont.)'", chunks.some(c => /\(cont\.\)$/.test(c.title)));
  const joined = chunks.map(c => c.text).join('\n');
  // The whole point: NOTHING is lost across the split. The recurring chunker bug
  // (reset elements before flushing, or drop the overflow element) would fail this.
  ok('CONSERVATION: every paragraph survives the split exactly once',
     paras.every(p => joined.split(p.text).length === 2));
}

// ── chunkParsedDoc: an over-cap single element is shipped whole, never dropped ──
{
  const huge = 'q'.repeat(200); // one element, alone larger than maxChars
  const chunks = chunkParsedDoc({ elements: [para(huge)] }, 50);
  eq('over-cap single element still yields 1 chunk', chunks.length, 1);
  ok('over-cap chunk exceeds maxChars (single elements are not split)', chunks[0].text.length > 50);
  ok('over-cap content is preserved in full, not truncated/dropped', chunks[0].text.includes(huge));
}

// ── summary ──
console.log(`google-docs-chunk: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
