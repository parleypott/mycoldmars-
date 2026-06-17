// First assertion coverage for The Hunter's FCP7 XML exporter.
//
// buildHunterSequenceXML + isNtscRate are pure (no DOM) — downloadXML and the
// parser are the only DOM-bound bits, and the module touches `document` only
// inside downloadXML's body, so a static import is safe under bun/node.
//
// Headline fix locked here: isNtscRate was a strict float-equality check
// (`fps === 23.976 || ...`). A probed rate of 24000/1001 = 23.97602... — the
// exact value the sibling Interpreter's ffprobe-meta now produces — slipped
// through, emitting <ntsc>FALSE</ntsc> and reintroducing ~0.1%/hour drift.
//
// Run: bun hunter/src/xml-writer.test.mjs   (auto-discovered by `bun run test`)

import { buildHunterSequenceXML, isNtscRate } from './xml-writer.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; fails.push(msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// Count non-overlapping occurrences of a substring.
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const PROBED_2398 = 24000 / 1001; // 23.976023976... — what ffprobe reports
const PROBED_2997 = 30000 / 1001;
const PROBED_5994 = 60000 / 1001;

// ── isNtscRate: the fix + boundaries ──────────────────────────────────────

// The bug class: probed fractional rates must read as NTSC.
ok(isNtscRate(PROBED_2398), 'probed 24000/1001 is NTSC (the fix; strict === missed it)');
ok(isNtscRate(PROBED_2997), 'probed 30000/1001 is NTSC');
ok(isNtscRate(PROBED_5994), 'probed 60000/1001 is NTSC');

// Exact literals still match (back-compat with the current hardcoded caller).
ok(isNtscRate(23.976), 'exact 23.976 is NTSC');
ok(isNtscRate(29.97), 'exact 29.97 is NTSC');
ok(isNtscRate(59.94), 'exact 59.94 is NTSC');

// Whole-number rates are NOT NTSC.
ok(!isNtscRate(24), 'true 24 is not NTSC');
ok(!isNtscRate(25), 'PAL 25 is not NTSC');
ok(!isNtscRate(30), 'true 30 is not NTSC');
ok(!isNtscRate(60), 'true 60 is not NTSC');
ok(!isNtscRate(23.5), 'off-window 23.5 is not NTSC');
ok(!isNtscRate(30.1), 'off-window 30.1 is not NTSC');

// Inline RED proof — the OLD strict-equality check the fix replaced.
const oldStrictIsNtsc = (fps) => (fps === 23.976 || fps === 29.97 || fps === 59.94);
ok(!oldStrictIsNtsc(PROBED_2398), 'RED proof: old strict check FAILED on 24000/1001');
ok(oldStrictIsNtsc(23.976), 'RED proof: old strict check only worked on the exact literal');

// ── buildHunterSequenceXML: the <ntsc> flag end-to-end ─────────────────────

const oneUnit = [{ sourceClipName: 'A001.mov', startSeconds: 1, endSeconds: 3 }];

// The headline end-to-end fix: a probed fps must write TRUE everywhere.
const probedXml = buildHunterSequenceXML({ units: oneUnit, fps: PROBED_2398 });
eq(count(probedXml, '<ntsc>TRUE</ntsc>'), count(probedXml, '<ntsc>'),
  'probed-fps export: every <ntsc> tag is TRUE (the fix — was FALSE before)');
ok(!probedXml.includes('<ntsc>FALSE</ntsc>'), 'probed-fps export: no <ntsc>FALSE</ntsc> leaks');
ok(probedXml.includes('<timebase>24</timebase>'), 'probed 24000/1001 → integer timebase 24');

// Exact 23.976 (the current caller) still TRUE.
const exactXml = buildHunterSequenceXML({ units: oneUnit, fps: 23.976 });
ok(exactXml.includes('<ntsc>TRUE</ntsc>') && !exactXml.includes('<ntsc>FALSE</ntsc>'),
  'exact 23.976 export: NTSC TRUE');

