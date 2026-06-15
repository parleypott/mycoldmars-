/**
 * Regression test for FCP/Premiere XML rate emission across all three builders.
 *
 * The contract (standard FCP-XML pulldown convention):
 *   - NTSC-fractional rates (23.976, 29.97, 59.94) → integer <timebase> (24/30/60)
 *     plus <ntsc>TRUE</ntsc>. Premiere interprets the integer frame counts as
 *     <timebase> * 1000/1001 at import. Emitting ntsc FALSE here reintroduces
 *     the ~0.1%/hour drift bug (3.6s over a 1-hour transcript).
 *   - Whole rates (24, 25, 30, 50, 60) → that integer <timebase> + <ntsc>FALSE</ntsc>.
 *
 * The load-bearing case is 24000/1001 = 23.97602... — what ffprobe actually
 * reports for "23.976" footage. A strict `fps === 23.976` check fails on it and
 * silently mislabels the sequence as true 24fps. Tolerance-based detection must
 * catch it. This test exists so that never regresses again.
 */
import {
  buildPremiereXML,
  buildPremiereSequenceXML,
  buildSacredSequencerXML,
} from './premiere-xml.js';

const NTSC_FRACTIONAL = 24000 / 1001; // 23.97602... — the realistic ffprobe value

const segments = [
  { number: 1, start: '00:00:01.000', end: '00:00:03.000', text: 'one', speaker: 'A' },
  { number: 2, start: '00:00:05.000', end: '00:00:07.000', text: 'two', speaker: 'B' },
];
const highlights = [{ segmentNumbers: [1, 2], tagName: 'Tag', textPreview: 'x', color: '#DD2C1E' }];
const soundbites = [
  { start: '00:00:01.000', end: '00:00:03.000', text: 'one', prefix: 'SB1' },
  { start: '00:00:05.000', end: '00:00:07.000', text: 'two', prefix: 'SB2' },
];

// fps → expected [timebase, ntsc]
const CASES = [
  [23.976, '24', 'TRUE'],
  [NTSC_FRACTIONAL, '24', 'TRUE'], // the case the strict === check used to break
  [24, '24', 'FALSE'],
  [25, '25', 'FALSE'],
  [29.97, '30', 'TRUE'],
  [30, '30', 'FALSE'],
  [50, '50', 'FALSE'],
  [59.94, '60', 'TRUE'],
  [60, '60', 'FALSE'],
];

// Pull the FIRST <rate> block's timebase + ntsc out of a built XML string.
function firstRate(xml) {
  const tb = xml.match(/<timebase>(\d+)<\/timebase>/);
  const ntsc = xml.match(/<ntsc>(TRUE|FALSE)<\/ntsc>/);
  return { timebase: tb && tb[1], ntsc: ntsc && ntsc[1] };
}

const builders = [
  ['buildPremiereXML', (fps) => buildPremiereXML(highlights, segments, 'T', { fps })],
  ['buildPremiereSequenceXML', (fps) =>
    buildPremiereSequenceXML({ sacredSequenceName: 'S', outputName: 'O', segments, translations: [], fps })],
  ['buildSacredSequencerXML', (fps) =>
    buildSacredSequencerXML({ soundbites, sacredSequenceName: 'S', outputName: 'O', fps })],
];

let failures = 0;
for (const [name, build] of builders) {
  for (const [fps, wantTb, wantNtsc] of CASES) {
    const { timebase, ntsc } = firstRate(build(fps));
    const ok = timebase === wantTb && ntsc === wantNtsc;
    if (!ok) {
      failures++;
      console.error(
        `FAIL ${name} fps=${fps}: got timebase=${timebase} ntsc=${ntsc}, want timebase=${wantTb} ntsc=${wantNtsc}`
      );
    }
  }
}

if (failures === 0) {
  console.log(`PASS — all ${builders.length * CASES.length} rate cases correct across 3 builders`);
  process.exit(0);
} else {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
