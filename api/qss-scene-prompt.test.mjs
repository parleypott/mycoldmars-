/**
 * Tests for the QSS scene-illustration prompt assembly
 * (api/_lib/qss-scene-prompt.js), extracted byte-for-byte from
 * api/qss-scene-illustrate.js.
 *
 * Run: node qss-scene-prompt.test.mjs  (from api/)  — or `bun run test`.
 *
 * This is the Henry-FACING illustration contract: the prompt that decides what
 * EVERY storybook scene picture looks like. The load-bearing pieces:
 *   • SCENE_FRAMING       — the absolute composition guardrails (ONE image,
 *                           NEVER a comic panel, NEVER text/speech bubbles in the
 *                           picture). Lose these and the book renders as a
 *                           graphic-novel collage.
 *   • extractSceneText    — the index loop that picks WHICH prose the picture
 *                           depicts. Inclusive start..end, clamped to
 *                           blocks.length, string-or-{text} blocks, empties
 *                           dropped, non-numeric start → no run (excerpt fallback).
 *   • buildProseBlock     — 1500-char cap + excerpt fallback + empty.
 *   • buildScenePrompt    — the load-bearing FIELD ORDER (style, framing, title,
 *                           setting, time, characters, prose, variation hint).
 *
 * No live bug found — the assembler was already correct — so this is a
 * verifier-layer LOCK (same standard as the buildPortraitPrompt / qss-report
 * locks). Mutation-proven: each source mutation listed below turns this suite
 * RED; restore → GREEN.
 *
 *   MUTATIONS (each → RED):
 *   1. extractSceneText loop bound `<=` → `<`          (drops the last block)
 *   2. buildProseBlock `.slice(0, 1500)` removed        (uncapped prose)
 *   3. buildProseBlock fallback `?` excerpt branch lost (summary never emitted)
 *   4. SCENE_FRAMING: drop the "NEVER ... text" line    (guardrail gone)
 *   5. buildScenePrompt: swap charBlock/proseBlock order (field order broken)
 *   6. buildCharBlock: emit block even when empty        (scar on absent input)
 *
 * NOTE — the `&& i < arr.length` clamp in extractSceneText is a loop-BOUND
 * guard, not an output lever: out-of-range reads yield `undefined`, which the
 * empty-block filter drops anyway, so removing it does NOT change output (the
 * end-past-length test below still passes). Its real job is to stop a runaway
 * loop when prose_end_block is garbage-huge or Infinity. Documented, not
 * over-claimed as a RED mutation.
 */

import {
  SCENE_FRAMING,
  extractSceneText,
  buildCharBlock,
  buildProseBlock,
  buildScenePrompt,
} from './_lib/qss-scene-prompt.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${label}`); }
}
function eq(a, b, label) {
  ok(a === b, `${label}${a === b ? '' : `  (got ${JSON.stringify(a)} ≠ ${JSON.stringify(b)})`}`);
}

// ── (0) SCENE_FRAMING guardrails — the whole reason the book stays a book ────
ok(SCENE_FRAMING.includes('ONE single image. ONE moment.'), 'framing: one-image rule present');
ok(SCENE_FRAMING.includes('NEVER a comic panel layout'), 'framing: no-comic-panel rule present');
ok(SCENE_FRAMING.includes('NEVER speech bubbles'), 'framing: no-speech-bubbles rule present');
ok(/NEVER any text, words, letters, numbers, signs, or labels visible inside the image\./.test(SCENE_FRAMING),
  'framing: no-text-inside-image rule present (MUTATION 4 target)');
ok(SCENE_FRAMING.includes('NOT a page of a graphic novel'), 'framing: picture-book-not-graphic-novel rule present');

// ── (1) extractSceneText: range, clamping, block shapes, empties ─────────────
const blocks = [
  'block zero',
  { text: '  block one  ' },          // trimmed
  { text: '' },                       // empty → dropped
  'block three',
  { notText: 'ignored' },             // no .text → '' → dropped
  'block four',
];
// start..end inclusive, within range
eq(JSON.stringify(extractSceneText(blocks, 0, 1)), JSON.stringify(['block zero', 'block one']),
  'extract: inclusive 0..1, trims, mixes string + {text}');
// MUTATION 1 target: `<=` not `<` — end block MUST be included
eq(JSON.stringify(extractSceneText(blocks, 3, 3)), JSON.stringify(['block three']),
  'extract: single-block range 3..3 includes block 3 (MUTATION 1 — `<=`→`<` drops it)');
// empty/no-text blocks dropped, not pushed as ''
eq(JSON.stringify(extractSceneText(blocks, 1, 4)), JSON.stringify(['block one', 'block three']),
  'extract: empty {text:""} and no-text blocks dropped from the middle');
// end past the array stays correct (clamp is a loop-bound guard; the empty
// filter already masks out-of-range undefined reads — see header NOTE)
eq(JSON.stringify(extractSceneText(blocks, 5, 99)), JSON.stringify(['block four']),
  'extract: end past length yields only the in-range block (clamp bounds the loop)');
// non-numeric start → loop never runs (handler then uses prose_excerpt)
eq(JSON.stringify(extractSceneText(blocks, undefined, 5)), JSON.stringify([]),
  'extract: undefined start → empty (excerpt fallback path)');
eq(JSON.stringify(extractSceneText(null, 0, 3)), JSON.stringify([]),
  'extract: non-array blocks → empty, no throw');

