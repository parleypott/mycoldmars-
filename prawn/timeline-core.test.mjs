// Verifier-layer LOCK for the Prawn Weekend host-prep TIMELINE date/time engine.
//
// prawn/index.html renders a date-aware timeline that places each guest's RSVP
// ("arrive_when" / "depart_when" free text) into the correct DAY COLUMN and
// orders the pills within a cell by time. The whole placement rides on five
// pure, ZERO-COVERAGE functions:
//   parseDate      -> Date | null   (which column a guest lands in)
//   detectDayName  -> 0..6 | null   (day-name fallback when no explicit date)
//   shortTime      -> "" | "h:mmam" (the time shown + the sort key source)
//   timeSortKey    -> number        (orders pills within a cell)
//   dateKey/addDays/daysBetween     (build the column window)
// A silent regression here drops a guest's time or files them under the wrong
// day with no signal. No live bug found (reviewed every branch) -> this is a
// LOCK, not a fix. The test EXTRACTS the real shipped functions from index.html
// at runtime (brace-matched), so it can't drift from a hand-copied mirror.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'index.html'), 'utf8');

// --- runtime extractors (can't drift) -------------------------------------
function braceMatch(src, openIdx) {
  // openIdx points at the first '{' ; returns index just past the matching '}'
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces from ' + openIdx);
}
function extractFn(src, name) {
  const sig = src.indexOf('function ' + name + '(');
  assert.ok(sig !== -1, 'missing function ' + name);
  const open = src.indexOf('{', sig);
  return src.slice(sig, braceMatch(src, open));
}
function extractConst(src, name) {
  // pulls `const NAME = ...;` up to the line's terminating `;` for an array literal
  const i = src.indexOf('const ' + name + ' =');
  assert.ok(i !== -1, 'missing const ' + name);
  // find the end of the literal: for the array consts, the matching `];`
  const bracket = src.indexOf('[', i);
  let depth = 0, end = -1;
  for (let j = bracket; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return src.slice(i, end) + ';';
}

const bundle = [
  extractConst(SRC, 'MONTH_NAMES'),
  extractConst(SRC, 'DAY_NAME_ALIASES'),
  extractFn(SRC, 'parseDate'),
  extractFn(SRC, 'detectDayName'),
  extractFn(SRC, 'shortTime'),
  extractFn(SRC, 'dateKey'),
  extractFn(SRC, 'addDays'),
  extractFn(SRC, 'daysBetween'),
  extractFn(SRC, 'timeSortKey'),
  'return { parseDate, detectDayName, shortTime, dateKey, addDays, daysBetween, timeSortKey };',
].join('\n');

const T = new Function(bundle)();

// --- tiny harness ---------------------------------------------------------
let pass = 0, fail = 0;
function eq(a, b, msg) {
  try { assert.deepStrictEqual(a, b); pass++; }
  catch { fail++; console.error('  ✗', msg, '\n    got', JSON.stringify(a), 'want', JSON.stringify(b)); }
}
function ok(c, msg) {
  if (c) pass++; else { fail++; console.error('  ✗', msg); }
}
const ymd = d => d == null ? null : [d.getFullYear(), d.getMonth() + 1, d.getDate()];

const YEAR = 2026;

// ── INLINE RED PROOFS — what a regression would do ────────────────────────
// (1) detectDayName: the short keys MUST be word-bounded, else "sunset"/"satin"
//     would falsely report a day. A boundary-less matcher would mis-detect.
{
  const boundaryless = (text) => {
    const lower = (text || '').toLowerCase();
    const ALIASES = [
      { idx: 0, keys: ['sun', 'sunday'] }, { idx: 6, keys: ['sat', 'saturday'] },
    ];
    for (const d of ALIASES) for (const k of d.keys) if (lower.includes(k)) return d.idx;
    return null;
  };
  ok(boundaryless('sunset plans') === 0, 'RED proof: substring matcher mis-detects "sunset" as Sunday');
  ok(T.detectDayName('sunset plans') === null, 'shipped detectDayName does NOT mis-detect "sunset"');
}
// (2) timeSortKey: a key that ignores am/pm would sort 9pm before 9am wrongly.
{
  const noMeridiem = (t) => { const m = (t || '').match(/^(\d{1,2})/); return m ? parseInt(m[1], 10) : 50; };
  ok(noMeridiem('9pm') === noMeridiem('9am'), 'RED proof: meridiem-blind key ties 9am and 9pm');
  ok(T.timeSortKey('9pm') > T.timeSortKey('9am'), 'shipped timeSortKey orders 9pm after 9am');
}

// ── parseDate ─────────────────────────────────────────────────────────────
eq(ymd(T.parseDate('6/24', YEAR)), [2026, 6, 24], 'slash date m/d uses defaultYear');
eq(ymd(T.parseDate('6/24/26', YEAR)), [2026, 6, 24], 'slash date 2-digit year -> 20xx');
eq(ymd(T.parseDate('6/24/2025', YEAR)), [2025, 6, 24], 'slash date 4-digit year');
eq(ymd(T.parseDate('June 24', YEAR)), [2026, 6, 24], 'month-name "June 24"');
eq(ymd(T.parseDate('Jun 24th', YEAR)), [2026, 6, 24], 'abbrev month + ordinal "Jun 24th"');
eq(ymd(T.parseDate('arriving Dec 3rd, late', YEAR)), [2026, 12, 3], 'month-name embedded in prose');
eq(ymd(T.parseDate('((late 7/4))', YEAR)), [2026, 7, 4], 'slash date inside decoration');
ok(T.parseDate('', YEAR) === null, 'empty -> null');
ok(T.parseDate(null, YEAR) === null, 'null -> null');
ok(T.parseDate('sometime thursday', YEAR) === null, 'no date token -> null');
ok(T.parseDate('13/40', YEAR) === null, 'invalid month/day -> null (slash branch rejects)');
// impossible days must reject, not silently roll into the next month (a guest on the wrong column).
// These go RED if the rollover-detection guard is removed (parseDate falls back to `day <= 31`).
ok(T.parseDate('6/31', YEAR) === null, 'slash 6/31 (June has 30 days) -> null, not July 1');
ok(T.parseDate('2/30', YEAR) === null, 'slash 2/30 -> null, not March 2');
ok(T.parseDate('2/29/25', YEAR) === null, 'slash 2/29 in non-leap 2025 -> null, not March 1');
eq(ymd(T.parseDate('2/29/28', YEAR)), [2028, 2, 29], 'slash 2/29 in leap 2028 -> valid Feb 29');
ok(T.parseDate('Feb 30', YEAR) === null, 'month-name Feb 30 -> null, not March 2');
ok(T.parseDate('November 31', YEAR) === null, 'month-name Nov 31 (30 days) -> null, not Dec 1');
eq(ymd(T.parseDate('6/30', YEAR)), [2026, 6, 30], 'valid last-day-of-month stays byte-identical');
ok(T.parseDate('Foozember 9', YEAR) === null, 'unknown month name -> null');
eq(ymd(T.parseDate('1/1/27', YEAR)), [2027, 1, 1], 'next-year slash date');
// slash branch wins when both present
eq(ymd(T.parseDate('Jan 5 (really 2/2)', YEAR)), [2026, 2, 2], 'slash branch checked first');

// ── detectDayName ─────────────────────────────────────────────────────────
eq(T.detectDayName('thursday night'), 4, 'full "thursday" -> 4');
eq(T.detectDayName('thu pm'), 4, 'abbrev "thu" -> 4');
eq(T.detectDayName('thurs'), 4, 'abbrev "thurs" -> 4');
eq(T.detectDayName('see you sat'), 6, '"sat" -> 6');
eq(T.detectDayName('SUNDAY brunch'), 0, 'uppercase "SUNDAY" -> 0');
eq(T.detectDayName('weds eve'), 3, '"weds" -> 3');
ok(T.detectDayName('saturated market') === null, '"saturated" not mis-detected as Saturday');
ok(T.detectDayName('no day here') === null, 'no day -> null');
ok(T.detectDayName('') === null, 'empty -> null');
// first matching day wins in alias order (Sun..Sat); two days -> earliest in week
eq(T.detectDayName('friday or saturday'), 5, 'two days -> first in alias order (Fri)');

// ── shortTime ─────────────────────────────────────────────────────────────
eq(T.shortTime('arriving 11:30 am'), '11:30am', 'time normalized: space stripped, lowercased');
eq(T.shortTime('3pm flight'), '3pm', 'bare hour pm');
eq(T.shortTime('around NOON'), 'noon', 'fuzzy "noon"');
eq(T.shortTime('late night'), 'late', 'fuzzy: leftmost token in string wins ("late" before "night")');
eq(T.shortTime('12:00am redeye'), '12:00am', 'midnight time kept');
eq(T.shortTime('thursday'), '', 'no time token -> empty');
eq(T.shortTime(''), '', 'empty -> empty');
eq(T.shortTime('9 PM'), '9pm', 'spaced uppercase meridiem');

// ── timeSortKey ────────────────────────────────────────────────────────────
ok(T.timeSortKey('12am') < T.timeSortKey('1am'), 'midnight (0) sorts before 1am');
ok(T.timeSortKey('11am') < T.timeSortKey('12pm'), '11am before noon');
ok(T.timeSortKey('12pm') < T.timeSortKey('1pm'), 'noon before 1pm');
eq(T.timeSortKey('12pm'), 12, 'noon -> 12');
eq(T.timeSortKey('12am'), 0, 'midnight -> 0');
eq(T.timeSortKey('1:30pm'), 13.5, '1:30pm -> 13.5');
ok(T.timeSortKey('morning') < T.timeSortKey('evening'), 'fuzzy morning before evening');
eq(T.timeSortKey('whenever'), 50, 'unknown token -> 50 (sorts last among knowns)');
eq(T.timeSortKey(''), 50, 'empty -> 50');
ok(T.timeSortKey('early') < T.timeSortKey('morning'), 'fuzzy early before morning');
// real ordering of a cell with mixed entries
{
  const times = ['3pm', '9am', 'noon', 'evening', '12am'];
  const sorted = [...times].sort((a, b) => T.timeSortKey(a) - T.timeSortKey(b));
  eq(sorted, ['12am', '9am', 'noon', '3pm', 'evening'], 'mixed cell sorts chronologically');
}

// ── dateKey / addDays / daysBetween (column window) ────────────────────────
eq(T.dateKey(new Date(2026, 5, 4)), '2026-06-04', 'dateKey zero-pads month+day');
eq(ymd(T.addDays(new Date(2026, 5, 30), 1)), [2026, 7, 1], 'addDays rolls month over');
eq(ymd(T.addDays(new Date(2026, 11, 31), 1)), [2027, 1, 1], 'addDays rolls year over');
eq(T.daysBetween(new Date(2026, 5, 4), new Date(2026, 5, 4)), 0, 'same day -> 0');
eq(T.daysBetween(new Date(2026, 5, 4), new Date(2026, 5, 7)), 3, 'Thu->Sun -> 3');
// end-to-end column window for a typical Thu->Sun weekend
{
  const dates = ['6/25', '6/28', '6/26'].map(s => T.parseDate(s, YEAR)).filter(Boolean).sort((a, b) => a - b);
  const min = dates[0], max = dates[dates.length - 1];
  const span = Math.min(T.daysBetween(min, max), 9);
  const cols = [];
  for (let i = 0; i <= span; i++) cols.push(T.dateKey(T.addDays(min, i)));
  eq(cols, ['2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28'], 'Thu->Sun window = 4 columns');
}

console.log(`timeline-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
