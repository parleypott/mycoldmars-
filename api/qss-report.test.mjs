// Regression lock for api/qss-report.js — the parent-facing aggregator that
// turns Henry's qss_observations event log into the storytelling-pattern
// dashboard (character/setting fixation, escalation curve, vibe picks, origin
// mix, per-day timeline). Zero coverage before this; the streak and average
// math is exactly the kind of thing that breaks silently on refactor.
//
// No live bug was found — summarize() is correct. This is verifier-layer
// hardening (same standard as geo-utils / pinglobe / qss-worlds): every
// assertion is mutation-proven below to fail if the corresponding logic
// regresses. Run: bun api/qss-report.test.mjs  (or `bun run test`).

import { summarize, topN } from './qss-report.js';

let passed = 0, failed = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; fails.push(`✗ ${msg}\n    expected: ${e}\n    actual:   ${a}`); }
}
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; fails.push(`✗ ${msg}`); }
}

// Helpers to build observation rows in the real shape.
const block = (sig, created_at = '2026-06-01T10:00:00Z', story_name = 'dragons') =>
  ({ event: 'block_added', signals: sig, created_at, story_name });
const ownBlock = (sig, created_at = '2026-06-01T10:00:00Z', story_name = 'dragons') =>
  ({ event: 'own_block_added', signals: sig, created_at, story_name });

// ── totals & averages ──────────────────────────────────────────────
{
  const rows = [
    block({ characters: ['scarlet'], settings: ['castle'], words: 100, sentences: 8, escalation: 2, origin: 'option' }),
    block({ characters: ['scarlet'], settings: ['castle'], words: 50,  sentences: 4, escalation: 4, origin: 'direction' }),
    ownBlock({ characters: ['kevin'], settings: ['lab'],   words: 30,  sentences: 2, escalation: 0, origin: 'kid' }),
    { event: 'direction_picked', signals: { vibe: 'Spooky' }, created_at: '2026-06-01T11:00:00Z', story_name: 'dragons' },
    { event: 'direction_rejected', signals: { vibe: 'Silly' }, created_at: '2026-06-01T11:05:00Z', story_name: 'dragons' },
    { event: 'option_rejected', payload: { kind: 'twist' }, created_at: '2026-06-01T11:06:00Z', story_name: 'dragons' },
  ];
  const r = summarize(rows);

  eq(r.totals.events, 6, 'totals.events counts every row');
  eq(r.totals.blocks, 3, 'totals.blocks counts block_added + own_block_added only');
  eq(r.totals.direction_picks, 1, 'totals.direction_picks');
  eq(r.totals.direction_rejects, 1, 'totals.direction_rejects');
  eq(r.totals.option_rejects, 1, 'totals.option_rejects');
  eq(r.totals.stories_touched, 1, 'totals.stories_touched (distinct story_name)');

  // words 100+50+30=180 / 3 blocks = 60 (Math.round)
  eq(r.averages.words_per_block, 60, 'averages.words_per_block rounds total/blocks');
  // sentences 8+4+2=14 / 3 = 4.666 → toFixed(1) → 4.7
  eq(r.averages.sentences_per_block, 4.7, 'averages.sentences_per_block toFixed(1)');
  // escalation 2+4+0=6 / 3 = 2.00 → toFixed(2) → 2
  eq(r.averages.escalation_per_block, 2, 'averages.escalation_per_block toFixed(2)');
}

// ── empty input: no divide-by-zero, all zeros ──────────────────────
{
  const r = summarize([]);
  eq(r.totals.events, 0, 'empty: events 0');
  eq(r.totals.blocks, 0, 'empty: blocks 0');
  eq(r.averages.words_per_block, 0, 'empty: words_per_block 0 (no NaN)');
  eq(r.averages.sentences_per_block, 0, 'empty: sentences_per_block 0 (no NaN)');
  eq(r.averages.escalation_per_block, 0, 'empty: escalation_per_block 0 (no NaN)');
  eq(r.fixation.longest_same_character_streak, 0, 'empty: char streak 0');
  eq(r.escalation_curve, [], 'empty: escalation_curve []');
  eq(r.character_frequency, [], 'empty: character_frequency []');
}

