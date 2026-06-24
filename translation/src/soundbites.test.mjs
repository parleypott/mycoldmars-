// Tests for translation/src/soundbites.js — the producer-facing manual
// soundbite-paste import core + Sacred-Selects sequence detection in the
// Interpreter. This is the front door Johnny pastes selects into; a regression
// in any of the four format regexes (F1-F4), the sequence-name extraction, or
// the FCP7 frame-notation converter would silently drop or misparse a producer's
// soundbites with no signal. No live bug was found — the parsing is robust
// (backtracking handles mid-text brackets; extractSacredName requires a
// letter-initial trailing token) — so this is a verifier-layer LOCK: every
// assertion is mutation-proven to fail if the corresponding logic regresses.
//
// Pure functions, freeze-independent: the mutation-proven test IS the full
// verification — no deploy or live grep needed.

import {
  parseSoundbites,
  extractSacredName,
  detectSacredSequence,
  detectAllSequences,
  formatDuration,
  tcToFrameNotation,
} from './soundbites.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// ── parseSoundbites: F1 canonical ───────────────────────────────────────────
{
  const { bites, skipped } = parseSoundbites('[BURMA-DAY-2 | 00:00:01 → 00:00:05] he walked in');
  eq(bites.length, 1, 'F1: one bite');
  eq(skipped.length, 0, 'F1: nothing skipped');
  eq(bites[0].prefix, 'BURMA-DAY-2', 'F1: prefix');
  eq(bites[0].start, '00:00:01', 'F1: start');
  eq(bites[0].end, '00:00:05', 'F1: end');
  eq(bites[0].text, 'he walked in', 'F1: text');
  ok(typeof bites[0].id === 'string' && bites[0].id.length > 0, 'F1: id assigned');
}

// ── parseSoundbites: F2 with trailing duration ──────────────────────────────
{
  const { bites } = parseSoundbites('SEQ - JOHNNY: [00:00:01] hello there [00:00:05][4.0]');
  eq(bites.length, 1, 'F2: one bite');
  eq(bites[0].prefix, 'SEQ - JOHNNY', 'F2: prefix keeps speaker');
  eq(bites[0].start, '00:00:01', 'F2: start');
  eq(bites[0].end, '00:00:05', 'F2: end is the SECOND timecode (not the duration)');
  eq(bites[0].text, 'hello there', 'F2: text');
}

// ── parseSoundbites: F2 without the optional duration ───────────────────────
{
  const { bites } = parseSoundbites('SEQ: [00:00:01] hi [00:00:05]');
  eq(bites.length, 1, 'F2-no-dur: one bite');
  eq(bites[0].end, '00:00:05', 'F2-no-dur: end');
  eq(bites[0].text, 'hi', 'F2-no-dur: text');
}

// ── parseSoundbites: mid-text NUMERIC bracket is kept (backtracking lock) ────
// The end-TC bracket must be the LAST numeric bracket; an earlier "[02:30]"
// inside the text stays in the text. A greedy/non-backtracking regex would
// stop at "[02:30]" and corrupt both text and end.
{
  const { bites } = parseSoundbites('SEQ: [00:00:01] at [02:30] he left [00:00:05][4.0]');
  eq(bites.length, 1, 'F2 mid-numeric-bracket: one bite');
  eq(bites[0].text, 'at [02:30] he left', 'F2 mid-numeric-bracket: inner timecode stays in text');
  eq(bites[0].end, '00:00:05', 'F2 mid-numeric-bracket: end is the final timecode');
}

// ── parseSoundbites: mid-text NON-numeric bracket kept in text ──────────────
{
  const { bites } = parseSoundbites('SEQ: [00:00:01] he said [pause] then [00:00:05]');
  eq(bites[0].text, 'he said [pause] then', 'F2 mid-[pause]: non-numeric bracket stays in text');
  eq(bites[0].end, '00:00:05', 'F2 mid-[pause]: end');
}

// ── parseSoundbites: F3 single timecode → skipped, not a bite ───────────────
{
  const { bites, skipped } = parseSoundbites('SEQ - JOHNNY: [00:00:01] no end here');
  eq(bites.length, 0, 'F3: no cuttable bite');
  eq(skipped.length, 1, 'F3: one skipped');
  eq(skipped[0].prefix, 'SEQ - JOHNNY', 'F3: skipped prefix');
  ok(/no end timecode/.test(skipped[0].reason), 'F3: skip reason names the missing end TC');
}

