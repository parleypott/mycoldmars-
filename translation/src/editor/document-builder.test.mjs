// Tests for the interpreter editor's document-builder — first assertion coverage.
// Headline fix: formatTimecodeForTag silently disagreed with the canonical
// timeToSeconds parser (srt-builder.js) on sub-hour fractional timecodes, so the
// same seg.start rendered correctly in the SRT export but as a garbage "0:01"
// orientation tag in the editor margin. Plus locks for buildEditorDocument's
// speaker grouping, language coding, and the dismissed/highlight tree walkers.
import {
  formatTimecodeForTag,
  toLangCode,
  buildEditorDocument,
  getDismissedSegmentNumbers,
  extractHighlightsFromEditor,
} from './document-builder.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(`✗ ${msg}`); } }

// ───────────────────────── formatTimecodeForTag ─────────────────────────
// THE FIX: sub-hour timecode carrying a fraction. Old anchored MM:SS pattern
// (no fraction group) fell through to parseFloat → "0:01".
eq(formatTimecodeForTag('1:23.456'), '1:23', 'MM:SS.mmm dot — the bug');
eq(formatTimecodeForTag('1:23,456'), '1:23', 'MM:SS,mmm comma separator');
eq(formatTimecodeForTag('12:05.5'), '12:05', 'MM:SS.m single-digit frac');
eq(formatTimecodeForTag('59:59.999'), '59:59', 'MM:SS.mmm near a minute');

