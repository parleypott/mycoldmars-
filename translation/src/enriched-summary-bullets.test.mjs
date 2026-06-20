// Tests for parseEnrichedSummaryBullets — the "enriched" summary-bullet path
// (pre-existing transcripts with no raw summary). Focus: a rangeless section header
// must RESET the running segment range so its bullets don't inherit the PREVIOUS
// section's range. Same bug class as summary-bullets.js (fixed in parseSummaryBullets).

import { parseEnrichedSummaryBullets } from './enriched-summary-bullets.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`${msg}\n    expected: ${e}\n    actual:   ${a}`); }
}
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// A realistic reverse map: short timecode -> segment number.
const TC2SEG = { '0:00': 1, '0:38': 1, '6:00': 5, '6:01': 6, '10:00': 12, '1:05:30': 40 };

// ---- inline RED proof: reconstruct the OLD (buggy) logic that never reset on a
// rangeless header, and show it inherits the previous section's range. ----
function oldBuggyParse(enrichedText, tcToSeg = {}) {
  if (!enrichedText) return [];
  const lines = enrichedText.split('\n');
  const bullets = [];
  let id = 0, sectionSegStart = null, sectionSegEnd = null, sectionTitle = null;
  for (const line of lines) {
    const isHeader = line.startsWith('**') || line.startsWith('## ') || line.startsWith('# ');
    if (isHeader) {
      sectionTitle = line.replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*$/, '$1').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
      const tcMatch = line.match(/\((\d+:\d+(?::\d+)?)\s*[–—-]\s*(\d+:\d+(?::\d+)?)\)/);
      if (tcMatch) {
        sectionSegStart = tcToSeg[tcMatch[1]] || null;
        sectionSegEnd = tcToSeg[tcMatch[2]] || null;
      } else {
        const singleTcMatch = line.match(/\((\d+:\d+(?::\d+)?)\)/);
        if (singleTcMatch) {
          sectionSegStart = tcToSeg[singleTcMatch[1]] || null;
          sectionSegEnd = sectionSegStart;
        }
        // NOTE: no else — the bug. Rangeless header keeps prior range.
      }
      continue;
    }
    const bulletMatch = line.match(/^(?:[-•]|\d+\.)\s+(.+)/);
    if (!bulletMatch) continue;
    const text = bulletMatch[1];
    let segStart = sectionSegStart, segEnd = sectionSegEnd;
    const bulletTcMatch = text.match(/\((\d+:\d+(?::\d+)?)\s*[–—-]\s*(\d+:\d+(?::\d+)?)\)/);
    if (bulletTcMatch) {
      segStart = tcToSeg[bulletTcMatch[1]] || segStart;
      segEnd = tcToSeg[bulletTcMatch[2]] || segEnd;
    } else {
      const bracketMatch = text.match(/\[(\d+)(?:\s*[-–]\s*(\d+))?\]/);
      if (bracketMatch) { segStart = parseInt(bracketMatch[1]); segEnd = bracketMatch[2] ? parseInt(bracketMatch[2]) : segStart; }
    }
    bullets.push({ id: id++, rawText: text, segmentStart: segStart, segmentEnd: segEnd });
  }
  return bullets;
}

const BUG_DOC = [
  '**Intro (0:00 – 6:00)**',
  '- Opening remarks',
  '**Key Themes**',          // rangeless header
  '- A recurring idea',
  '- Another point',
].join('\n');

// RED proof: the old logic mis-links the rangeless "Key Themes" bullets to Intro 1-5.
const oldOut = oldBuggyParse(BUG_DOC, TC2SEG);
ok(oldOut[1].segmentStart === 1 && oldOut[1].segmentEnd === 5,
   'RED-PROOF: old logic inherits Intro range (1-5) on rangeless Key Themes bullet');
ok(oldOut[2].segmentStart === 1 && oldOut[2].segmentEnd === 5,
   'RED-PROOF: old logic inherits Intro range on 2nd rangeless bullet too');

// GREEN: the fixed parser resets to null on the rangeless header.
const fixedOut = parseEnrichedSummaryBullets(BUG_DOC, TC2SEG);
eq(fixedOut[0].segmentStart, 1, 'fix: Intro bullet keeps its declared range start');
eq(fixedOut[0].segmentEnd, 5, 'fix: Intro bullet keeps its declared range end');
eq(fixedOut[1].segmentStart, null, 'fix: rangeless Key Themes bullet -> null start (no inherit)');
eq(fixedOut[1].segmentEnd, null, 'fix: rangeless Key Themes bullet -> null end (no inherit)');
eq(fixedOut[2].segmentStart, null, 'fix: 2nd rangeless bullet -> null start');
eq(fixedOut[2].segmentEnd, null, 'fix: 2nd rangeless bullet -> null end');

