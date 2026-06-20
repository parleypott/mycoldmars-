// Tests for translation/src/summary-bullets.js — the producer-facing summary→segment
// linker. Imports the REAL shipped parseSummaryBullets (no mirror, can't drift).
//
// Headline: a section header with NO segment range used to inherit the PREVIOUS section's
// range, mis-linking that section's bullets to the wrong transcript segments. Fixed to
// reset the running range on a rangeless header.

import { parseSummaryBullets } from './summary-bullets.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`FAIL: ${msg}\n   expected ${e}\n   got      ${a}`); }
}
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; fails.push(`FAIL: ${msg}`); }
}

// ---- inline RED proof: reconstruct the OLD (pre-fix) logic and show it bleeds the range
function oldParse(rawText) {
  if (!rawText) return [];
  const lines = rawText.split('\n');
  const bullets = [];
  let id = 0;
  let sectionSegStart = null, sectionSegEnd = null, sectionTitle = null;
  for (const line of lines) {
    const isHeader = line.startsWith('**') || line.startsWith('## ') || line.startsWith('# ');
    if (isHeader) {
      sectionTitle = line.replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*$/, '$1').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
      const m = line.match(/(?:\(Segments?\s+(\d+)(?:\s*[-–]\s*(\d+))?\)|\[(\d+)(?:\s*[-–]\s*(\d+))?\])/i);
      if (m) { sectionSegStart = parseInt(m[1] || m[3]); sectionSegEnd = parseInt(m[2] || m[4] || m[1] || m[3]); }
      // NOTE: the bug — no reset when a header has no range.
      continue;
    }
    const bm = line.match(/^(?:[-•]|\d+\.)\s+(.+)/);
    if (!bm) continue;
    const text = bm[1];
    const bs = text.match(/(?:\(Segments?\s+(\d+)(?:\s*[-–]\s*(\d+))?\)|\[(\d+)(?:\s*[-–]\s*(\d+))?\])/i);
    let s, e;
    if (bs) { s = parseInt(bs[1] || bs[3]); e = parseInt(bs[2] || bs[4] || bs[1] || bs[3]); }
    else { s = sectionSegStart; e = sectionSegEnd; }
    bullets.push({ id: id++, rawText: text, segmentStart: s, segmentEnd: e });
  }
  return bullets;
}

const bleedDoc = `**Intro (Segments 1-5)**
- The setup happens here
**Key Themes**
- A thematic reflection with no segment range`;

// RED proof: the OLD logic wrongly inherits 1-5 onto the rangeless "Key Themes" section.
const oldOut = oldParse(bleedDoc);
ok(oldOut[1].segmentStart === 1 && oldOut[1].segmentEnd === 5,
  'RED proof: old logic bleeds prev range onto rangeless section (precondition for the bug)');

// ---- THE FIX: rangeless section gets null range, not the previous section's
{
  const out = parseSummaryBullets(bleedDoc);
  eq([out[0].segmentStart, out[0].segmentEnd], [1, 5], 'ranged section keeps its own range');
  eq([out[1].segmentStart, out[1].segmentEnd], [null, null], 'FIX: rangeless section gets null, not inherited 1-5');
  ok(out[1].sectionTitle === 'Key Themes', 'rangeless section title parsed');
}

// ---- multiple sections: each rangeless one resets; ranged ones set their own
{
  const md = `**A (Segments 1-3)**
- alpha
**B**
- bravo
**C (Segments 10-12)**
- charlie
**D**
- delta`;
  const out = parseSummaryBullets(md);
  eq([out[0].segmentStart, out[0].segmentEnd], [1, 3], 'A range');
  eq([out[1].segmentStart, out[1].segmentEnd], [null, null], 'B resets (rangeless after ranged A)');
  eq([out[2].segmentStart, out[2].segmentEnd], [10, 12], 'C range');
  eq([out[3].segmentStart, out[3].segmentEnd], [null, null], 'D resets (rangeless after ranged C)');
}

