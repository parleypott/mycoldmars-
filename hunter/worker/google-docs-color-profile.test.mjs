// Locks buildColorProfile — the LIVE, previously-untested core inside
// parseDocStructured (hunter/worker/google-docs-parser.js) that runs on every
// Google-Doc ingest into The Hunter corpus. It scans every run of every element
// (paragraph, heading, and both voice/visual halves of a beat), and for each
// HIGHLIGHTED run rolls it up into a color profile: { count, totalChars,
// sampleTexts } per color. That profile is what teaches the copilot "colors mean
// something in JH's scripts" (purple = wide shot, red = archive needed, …).
//
// Three load-bearing behaviors that a refactor could silently break, each pinned
// below with a mutation-proving assertion:
//
//  1. NEAR-COLOR MERGE. Runs whose highlight is within RGB distance 30 of an
//     already-seen color are folded into that first-seen key (Docs re-emits the
//     "same" swatch with tiny jitter). Kill the merge and #9900F5 splits off as
//     its own key: keys.length flips 2 → 3 and the purple count drops 3 → 2.
//  2. BEAT HALVES COUNTED. A beat's highlights live under el.voice.runs /
//     el.visual.runs, NOT el.runs. Drop those two branches and every
//     script-table highlight (the bulk of a real doc) vanishes from the profile.
//  3. SAMPLE GATE. Only trimmed samples >10 chars are kept, capped at 5 — so the
//     copilot trains on meaningful phrases, not "short". Un-highlighted runs are
//     ignored entirely.
//
// Imports the REAL shipped function (no mirror) so the lock can't drift.

import { buildColorProfile } from './google-docs-parser.js';

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) { if (cond) passed++; else { failed++; fails.push(name); } }
function eq(name, a, b) {
  ok(name, a === b);
  if (a !== b && fails[fails.length - 1] === name) fails[fails.length - 1] = `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`;
}

// #9900FF (purple) seen exactly twice, plus #9900F5 which is distance 10 away
// (< 30) so it MERGES into #9900FF. #FF0000 (red) seen on a beat's visual half
// and on a heading. One un-highlighted run must be ignored.
const PURPLE_LINE = 'this is a purple line here';        // len 26, >10 → sampled
const SHORT = 'short';                                   // len  5, ≤10 → NOT sampled but still counted
const PLAIN = 'plain unhighlighted line';                // no highlight → ignored entirely
const AERIAL = 'wide aerial of the highway at dawn';     // len 34, merged-purple, >10 → sampled
const ARCHIVE = 'archive clip needed here now';          // len 28, red
const HEADING = 'ACT THREE HEADING TEXT';                // len 22, red

const elements = [
  { type: 'paragraph', text: 'x', runs: [
    { text: PURPLE_LINE, style: { highlight: '#9900FF' } },
    { text: SHORT,       style: { highlight: '#9900FF' } },
    { text: PLAIN,       style: { bold: true } },
  ] },
  { type: 'beat',
    voice:  { runs: [ { text: AERIAL,  style: { highlight: '#9900F5' } } ] },   // near-neighbor → merges to #9900FF
    visual: { runs: [ { text: ARCHIVE, style: { highlight: '#FF0000' } } ] },
  },
  { type: 'section_break' },                                                     // no runs → must not crash / add keys
  { type: 'heading', text: 'ACT THREE', runs: [
    { text: HEADING, style: { highlight: '#FF0000' } },
  ] },
];

const cp = buildColorProfile(elements);
const keys = Object.keys(cp);

// ── (1) merge: exactly two canonical colors, the neighbor folded into the first-seen key ──
eq('two canonical colors after merge (kill merge → 3)', keys.length, 2);
ok('first-seen purple key is the canonical one', Object.prototype.hasOwnProperty.call(cp, '#9900FF'));
ok('near-neighbor #9900F5 did NOT become its own key', !Object.prototype.hasOwnProperty.call(cp, '#9900F5'));

// ── (2) beat voice/visual halves counted (drop those branches → purple 3→2, red 2→1) ──
eq('purple count = 2 exact + 1 merged neighbor', cp['#9900FF'].count, 3);
eq('red count = beat-visual + heading', cp['#FF0000'].count, 2);

// ── totalChars sums the raw run text lengths of the merged cluster ──
eq('purple totalChars = 26 + 5 + 34', cp['#9900FF'].totalChars, PURPLE_LINE.length + SHORT.length + AERIAL.length);
eq('red totalChars = 28 + 22', cp['#FF0000'].totalChars, ARCHIVE.length + HEADING.length);

// ── (3) sample gate: >10 chars only, un-highlighted run ignored ──
eq('purple keeps only the two >10-char samples', cp['#9900FF'].sampleTexts.length, 2);
ok('short (≤10) is NOT sampled', !cp['#9900FF'].sampleTexts.includes(SHORT));
ok('purple sample includes the merged-neighbor text', cp['#9900FF'].sampleTexts.includes(AERIAL));
ok('plain un-highlighted run never appears anywhere', !JSON.stringify(cp).includes(PLAIN));

// ── section_break with no runs is a no-op (empty-profile / crash guard) ──
{
  const emptyCp = buildColorProfile([{ type: 'section_break' }, { type: 'paragraph', text: 'no runs here', runs: [] }]);
  eq('runless elements yield an empty profile, no crash', Object.keys(emptyCp).length, 0);
}

// ── sample cap: never more than 5 stored even with many highlighted runs ──
{
  const many = { type: 'paragraph', text: 'x', runs: [] };
  for (let i = 0; i < 9; i++) many.runs.push({ text: `sample phrase number ${i} here`, style: { highlight: '#00AA00' } });
  const capped = buildColorProfile([many]);
  eq('count reflects all 9 highlighted runs', capped['#00AA00'].count, 9);
  eq('sampleTexts capped at 5', capped['#00AA00'].sampleTexts.length, 5);
}

console.log(`google-docs-color-profile: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
