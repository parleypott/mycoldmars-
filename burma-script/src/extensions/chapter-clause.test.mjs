// Locks shortChapterClause — the derivation behind the vertical chapter
// tag in the burma-script editor's left gutter.
//
// Bug this locks: the "short" contract was leaky. The primary path caps
// the label at 36 chars (via .{1,36}?), but the delimiter fallback
// returned the FULL clause when a long header had no early sentence
// break and no double-space/spaced-dash/open-paren delimiter — so a
// punctuation-less header rendered as a vertical label running ~82% of
// screen height (CSS max-height clips it, but it's still absurdly long
// and violates the function's own name/contract). Fix: every return
// path now honors MAX_CLAUSE_LEN, cutting at a word boundary.
//
// Run: bun burma-script/src/extensions/chapter-clause.test.mjs  (auto-discovered by `bun run test`)
import { shortChapterClause, MAX_CLAUSE_LEN } from './chapter-clause.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}`); }
};

// ── The load-bearing invariant: output is NEVER longer than the cap ──
// This is the whole point of "short". The pre-fix fallback could return
// 90+ chars; a smart future edit that reintroduces an uncapped path
// turns these RED.
const LONG_NO_PUNCT = 'the long march north through the hills toward the contested border where everything changed';
const LONG_DAY = 'DAY 3 the border crossing at midnight where they finally understood what was at stake for everyone';
ok(shortChapterClause(LONG_NO_PUNCT).length <= MAX_CLAUSE_LEN,
  `long punctuation-less header capped to <= ${MAX_CLAUSE_LEN} (was 91)`);
ok(shortChapterClause(LONG_DAY).length <= MAX_CLAUSE_LEN,
  `long DAY-prefixed header capped to <= ${MAX_CLAUSE_LEN} (was 98)`);

// ── RED-proof: the OLD fallback (uncapped) would have leaked the full clause ──
const oldFallback = (clause) => clause.split(/\s{2,}|\s[-–—]\s|\s\(/)[0].trim();
ok(oldFallback(LONG_NO_PUNCT).length > MAX_CLAUSE_LEN,
  'RED-proof: old uncapped fallback returns > cap for the long header');

// ── Word-boundary cut: no mid-word slicing ──
const capped = shortChapterClause(LONG_NO_PUNCT);
ok(!capped.endsWith(' '), 'capped result has no trailing space');
ok(LONG_NO_PUNCT.startsWith(capped) || LONG_NO_PUNCT.replace(/\s+/g, ' ').startsWith(capped),
  'capped result is a genuine prefix of the (whitespace-collapsed) header');
ok(!/\S$/.test(capped) === false, 'capped ends on a word char (not empty)');
// It should cut at a space, so the last token must be a whole word from the source.
const srcWords = LONG_NO_PUNCT.split(/\s+/);
const gotWords = capped.split(/\s+/);
ok(srcWords.slice(0, gotWords.length).join(' ') === capped,
  'every word in the cap is a complete leading word of the header (no truncated tail word)');

// ── Behavior preserved for the cases the primary/short paths already handled ──
eq(shortChapterClause('CH: The Battle'), 'The Battle', 'CH: prefix stripped, short clause intact');
eq(shortChapterClause('First light. Then the crossing.'), 'First light',
  'cuts at the first sentence break');
eq(shortChapterClause('Chapter One - the arrival'), 'Chapter One - the arrival',
  'short-enough clause (<= cap) returned whole');
eq(shortChapterClause('The Ambush'), 'The Ambush', 'plain short title unchanged');
eq(shortChapterClause(''), '', 'empty input → empty');
eq(shortChapterClause(null), '', 'null input → empty (no crash)');
eq(shortChapterClause('   \n\t  '), '', 'whitespace-only → empty');
eq(shortChapterClause('CH DAY 5 the raid'), 'DAY 5 the raid',
  'CH strip + DAY-cap-run trim preserved');

// ── A single mega-word longer than the cap is hard-cut (never returns > cap) ──
const MEGA = 'x'.repeat(80);
ok(shortChapterClause(MEGA).length <= MAX_CLAUSE_LEN, 'mega single word hard-cut to <= cap');
ok(shortChapterClause(MEGA).length > 0, 'mega single word not blanked');

// ── Delimiter fallback still splits, then caps ──
// (Note: the leading `clean` collapses whitespace, so the delimiter that
// actually fires here is the spaced-dash, not double-space.)
eq(shortChapterClause('The raid - and then everything after it went sideways forever and ever'),
  'The raid', 'spaced-dash delimiter still wins before the cap');

if (fail) { console.error(`\nchapter-clause: ${pass} passed, ${fail} FAILED`); process.exit(1); }
console.log(`chapter-clause: ${pass}/${pass} passed`);