// ---- per-bullet ref always wins, even under a ranged section
{
  const md = `**Intro (Segments 1-5)**
- inherits the section [say 2-4]? no, explicit ref (Segments 2-3)
- inherits the section range`;
  const out = parseSummaryBullets(md);
  eq([out[0].segmentStart, out[0].segmentEnd], [2, 3], 'per-bullet (Segments 2-3) wins over section');
  eq([out[1].segmentStart, out[1].segmentEnd], [1, 5], 'bullet with no ref inherits section range');
}

// ---- per-bullet [X-Y] bracket form + single-segment forms
{
  const md = `**S**
- bracket range [7-9]
- single segment (Segment 4)
- single bracket [11]`;
  const out = parseSummaryBullets(md);
  eq([out[0].segmentStart, out[0].segmentEnd], [7, 9], '[7-9] bracket range');
  eq([out[1].segmentStart, out[1].segmentEnd], [4, 4], '(Segment 4) single → start==end');
  eq([out[2].segmentStart, out[2].segmentEnd], [11, 11], '[11] single bracket → start==end');
}

// ---- header forms: **bold**, ## heading, # heading
{
  const md = `## Heading Section (Segments 20-25)
- under an h2
# Big Section
- under an h1 (rangeless → null)`;
  const out = parseSummaryBullets(md);
  eq([out[0].segmentStart, out[0].segmentEnd], [20, 25], 'h2 header with range');
  ok(out[0].sectionTitle === 'Heading Section (Segments 20-25)', 'h2 title strips ## prefix');
  eq([out[1].segmentStart, out[1].segmentEnd], [null, null], 'h1 rangeless resets');
  ok(out[1].sectionTitle === 'Big Section', 'h1 title strips # prefix');
}

// ---- bullet markers: "- ", "• ", "N. "
{
  const md = `**S (Segments 1-2)**
- dash bullet
• dot bullet
1. numbered bullet
2. another numbered`;
  const out = parseSummaryBullets(md);
  eq(out.map(b => b.rawText), ['dash bullet', 'dot bullet', 'numbered bullet', 'another numbered'], 'all three bullet markers parsed');
  ok(out.every(b => b.segmentStart === 1 && b.segmentEnd === 2), 'all inherit section range');
}

// ---- en-dash range in a section header (codebase uses [-–] for numeric ranges)
{
  const out = parseSummaryBullets(`**Section (Segments 15–18)**\n- body`); // U+2013 en-dash
  eq([out[0].segmentStart, out[0].segmentEnd], [15, 18], 'en-dash range parsed');
}

// ---- bullet text + shape: enrichedText '' default, id increments, rawText preserved
{
  const out = parseSummaryBullets(`**S**\n- first\n- second`);
  ok(out.length === 2, 'two bullets');
  eq([out[0].id, out[1].id], [0, 1], 'ids increment from 0');
  ok(out[0].enrichedText === '' && out[1].enrichedText === '', 'enrichedText defaults to empty string');
}

// ---- non-bullet prose lines between bullets are ignored
{
  const md = `**S (Segments 1-9)**
- a bullet
This is a plain prose line, not a bullet.
- another bullet`;
  const out = parseSummaryBullets(md);
  ok(out.length === 2, 'prose line ignored, only bullets kept');
  eq(out.map(b => b.rawText), ['a bullet', 'another bullet'], 'right two bullets');
}

// ---- bullets BEFORE any header inherit nothing (null range), no crash
{
  const out = parseSummaryBullets(`- orphan bullet before any header`);
  eq([out[0].segmentStart, out[0].segmentEnd], [null, null], 'pre-header bullet → null range');
  ok(out[0].sectionTitle === null, 'pre-header bullet → null title');
}

// ---- edge inputs: empty / null / whitespace / no bullets
{
  eq(parseSummaryBullets(''), [], 'empty string → []');
  eq(parseSummaryBullets(null), [], 'null → []');
  eq(parseSummaryBullets(undefined), [], 'undefined → []');
  eq(parseSummaryBullets('just some prose\nwith no bullets'), [], 'no bullets → []');
  eq(parseSummaryBullets('**Header only (Segments 1-3)**'), [], 'header only, no bullets → []');
}

// ---- summary
console.log(`\nsummary-bullets: ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join('\n')); process.exit(1); }