// Inline RED proof: the OLD logic produces "0:01" for "1:23.456".
function oldFormat(tc) {
  let total = NaN;
  const m3 = tc.match(/^(\d+):(\d{1,2}):(\d{1,2})/);
  const m2 = tc.match(/^(\d+):(\d{1,2})$/);
  if (m3) total = (+m3[1]) * 3600 + (+m3[2]) * 60 + (+m3[3]);
  else if (m2) total = (+m2[1]) * 60 + (+m2[2]);
  else total = parseFloat(tc);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = Math.floor(total % 60);
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
eq(oldFormat('1:23.456'), '0:01', 'RED proof: old logic mangles MM:SS.mmm');
ok(formatTimecodeForTag('1:23.456') !== oldFormat('1:23.456'), 'RED proof: fix changed the output');

// Regression locks — every previously-correct shape unchanged.
eq(formatTimecodeForTag('00:01:23'), '1:23', 'HH:MM:SS drops zero hours');
eq(formatTimecodeForTag('01:02:03'), '1:02:03', 'HH:MM:SS keeps nonzero hours');
eq(formatTimecodeForTag('00:00:05'), '0:05', 'HH:MM:SS small');
eq(formatTimecodeForTag('00:01:23.456'), '1:23', 'HH:MM:SS.mmm drops sub-second');
eq(formatTimecodeForTag('00:01:23,456'), '1:23', 'HH:MM:SS,mmm comma drops sub-second');
eq(formatTimecodeForTag('1:23'), '1:23', 'bare MM:SS preserved');
eq(formatTimecodeForTag('83.5'), '1:23', 'numeric-string seconds');
eq(formatTimecodeForTag('95'), '1:35', 'integer-string seconds');
eq(formatTimecodeForTag(95), '1:35', 'numeric seconds');
eq(formatTimecodeForTag(83.5), '1:23', 'numeric float seconds');
eq(formatTimecodeForTag(3723), '1:02:03', 'numeric seconds with hours');
eq(formatTimecodeForTag(0), '0:00', 'numeric zero formats (guard only catches null/empty-string)');
eq(formatTimecodeForTag(''), '', 'empty string');
eq(formatTimecodeForTag(null), '', 'null');
eq(formatTimecodeForTag(undefined), '', 'undefined');
eq(formatTimecodeForTag('  00:01:23  '), '1:23', 'whitespace trimmed');
eq(formatTimecodeForTag('garbage'), 'garbage', 'unparseable returns String(tc)');

// ───────────────────────── toLangCode ─────────────────────────
eq(toLangCode('Chinese'), 'ZH', 'chinese');
eq(toLangCode('Mandarin Chinese'), 'ZH', 'mandarin');
eq(toLangCode('Cantonese'), 'ZH', 'cantonese');
eq(toLangCode('English'), 'EN', 'english');
eq(toLangCode('Japanese'), 'JA', 'japanese');
eq(toLangCode('Mixed'), 'MIX', 'mixed');
eq(toLangCode('Malay'), 'ID', 'malay→ID');
eq(toLangCode(''), '', 'empty lang');
eq(toLangCode(null), '', 'null lang');
eq(toLangCode('Swahili'), 'SW', 'unknown 2-char fallback');
eq(toLangCode('Tagalog'), 'TA', 'unknown long word → first 2 chars');
eq(toLangCode('ZH'), 'ZH', 'short code passthrough uppercased');

// ───────────────────────── buildEditorDocument ─────────────────────────
const colors = { Alice: '#111', Bob: '#222' };

// English-only (translations null): consecutive same-speaker segments merge.
{
  const segs = [
    { number: 1, speaker: 'Alice', start: '00:00:01', end: '00:00:02', text: 'hello' },
    { number: 2, speaker: 'Alice', start: '00:00:02', end: '00:00:03', text: 'again' },
    { number: 3, speaker: 'Bob', start: '00:00:04', end: '00:00:05', text: 'hi' },
  ];
  const doc = buildEditorDocument(segs, null, colors, {}, [], null, {});
  eq(doc.type, 'doc', 'returns a doc node');
  eq(doc.content.length, 2, 'two consecutive Alice segs merge into one block, Bob separate');
  eq(doc.content[0].attrs.speaker, 'Alice', 'first block speaker');
  eq(doc.content[0].content[0].content.length, 2, 'Alice block has 2 segment text nodes');
  eq(doc.content[0].content[0].content[0].text, 'hello ', 'english-only uses segment text + trailing space');
  eq(doc.content[0].content[0].content[0].marks[0].attrs.number, 1, 'segment mark carries number');
  eq(doc.content[0].content[0].content[0].marks[0].attrs.originalText, '', 'english-only originalText empty');
  eq(doc.content[0].attrs.startTime, '0:01', 'block startTime = first seg start formatted');
  eq(doc.content[0].attrs.color, '#111', 'color from speakerColors');
  eq(doc.content[1].attrs.speaker, 'Bob', 'second block is Bob');
}

// Same speaker NON-consecutive does NOT merge (a different speaker breaks the run).
{
  const segs = [
    { number: 1, speaker: 'Alice', start: 1, end: 2, text: 'a' },
    { number: 2, speaker: 'Bob', start: 2, end: 3, text: 'b' },
    { number: 3, speaker: 'Alice', start: 3, end: 4, text: 'c' },
  ];
  const doc = buildEditorDocument(segs, null, colors, {}, [], null, {});
  eq(doc.content.length, 3, 'A,B,A → three blocks (no cross-merge)');
}

// Translations present: translated text wins, originalText preserved.
{
  const segs = [{ number: 1, speaker: 'Alice', start: 1, end: 2, text: '你好' }];
  const trans = [{ translated: 'hello', original: '你好' }];
  const doc = buildEditorDocument(segs, trans, colors, {}, [], null, {});
  const node = doc.content[0].content[0].content[0];
  eq(node.text, 'hello ', 'translated text used');
  eq(node.marks[0].attrs.originalText, '你好', 'originalText preserved from segment');
}

// Translation fallback chain: translated → original → seg.text.
{
  const segs = [{ number: 1, speaker: 'A', start: 1, end: 2, text: 'rawtext' }];
  eq(buildEditorDocument(segs, [{ original: 'orig' }], { A: '#1' }, {}, [], null, {})
     .content[0].content[0].content[0].text, 'orig ', 'falls back to original when no translated');
  eq(buildEditorDocument(segs, [{}], { A: '#1' }, {}, [], null, {})
     .content[0].content[0].content[0].text, 'rawtext ', 'falls back to seg.text when trans empty');
}

// hideUnintelligible: drops unintelligible segments entirely.
{
  const segs = [
    { number: 1, speaker: 'A', start: 1, end: 2, text: 'x' },
    { number: 2, speaker: 'A', start: 2, end: 3, text: 'y' },
  ];
  const trans = [{ translated: 'keep' }, { unintelligible: true }];
  const shown = buildEditorDocument(segs, trans, { A: '#1' }, {}, [], null, { hideUnintelligible: true });
  eq(shown.content[0].content[0].content.length, 1, 'unintelligible seg dropped when hidden');
  const all = buildEditorDocument(segs, trans, { A: '#1' }, {}, [], null, {});
  eq(all.content[0].content[0].content.length, 2, 'both kept when not hiding');
  eq(all.content[0].content[0].content[1].text, '[unintelligible] ', 'unintelligible placeholder text when shown');
}

// language map + speakerMap remap + hidden speaker dismissed flags.
{
  const segs = [{ number: 1, speaker: 'spk_0', start: 1, end: 2, text: '你好' }];
  const doc = buildEditorDocument(segs, [{ translated: 'hi' }], { spk_0: '#1' },
    { spk_0: 'Grandma' }, ['spk_0'], { spk_0: 'Mandarin Chinese' }, {});
  eq(doc.content[0].attrs.speaker, 'Grandma', 'speakerMap remaps display name');
  eq(doc.content[0].attrs.language, 'ZH', 'languageMap → langCode');
  eq(doc.content[0].attrs.visible, false, 'hidden speaker not visible');
  eq(doc.content[0].attrs.dismissed, true, 'hidden speaker dismissed');
}

// Default color + Unknown speaker fallback + empty/null segments skipped.
{
  const segs = [null, { number: 1, start: 1, end: 2, text: 'q' }];
  const doc = buildEditorDocument(segs, null, {}, {}, [], null, {});
  eq(doc.content[0].attrs.speaker, 'Unknown', 'missing speaker → Unknown');
  eq(doc.content[0].attrs.color, '#DD2C1E', 'default color when speaker not in map');
}
eq(buildEditorDocument([], null, {}, {}, [], null, {}), { type: 'doc', content: [] }, 'empty segments → empty doc');

// ───────────────────────── getDismissedSegmentNumbers ─────────────────────────
{
  const segs = [
    { number: 1, speaker: 'A', start: 1, end: 2, text: 'a' },
    { number: 2, speaker: 'B', start: 2, end: 3, text: 'b' },
  ];
  const doc = buildEditorDocument(segs, null, { A: '#1', B: '#2' }, {}, ['B'], null, {});
  const dismissed = getDismissedSegmentNumbers(doc);
  ok(dismissed instanceof Set, 'returns a Set');
  ok(!dismissed.has(1), 'visible block segment not dismissed');
  ok(dismissed.has(2), 'dismissed block segment collected');
  eq(getDismissedSegmentNumbers(null).size, 0, 'null editorState → empty set');
  eq(getDismissedSegmentNumbers({}).size, 0, 'no content → empty set');
}

// ───────────────────────── extractHighlightsFromEditor ─────────────────────────
{
  const editor = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'plain' },
        { type: 'text', text: 'the highlighted bit here', marks: [
          { type: 'highlight', attrs: { tagId: 't1', segmentNumbers: [3, 4], originalText: '原文', note: 'check' } },
        ] },
        { type: 'text', text: 'other', marks: [{ type: 'segment', attrs: { number: 9 } }] },
      ],
    }],
  };
  const hl = extractHighlightsFromEditor(editor);
  eq(hl.length, 1, 'only highlight marks collected (segment mark ignored)');
  eq(hl[0].tagId, 't1', 'tagId captured');
  eq(hl[0].segmentNumbers, [3, 4], 'segmentNumbers captured');
  eq(hl[0].note, 'check', 'note captured');
  eq(hl[0].originalTextPreview, '原文', 'originalText preview captured');
  ok(hl[0].textPreview.length <= 200, 'textPreview capped');
  eq(extractHighlightsFromEditor(null), [], 'null editor → []');
  eq(extractHighlightsFromEditor({ content: [] }), [], 'empty content → []');
}

// ───────────────────────── report ─────────────────────────
if (fail) { console.log(fails.join('\n')); console.log(`\ndocument-builder (interpreter editor): ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`document-builder (interpreter editor): ${pass}/${pass} passed`);