// ── character / setting frequency + topN ordering ──────────────────
{
  const rows = [
    block({ characters: ['scarlet', 'kevin'], settings: ['castle'] }),
    block({ characters: ['scarlet'], settings: ['castle'] }),
    block({ characters: ['scarlet'], settings: ['lab'] }),
    block({ characters: ['benny'], settings: ['lab'] }),
  ];
  const r = summarize(rows);
  eq(r.character_frequency, [
    { key: 'scarlet', count: 3 },
    { key: 'kevin', count: 1 },
    { key: 'benny', count: 1 },
  ], 'character_frequency sorted by count desc');
  eq(r.setting_frequency, [
    { key: 'castle', count: 2 },
    { key: 'lab', count: 2 },
  ], 'setting_frequency counts each block');
  eq(r.distinct.characters, 3, 'distinct.characters');
  eq(r.distinct.settings, 2, 'distinct.settings');
}

// topN unit: respects n and sort
eq(topN({ a: 1, b: 5, c: 3 }, 2), [{ key: 'b', count: 5 }, { key: 'c', count: 3 }], 'topN slices to n, sorted desc');
eq(topN({}, 20), [], 'topN of empty object is []');

// ── fixation: longest same-character streak ────────────────────────
{
  // scarlet, scarlet, scarlet, kevin, scarlet  → longest run = 3
  const rows = [
    block({ characters: ['scarlet'] }),
    block({ characters: ['scarlet'] }),
    block({ characters: ['scarlet'] }),
    block({ characters: ['kevin'] }),
    block({ characters: ['scarlet'] }),
  ];
  eq(summarize(rows).fixation.longest_same_character_streak, 3, 'char streak finds the 3-run, not the trailing 1');
}
{
  // A null/empty-character block BREAKS the streak.
  const rows = [
    block({ characters: ['scarlet'] }),
    block({ characters: [] }),          // no main character → break
    block({ characters: ['scarlet'] }),
    block({ characters: ['scarlet'] }),
  ];
  eq(summarize(rows).fixation.longest_same_character_streak, 2, 'empty-character block resets the streak');
}
{
  // Only the FIRST character drives the streak (main = chars[0]).
  const rows = [
    block({ characters: ['scarlet', 'kevin'] }),
    block({ characters: ['kevin', 'scarlet'] }),  // main flips to kevin → break
    block({ characters: ['kevin'] }),
  ];
  eq(summarize(rows).fixation.longest_same_character_streak, 2, 'streak keys on chars[0] only');
}

{
  // Blocks with NO characters at all → streak must stay 0 (a character-less
  // block is not a 1-long fixation run). Guards the `: 0` reset branch.
  const rows = [
    block({ characters: [] }),
    block({ characters: [] }),
    block({ characters: [] }),
  ];
  eq(summarize(rows).fixation.longest_same_character_streak, 0, 'all character-less blocks → streak 0, never 1');
}

// ── fixation: longest same-setting streak ──────────────────────────
{
  const rows = [
    block({ settings: ['lab'] }),
    block({ settings: ['lab'] }),
    block({ settings: ['castle'] }),
    block({ settings: ['castle'] }),
    block({ settings: ['castle'] }),
  ];
  eq(summarize(rows).fixation.longest_same_setting_streak, 3, 'setting streak finds the castle 3-run');
}

