/**
 * Tests for csv-parser — the Happy Scribe / Trint import front door. Every
 * downstream export (SRT, Premiere XML, sacred sequencer) is built from what
 * this module parses, so a silent mis-parse here corrupts everything.
 * Run: node src/csv-parser.test.mjs
 *
 * Headline case: a quoted field containing a newline (a multi-line transcript
 * cell). The old code split on '\n' BEFORE quote-aware field parsing, shearing
 * the cell — the second physical line dropped out and the text was truncated.
 */
import {
  parseCSV,
  cleanSpeakerName,
  isGenericSpeaker,
  parseSequenceInfo,
  getStats,
  findKeywordCol,
} from './csv-parser.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label}`); }
};

const H = 'Number;Speaker;Start time;End time;Duration;Text';

// ── basic parse: header detection + semicolon delimiter ──
{
  const segs = parseCSV(`${H}\n1;JOHN;0:00:01,000;0:00:02,000;1;Hello world`);
  eq(segs.length, 1, 'basic: one segment');
  eq(segs[0].speaker, 'JOHN', 'basic: speaker');
  eq(segs[0].start, '0:00:01,000', 'basic: start');
  eq(segs[0].text, 'Hello world', 'basic: text');
  eq(segs[0].number, 1, 'basic: number');
}

// ── THE BUG: quoted field with an embedded newline (multi-line cell) ──
{
  const csv = `${H}\n1;JOHN;0:00:01,000;0:00:02,000;1;"Line one\nLine two"\n2;JANE;0:00:03,000;0:00:04,000;1;Second`;
  const segs = parseCSV(csv);
  eq(segs.length, 2, 'multiline: still exactly two segments');
  eq(segs[0].text, 'Line one\nLine two', 'multiline: cell text preserved across the newline');
  eq(segs[0].start, '0:00:01,000', 'multiline: row 1 timing intact');
  eq(segs[1].speaker, 'JANE', 'multiline: row 2 not corrupted by the orphan');
  eq(segs[1].text, 'Second', 'multiline: row 2 text intact');
}

// ── quoted field containing the delimiter (must not split the field) ──
{
  const segs = parseCSV(`${H}\n1;JOHN;0:00:01,000;0:00:02,000;1;"Hello; world"`);
  eq(segs[0].text, 'Hello; world', 'embedded-delimiter: semicolon stays inside the cell');
}

// ── doubled-quote escape inside a quoted field ──
{
  const segs = parseCSV(`${H}\n1;JOHN;0:00:01,000;0:00:02,000;1;"She said ""stop"" loudly"`);
  eq(segs[0].text, 'She said "stop" loudly', 'escaped-quote: "" -> literal "');
}

// ── multi-line cell that ALSO contains an escaped quote (combined stress) ──
{
  const csv = `${H}\n1;JOHN;0:00:01,000;0:00:02,000;1;"a ""b""\nc"\n2;JANE;0:00:03,000;0:00:04,000;1;ok`;
  const segs = parseCSV(csv);
  eq(segs.length, 2, 'combo: two segments');
  eq(segs[0].text, 'a "b"\nc', 'combo: escaped quote + newline both preserved');
  eq(segs[1].text, 'ok', 'combo: trailing row intact');
}

// ── BOM strip ──
{
  const segs = parseCSV(`﻿${H}\n1;JOHN;0:00:01,000;0:00:02,000;1;Hi`);
  eq(segs[0].text, 'Hi', 'BOM: header still resolves, text parsed');
}

// ── CRLF normalization ──
{
  const segs = parseCSV(`${H}\r\n1;JOHN;0:00:01,000;0:00:02,000;1;Hi\r\n2;JANE;0:00:03,000;0:00:04,000;1;Yo`);
  eq(segs.length, 2, 'CRLF: two segments');
  eq(segs[0].text, 'Hi', 'CRLF: no trailing \\r contamination');
}

// ── tab-delimited (TSV) detection ──
{
  const segs = parseCSV('Number\tSpeaker\tStart time\tEnd time\tDuration\tText\n1\tJOHN\t0:00:01,000\t0:00:02,000\t1\tTabbed');
  eq(segs[0].text, 'Tabbed', 'TSV: tab delimiter auto-detected');
  eq(segs[0].speaker, 'JOHN', 'TSV: speaker column');
}