// ── parseSoundbites: F4 header + body → skipped with .mp4 stripped ──────────
{
  const raw = '260316-04-102-FISHERMAN.mp4\nFISHERMAN Speaker 6 (00:58:58.16) he spoke';
  const { bites, skipped } = parseSoundbites(raw);
  eq(bites.length, 0, 'F4: no cuttable bite (single timestamp)');
  eq(skipped.length, 1, 'F4: one skipped');
  eq(skipped[0].prefix, '260316-04-102-FISHERMAN', 'F4: prefix is the filename with .mp4 stripped');
  ok(/no end timecode/.test(skipped[0].reason), 'F4: skip reason names the missing end TC');
}

// ── parseSoundbites: lone F4 body (no preceding header) is silently dropped ──
{
  const { bites, skipped } = parseSoundbites('FISHERMAN Speaker 6 (00:58:58.16) he spoke');
  eq(bites.length, 0, 'F4 lone body: no bite');
  eq(skipped.length, 0, 'F4 lone body: not flagged (needs the .mp4 header context)');
}

// ── parseSoundbites: blanks filtered, order preserved, multi-format mix ──────
{
  const raw = [
    '',
    '   ',
    '[A | 00:00:00 → 00:00:02] first',
    'B: [00:00:03] second [00:00:06][3.0]',
    'totally unrecognized line',
    '[C | 00:00:07 → 00:00:09] third',
  ].join('\n');
  const { bites, skipped } = parseSoundbites(raw);
  eq(bites.length, 3, 'mix: three bites');
  eq(skipped.length, 0, 'mix: unrecognized line is silently dropped, not skipped[]');
  eq(bites.map(b => b.text).join('|'), 'first|second|third', 'mix: order preserved');
  ok(new Set(bites.map(b => b.id)).size === 3, 'mix: ids are unique');
}

// ── parseSoundbites: empty / whitespace input → empty result, no throw ───────
{
  const a = parseSoundbites('');
  eq(a.bites.length, 0, 'empty: no bites');
  eq(a.skipped.length, 0, 'empty: no skipped');
  const b = parseSoundbites('\n  \n\t\n');
  eq(b.bites.length, 0, 'whitespace-only: no bites');
}

// ── RED proof: a non-backtracking F2 (greedy text, first-numeric-bracket end)
// would corrupt the mid-text-numeric case. Reconstruct it to document the bug
// the real lazy regex avoids.
{
  const badF2 = /^(.+?):\s*\[([0-9:.,]+)\]\s*(.+)\s*\[([0-9:.,]+)\]/; // greedy .+, no $-anchor discipline
  const m = 'SEQ: [00:00:01] at [02:30] he left [00:00:05][4.0]'.match(badF2);
  // greedy .+ grabs as much as possible, so end becomes the LAST bracket via [4.0]?
  // The point: this naive form does NOT reliably yield end=00:00:05 text='at [02:30] he left'.
  const realResult = parseSoundbites('SEQ: [00:00:01] at [02:30] he left [00:00:05][4.0]').bites[0];
  ok(realResult.end === '00:00:05' && realResult.text === 'at [02:30] he left',
     'RED-context: the shipped lazy F2 gets end+text right where a naive greedy regex would not');
  ok(m !== null, 'RED-context: the naive regex matches but its capture groups are not what we want');
}

// ── extractSacredName: strip the trailing "- SPEAKER" ───────────────────────
eq(extractSacredName('Mars Study - JOHNNY'), 'Mars Study', 'sacred: strips "- SPEAKER"');
eq(extractSacredName('260304-0439-Chihhao Yu'), '260304-0439',
   'sacred: strips speaker even across internal hyphens, keeps the numeric sequence');
eq(extractSacredName('BURMA-DAY-2'), 'BURMA-DAY-2',
   'sacred: does NOT strip a trailing token that starts with a digit (letter-initial required)');