// ── escalation curve preserves order + timestamps ──────────────────
{
  const rows = [
    block({ escalation: 1 }, '2026-06-01T10:00:00Z'),
    block({ escalation: 5 }, '2026-06-01T10:05:00Z'),
    block({ escalation: 3 }, '2026-06-01T10:10:00Z'),
  ];
  eq(summarize(rows).escalation_curve, [
    { t: '2026-06-01T10:00:00Z', score: 1 },
    { t: '2026-06-01T10:05:00Z', score: 5 },
    { t: '2026-06-01T10:10:00Z', score: 3 },
  ], 'escalation_curve keeps block order and (t, score)');
}

// ── block origin mix ───────────────────────────────────────────────
{
  const rows = [
    block({ characters: ['x'], origin: 'option' }),
    block({ characters: ['x'], origin: 'direction' }),
    ownBlock({ characters: ['x'], origin: 'kid' }),
    block({ characters: ['x'] }),  // missing origin → defaults to 'option'
  ];
  const r = summarize(rows);
  eq(r.block_origin.option, 2, 'block_origin.option counts option + missing-origin default');
  eq(r.block_origin.direction, 1, 'block_origin.direction');
  eq(r.block_origin.kid, 1, 'block_origin.kid (own_block_added)');
}

// ── vibe pick vs reject frequency (signals.vibe OR payload.vibe) ────
{
  const rows = [
    { event: 'direction_picked', signals: { vibe: 'Spooky' }, created_at: '2026-06-01T10:00:00Z' },
    { event: 'direction_picked', payload: { vibe: 'spooky' }, created_at: '2026-06-01T10:01:00Z' }, // payload fallback, lowercased → merges
    { event: 'direction_picked', signals: { vibe: 'Silly' },  created_at: '2026-06-01T10:02:00Z' },
    { event: 'direction_rejected', signals: { vibe: 'Boring' }, created_at: '2026-06-01T10:03:00Z' },
  ];
  const r = summarize(rows);
  eq(r.vibe_pick_frequency, [
    { key: 'spooky', count: 2 },
    { key: 'silly', count: 1 },
  ], 'vibe_pick_frequency lowercases + merges signals/payload vibe');
  eq(r.vibe_reject_frequency, [{ key: 'boring', count: 1 }], 'vibe_reject_frequency from direction_rejected');
  eq(r.distinct.vibes_picked, 2, 'distinct.vibes_picked');
}

// ── by_day timeline + stories ──────────────────────────────────────
{
  const rows = [
    block({ characters: ['x'] }, '2026-06-01T10:00:00Z', 'dragons'),
    block({ characters: ['x'] }, '2026-06-01T23:00:00Z', 'dragons'),
    block({ characters: ['x'] }, '2026-06-02T08:00:00Z', 'knights'),
    { event: 'direction_picked', created_at: '', story_name: 'knights' }, // no date → skipped in by_day
  ];
  const r = summarize(rows);
  eq(r.by_day, { '2026-06-01': 2, '2026-06-02': 1 }, 'by_day buckets by YYYY-MM-DD, skips dateless rows');
  eq(r.stories, { dragons: 2, knights: 2 }, 'stories counts every row with a story_name');
  eq(r.totals.stories_touched, 2, 'stories_touched = distinct story_name');
}

// ── robustness: missing signals / payload never throw ──────────────
{
  const rows = [
    { event: 'block_added', created_at: '2026-06-01T10:00:00Z' },       // no signals
    { event: 'direction_picked', created_at: '2026-06-01T10:01:00Z' },  // no signals/payload
    { event: 'weird_event', payload: { foo: 1 }, created_at: '2026-06-01T10:02:00Z' },
  ];
  const r = summarize(rows);
  ok(r && r.totals.blocks === 1, 'missing-signals block still counts, no throw');
  eq(r.averages.words_per_block, 0, 'block with no signals contributes 0 words');
  eq(r.character_frequency, [], 'no characters extracted from signal-less block');
}

// ───────────────────────────── report ─────────────────────────────
console.log(`\nqss-report.test.mjs — ${passed} passed, ${failed} failed`);
if (failed) { console.log('\n' + fails.join('\n')); process.exit(1); }