// ── blank lines skipped, empty-text rows skipped ──
{
  const segs = parseCSV(`${H}\n1;JOHN;0:00:01,000;0:00:02,000;1;Hi\n\n2;JANE;0:00:03,000;0:00:04,000;1;`);
  eq(segs.length, 1, 'skips: blank line and empty-text row both dropped');
}

// ── cleanSpeakerName ──
eq(cleanSpeakerName('260317-04-104-JERRY - JOHNNY'), 'Johnny', 'clean: strips sequence prefix');
eq(cleanSpeakerName('Mikael Antell'), 'Mikael Antell', 'clean: plain name preserved');
eq(cleanSpeakerName('ALL JH ONCAM'), 'ALL JH ONCAM', 'clean: no-digit multiword as-is');
eq(cleanSpeakerName(''), '', 'clean: empty');
// Apostrophe surnames — straight AND curly (the smart-quote default in real
// exports). The strip-class was straight-only, so a name whose only alpha word
// carried a curly apostrophe failed the [a-zA-Z]{2,} test in BOTH cleanSpeakerName
// (the line strip) AND isGenericSpeaker (which then flagged the name "generic",
// making cleanSpeakerName early-return the whole raw sequence prefix). RED proof:
// before the fix curly "O’Brien" returned "260317-04-104-O’Brien".
eq(cleanSpeakerName("260317-04-104-O'Brien"), 'Obrien', 'clean: straight-apostrophe surname stripped');
eq(cleanSpeakerName('260317-04-104-O’Brien'), 'Obrien', 'clean: curly U+2019 surname (was leaking whole prefix)');
eq(cleanSpeakerName('260317-04-104-O‘Brien'), 'Obrien', 'clean: curly U+2018 surname');
eq(cleanSpeakerName('260304-02-JANE-D’Angelo'), 'Dangelo', 'clean: curly surname is the trailing speaker, not an earlier word');

// ── isGenericSpeaker ──
ok(isGenericSpeaker('Speaker 1'), 'generic: "Speaker 1" is generic');
ok(isGenericSpeaker(''), 'generic: empty is generic');
ok(!isGenericSpeaker('Johnny'), 'generic: real name is not generic');
// A real surname carrying a curly apostrophe must NOT read as a generic label.
ok(!isGenericSpeaker("260317-04-104-O'Brien"), 'generic: straight-apostrophe surname is a real name');
ok(!isGenericSpeaker('260317-04-104-O’Brien'), 'generic: curly U+2019 surname is a real name (was wrongly generic)');
ok(!isGenericSpeaker('260304-02-D’Angelo'), 'generic: curly surname alone is a real name');
ok(isGenericSpeaker('260317-04-104'), 'generic: pure numeric code is generic');

// ── parseSequenceInfo date (UTC, stable across timezones) ──
{
  const { dateFilmed } = parseSequenceInfo('260317-04-104-JERRY');
  ok(dateFilmed instanceof Date, 'date: parsed to a Date');
  eq(dateFilmed.getUTCFullYear(), 2026, 'date: year 2026');
  eq(dateFilmed.getUTCMonth(), 2, 'date: month March (0-indexed 2)');
  eq(dateFilmed.getUTCDate(), 17, 'date: day 17');
}
eq(parseSequenceInfo('NO DATE HERE').dateFilmed, null, 'date: no leading 6-digit -> null');

// ── getStats ──
{
  const segs = parseCSV(`${H}\n1;JOHN;0:00:01,000;0:00:05,000;4;Hi\n2;JANE;0:00:05,000;0:00:09,000;4;Yo`);
  const st = getStats(segs);
  eq(st.segmentCount, 2, 'stats: segment count');
  eq(st.speakerCount, 2, 'stats: speaker count');
  eq(st.duration, '0:00:09,000', 'stats: duration = last end');
}

