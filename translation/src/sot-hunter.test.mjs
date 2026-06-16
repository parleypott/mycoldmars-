/**
 * Tests for the SOT Hunter producer-output core — the pure logic that builds
 * the soundbite line a producer copies into a doc:
 *   [260322-04-113-Matzu | 22:55.3 → 23:00.5]: TEXT
 * This is the most-used output of the most-used tool, and was the last
 * untested logic in the interpreter. Run: node src/sot-hunter.test.mjs
 *
 * Headline case: parseHunterJSON's fallback brace-matcher used a naive depth
 * counter that miscounts when a JSON string VALUE contains a literal { or }
 * (e.g. a soundbite quote like `the cost was high }`). Prose-wrapped JSON with
 * such a value failed to parse and threw "Could not parse hunter response".
 * The fix makes the scan string-aware (skip braces inside quoted strings,
 * respect escapes).
 */
import {
  parseHunterJSON,
  confidenceLabel,
  fmtTimecode,
  buildEnglishSegments,
  formatSoundbiteLine,
  buildMatchSnippet,
} from './sot-hunter.js';
import { getSequenceMetadata, extractSequenceBase } from './csv-parser.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label}`); }
};
const throws = (fn, label) => {
  try { fn(); fail++; console.log(`FAIL ${label}: expected throw`); }
  catch { pass++; }
};

// ─────────────────────────────── parseHunterJSON ───────────────────────────
{
  // clean JSON (the primary path most modern responses take)
  eq(parseHunterJSON('{"confidence":80,"segments":[1,2]}').confidence, 80, 'phj: clean');
  eq(parseHunterJSON('   \n {"a":1}  ').a, 1, 'phj: clean w/ whitespace');

  // fenced
  eq(parseHunterJSON('```json\n{"a":2}\n```').a, 2, 'phj: fenced json');
  eq(parseHunterJSON('```\n{"a":3}\n```').a, 3, 'phj: fenced no-lang');

  // prose-wrapped, clean
  eq(parseHunterJSON('Sure! Here it is:\n{"a":4}').a, 4, 'phj: prose-wrapped clean');

  // ── HEADLINE: prose-wrapped JSON with a closing brace inside a string value.
  // RED before the fix (naive counter closed the object early → threw). ──
  {
    const r = parseHunterJSON('Match found:\n{"quote":"the cost was high }","confidence":80}');
    eq(r.quote, 'the cost was high }', 'phj: prose + closing-brace-in-string keeps text');
    eq(r.confidence, 80, 'phj: prose + closing-brace-in-string keeps confidence');
  }
  // opening brace in string value — same failure class
  {
    const r = parseHunterJSON('Here:\n{"quote":"a { b","c":1}');
    eq(r.quote, 'a { b', 'phj: prose + opening-brace-in-string');
    eq(r.c, 1, 'phj: prose + opening-brace-in-string sibling key');
  }
  // escaped quote AND a brace inside the string
  {
    const r = parseHunterJSON('Result:\n{"quote":"she said \\"go }\\" loud"}');
    eq(r.quote, 'she said "go }" loud', 'phj: escaped-quote + brace-in-string');
  }
  // nested object still parses to the OUTER object
  {
    const r = parseHunterJSON('ok: {"a":{"b":2},"c":3}');
    eq(r.a.b, 2, 'phj: nested inner');
    eq(r.c, 3, 'phj: nested outer sibling');
  }
  // garbage throws
  throws(() => parseHunterJSON('no json here at all'), 'phj: garbage throws');
}

// ─────────────────────────────── confidenceLabel ───────────────────────────
{
  eq(confidenceLabel(100), 'Locked on', 'conf: 100');
  eq(confidenceLabel(80), 'Locked on', 'conf: 80 boundary');
  eq(confidenceLabel(79), 'Probable', 'conf: 79');
  eq(confidenceLabel(50), 'Probable', 'conf: 50 boundary');
  eq(confidenceLabel(49), 'Best guess', 'conf: 49');
  eq(confidenceLabel(20), 'Best guess', 'conf: 20 boundary');
  eq(confidenceLabel(19), 'No clean match', 'conf: 19');
  eq(confidenceLabel(0), 'No clean match', 'conf: 0');
  eq(confidenceLabel(undefined), 'No clean match', 'conf: undefined → floor');
}

// ─────────────────────────────── fmtTimecode ───────────────────────────────
{
  eq(fmtTimecode(null), '', 'fmt: null → empty');
  eq(fmtTimecode(''), '', 'fmt: empty → empty');
  eq(fmtTimecode('1375.3'), '22:55.3', 'fmt: numeric-string seconds');
  eq(fmtTimecode('0'), '0:0.0', 'fmt: zero seconds (opening of interview)');
  // colon-form timecodes pass through untouched (already human-readable)
  eq(fmtTimecode('00:00:12,340'), '00:00:12,340', 'fmt: colon form passthrough');
  eq(fmtTimecode('1:02:03'), '1:02:03', 'fmt: HH:MM:SS passthrough');
}

