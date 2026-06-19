// Lock + bug fix for extractChapters in api/nano-banana.js — the QSS Scribe
// chapter parser. It pulls ```chapter title="…"``` fenced blocks out of Wordy's
// (Gemini's) reply into structured { title, body } chapters, strips them from
// the prose shown to Henry, and gracefully handles a TRUNCATED trailing block
// (maxOutputTokens cut-off) by emitting a placeholder + a "(output truncated)"
// note. It is Henry-facing, runs on every Scribe turn, and had ZERO coverage.
//
// REAL BUG fixed here: an EMPTY-BODY closed fence (```chapter title="X"\n\n```)
// was NOT consumed (the consume only ran when body was non-empty), so the stray
// fence survived into cleanReply and was then matched by the open-ended
// (truncation) regex — spawning a GARBAGE chapter whose body was the leftover
// closing fence "```". The fix always consumes a matched closed fence (it is
// structured markup, never prose); only a non-empty body yields a chapter. The
// inline RED proof below reconstructs the OLD logic and asserts it leaks the
// garbage chapter.
//
// Run: bun api/nano-banana-chapters.test.mjs   (or `bun run test`)

import { extractChapters } from './nano-banana.js';

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

const NOTE = '_(output truncated — last chapter may be incomplete)_';
const UNTITLED = '(untitled — output may be truncated)';

// ── THE FIX: an empty-body closed fence must NOT spawn a garbage chapter ──────
{
  const reply = '```chapter title="Ghost"\n\n```';
  const { chapters, cleanReply } = extractChapters(reply);
  eq(chapters, [], 'empty-body closed fence yields no chapter');
  eq(cleanReply, '', 'empty-body fence is stripped from the prose');

  // Inline RED proof: reconstruct the OLD logic (consume only when body present)
  // and show it leaks a garbage chapter whose body is the leftover fence.
  const oldExtract = (r) => {
    const closedRe = /```chapter(?:\s+title\s*=\s*"([^"]*)")?\s*\n([\s\S]*?)\n```/gi;
    const chs = []; let clean = r; const consumed = []; let m;
    while ((m = closedRe.exec(r)) !== null) {
      const title = (m[1] || '').trim(); const body = (m[2] || '').trim();
      if (body) { chs.push({ title, body }); consumed.push([m.index, m.index + m[0].length]); }
    }
    for (const [s, e] of consumed.reverse()) clean = clean.slice(0, s) + clean.slice(e);
    const openRe = /```chapter(?:\s+title\s*=\s*"([^"]*)")?\s*\n([\s\S]+)$/i;
    const open = openRe.exec(clean);
    if (open) {
      const body = (open[2] || '').trim();
      if (body) chs.push({ title: (open[1] || '').trim() || UNTITLED, body });
    }
    return chs;
  };
  const old = oldExtract(reply);
  ok(old.length === 1 && old[0].body === '```',
    'RED proof: old logic leaks a garbage chapter with body "```"');
}

// ── Closed chapter, with title ───────────────────────────────────────────────
{
  const { chapters, cleanReply } = extractChapters('```chapter title="The Dragon"\nOnce upon a time.\n```');
  eq(chapters, [{ title: 'The Dragon', body: 'Once upon a time.' }], 'single closed chapter parsed');
  eq(cleanReply, '', 'fully-consumed reply leaves empty cleanReply');
}

// ── Closed chapter, no title ─────────────────────────────────────────────────
{
  const { chapters } = extractChapters('```chapter\nBody here.\n```');
  eq(chapters, [{ title: '', body: 'Body here.' }], 'titleless closed chapter → empty title');
}

// ── Surrounding prose is preserved + collapsed ───────────────────────────────
{
  const { chapters, cleanReply } = extractChapters(
    'Here you go:\n\n```chapter title="One"\nBody one.\n```\n\nHope that helps!'
  );
  eq(chapters, [{ title: 'One', body: 'Body one.' }], 'chapter extracted from surrounding prose');
  eq(cleanReply, 'Here you go:\n\nHope that helps!', 'prose kept; triple+ newlines collapsed to double');
}

// ── Multiple back-to-back closed chapters ────────────────────────────────────
{
  const { chapters, cleanReply } = extractChapters(
    '```chapter title="A"\nAlpha.\n```\n```chapter title="B"\nBeta.\n```'
  );
  eq(chapters, [{ title: 'A', body: 'Alpha.' }, { title: 'B', body: 'Beta.' }], 'two back-to-back chapters');
  eq(cleanReply, '', 'all fences stripped, separators trimmed away');
}

// ── Truncated open-ended chapter WITH title (the load-bearing case) ──────────
{
  const { chapters, cleanReply } = extractChapters('```chapter title="The Quest"\nScarlet flew over the');
  eq(chapters, [{ title: 'The Quest', body: 'Scarlet flew over the' }], 'truncated open chapter captured');
  eq(cleanReply, NOTE, 'truncation note replaces the consumed open block');
}

// ── Truncated open-ended chapter WITHOUT title → placeholder ─────────────────
{
  const { chapters } = extractChapters('```chapter\nA story begins');
  eq(chapters, [{ title: UNTITLED, body: 'A story begins' }], 'untitled truncated chapter gets placeholder title');
}

// ── Closed chapter FOLLOWED by a truncated open chapter ──────────────────────
{
  const { chapters, cleanReply } = extractChapters(
    '```chapter title="One"\nBody one.\n```\n```chapter title="Two"\nBody two unfinished'
  );
  eq(chapters, [{ title: 'One', body: 'Body one.' }, { title: 'Two', body: 'Body two unfinished' }],
    'closed chapter + trailing truncated chapter both captured');
  eq(cleanReply, NOTE, 'leading separator trimmed, truncation note appended');
}

// ── Empty-body fence sandwiched between two real chapters (mixed) ─────────────
{
  const { chapters, cleanReply } = extractChapters(
    '```chapter title="A"\nAlpha.\n```\n```chapter title="Mid"\n\n```\n```chapter title="B"\nBeta.\n```'
  );
  eq(chapters, [{ title: 'A', body: 'Alpha.' }, { title: 'B', body: 'Beta.' }],
    'empty middle fence dropped; the two real chapters survive intact');
  eq(cleanReply, '', 'all three fences (incl. the empty one) stripped');
}

// ── No chapters at all (plain Scribe chat) ───────────────────────────────────
{
  const reply = 'I love where this story is going! What happens next?';
  const { chapters, cleanReply } = extractChapters(reply);
  eq(chapters, [], 'plain chat yields no chapters');
  eq(cleanReply, reply, 'plain chat passes through unchanged (trimmed)');
}

// ── Robustness: leading/trailing whitespace is trimmed off cleanReply ────────
{
  const { cleanReply } = extractChapters('   \n\n  Just some words.  \n\n  ');
  eq(cleanReply, 'Just some words.', 'cleanReply is trimmed');
}

// ── Summary ──────────────────────────────────────────────────────────────────
if (failed === 0) {
  console.log(`nano-banana extractChapters: ${passed} passed, 0 failed`);
} else {
  console.error(`nano-banana extractChapters: ${passed} passed, ${failed} FAILED\n`);
  console.error(fails.join('\n'));
  process.exit(1);
}