// PAL 25 → FALSE everywhere, timebase 25.
const palXml = buildHunterSequenceXML({ units: oneUnit, fps: 25 });
ok(palXml.includes('<ntsc>FALSE</ntsc>') && !palXml.includes('<ntsc>TRUE</ntsc>'),
  'PAL 25 export: NTSC FALSE');
ok(palXml.includes('<timebase>25</timebase>'), 'PAL 25 → timebase 25');

// True 30 → FALSE.
const p30 = buildHunterSequenceXML({ units: oneUnit, fps: 30 });
ok(p30.includes('<ntsc>FALSE</ntsc>') && !p30.includes('<ntsc>TRUE</ntsc>'), 'true 30 export: NTSC FALSE');

// ── frame math (secondsToFrames via the XML) ───────────────────────────────

// fps 24 (round of 23.976 is 24, but pass 24 for clean integers): 1s→24, 3s→72.
const f24 = buildHunterSequenceXML({ units: [{ sourceClipName: 'X', startSeconds: 1, endSeconds: 3 }], fps: 24 });
ok(f24.includes('<in>24</in>'), 'secondsToFrames: 1s @24fps → in=24');
ok(f24.includes('<out>72</out>'), 'secondsToFrames: 3s @24fps → out=72');
// duration = out - in = 48, start=0, end=48
ok(f24.includes('<start>0</start>'), 'first clip starts at timeline 0');
ok(f24.includes('<end>48</end>'), 'first clip end = duration (48)');

// ── duration<=0 clips are skipped, do not advance timeline ─────────────────

const withZero = buildHunterSequenceXML({
  fps: 24,
  units: [
    { sourceClipName: 'good1', startSeconds: 0, endSeconds: 1 },   // 0→24, dur 24
    { sourceClipName: 'zero',  startSeconds: 5, endSeconds: 5 },   // dur 0 → skipped
    { sourceClipName: 'neg',   startSeconds: 9, endSeconds: 8 },   // dur <0 → skipped
    { sourceClipName: 'good2', startSeconds: 0, endSeconds: 2 },   // 0→48, dur 48
  ],
});
// Only 2 units survive on each of the 2 tracks → 4 total clipitems (2 video + 2 audio).
eq(count(withZero, '<clipitem id="clip-'), 4, 'only the 2 positive-duration clips kept (×2 tracks)');
// Video-only count: total clipitems minus the audio ones (id="clip-audio-").
eq(count(withZero, '<clipitem id="clip-') - count(withZero, '<clipitem id="clip-audio-'), 2,
  'video track: exactly 2 positive-duration clipitems');
ok(!withZero.includes('>zero<') && !withZero.includes('>neg<'), 'zero/negative-duration clips dropped');
// good2 should start right after good1 (timeline 24), proving the skipped clips
// did NOT advance timelinePos.
ok(withZero.includes('<start>24</start>'), 'kept clip2 starts at 24 — skipped clips did not advance timeline');

// ── gapFrames between clips ─────────────────────────────────────────────────

const gapped = buildHunterSequenceXML({
  fps: 24,
  gapFrames: 10,
  units: [
    { sourceClipName: 'g1', startSeconds: 0, endSeconds: 1 }, // dur 24, 0→24
    { sourceClipName: 'g2', startSeconds: 0, endSeconds: 1 }, // dur 24, starts 24+10=34
  ],
});
ok(gapped.includes('<start>34</start>'), 'gapFrames pushes clip2 start to 34 (24 + 10 gap)');

// ── escapeXml on names and labels ───────────────────────────────────────────

const special = buildHunterSequenceXML({
  fps: 24,
  units: [{ sourceClipName: 'A & B <clip> "q" \'s', startSeconds: 0, endSeconds: 1, analysisText: 'x > y & z' }],
  label: 'Tag<&>',
});
ok(special.includes('A &amp; B &lt;clip&gt; &quot;q&quot; &apos;s'), 'clip name XML-escaped');
ok(special.includes('Tag&lt;&amp;&gt;'), 'marker label XML-escaped');
ok(special.includes('x &gt; y &amp; z'), 'analysis comment XML-escaped');
ok(!special.includes('A & B'), 'raw unescaped ampersand does not leak');

