// Tests for buildBlockSummary — the recent-blocks context Wordy sees in QSS
// Freestyle mode. The labels must be each block's 1-based position in the full
// story. The shipped formula (`blocks.length - 2 + i`) only happened to be
// 1-based for stories of 3+ blocks; at a story's opening (1-2 committed
// blocks) it emitted `[0]` and even `[-1]`, feeding Wordy nonsense block
// numbers. This pins the correct numbering for every length.
//
// Run: node api/qss-freestyle.test.mjs   (or via `bun run test`)

import { buildBlockSummary } from './qss-freestyle.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  if (actual === expected) { pass++; return; }
  fail++; fails.push(`${msg}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// The OLD shipped formula, kept here to prove the test actually catches the bug.
function oldBuildBlockSummary(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  return list.slice(-3).map((b, i) => `[${list.length - 2 + i}] ${(b?.text || '').trim().slice(0, 320)}`).join('\n\n');
}
// Pull the leading [N] label off each rendered line.
const labels = (s) => s.split('\n\n').map(line => {
  const m = line.match(/^\[(-?\d+)\]/);
  return m ? Number(m[1]) : NaN;
});

const blk = (t) => ({ id: 'x', text: t });

// ── RED proof (non-simulated): the bug bites real story openings ──────────────
// A brand-new story with 1 or 2 committed blocks is the common opening case.
{
  const one = [blk('Once upon a time')];
  ok(labels(oldBuildBlockSummary(one))[0] === -1, 'RED: old code labels a lone block [-1]');
  eq(labels(buildBlockSummary(one))[0], 1, 'FIX: lone block is [1], never [-1]');

  const two = [blk('A'), blk('B')];
  const oldTwo = labels(oldBuildBlockSummary(two));
  ok(oldTwo[0] === 0 && oldTwo[1] === 1, 'RED: old code labels two blocks [0],[1]');
  eq(labels(buildBlockSummary(two)).join(','), '1,2', 'FIX: two blocks are [1],[2]');
}

// ── Regression locks: behavior on 3+ blocks must be unchanged (already 1-based) ─
{
  const ten = Array.from({ length: 10 }, (_, i) => blk(`block ${i + 1}`));
  eq(labels(buildBlockSummary(ten)).join(','), '8,9,10', 'last 3 of 10 → [8],[9],[10]');
  // old and new agree for length >= 3 (that's why the bug was invisible)
  eq(buildBlockSummary(ten), oldBuildBlockSummary(ten), 'fix is behavior-preserving for 10 blocks');

  const three = [blk('a'), blk('b'), blk('c')];
  eq(labels(buildBlockSummary(three)).join(','), '1,2,3', 'exactly 3 blocks → [1],[2],[3]');
  eq(buildBlockSummary(three), oldBuildBlockSummary(three), 'fix is behavior-preserving for 3 blocks');

  const five = Array.from({ length: 5 }, (_, i) => blk(`b${i}`));
  eq(labels(buildBlockSummary(five)).join(','), '3,4,5', 'last 3 of 5 → [3],[4],[5]');
}

// ── Only the last 3 blocks are shown, regardless of story length ──────────────
{
  const hundred = Array.from({ length: 100 }, (_, i) => blk(`b${i}`));
  const out = buildBlockSummary(hundred);
  eq(out.split('\n\n').length, 3, 'only 3 blocks rendered for a 100-block story');
  eq(labels(out).join(','), '98,99,100', 'last 3 of 100 → [98],[99],[100]');
}

// ── Text handling: trim + 320-char cap preserved ─────────────────────────────
{
  const long = 'z'.repeat(500);
  const out = buildBlockSummary([blk('   ' + long + '   ')]);
  ok(out.startsWith('[1] '), 'label prefix present');
  eq(out, '[1] ' + 'z'.repeat(320), 'body is trimmed then capped at 320 chars');

  eq(buildBlockSummary([blk('  hi  ')]), '[1] hi', 'whitespace trimmed around body');
}

// ── Defensive: missing/empty text and bad shapes never throw ─────────────────
{
  eq(buildBlockSummary([{ id: 'x' }]), '[1] ', 'block with no text → empty body, valid label');
  eq(buildBlockSummary([blk(null)]), '[1] ', 'null text coerced to empty');
  eq(buildBlockSummary([]), '', 'no blocks → empty string');
  eq(buildBlockSummary(null), '', 'null blocks → empty string (no throw)');
  eq(buildBlockSummary(undefined), '', 'undefined blocks → empty string (no throw)');
  eq(buildBlockSummary('not an array'), '', 'non-array → empty string (no throw)');
}

// ── No label is ever non-positive for any length 1..12 ───────────────────────
{
  let allPositive = true;
  for (let len = 1; len <= 12; len++) {
    const blocks = Array.from({ length: len }, (_, i) => blk(`b${i}`));
    for (const n of labels(buildBlockSummary(blocks))) {
      if (!(Number.isInteger(n) && n >= 1)) allPositive = false;
    }
  }
  ok(allPositive, 'every label is a positive 1-based integer for lengths 1..12');
}

console.log(`\nqss-freestyle buildBlockSummary: ${pass} passed, ${fail} failed`);
if (fail) { console.error('\nFAILURES:\n' + fails.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
