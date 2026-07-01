/**
 * Tests for the CHAPTER-RECLASSIFIER DECISION CORE of the shared WP script engine —
 * reclassifyChapter / actLabel / headBodySplit in document-builder.js. Run: bun src/reclassify-core.test.mjs
 *
 * Why this is load-bearing and was at ACTIVE RISK with zero DIRECT coverage:
 *
 *   episode-regex.test.mjs locks the regex *builders* (buildDayCharacterClass,
 *   episodeHeadAlternation) — but NOT the three functions that CONSUME them to make the
 *   actual editorial decision: is a parser-labelled block a true act divider (`chapter`),
 *   a quiet sub-heading (`scene`), or a demoted directing cue (`oncam`)? And when it IS a
 *   chapter, what is its clean act label, and what body prose hangs under it? Those three
 *   functions are the ones the deployed WP-01 (Burma) and brand-new WP-02 (Palau) editors
 *   run on every block. They were edited across 3 commits in 3 days (episode-driven refactor)
 *   with no test touching them directly.
 *
 * THE EPISODE-FREEZE CONSTRAINT (why this file sets Palau BEFORE importing the engine):
 *
 *   document-builder.js derives ACT_HEAD / ACT_LABEL_RE / HEAD_BODY_SPLIT_RE ONCE, at module
 *   load, from the active episode singleton. In production boot.jsx defends this by calling
 *   setEpisode(PALAU) and THEN dynamically importing the engine (a static import would hoist
 *   above setEpisode and freeze to the Burma default). This test reproduces that exact boot
 *   contract: setEpisode(PALAU) runs first, then `await import('./document-builder.js')`, so
 *   the reclassifier's regexes freeze to Palau — the never-before-exercised surface.
 *
 * THE CANARY: under Palau, "LOOK AT THIS MAP" is a `map`-genre act head → 'chapter'. Under
 * Burma the SAME title is not a head and trips the MAP\b direction word → 'oncam' (verified).
 * So the `LOOK AT THIS MAP → chapter` assertion below goes RED the instant the episode-head
 * wiring regresses to the Burma-frozen default — it is the one-line canary for the whole
 * episode-driven reclassifier contract.
 */
import { setEpisode } from './episode-config.js';
import { PALAU } from '../../palau-script/config.js';
import { BURMA } from '../config.js';

// Freeze the engine's episode-derived regexes to PALAU (must precede the engine import).
setEpisode(PALAU);
const { reclassifyChapter, actLabel, headBodySplit } = await import('./document-builder.js');

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};

// ── reclassifyChapter: the head branch (Palau-specific act heads) ──────────────────────
// THE CANARY — see header. If ACT_HEAD ever freezes to Burma, this flips to 'oncam' (MAP\b).
eq(reclassifyChapter({ title: 'LOOK AT THIS MAP' }), 'chapter', 'Palau map head → chapter (CANARY: Burma would give oncam)');
eq(reclassifyChapter({ title: 'LOOK AT THE MAP' }), 'chapter', 'Palau map head (THE variant) → chapter');
eq(reclassifyChapter({ title: 'EXPLAINER 2' }), 'chapter', 'Palau EXPLAINER head → chapter');
eq(reclassifyChapter({ title: 'GROUND 2 — the dock' }), 'chapter', 'Palau GROUND head (with trailing prose) → chapter');
eq(reclassifyChapter({ title: 'MONTAGE — the heptapods' }), 'chapter', 'Palau MONTAGE head → chapter');
eq(reclassifyChapter({ title: 'COLD OPEN' }), 'chapter', 'COLD OPEN head → chapter');

// ── reclassifyChapter: the direction branch (episode-agnostic) ─────────────────────────
// No act head + a directing word → 'oncam'. Neuter `if (hasDirection) return 'oncam'` and a
// short non-head title like this falls through to the length/punct check and becomes 'chapter'.
eq(reclassifyChapter({ title: 'WALK AND TALK by the dock' }), 'oncam', 'directing language, no head → oncam');
eq(reclassifyChapter({ title: 'ON CAM piece' }), 'oncam', 'ON CAM directing cue → oncam');

// ── reclassifyChapter: the stray-prose branch ──────────────────────────────────────────
// No head, no direction, but long OR sentence-punctuated → demote to 'scene' (quiet heading).
eq(reclassifyChapter({ title: 'this is a stray prose line the parser over-promoted here' }), 'scene', 'long non-head prose → scene');
eq(reclassifyChapter({ title: 'a short claim.' }), 'scene', 'sentence punctuation (short) → scene');
// Short, no head, no direction, no punctuation → default 'chapter'.
eq(reclassifyChapter({ title: 'REEF RACK' }), 'chapter', 'short non-head non-direction → default chapter');

// ── actLabel: clamp the divider title to its clean act label, dropping the directing tail ──
eq(actLabel('GROUND 2 — the dock'), 'GROUND 2', 'actLabel peels trailing prose off "GROUND 2"');
eq(actLabel('EXPLAINER 2 the reef explainer'), 'EXPLAINER 2', 'actLabel keeps head+number, drops the rest');
eq(actLabel('COLD OPEN from the deck'), 'COLD OPEN', 'actLabel clamps multi-word head');
eq(actLabel('just some words'), 'just some words', 'actLabel: no head → returns cleaned title unchanged (not upper-cased)');

// ── headBodySplit: peel the structural marker + act head, keep EVERYTHING after as body ──
eq(headBodySplit('GROUND 2 — the dock', 'GROUND 2'), 'the dock', 'headBodySplit returns body prose after "GROUND 2 —"');
eq(headBodySplit('CH: LOOK AT THE MAP · candidates 1 2 3', 'LOOK AT THE MAP'), '· candidates 1 2 3', 'headBodySplit peels "CH:" + map head, keeps the notes');
eq(headBodySplit('SCENE: EXPLAINER 2 the coral', 'EXPLAINER 2'), 'the coral', 'headBodySplit peels "SCENE:" + "EXPLAINER 2"');

// restore the default so import order can't leak a non-Burma episode into other suites
setEpisode(BURMA);

console.log(`reclassify-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