// ─────────────────────────────── buildEnglishSegments ──────────────────────
{
  const segs = [
    { number: 1, text: 'orig one' },
    { number: 2, text: 'orig two' },
    { number: 3, text: 'orig three' },
  ];
  // no translations → identity
  eq(buildEnglishSegments(segs, []), segs, 'bes: empty translations → identity');
  eq(buildEnglishSegments(segs, null), segs, 'bes: null translations → identity');

  const tr = [
    { number: 1, translated: 'english one', original: 'x' },
    { number: 2, translated: '   ', original: 'fallback original two' },
    { number: 3, unintelligible: true },
  ];
  const out = buildEnglishSegments(segs, tr);
  eq(out.length, 2, 'bes: unintelligible segment dropped');
  eq(out[0].text, 'english one', 'bes: translated wins');
  eq(out[1].text, 'fallback original two', 'bes: blank translated → original fallback');
  ok(!out.some(s => s.number === 3), 'bes: seg 3 gone');

  // a segment with no matching translation is kept as-is
  const out2 = buildEnglishSegments(segs, [{ number: 1, translated: 'only one' }]);
  eq(out2.length, 3, 'bes: untranslated segments preserved');
  eq(out2[1].text, 'orig two', 'bes: untranslated keeps source text');
}

// ─────────────────────────────── formatSoundbiteLine ───────────────────────
{
  const segs = [
    { number: 1, speaker: '260322-04-113-Matzu', start: '1375.3', end: '1380.6', text: 'first part' },
    { number: 2, speaker: '260322-04-113-Matzu', start: '1380.6', end: '1385.0', text: 'second part' },
    { number: 3, speaker: '260322-04-114-Chen', start: '1400.0', end: '1405.0', text: 'chen speaking' },
  ];
  const seqMeta = getSequenceMetadata(segs);
  const base = extractSequenceBase(seqMeta.sequenceName); // '260322-04-113-Matzu'

  eq(formatSoundbiteLine(segs, [], seqMeta), '', 'fsl: empty segNums → empty');
  eq(formatSoundbiteLine(segs, [99], seqMeta), '', 'fsl: no match → empty');

  // multi-segment span by the primary speaker: start from first, end from last,
  // text joined in document order, no speaker suffix (matches primary).
  {
    const line = formatSoundbiteLine(segs, [1, 2], seqMeta);
    const want = `[${base} | ${fmtTimecode('1375.3')} → ${fmtTimecode('1385.0')}]: first part second part`;
    eq(line, want, 'fsl: primary multi-segment span');
  }

  // segNums given out of order → still document-ordered start/end/text
  {
    const line = formatSoundbiteLine(segs, [2, 1], seqMeta);
    const want = `[${base} | ${fmtTimecode('1375.3')} → ${fmtTimecode('1385.0')}]: first part second part`;
    eq(line, want, 'fsl: reversed segNums normalize to doc order');
  }

  // a different speaker than primary → append " - SPEAKER"
  {
    const line = formatSoundbiteLine(segs, [3], seqMeta);
    const want = `[${base} - CHEN | ${fmtTimecode('1400.0')} → ${fmtTimecode('1405.0')}]: chen speaking`;
    eq(line, want, 'fsl: non-primary speaker suffix');
  }

  // polished text overrides the joined segment text
  {
    const line = formatSoundbiteLine(segs, [1, 2], seqMeta, 'cleaned-up quote');
    ok(line.endsWith(']: cleaned-up quote'), 'fsl: polished text overrides');
  }
}

// ─────────────────────────────── buildMatchSnippet ─────────────────────────
{
  const segs = [
    { number: 1, start: '1375.3', end: '1380.6', text: 'first part' },
    { number: 2, start: '1380.6', end: '1385.0', text: 'second part' },
  ];
  eq(buildMatchSnippet(segs, []), '', 'bms: empty segNums → empty');
  eq(buildMatchSnippet(segs, [99]), '', 'bms: no match → empty');
  {
    const r = buildMatchSnippet(segs, [1, 2]);
    eq(r.text, 'first part second part', 'bms: joined text');
    eq(r.tc, `${fmtTimecode('1375.3')} – ${fmtTimecode('1385.0')}`, 'bms: tc first→last');
  }
  {
    const r = buildMatchSnippet(segs, [1, 2], 'polished');
    eq(r.text, 'polished', 'bms: polished override');
  }
}

console.log(fail === 0
  ? `PASS — all ${pass} sot-hunter cases correct`
  : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
