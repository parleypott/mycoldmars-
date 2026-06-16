/**
 * Tests for json-parser — the Happy Scribe word-level JSON import front door
 * (the bilingual path: English word timings + Chinese original_translation_text).
 * Every downstream export is built from what this parses, so a silent mis-parse
 * here corrupts everything. Run: node src/json-parser.test.mjs
 *
 * Headline case: a long English utterance that splits into multiple sub-groups,
 * paired with a Chinese original that has FEWER clauses than groups. The Chinese
 * aligner (distributeToCount) emits an empty string for the overflow group; its
 * own comment promises that "shows English fallback", but the consumer used the
 * empty chunk verbatim — shipping a blank-text segment at a real timecode. The
 * fix falls back to the group's English words, matching every other path here.
 */
import { parseJSON } from './json-parser.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label}`); }
};

const w = (text, s, d = 0.4) => ({ text, data_start: s, data_end: s + d });

// ── Headline: no segment may ship empty text when English words exist ──────────
{
  // 10 English words → 2 groups of 5 (break after the comma on word 5).
  // Chinese original is one short clause, no internal punctuation → 1 clause < 2 groups.
  const input = JSON.stringify([{
    speaker: 'A',
    original_translation_text: '你好世界',
    words: [
      w('one', 0), w('two', 0.5), w('three', 1), w('four', 1.5), w('five,', 2),
      w('six', 2.5), w('seven', 3), w('eight', 3.5), w('nine', 4), w('ten', 4.5),
    ],
  }]);
  const { segments } = parseJSON(input);
  eq(segments.length, 2, 'headline: two segments');
  eq(segments[0].text, '你好世界', 'headline: first group keeps the Chinese clause');
  ok(segments[1].text.trim().length > 0, 'headline: overflow group is NOT empty');
  eq(segments[1].text, 'six seven eight nine ten', 'headline: overflow group falls back to English words');
  eq(segments.filter(s => s.text.trim() === '').length, 0, 'headline: zero blank-text segments');
}

// ── Equal clause/group count: Chinese passes through 1:1, no English leakage ────
{
  const input = JSON.stringify([{
    speaker: 'B',
    original_translation_text: '第一句，第二句。',
    words: [
      w('alpha', 0), w('bravo', 0.5), w('charlie', 1), w('delta', 1.5), w('echo,', 2),
      w('foxtrot', 2.5), w('golf', 3), w('hotel', 3.5), w('india', 4), w('juliet', 4.5),
    ],
  }]);
  const { segments } = parseJSON(input);
  eq(segments.length, 2, 'equal: two segments');
  ok(segments.every(s => /[一-鿿]/.test(s.text)), 'equal: every segment carries Chinese, no English fallback');
  eq(segments.map(s => s.text).join(''), '第一句，第二句。', 'equal: no Chinese characters dropped');
}

// ── More clauses than groups: clauses merged, nothing dropped ───────────────────
{
  const input = JSON.stringify([{
    speaker: 'C',
    original_translation_text: '甲，乙，丙，丁。',
    words: [
      w('one', 0), w('two', 0.5), w('three', 1), w('four', 1.5), w('five,', 2),
      w('six', 2.5), w('seven', 3), w('eight', 3.5), w('nine', 4), w('ten', 4.5),
    ],
  }]);
  const { segments } = parseJSON(input);
  ok(segments.length >= 1, 'more-clauses: produced segments');
  const joined = segments.map(s => s.text).join('');
  for (const ch of ['甲', '乙', '丙', '丁']) ok(joined.includes(ch), `more-clauses: kept ${ch}`);
}

// ── Short utterance (<= TARGET_WORDS): single segment, Chinese wins ─────────────
{
  const input = JSON.stringify([{
    speaker: 'D',
    original_translation_text: '简短',
    words: [w('short', 0), w('one', 0.5)],
  }]);
  const { segments } = parseJSON(input);
  eq(segments.length, 1, 'short: single segment');
  eq(segments[0].text, '简短', 'short: Chinese original wins over English words');
}

// ── Short utterance with NO Chinese: English words fill the text ────────────────
{
  const input = JSON.stringify([{
    speaker: 'E',
    words: [w('just', 0), w('english', 0.5), w('here', 1)],
  }]);
  const { segments } = parseJSON(input);
  eq(segments.length, 1, 'no-chinese-short: single segment');
  eq(segments[0].text, 'just english here', 'no-chinese-short: English words joined');
}

// ── Long utterance with NO Chinese: each group uses its own English words ───────
{
  const input = JSON.stringify([{
    speaker: 'F',
    words: [
      w('aa', 0), w('bb', 0.5), w('cc', 1), w('dd', 1.5), w('ee,', 2),
      w('ff', 2.5), w('gg', 3), w('hh', 3.5), w('ii', 4), w('jj', 4.5),
    ],
  }]);
  const { segments } = parseJSON(input);
  ok(segments.length >= 2, 'no-chinese-long: split into groups');
  eq(segments.filter(s => s.text.trim() === '').length, 0, 'no-chinese-long: no empty segments');
  eq(segments.map(s => s.text).join(' ').split(/\s+/).filter(Boolean).length, 10,
    'no-chinese-long: all 10 words present across groups');
}

// ── Empty-words utterance with Chinese: emitted as one segment ──────────────────
{
  const input = JSON.stringify([{
    speaker: 'G',
    original_translation_text: '只有中文没有词',
    words: [],
    data_start: 1.0,
    data_end: 2.0,
  }]);
  const { segments } = parseJSON(input);
  eq(segments.length, 1, 'empty-words: one segment from Chinese only');
  eq(segments[0].text, '只有中文没有词', 'empty-words: Chinese text preserved');
  eq(segments[0].start, '1', 'empty-words: start from utterance');
  eq(segments[0].end, '2', 'empty-words: end from utterance');
}

// ── BOM stripping: a leading BOM must not break JSON.parse ──────────────────────
{
  const body = JSON.stringify([{ speaker: 'H', words: [w('hi', 0)] }]);
  const { segments } = parseJSON('﻿' + body);
  eq(segments.length, 1, 'bom: parses past the BOM');
  eq(segments[0].text, 'hi', 'bom: content intact');
}

// ── Error paths ────────────────────────────────────────────────────────────────
{
  let threw = false;
  try { parseJSON('not json'); } catch { threw = true; }
  ok(threw, 'error: invalid JSON throws');

  threw = false;
  try { parseJSON('{"not":"array"}'); } catch { threw = true; }
  ok(threw, 'error: non-array throws');

  threw = false;
  try { parseJSON('[]'); } catch { threw = true; }
  ok(threw, 'error: empty array (no segments) throws');
}

console.log(`\njson-parser: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