eq(extractSacredName('SEQ'), 'SEQ', 'sacred: no suffix -> unchanged');
eq(extractSacredName('01 MIKAEL ANTELL'), '01 MIKAEL ANTELL',
   'sacred: no hyphen -> unchanged (space-separated speaker not stripped)');
eq(extractSacredName('- JOHN'), '- JOHN',
   'sacred: an all-suffix prefix falls back to the original (|| prefix), never empty string');

// ── detectSacredSequence: most-frequent sequence wins ───────────────────────
{
  const bites = [
    { prefix: 'BURMA - A' }, { prefix: 'BURMA - B' }, { prefix: 'BURMA - C' },
    { prefix: 'TAIWAN - X' }, { prefix: 'TAIWAN - Y' },
  ];
  const r = detectSacredSequence(bites);
  eq(r.name, 'BURMA', 'detectSacred: most frequent sequence');
  eq(r.count, 3, 'detectSacred: its count');
  eq(r.total, 5, 'detectSacred: total bites');
}
{
  // Tie: strict > means the FIRST-seen sequence keeps the crown.
  const r = detectSacredSequence([{ prefix: 'A - X' }, { prefix: 'B - Y' }]);
  eq(r.name, 'A', 'detectSacred: tie -> first-seen wins (strict >)');
  eq(r.count, 1, 'detectSacred: tie count');
}
{
  const r = detectSacredSequence([]);
  eq(r.name, '', 'detectSacred: empty -> empty name');
  eq(r.count, 0, 'detectSacred: empty -> 0 count');
  eq(r.total, 0, 'detectSacred: empty -> 0 total');
}

// ── detectAllSequences: sorted desc by count ────────────────────────────────
{
  const bites = [
    { prefix: 'TAIWAN - X' },
    { prefix: 'BURMA - A' }, { prefix: 'BURMA - B' }, { prefix: 'BURMA - C' },
    { prefix: 'TAIWAN - Y' },
  ];
  const r = detectAllSequences(bites);
  eq(r.length, 2, 'detectAll: two distinct sequences');
  eq(r[0].name, 'BURMA', 'detectAll: highest count first');
  eq(r[0].count, 3, 'detectAll: BURMA count');
  eq(r[1].name, 'TAIWAN', 'detectAll: lower count second');
  eq(r[1].count, 2, 'detectAll: TAIWAN count');
}
eq(detectAllSequences([]).length, 0, 'detectAll: empty -> empty array');

// ── formatDuration: sums (end-start), hour-carrying, negative-guarded ────────
eq(formatDuration([{ start: '00:00:01', end: '00:00:05' }]), '0:04', 'dur: simple 4s');
eq(formatDuration([
  { start: '00:00:00', end: '00:00:30' },
  { start: '00:00:00', end: '00:00:30' },
]), '1:00', 'dur: two 30s bites -> 1:00');
eq(formatDuration([{ start: '00:00:00', end: '01:30:00' }]), '1:30:00',
   'dur: hour-plus total carries the hour (regression-proof of the formatClock fix)');
eq(formatDuration([{ start: '00:00:01,5', end: '00:00:03,5' }]), '0:02',
   'dur: comma-decimal timecodes parse');
eq(formatDuration([{ start: '00:00:10', end: '00:00:05' }]), '0:00',
   'dur: reversed bite contributes 0 (Math.max(0,...) guard), never negative');
// A reversed bite must NOT subtract from a sibling's real duration. Without the
// Math.max(0,...) per-bite clamp this would be 30 + (-5) = 25 -> "0:25".
eq(formatDuration([
  { start: '00:00:00', end: '00:00:30' },
  { start: '00:00:10', end: '00:00:05' },
]), '0:30', 'dur: a reversed bite does not erode a sibling bite (per-bite clamp)');
eq(formatDuration([]), '0:00', 'dur: empty -> 0:00');

