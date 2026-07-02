// Locks buildAnnotatedText — the Hunter Script Copilot's editorial-annotation
// assembly. Its output IS the corpus text the narrative AI reads: chunkParsedDoc
// calls buildAnnotatedText(chunk.elements, {}) to produce each chunk's `text`,
// which ingest.js embeds and feeds the model. The color PRIMITIVES it leans on
// (approximateColorName/rgbToHex/...) are locked in google-docs-color.test.mjs;
// this file locks the ASSEMBLY around them — the part that decides how a beat,
// heading, section break, and colored/bold/italic/struck run turn into the
// markered text the AI actually sees.
//
// Contract locked here (a refactor that breaks any of these should go RED):
//   • heading         -> "\n## <text>\n"
//   • beat            -> "---BEAT---", then "VOICE: <annotated>" (if voice.text),
//                        then "VISUAL: <annotated>" (if visual.text)
//   • section_break   -> "---"
//   • paragraph       -> annotated runs, FALLING BACK to el.text when the
//                        annotation is empty (no/blank runs)   [the `|| el.text`]
//   • annotateRuns    -> per run, a marker set in a FIXED order: colour first,
//                        then BOLD, ITALIC, STRUCK, joined by "/", wrapped as
//                        "[MARKERS: text]"; unmarked runs pass through bare;
//                        runs joined by a single space; blank runs dropped.
//   • colour precedence: colorConventions[highlight] (uppercased) OVERRIDES the
//                        approximateColorName fallback.
//   • lines joined by "\n".
//
// Imports the REAL shipped function (no mirror) so the lock can't drift.

import { buildAnnotatedText } from './google-docs-parser.js';

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) { if (cond) passed++; else { failed++; fails.push(name); } }
function eq(name, a, b) {
  ok(name, a === b);
  if (a !== b && fails[fails.length - 1] === name) {
    fails[fails.length - 1] = `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`;
  }
}

// ── headings, section breaks, and the paragraph el.text fallback ──
eq('heading wraps in "\\n## …\\n"',
  buildAnnotatedText([{ type: 'heading', text: 'ACT ONE' }]),
  '\n## ACT ONE\n');

eq('section_break renders as ---',
  buildAnnotatedText([{ type: 'section_break' }]),
  '---');

eq('paragraph with NO runs falls back to el.text',
  buildAnnotatedText([{ type: 'paragraph', text: 'plain fallback', runs: [] }]),
  'plain fallback');

eq('paragraph with only-blank runs falls back to el.text',
  buildAnnotatedText([{ type: 'paragraph', text: 'still here', runs: [{ text: '   ' }] }]),
  'still here');

// This is the load-bearing `|| el.text`. If the annotation is non-empty it must
// WIN over el.text (markup is the whole point).
eq('paragraph with content runs uses the ANNOTATION, not el.text',
  buildAnnotatedText([{ type: 'paragraph', text: 'the border was closed',
    runs: [{ text: 'the ' }, { text: 'border', style: { highlight: '#FF0000' } }, { text: ' was closed' }] }]),
  'the [RED: border] was closed');

// ── colour precedence: convention beats approximation, and is uppercased ──
eq('colorConventions[highlight] OVERRIDES approximateColorName (and uppercases)',
  buildAnnotatedText(
    [{ type: 'paragraph', text: 'x', runs: [{ text: 'border', style: { highlight: '#FF0000' } }] }],
    { '#FF0000': 'danger' }),
  '[DANGER: border]');

eq('no convention -> approximateColorName is used',
  buildAnnotatedText([{ type: 'paragraph', text: 'x', runs: [{ text: 'sky', style: { highlight: '#9900FF' } }] }]),
  '[PURPLE: sky]');

// ── marker ORDER + stacking: colour, BOLD, ITALIC, STRUCK, "/"-joined ──
eq('markers stack in fixed order colour/BOLD/ITALIC/STRUCK',
  buildAnnotatedText([{ type: 'paragraph', text: 'x',
    runs: [{ text: 'go', style: { highlight: '#00FF00', bold: true, italic: true, strikethrough: true } }] }]),
  '[GREEN/BOLD/ITALIC/STRUCK: go]');

eq('bold-only run -> [BOLD: …]',
  buildAnnotatedText([{ type: 'paragraph', text: 'x', runs: [{ text: 'ACT', style: { bold: true } }] }]),
  '[BOLD: ACT]');

eq('strikethrough -> STRUCK; unmarked neighbour passes through bare; single-space join',
  buildAnnotatedText([{ type: 'paragraph', text: 'x',
    runs: [{ text: 'cut me', style: { strikethrough: true } }, { text: 'keep it' }] }]),
  '[STRUCK: cut me] keep it');

// ── beat assembly: header line, VOICE then VISUAL, each annotated; ──
// ── a beat missing voice.text omits the VOICE line entirely. ──
eq('beat: ---BEAT--- then VOICE then VISUAL, each annotated',
  buildAnnotatedText([{ type: 'beat',
    voice: { text: 'the border', runs: [{ text: 'the ' }, { text: 'border', style: { highlight: '#FF0000' } }] },
    visual: { text: 'aerial highway', runs: [{ text: 'aerial ', style: { bold: true } }, { text: 'highway', style: { highlight: '#9900FF', italic: true } }] } }]),
  '---BEAT---\nVOICE: the [RED: border]\nVISUAL: [BOLD: aerial] [PURPLE/ITALIC: highway]');

eq('beat with no voice.text omits the VOICE line',
  buildAnnotatedText([{ type: 'beat', visual: { text: 'wide shot', runs: [{ text: 'wide shot' }] } }]),
  '---BEAT---\nVISUAL: wide shot');

// The beat-body fallback mirrors the paragraph one: annotateRuns() returns ''
// on a runless side, so `annotateRuns(...) || el.voice.text` uses the raw text.
eq('beat VOICE with text but no runs falls back to voice.text',
  buildAnnotatedText([{ type: 'beat', voice: { text: 'raw voice line', runs: [] } }]),
  '---BEAT---\nVOICE: raw voice line');

// ── multi-element document joins with "\n" and preserves element order ──
eq('multi-element doc joins with newlines in order',
  buildAnnotatedText([
    { type: 'heading', text: 'H' },
    { type: 'paragraph', text: 'p', runs: [{ text: 'plain para' }] },
    { type: 'section_break' },
  ]),
  '\n## H\n\nplain para\n---');

// ── empty input is the empty string, not a crash ──
eq('empty element list -> ""', buildAnnotatedText([]), '');

// ── MUTATION PROOF: the checks above actually pin the contract. ──
// If any of these load-bearing behaviours regressed, at least one eq() above
// would have caught it. Spot-verify the two most fragile invariants directly so
// the lock's intent is self-documenting:
{
  // (a) marker order: swapping colour-after-bold would produce "[BOLD/GREEN: …]".
  const out = buildAnnotatedText([{ type: 'paragraph', text: 'x',
    runs: [{ text: 'go', style: { highlight: '#00FF00', bold: true } }] }]);
  ok('MUTATION: colour precedes BOLD (not "[BOLD/GREEN: …]")', out === '[GREEN/BOLD: go]');

  // (b) the `|| el.text` fallback: dropping it would yield "" for a runless para.
  const fb = buildAnnotatedText([{ type: 'paragraph', text: 'FALLBACK', runs: [] }]);
  ok('MUTATION: runless paragraph keeps el.text (fallback intact)', fb === 'FALLBACK');
}

// ── summary ──
console.log(`google-docs-annotate: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
