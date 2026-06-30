/**
 * Tests for the EPISODE-DERIVED REGEX CORE of the shared WP script engine — the brand-new
 * (commit 046ce07, "generalize engine to episode-driven; add Palau") code that lets one
 * codebase drive multiple episodes. Run: bun src/episode-regex.test.mjs
 *
 * Why this is load-bearing and was at ACTIVE RISK with zero coverage:
 *
 *  1) buildDayCharacterClass(days) builds the `[…]` inside the DAY-stamp regex
 *     (`\bDAY\s*([…])\b`). Burma shoots days 1–3 → `[1-3]`. PALAU SHOOTS DAYS 1–7, and its
 *     source carries 69 real "DAY 4".."DAY 7" timecode stamps that ONLY get recognized as
 *     day context because this function widens the class past Burma's. If it ever froze to
 *     Burma's class (exactly the static-import boot-order trap that boot.jsx's own comments
 *     warn about), every Palau day-4-through-7 stamp would silently lose its "DAY N ·" chip
 *     context. The `DAY 7 matches for Palau` assertion below goes RED the instant that
 *     regression returns — it is the canary for the whole episode-boot contract.
 *
 *  2) episodeHeadAlternation() builds the chapter-reclassifier alternation. The commit's
 *     headline guarantee is "Burma is BYTE-FOR-BYTE unchanged" — so with Burma active the
 *     function MUST reproduce the frozen BURMA_HEAD_ALTERNATION literal exactly, and with
 *     Palau active it MUST extend to Palau's six genre heads (so a "MONTAGE" / "EXPLAINER" /
 *     "GROUND 2" chapter is recognized) while still appending the structural words.
 *
 * Both functions are pure (or pure-of-arg); the test drives them directly and, for the
 * head alternation, swaps the active episode via setEpisode so it reads the real configs.
 */
import { buildDayCharacterClass, episodeHeadAlternation } from './document-builder.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';
import { PALAU } from '../../palau-script/config.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// The exact frozen literal the commit pins as Burma's contract (copied from document-builder.js).
const BURMA_HEAD_ALTERNATION = 'COLD\\s*OPEN|HISTORY|GROUND|INQUIRY|LATM|ACT|EPILOGUE|OUTRO|TEASER|INTRO';

// Build the DAY regex exactly as document-builder.js does from the class source.
const dayRe = (days) => new RegExp(`\\bDAY\\s*([${buildDayCharacterClass(days)}])\\b`, 'i');
const headRe = () => new RegExp(`^(${episodeHeadAlternation()})\\b`, 'i');

// ── buildDayCharacterClass: contiguous ranges collapse to a hyphen class ──────────────
eq(buildDayCharacterClass([1, 2, 3]), '1-3', 'Burma 1..3 → "1-3" (contiguous, >2)');
eq(buildDayCharacterClass([1, 2, 3, 4, 5, 6, 7]), '1-7', 'Palau 1..7 → "1-7" (contiguous, >2)');
eq(buildDayCharacterClass(BURMA.days), '1-3', 'real BURMA.days → "1-3"');
eq(buildDayCharacterClass(PALAU.days), '1-7', 'real PALAU.days → "1-7"');

// exactly two, or one, stay as a joined char list (no degenerate "1-2"/"3-3" range)
eq(buildDayCharacterClass([1, 2]), '12', 'two contiguous → joined "12", not a range');
eq(buildDayCharacterClass([3]), '3', 'single day → "3"');

// non-contiguous days are joined verbatim (each digit is its own class member)
eq(buildDayCharacterClass([1, 3, 5]), '135', 'non-contiguous → "135"');

// dedupe + sort + drop out-of-class (negative, >9, non-integer, non-array)
eq(buildDayCharacterClass([3, 1, 2, 2, 1]), '1-3', 'unsorted+dupes normalize to "1-3"');
eq(buildDayCharacterClass([1, 2, 3, 12, -4, 2.5]), '1-3', 'out-of-[0..9] / non-int values dropped');
eq(buildDayCharacterClass([]), '123', 'empty → Burma fallback "123"');
eq(buildDayCharacterClass(null), '123', 'non-array → Burma fallback "123"');

// ── the regex the class feeds: Palau MUST recognize every shoot day, Burma must not over-match ──
const burmaDay = dayRe(BURMA.days);
ok(burmaDay.test('DAY 1'), 'Burma day-regex matches DAY 1');
ok(burmaDay.test('DAY 3'), 'Burma day-regex matches DAY 3');
ok(!burmaDay.test('DAY 7'), 'Burma day-regex does NOT match DAY 7 (out of its shoot)');

const palauDay = dayRe(PALAU.days);
ok(palauDay.test('DAY 1'), 'Palau day-regex matches DAY 1');
ok(palauDay.test('DAY 4'), 'Palau day-regex matches DAY 4 (mid extended range)');
// LOAD-BEARING CANARY: if buildDayCharacterClass ever froze to Burma's class, this fails.
ok(palauDay.test('DAY 7'), 'Palau day-regex matches DAY 7 (the episode-boot canary)');
ok(palauDay.test('day7'), 'Palau day-regex is case-insensitive and space-optional ("day7")');
ok(!palauDay.test('DAY 8'), 'Palau day-regex does NOT match DAY 8 (past the 7-day shoot)');

// ── episodeHeadAlternation: Burma byte-identical, Palau extends ───────────────────────
setEpisode(BURMA);
eq(episodeHeadAlternation(), BURMA_HEAD_ALTERNATION, 'Burma active → byte-identical frozen head alternation');
{
  const re = headRe();
  ok(re.test('HISTORY 2'), 'Burma head-regex recognizes HISTORY 2');
  ok(re.test('COLD OPEN'), 'Burma head-regex recognizes COLD OPEN');
  ok(!re.test('MONTAGE — reef'), 'Burma head-regex does NOT recognize Palau-only MONTAGE');
}

setEpisode(PALAU);
{
  const alt = episodeHeadAlternation();
  ok(alt.includes('MONTAGE|HEPTAPODS'), 'Palau alternation carries the MONTAGE head');
  ok(alt.includes('EXPLAINER|EX\\s*\\d'), 'Palau alternation carries the EXPLAINER head');
  ok(alt.includes('GROUND|GR\\s*\\d'), 'Palau alternation carries the GROUND head');
  ok(alt.endsWith('ACT|EPILOGUE|OUTRO|TEASER|INTRO'), 'Palau still appends the structural head words');

  const re = headRe();
  ok(re.test('MONTAGE — the heptapods'), 'Palau head-regex recognizes MONTAGE');
  ok(re.test('EXPLAINER'), 'Palau head-regex recognizes EXPLAINER');
  ok(re.test('GROUND 2 — the dock'), 'Palau head-regex recognizes GROUND 2');
  ok(re.test('LOOK AT THIS MAP'), 'Palau head-regex recognizes the multi-word MAP head');
}

// fallback: an episode with no genre heads → Burma alternation (never an empty `^()\b` regex)
setEpisode({ id: 'x', days: [1], genres: [{ id: 'other', head: null }], storage: {} });
eq(episodeHeadAlternation(), BURMA_HEAD_ALTERNATION, 'headless episode → Burma fallback alternation');

// restore the default so import order can't leak a non-Burma episode into other suites
setEpisode(BURMA);

console.log(`episode-regex: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