// ── (2) buildCharBlock: present iff characters, no scar when empty ───────────
eq(buildCharBlock([]), '', 'charBlock: empty array → empty string (MUTATION 6 — no scar)');
eq(buildCharBlock(undefined), '', 'charBlock: undefined → empty string, no throw');
ok(buildCharBlock(['- Kevin: red cape']).startsWith('\n\nCHARACTERS in this scene'),
  'charBlock: non-empty → leads with the CHARACTERS header');
ok(buildCharBlock(['- Kevin: red cape', '- Mara']).includes('- Kevin: red cape\n- Mara'),
  'charBlock: parts joined by newline');

// ── (3) buildProseBlock: cap, fallback, empty ───────────────────────────────
eq(buildProseBlock([], null), '', 'prose: no texts + no excerpt → empty');
eq(buildProseBlock([], 'a short summary'), '\n\nSCENE SUMMARY: a short summary',
  'prose: no texts but excerpt present → SCENE SUMMARY fallback (MUTATION 3)');
ok(buildProseBlock(['She ran.'], 'ignored excerpt').startsWith('\n\nWHAT HAPPENS IN THIS SCENE:'),
  'prose: texts present → WHAT HAPPENS header, excerpt ignored');
// MUTATION 3 target: 1500-char cap on the joined body
const huge = 'x'.repeat(5000);
const proseHeader = '\n\nWHAT HAPPENS IN THIS SCENE:\n';
const capped = buildProseBlock([huge], null);
eq(capped.length, proseHeader.length + 1500,
  'prose: joined body capped at 1500 chars (MUTATION 2 — drop slice → 5000)');

// ── (4) buildScenePrompt: full assembly, byte-identical to the old inline form ─
// Reconstruct the ORIGINAL inline template independently and assert equality, so
// any drift in the extracted assembler is caught.
const STYLE = 'STYLE: painterly Ghibli. REFS: Iron Giant. DONT: stickers.';
const scene = {
  title: 'The Duel at Dawn',
  time_of_day: 'dawn',
  prose_start_block: 0,
  prose_end_block: 1,
  prose_excerpt: 'a summary',
};
const settingBlock = '\n\nSETTING: the cliff edge (Cliff: windswept)';
const charParts = ['- Scarlet: red dragon, yellow horns', '- Kevin'];
const sceneTexts = extractSceneText(['Scarlet roared.', 'Kevin froze.'], 0, 1);

function originalInline({ isVariation }) {
  const charBlock = charParts.length
    ? `\n\nCHARACTERS in this scene (preserve their established visual identity):\n${charParts.join('\n')}`
    : '';
  const proseBlock = sceneTexts.length
    ? `\n\nWHAT HAPPENS IN THIS SCENE:\n${sceneTexts.join('\n\n').slice(0, 1500)}`
    : (scene.prose_excerpt ? `\n\nSCENE SUMMARY: ${scene.prose_excerpt}` : '');
  const timeBlock = scene.time_of_day ? `\n\nTIME: ${scene.time_of_day}` : '';
  const variantHint = isVariation
    ? `\n\nVARIATION — same characters, same setting, but a DIFFERENT moment / camera angle / composition from any previous attempt.`
    : '';
  return `${STYLE}\n\n${SCENE_FRAMING}\n\nTITLE: ${scene.title}${settingBlock}${timeBlock}${charBlock}${proseBlock}${variantHint}`;
}

const built = buildScenePrompt({
  style: STYLE, title: scene.title, settingBlock, timeOfDay: scene.time_of_day,
  charParts, sceneTexts, proseExcerpt: scene.prose_excerpt, isVariation: false,
});
eq(built, originalInline({ isVariation: false }),
  'buildScenePrompt: byte-identical to the original inline template (no-variation)');

const builtVar = buildScenePrompt({
  style: STYLE, title: scene.title, settingBlock, timeOfDay: scene.time_of_day,
  charParts, sceneTexts, proseExcerpt: scene.prose_excerpt, isVariation: true,
});
eq(builtVar, originalInline({ isVariation: true }),
  'buildScenePrompt: byte-identical with the VARIATION hint appended');
ok(builtVar.endsWith('previous attempt.'), 'variation hint lands at the very end');
ok(!built.includes('VARIATION —'), 'no variation hint when isVariation=false');

// MUTATION 6 target: field order — characters must come BEFORE prose, both after time
ok(built.indexOf('TITLE:') < built.indexOf('SETTING:')
  && built.indexOf('SETTING:') < built.indexOf('\n\nTIME:')
  && built.indexOf('\n\nTIME:') < built.indexOf('CHARACTERS in this scene')
  && built.indexOf('CHARACTERS in this scene') < built.indexOf('WHAT HAPPENS IN THIS SCENE'),
  'buildScenePrompt: load-bearing field order title→setting→time→characters→prose (MUTATION 5)');

// FRAMING is embedded in the assembled prompt
ok(built.includes(SCENE_FRAMING), 'assembled prompt embeds the full FRAMING guardrail block');

// title is passed through even when falsy-ish (preserves original behavior)
eq(buildScenePrompt({ style: 's', title: undefined, charParts: [], sceneTexts: [] }).includes('TITLE: undefined'), true,
  'buildScenePrompt: undefined title → "TITLE: undefined" (byte-identical to original)');

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\nqss-scene-prompt: ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join('\n')); process.exit(1); }