// ── marker emitted only when label or analysis present ──────────────────────

const noMarker = buildHunterSequenceXML({ units: [{ sourceClipName: 'plain', startSeconds: 0, endSeconds: 1 }], fps: 24 });
eq(count(noMarker, '<marker>'), 0, 'no label/analysis → no <marker> block');
const withMarker = buildHunterSequenceXML({ units: [{ sourceClipName: 'm', startSeconds: 0, endSeconds: 1, analysisText: 'note' }], fps: 24 });
eq(count(withMarker, '<marker>'), 1, 'analysis present → one <marker> block');
ok(withMarker.includes('<comment>note</comment>'), 'marker comment carries analysis text');

// ── file dedup: full def on first use, reference after ──────────────────────

const dedup = buildHunterSequenceXML({
  fps: 24,
  units: [
    { sourceClipName: 'same.mov', startSeconds: 0, endSeconds: 1 },
    { sourceClipName: 'same.mov', startSeconds: 2, endSeconds: 3 },
  ],
});
// Both clips share file-1. The video track writes the FULL <file id="file-1"> once
// (with <name>), then a bare reference <file id="file-1"/> for the 2nd clip.
eq(count(dedup, '<file id="file-1">'), 1, 'shared source: full <file> definition emitted once');
ok(dedup.includes('<file id="file-1"/>'), 'shared source: bare reference for subsequent uses');
// Name appears: 2 video clip names + 2 audio clip names + 1 (shared) file definition = 5.
eq(count(dedup, '<name>same.mov</name>'), 5, 'shared source name appears 5× (2 video + 2 audio clips + 1 file def)');

// ── distinct sources get distinct file ids ──────────────────────────────────

const twoFiles = buildHunterSequenceXML({
  fps: 24,
  units: [
    { sourceClipName: 'one.mov', startSeconds: 0, endSeconds: 1 },
    { sourceClipName: 'two.mov', startSeconds: 0, endSeconds: 1 },
  ],
});
ok(twoFiles.includes('id="file-1"') && twoFiles.includes('id="file-2"'), 'two distinct sources → file-1 and file-2');

// ── empty units → valid but empty sequence ──────────────────────────────────

const empty = buildHunterSequenceXML({ units: [], fps: 24 });
ok(empty.includes('<xmeml version="5">'), 'empty export still produces a valid xmeml doc');
eq(count(empty, '<clipitem'), 0, 'empty export has no clipitems');
ok(empty.includes('<duration>0</duration>'), 'empty export totalDuration is 0');

// ── totalDuration excludes the trailing gap ─────────────────────────────────

const dur = buildHunterSequenceXML({
  fps: 24,
  gapFrames: 10,
  units: [
    { sourceClipName: 'd1', startSeconds: 0, endSeconds: 1 }, // 24
    { sourceClipName: 'd2', startSeconds: 0, endSeconds: 1 }, // 24
  ],
});
// timelinePos after loop = 24+10 + 24+10 = 68; totalDuration = 68 - 10 (trailing gap) = 58
ok(dur.includes('<sequence>') && dur.match(/<sequence>\s*<name>[^<]*<\/name>\s*<duration>58<\/duration>/),
  'sequence totalDuration strips the trailing gap (58, not 68)');

// ── default sequence name + custom name escaped ─────────────────────────────

const named = buildHunterSequenceXML({ units: oneUnit, fps: 24, sequenceName: 'My <Selects> & More' });
ok(named.includes('<name>My &lt;Selects&gt; &amp; More</name>'), 'custom sequence name escaped');
const defName = buildHunterSequenceXML({ units: oneUnit, fps: 24 });
ok(defName.includes('<name>Hunter Export</name>'), 'default sequence name is "Hunter Export"');

// ── report ──────────────────────────────────────────────────────────────────
if (fail) {
  console.error(`\n✗ xml-writer: ${fail} FAILED / ${pass} passed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`✓ xml-writer: all ${pass} passed`);