// ---- per-bullet ref still wins over (reset) section range ----
const PERBULLET = [
  '**Intro (0:00 – 6:00)**',
  '**Closing**',                 // rangeless: section resets to null
  '- Final thought [10-12]',     // bracket ref wins
  '- A wrapped note (6:01 – 10:00)', // tc ref wins
  '- No ref here',               // stays null (reset), does NOT inherit Intro
].join('\n');
const pb = parseEnrichedSummaryBullets(PERBULLET, TC2SEG);
eq([pb[0].segmentStart, pb[0].segmentEnd], [10, 12], 'per-bullet [10-12] bracket ref wins');
eq([pb[1].segmentStart, pb[1].segmentEnd], [6, 12], 'per-bullet (6:01 – 10:00) tc ref wins');
eq([pb[2].segmentStart, pb[2].segmentEnd], [null, null], 'rangeless bullet with no ref stays null');

// ---- a section that DECLARES a range still works (no over-reset) ----
const TWO_RANGED = [
  '**Intro (0:00 – 6:00)**',
  '- a',
  '**Themes (6:01 – 10:00)**',
  '- b',
].join('\n');
const tr = parseEnrichedSummaryBullets(TWO_RANGED, TC2SEG);
eq([tr[0].segmentStart, tr[0].segmentEnd], [1, 5], 'first ranged section bullet -> 1-5');
eq([tr[1].segmentStart, tr[1].segmentEnd], [6, 12], 'second ranged section bullet -> 6-12 (not 1-5)');

// ---- single-timecode header form ----
const SINGLE = ['**Moment (0:38)**', '- x'].join('\n');
const sg = parseEnrichedSummaryBullets(SINGLE, TC2SEG);
eq([sg[0].segmentStart, sg[0].segmentEnd], [1, 1], 'single-tc header -> start==end');
// followed by a rangeless header -> resets
const SINGLE_THEN_BARE = ['**Moment (0:38)**', '**Bare**', '- y'].join('\n');
const stb = parseEnrichedSummaryBullets(SINGLE_THEN_BARE, TC2SEG);
eq([stb[0].segmentStart, stb[0].segmentEnd], [null, null], 'rangeless header after single-tc resets to null');

// ---- header forms: ##, #, ** all reset on no range ----
for (const hdr of ['## Key Themes', '# Key Themes', '**Key Themes**']) {
  const doc = ['**Intro (0:00 – 6:00)**', '- a', hdr, '- b'].join('\n');
  const out = parseEnrichedSummaryBullets(doc, TC2SEG);
  eq([out[1].segmentStart, out[1].segmentEnd], [null, null], `rangeless "${hdr}" resets range`);
}

// ---- bullet markers: -, •, and numbered ----
const MARKERS = ['**Sec (0:00 – 6:00)**', '- dash', '• bullet', '1. numbered'].join('\n');
const mk = parseEnrichedSummaryBullets(MARKERS, TC2SEG);
eq(mk.length, 3, 'all three bullet markers parsed');
eq(mk.map(b => b.segmentStart), [1, 1, 1], 'all three bullets inherit declared section range');

// ---- en-dash range form ----
const ENDASH = ['**Sec (0:00–6:00)**', '- a'].join('\n');  // no spaces around dash
const ed = parseEnrichedSummaryBullets(ENDASH, TC2SEG);
eq([ed[0].segmentStart, ed[0].segmentEnd], [1, 5], 'en-dash range without spaces parses');

// ---- title is captured + stripped of markdown ----
eq(fixedOut[1].sectionTitle, 'Key Themes', 'section title stripped of ** markers');

// ---- bullets before any header -> null range (no crash) ----
const ORPHAN = ['- orphan bullet', '**Sec (0:00 – 6:00)**', '- b'].join('\n');
const orp = parseEnrichedSummaryBullets(ORPHAN, TC2SEG);
eq([orp[0].segmentStart, orp[0].segmentEnd], [null, null], 'pre-header orphan bullet -> null');
eq([orp[1].segmentStart, orp[1].segmentEnd], [1, 5], 'bullet after header gets range');

// ---- unmatched tc in map -> null (|| null) ----
const UNKNOWN_TC = ['**Sec (9:99 – 8:88)**', '- a'].join('\n');
const ut = parseEnrichedSummaryBullets(UNKNOWN_TC, TC2SEG);
eq([ut[0].segmentStart, ut[0].segmentEnd], [null, null], 'unknown timecodes -> null range');

// ---- prose lines (non-bullet) skipped ----
const PROSE = ['**Sec (0:00 – 6:00)**', 'This is prose, not a bullet.', '- real bullet'].join('\n');
const pr = parseEnrichedSummaryBullets(PROSE, TC2SEG);
eq(pr.length, 1, 'prose line skipped, only the bullet kept');

// ---- empty / null / undefined / no bullets ----
eq(parseEnrichedSummaryBullets('', TC2SEG), [], 'empty string -> []');
eq(parseEnrichedSummaryBullets(null, TC2SEG), [], 'null -> []');
eq(parseEnrichedSummaryBullets(undefined, TC2SEG), [], 'undefined -> []');
eq(parseEnrichedSummaryBullets('just text no bullets', TC2SEG), [], 'no bullets -> []');
// missing tcToSeg arg defaults to {} (no crash)
eq(parseEnrichedSummaryBullets('**Sec (0:00 – 6:00)**\n- a').length, 1, 'missing tcToSeg arg -> defaults, no crash');

console.log(`enriched-summary-bullets: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\nFAILURES:\n' + fails.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
