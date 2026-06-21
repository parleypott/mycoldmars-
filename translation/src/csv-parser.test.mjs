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

console.log(fail === 0
  ? `PASS — all ${pass} csv-parser cases correct`
  : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