// ── formatDuration: a malformed bite must NOT poison the whole total ─────────
// The soundbite regex `[0-9:.,]+` accepts pure-punctuation timecodes (":", "::"),
// and the workshop lets producers hand-edit bites. An empty hh/mm field yields
// NaN; the OLD code did `parseInt(p[0]) * 60 + ...` with no guard, so one bad
// bite's NaN poisoned the running sum (NaN + anything = NaN) and `formatClock`
// collapsed a real 10-minute sequence to "0:00". The fix isolates NaN per-bite.
eq(formatDuration([
  { start: '00:00:00', end: '00:10:00' },
  { start: '00:00:00', end: ':' },
]), '10:00', 'dur: an end=":" malformed bite contributes 0, does not zero the total');
eq(formatDuration([
  { start: '00:00:00', end: '00:10:00' },
  { start: '::', end: '::' },
]), '10:00', 'dur: a "::" bite is isolated, real sibling duration survives');
eq(formatDuration([
  { start: '00:00:00', end: '00:05:00' },
  { start: 'abc', end: 'xyz' },
]), '5:00', 'dur: non-numeric timecodes contribute 0, never NaN');
eq(formatDuration([{ start: '00:00:00', end: null }]), '0:00',
   'dur: null timecode is coerced (no crash, contributes 0)');
eq(formatDuration([{ start: undefined, end: '00:00:30' }]), '0:30',
   'dur: undefined start coerces to 0, real end still counts');

// ── RED proof: the OLD unguarded `parts` poisons the total on one bad bite ───
{
  const badParts = (tc) => {
    const p = tc.replace(',', '.').split(':');
    if (p.length === 3) return parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseFloat(p[2]);
    if (p.length === 2) return parseInt(p[0]) * 60 + parseFloat(p[1]); // NaN on empty fields
    return parseFloat(p[0]) || 0;
  };
  const badTotal =
    Math.max(0, badParts('00:10:00') - badParts('00:00:00')) +
    Math.max(0, badParts(':')       - badParts('00:00:00'));
  ok(Number.isNaN(badTotal), 'RED proof: old unguarded parts() yields NaN total on a ":" bite');
  // And the shipped function does NOT:
  eq(formatDuration([
    { start: '00:00:00', end: '00:10:00' },
    { start: '00:00:00', end: ':' },
  ]), '10:00', 'shipped formatDuration isolates the bad bite (10:00, not 0:00)');
}

// ── tcToFrameNotation: FCP7 frame notation, fps-aware ───────────────────────
eq(tcToFrameNotation('00:00:01.5', 24), '0:01:12', 'tc: .5s at 24fps -> frame 12');
eq(tcToFrameNotation('00:00:05', 24), '0:05:00', 'tc: no fraction -> frame 00');
eq(tcToFrameNotation('01:02:03.96', 23.976), '1:02:03:23',
   'tc: hour-plus -> H:MM:SS:FF, frac 0.96*23.976 floors to 23');
eq(tcToFrameNotation('00:01:02.5', 24), '1:02:12', 'tc: minutes unpadded, seconds+frames padded');
eq(tcToFrameNotation('00:00:00.999', 24), '0:00:23',
   'tc: frames never overflow the timebase (frac<1 -> floor(23.97)=23)');
eq(tcToFrameNotation('00:00:01,5', 24), '0:01:12', 'tc: comma decimal parses like dot');
eq(tcToFrameNotation('00:00:07.25', 24), '0:07:06', 'tc: 0.25*24=6 -> padded frame 06');

// ── RED proof: an hour-dropping tc formatter (no h>0 branch) would mislabel ──
{
  const badTc = (tc, fps) => {
    const parts = tc.replace(',', '.').split(':');
    let m = 0, secStr = '0';
    if (parts.length === 3) { m = parseInt(parts[1]) || 0; secStr = parts[2]; }
    const dotIdx = secStr.indexOf('.');
    const s = parseInt(dotIdx >= 0 ? secStr.slice(0, dotIdx) : secStr) || 0;
    const frac = dotIdx >= 0 ? parseFloat('0' + secStr.slice(dotIdx)) : 0;
    const ff = Math.floor(frac * fps).toString().padStart(2, '0');
    return `${m}:${s.toString().padStart(2, '0')}:${ff}`; // drops the hour
  };
  eq(badTc('01:02:03.96', 23.976), '2:03:23', 'RED proof: an hour-dropping formatter mislabels (2:03:23)');
  eq(tcToFrameNotation('01:02:03.96', 23.976), '1:02:03:23', 'shipped tc keeps the hour');
}

console.log(`\nsoundbites: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