// ── segment NUMBER: explicit 0 must survive (truthy-zero trap) ──
// seg.number is an ALIGNMENT KEY — translations, segment marks, and copilot
// selection all match segments by .number (main.js translatedMap, sot-hunter
// byNum, copilot-prompts findIndex). The old `parseInt(field,10) || i` replaced
// an explicit "0" with the loop counter i, so a 0-indexed export's segment 0
// collided with another segment's number → silent wrong-translation alignment.
{
  // Inline RED proof: reconstruct the OLD logic and show it loses the 0.
  const oldNumber = (field, i) => parseInt(field, 10) || i;
  ok(oldNumber('0', 1) === 1, 'RED-proof: old logic turns "0" into the loop counter (collision)');
  ok(oldNumber('0', 5) === 5, 'RED-proof: old logic, segment 0 at row 5 becomes 5');

  // A 0-indexed export: numbers 0,1,2 across three rows. The fix must keep them
  // 0,1,2 (distinct); the old logic would make them i=1,2,3 — and crucially the
  // "0" row collides with the second row's "1" once shifted.
  const z = parseCSV(`${H}\n0;A;0:00:00,000;0:00:01,000;1;Zero\n1;B;0:00:01,000;0:00:02,000;1;One\n2;C;0:00:02,000;0:00:03,000;1;Two`);
  eq(z.length, 3, 'seg0: three segments');
  eq(z[0].number, 0, 'seg0: explicit 0 preserved (not replaced by loop counter)');
  eq(z[1].number, 1, 'seg0: 1 preserved');
  eq(z[2].number, 2, 'seg0: 2 preserved');
  ok(new Set(z.map(s => s.number)).size === 3, 'seg0: all three numbers distinct (no key collision)');

  // A 0 in the MIDDLE of a 1-indexed-ish set must still be the literal 0.
  const mid = parseCSV(`${H}\n5;A;0:00:00,000;0:00:01,000;1;Five\n0;B;0:00:01,000;0:00:02,000;1;Zero\n7;C;0:00:02,000;0:00:03,000;1;Seven`);
  eq(mid[1].number, 0, 'seg0: middle explicit 0 preserved');
  eq(mid[0].number, 5, 'seg0: explicit 5 preserved');
  eq(mid[2].number, 7, 'seg0: explicit 7 preserved');
}

// ── segment NUMBER no-regression: 1-indexed + fallback paths unchanged ──
{
  // Every 1-indexed value (>=1) is byte-identical to the old `||i` behavior.
  const oldNumber = (field, i) => parseInt(field, 10) || i;
  const rows = [
    ['1', 1], ['2', 2], ['3', 3], ['42', 9], ['1000', 4],   // ordinary 1-indexed
    ['-1', 2],                                               // negative was already truthy-preserved
    ['7abc', 3],                                             // parseInt-lenient leading number
    ['', 6], ['   ', 8], ['abc', 5], ['N/A', 7],             // garbage/empty -> fall back to i
  ];
  for (const [field, i] of rows) {
    const parsedNum = parseInt(field, 10);
    const fixed = Number.isNaN(parsedNum) ? i : parsedNum;
    eq(fixed, oldNumber(field, i), `no-regression: "${field}" @${i} matches old ||i behavior`);
  }

  // No Number/# column at all -> loop counter, exactly as before.
  const noNum = parseCSV(`Speaker;Start time;End time;Text\nJOHN;0:00:01,000;0:00:02,000;Hi\nJANE;0:00:02,000;0:00:03,000;Yo`);
  eq(noNum[0].number, 1, 'no-column: first row -> i=1');
  eq(noNum[1].number, 2, 'no-column: second row -> i=2');

  // Garbage number field -> loop counter (intended fallback preserved).
  const garbage = parseCSV(`${H}\nNaN;A;0:00:00,000;0:00:01,000;1;Hi`);
  eq(garbage[0].number, 1, 'garbage-number: falls back to loop counter i=1');
}

