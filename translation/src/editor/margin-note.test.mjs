// Tests for truncateLabel — the interpreter editor's margin-note preview
// truncator. Imports the REAL shipped function (no drift-prone mirror).
//
// The bug this locks: the old inline form
//   text.slice(0, text.lastIndexOf(' ', 50) || 50) + '…'
// emitted nearly the whole string for a spaceless 50+ char bullet, because
// lastIndexOf returns -1 (no space), -1 is truthy, and slice(0,-1) keeps all
// but the last char. In-range for this tool: Chinese transcripts have no
// spaces. Mutation-proof: revert the `cut <= 0` guard to `cut || max` and the
// spaceless/CJK/leading-space cases go RED.

import { truncateLabel } from './margin-note.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${msg}`); }
}

// ── Inline RED proof: reconstruct the OLD buggy inline form ──────────────────
const oldBuggy = (text) =>
  text.length <= 50 ? text : text.slice(0, text.lastIndexOf(' ', 50) || 50) + '…';

{
  // A spaceless 50+ char string (CJK transcript / URL) — the headline bug.
  const url = 'https://example.com/very/long/path/that/keeps/going/forever/and/ever';
  ok(url.length > 50, 'fixture: url is over 50 chars');
  // OLD: leaks nearly the whole string (slice(0,-1) + '…').
  ok(oldBuggy(url).length >= url.length, 'RED PROOF: old form leaks ~whole string for spaceless input');
  // NEW: a real teaser, hard-cut at 50.
  eq(truncateLabel(url, 50), url.slice(0, 50) + '…', 'spaceless input hard-cuts at max (the fix)');
  ok(truncateLabel(url, 50).length === 51, 'spaceless teaser is max+1 (50 chars + ellipsis)');
}

{
  // Spaceless CJK — Mandarin/Cantonese transcript bullet, no spaces at all.
  const cjk = '他说我们必须在天黑之前到达边境否则巡逻队会发现我们然后一切都完了这是唯一的机会现在就走不要回头看也不要说话保持安静直到我们安全为止';
  ok(cjk.length > 50, 'fixture: cjk is over 50 chars');
  ok(oldBuggy(cjk).length >= cjk.length, 'RED PROOF: old form leaks whole CJK bullet into margin');
  eq(truncateLabel(cjk, 50), cjk.slice(0, 50) + '…', 'CJK hard-cuts at max');
}

// ── Word-boundary behaviour (preserved from the original, non-buggy path) ────
{
  // A space exists within the first `max` chars → break on the last one.
  const t = 'the quick brown fox jumps over the lazy dog and then some more words here';
  const lastSpace = t.lastIndexOf(' ', 50);
  ok(lastSpace > 0, 'fixture: text has a space within first 50 chars');
  eq(truncateLabel(t, 50), t.slice(0, lastSpace) + '…', 'breaks on last word boundary at/before max');
  // Behaviour-preserving lock: matches the OLD form on this (correct) path.
  eq(truncateLabel(t, 50), oldBuggy(t), 'matches old form when a real space exists in range');
  ok(!truncateLabel(t, 50).endsWith(' …'), 'no trailing space before ellipsis on word break');
}

// ── Under/at the limit: returned verbatim, no ellipsis ───────────────────────
eq(truncateLabel('short note', 50), 'short note', 'under max returned as-is');
eq(truncateLabel('', 50), '', 'empty string stays empty');
{
  const exactly50 = 'a'.repeat(50);
  eq(truncateLabel(exactly50, 50), exactly50, 'exactly max returned as-is (no ellipsis)');
}
{
  const fiftyOne = 'a'.repeat(51);
  eq(truncateLabel(fiftyOne, 50), 'a'.repeat(50) + '…', 'one over max hard-cuts at max');
}

// ── Leading-space edge: index-0 space is falsy → must hard-cut, not slice(0,0) ─
{
  const lead = ' ' + 'x'.repeat(60); // only space is at index 0
  eq(truncateLabel(lead, 50), lead.slice(0, 50) + '…', 'leading-space-only input hard-cuts at max');
  ok(truncateLabel(lead, 50).length === 51, 'leading-space teaser is max+1, not a lone ellipsis');
  // Behaviour-preserving: the OLD form also hard-cut here (0 is falsy → max).
  eq(truncateLabel(lead, 50), oldBuggy(lead), 'matches old form on the falsy-0 leading-space path');
}

// ── Custom max ───────────────────────────────────────────────────────────────
eq(truncateLabel('one two three four five', 8), 'one two…', 'custom max breaks on word boundary');
eq(truncateLabel('abcdefghij', 4), 'abcd…', 'custom max hard-cuts spaceless input');

// ── Defensive: non-string inputs degrade to '' (never throw) ─────────────────
eq(truncateLabel(null, 50), '', 'null → empty, no throw');
eq(truncateLabel(undefined, 50), '', 'undefined → empty, no throw');
eq(truncateLabel(12345, 50), '', 'number → empty, no throw');
eq(truncateLabel({}, 50), '', 'object → empty, no throw');

// ── Default max is 50 ────────────────────────────────────────────────────────
eq(truncateLabel('z'.repeat(60)), 'z'.repeat(50) + '…', 'default max is 50');

console.log(`\nmargin-note: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + fails.join('\n')); process.exit(1); }
