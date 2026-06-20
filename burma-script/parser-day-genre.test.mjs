// Lock for burma-script/parser.ts parseScript() — the SHOOTING-DAY resolution,
// chapter GENRE/act classification, and inline-SPAN extraction. These three are
// load-bearing for the producer-facing export (which shooting day a SOT belongs
// to drives the per-day grouping; the chapter act drives the spine; the {tk}/{fc}/
// [visual] spans drive the worklists) — and parse-test.ts only LOGS parseScript's
// output, it asserts NONE of this. So this is the first assertion coverage of the
// DAY-context threading + genreOf + extractSpans behaviors.
//
// Same DAY-correctness class as the migrate-doc DAY-stamp fix (12b254e) and the
// Hunter timezone day-bucket fixes: a wrong DAY silently mis-groups a soundbite in
// the producer's shooting-day view. This locks the parser's resolution so a
// regression in the contextDay threading can't slip through unnoticed.
//
// parseScript is already exported — this is a TEST-ONLY lock, zero source change.

import { parseScript } from './parser';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${g}\n  want: ${w}`); }
};

// Helpers to pull typed blocks out of a parsed doc.
const blocksOf = (src) => parseScript(src).doc.blocks;
const sots = (src) => blocksOf(src).filter(b => b.type === 'sot' || b.type === 'broll');
const chapters = (src) => blocksOf(src).filter(b => b.type === 'chapter');
const vos = (src) => blocksOf(src).filter(b => b.type === 'vo');

// ─────────────────────────────────────────────────────────────────────────────
// 1) SHOOTING-DAY RESOLUTION (the headline)
// ─────────────────────────────────────────────────────────────────────────────

// A SOT timecode BEFORE any DAY marker is ambiguous (day === null) and flagged.
{
  const r = parseScript(`JACK 02:02:01:07 the border was wide open`);
  const sot = r.doc.blocks.find(b => b.type === 'sot');
  eq(sot?.timecode?.day, null, 'SOT before any DAY -> day null');
  eq(sot?.timecode?.ambiguous, true, 'SOT before any DAY -> ambiguous true');
  eq(r.ambiguous.length, 1, 'ambiguous SOT pushed to the ambiguous array');
  eq(r.stats.ambiguousTimecodes, 1, 'ambiguousTimecodes stat counts it');
}

// A DAY marker on a PRIOR paragraph carries forward to a later SOT (cross-paragraph
// context threading — the exact behavior a regression would break).
{
  const src = `DAY 2\nJACK 02:02:01:07 the border was controlled`;
  const [sot] = sots(src);
  eq(sot?.timecode?.day, 2, 'DAY 2 on a prior paragraph threads into the later SOT');
  eq(sot?.timecode?.ambiguous, false, 'a DAY-resolved SOT is not ambiguous');
  // "controlled" must NOT route this as b-roll (\broll\b word boundary) — it is a SOT.
  eq(sot?.type, 'sot', '"controlled" SOT is not misfiled as b-roll');
}

// DAY context PERSISTS across an intervening non-DAY paragraph.
{
  const src = `DAY 1\nVO: some narration here\nDREW 03:08:33:13 talking about the road`;
  const [sot] = sots(src);
  eq(sot?.timecode?.day, 1, 'DAY 1 persists across an intervening VO paragraph');
}

// A LOCAL DAY on the SOT line itself overrides the running context.
{
  const src = `DAY 1\nDAY 3 JACK 03:19:40:07 later footage`;
  const [sot] = sots(src);
  eq(sot?.timecode?.day, 3, 'a local DAY 3 on the SOT line overrides the running DAY 1 context');
}

// The running context UPDATES as later DAY markers appear.
{
  const src = [
    `DAY 1`,
    `JACK 01:08:54:15 first day soundbite`,
    `DAY 3`,
    `DREW 03:15:11:03 third day soundbite`,
  ].join('\n');
  const got = sots(src).map(s => s.timecode?.day);
  eq(got, [1, 3], 'running DAY context updates: [DAY1 SOT, DAY3 SOT] -> [1, 3]');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) CHAPTER GENRE / ACT classification (genreOf)
// ─────────────────────────────────────────────────────────────────────────────
{
  const genre = (line) => chapters(line)[0]?.genre;
  eq(genre('CH: COLD OPEN from JH'), 'coldopen', 'CH COLD OPEN -> coldopen');
  eq(genre('CH: HISTORY 1 — the partition'), 'history', 'CH HISTORY -> history');
  eq(genre('CH: GROUND truth in the village'), 'ground', 'CH GROUND -> ground');
  eq(genre('CH: INQUIRY into the coup'), 'inquiry', 'CH INQUIRY -> inquiry');
  eq(genre('CH: LOOK AT THIS MAP of the border'), 'latm', 'CH LOOK AT THIS MAP -> latm');
  eq(genre('CH: LATM segment'), 'latm', 'CH LATM -> latm');
  eq(genre('CH: MAP ROOM walkthrough'), 'latm', 'CH MAP ROOM -> latm');
  eq(genre('CH: MAP ON CAM beat'), 'latm', 'CH MAP ON CAM -> latm');
  eq(genre('CH: Something unlabeled'), 'other', 'CH unlabeled -> other');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) INLINE SPAN extraction (extractSpans) on a VO writing surface
// ─────────────────────────────────────────────────────────────────────────────
{
  // A VO line carrying a {tk}, a {fc}, and a [visual] cue — distinct kinds, sorted by start.
  const src = `VO: we open {tk find the date} on the river [B roll of boats] and {fact verify the 1962 coup}`;
  const [vo] = vos(src);
  const kinds = (vo?.spans || []).map(s => s.kind);
  // VO_LEAD peels the "VO:" prefix; spans are over the STORED text (post-peel).
  eq(kinds.includes('tk'), true, 'VO spans include the {tk} ask');
  eq(kinds.includes('factcheck'), true, 'VO spans include the {fact} ask (factcheck kind)');
  eq(kinds.includes('visual'), true, 'VO spans include the [visual] cue');
  eq(vo?.spans?.length, 3, 'exactly three spans extracted');
  // sorted ascending by start offset
  const starts = (vo?.spans || []).map(s => s.start);
  eq(starts.slice().sort((a, b) => a - b), starts, 'spans are sorted by start offset');
  // stat rollups
  const st = parseScript(src).stats;
  eq(st.tkSpans, 1, 'tkSpans stat = 1');
  eq(st.visualSpans, 1, 'visualSpans stat = 1');
}

console.log(`parser-day-genre: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