// ── column detection: whole-word match beats substring collision ──
// The old detector was `cols.findIndex(c => c.includes(kw))`. A column that
// merely *contains* the keyword as a substring — "Sender" / "Legend" /
// "Recommended" all contain "end", "Restart" contains "start" — would hijack
// the timecode lookup (findIndex returns the FIRST match), feeding garbage into
// every segment's start/end with no error and corrupting all downstream exports.
{
  const lower = a => a.map(s => s.toLowerCase());

  // The headline collision: a chat/messaging transcript with a "Sender" column.
  // "sender".includes("end") === true, and Sender comes BEFORE the real End col.
  const chat = lower(['Sender', 'Start time', 'End time', 'Text']);
  eq(findKeywordCol(chat, 'end'), 2, 'collision: "Sender" must NOT steal the End column');
  eq(findKeywordCol(chat, 'start'), 1, 'collision: Start column resolves correctly past "Sender"');

  // RED-proof: the OLD substring logic picks "Sender" (index 0) as the End col.
  const oldFind = (cols, kw) => cols.findIndex(c => c.includes(kw));
  ok(oldFind(chat, 'end') === 0, 'RED-proof: old includes() logic mis-maps End→"Sender"');
  ok(findKeywordCol(chat, 'end') !== oldFind(chat, 'end'), 'fix diverges from buggy logic on the collision');

  // Other plausible substring collisions on "end".
  eq(findKeywordCol(lower(['Legend', 'Start', 'End', 'Text']), 'end'), 2, 'collision: "Legend" must not steal End');
  eq(findKeywordCol(lower(['Recommended', 'Start', 'End', 'Text']), 'end'), 2, 'collision: "Recommended" must not steal End');
  eq(findKeywordCol(lower(['Restart count', 'Start', 'End', 'Text']), 'start'), 1, 'collision: "Restart" must not steal Start');

  // No-regression: every real header shape still resolves to the right column.
  const hs = lower(['Number', 'Speaker', 'Start time', 'End time', 'Duration', 'Text']);
  eq(findKeywordCol(hs, 'start'), 2, 'real header: "Start time" resolves');
  eq(findKeywordCol(hs, 'end'), 3, 'real header: "End time" resolves');
  eq(findKeywordCol(hs, 'duration'), 4, 'real header: "Duration" resolves');
  eq(findKeywordCol(lower(['start', 'end', 'text']), 'end'), 1, 'bare "end" word resolves');
  eq(findKeywordCol(lower(['start (s)', 'end (s)', 'text']), 'end'), 1, '"end (s)" resolves via word boundary');

  // Loose-substring FALLBACK preserved: an oddball header with no word-boundary
  // match still resolves via includes() exactly as the old code did.
  eq(findKeywordCol(lower(['clipstart', 'clipend', 'text']), 'start'), 0, 'fallback: "clipstart" still resolves');
  eq(findKeywordCol(lower(['clipstart', 'clipend', 'text']), 'end'), 1, 'fallback: "clipend" still resolves');

  // Missing column → -1 (so parseCSV still throws its clear error).
  eq(findKeywordCol(lower(['speaker', 'text']), 'end'), -1, 'absent column → -1');

  // End-to-end: parseCSV on a "Sender" CSV must read END timecodes, not names.
  const chatCsv = 'Sender;Start time;End time;Text\nJOHN;0:00:01,000;0:00:02,500;Hi\nJANE;0:00:02,500;0:00:04,000;Yo';
  const chatSegs = parseCSV(chatCsv);
  eq(chatSegs[0].end, '0:00:02,500', 'e2e: End field carries the timecode, not the Sender name');
  eq(chatSegs[1].end, '0:00:04,000', 'e2e: second row End timecode intact');
}

// ── Trint native export: comma-delimited, "In"/"Out"/"Status" columns ──
// The exact shape Trint's "Export CSV" produces. Must load with no header
// renaming: In→start, Out→end, Speaker/Text/Duration matched as usual, Status
// ignored. Multi-sentence quoted cells (with internal commas) stay intact.
{
  const trint =
    'In,Out,Duration,Text,Speaker,Status\n' +
    '00:00:00.030,00:00:07.930,00:00:07.900,"I\'m done flying. Nice to meet you, really.",JOHNNY,edited\n' +
    '00:00:08.130,00:00:13.329,00:00:05.199,Delighted let me ask you a question.,JAMES,not-edited';
  const segs = parseCSV(trint);
  eq(segs.length, 2, 'trint: two segments');
  eq(segs[0].start, '00:00:00.030', 'trint: In → start');
  eq(segs[0].end, '00:00:07.930', 'trint: Out → end');
  eq(segs[0].speaker, 'JOHNNY', 'trint: speaker');
  eq(segs[0].text, "I'm done flying. Nice to meet you, really.", 'trint: quoted cell with internal comma intact');
  eq(segs[1].start, '00:00:08.130', 'trint: second row In');
  eq(segs[1].end, '00:00:13.329', 'trint: second row Out');
}

console.log(fail === 0
  ? `PASS — all ${pass} csv-parser cases correct`
  : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
