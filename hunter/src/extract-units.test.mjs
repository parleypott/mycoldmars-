// Verifier-layer lock for extractCorpusUnits + extractSourceClips — the pure
// FCP7-import core in hunter/src/xml-parser.js. These two functions turn the
// parsed sequence tree into (a) the searchable corpus units that become "cuts"
// in the selects ingest (counted in the UI and saved into media_asset metadata
// as parsedUnits) and (b) the unique source-clip list used for Dropbox file
// matching. Both were ZERO-coverage and operate on plain objects (no DOM), so
// they are fully headless-testable.
//
// No live bug fixed here — the extractors are correct for their contract — so
// this is a verifier-layer LOCK: every assertion is mutation-proven to go RED
// if the corresponding logic regresses (see the journal for the mutation runs).
//
// A genuine design TENSION is deliberately PINNED to current behavior rather
// than "fixed" (logged for Johnny — an attended call):
//   extractCorpusUnits skips a clip only when it has NEITHER a sourceFile NOR a
//   name (`!clip.sourceFile && !clip.name`). The comment says "skip generator
//   clips (titles, black, etc.)", but a title/black generator HAS a name (just
//   no <file>), so it is NOT skipped — it leaks into the corpus as a noise unit.
//   The naive fix (`if (!clip.sourceFile) continue`) is WRONG: in FCP7 XML only
//   the FIRST clipitem referencing a file carries the full <file> (name/pathurl);
//   repeat references are bare `<file id=".."/>`, so parseClipItem returns
//   sourceFile=null for a REAL repeat clip — which the current `&& name` clause
//   correctly keeps. Dropping sourceFile-less clips would drop real repeat
//   footage. The proper fix needs a fileId→fileDef resolution pass in the DOM
//   parser, out of scope under the deploy freeze. These tests lock BOTH facts.
//
// Run: bun hunter/src/extract-units.test.mjs

import { extractCorpusUnits, extractSourceClips } from './xml-parser.js';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
};

// ── fixture builders (mirror parseClipItem / parseSequence output shape) ──
function clip(over = {}) {
  return {
    name: '', start: 0, end: 0, inPoint: 0, outPoint: 0, duration: 0,
    startSeconds: 0, endSeconds: 0, inSeconds: 0, outSeconds: 0,
    sourceFile: null, markers: [],
    ...over,
  };
}
function vtrack(index, clips) { return { index, clips }; }
function atrack(index, clips) { return { index, clips }; }
function seq(over = {}) {
  return { name: 'SEQ', duration: 0, fps: 24, timebase: 24, ntsc: false,
    videoTracks: [], audioTracks: [], ...over };
}
const file = (name, pathUrl = '', id = 'f1') => ({ id, name, pathUrl });

// ───────────────────────── extractCorpusUnits ─────────────────────────

// One real footage clip on V1 → one unit, source range from in/out, timeline
// range from start/end, trackLabel V<index>, sequenceName from seq.name.
{
  const s = seq({ name: 'EP01 SELECTS', videoTracks: [vtrack(1, [
    clip({ name: 'A001', sourceFile: file('A001.mov', '/vol/A001.mov'),
      inSeconds: 12.5, outSeconds: 20.0, startSeconds: 0, endSeconds: 7.5 }),
  ])] });
  const u = extractCorpusUnits([s]);
  eq('one clip → one unit', u.length, 1);
  eq('startSeconds from source IN', u[0].startSeconds, 12.5);
  eq('endSeconds from source OUT', u[0].endSeconds, 20.0);
  eq('timelineStart from clip start', u[0].timelineStart, 0);
  eq('timelineEnd from clip end', u[0].timelineEnd, 7.5);
  eq('trackLabel V<index>', u[0].trackLabel, 'V1');
  eq('sequenceName carried', u[0].sequenceName, 'EP01 SELECTS');
  eq('sourceClipName = file name', u[0].sourceClipName, 'A001.mov');
}

// sourceClipName precedence: sourceFile.name → clip.name → 'unknown'.
{
  const s = seq({ videoTracks: [vtrack(1, [
    clip({ name: 'CLIPNAME', sourceFile: file('', '/vol/x.mov') }), // file but no file.name → clip.name
    clip({ name: 'BARE-REF' }),                                     // no sourceFile → clip.name
    clip({ name: '', sourceFile: file('REAL.mov') }),              // file.name wins over empty clip.name
  ])] });
  const u = extractCorpusUnits([s]);
  eq('file-without-name falls to clip.name', u[0].sourceClipName, 'CLIPNAME');
  eq('bare-ref uses clip.name', u[1].sourceClipName, 'BARE-REF');
  eq('file.name wins', u[2].sourceClipName, 'REAL.mov');
}

// Skip ONLY clips with neither sourceFile nor name; KEEP a bare-reference real
// clip (name, no sourceFile) — the load-bearing protection for FCP7 repeat refs.
{
  const s = seq({ videoTracks: [vtrack(1, [
    clip({ name: '', sourceFile: null }),          // truly empty → skipped
    clip({ name: 'REPEAT-REF', sourceFile: null }),// real repeat clip → KEPT
    clip({ name: 'X', sourceFile: file('X.mov') }),// real → kept
  ])] });
  const u = extractCorpusUnits([s]);
  eq('empty clip skipped, the other two kept', u.length, 2);
  eq('bare-ref real clip survives (not dropped)', u.some(x => x.sourceClipName === 'REPEAT-REF'), true);
}

// PINNED TENSION: a named generator (title/black) with no sourceFile currently
// LEAKS into the corpus. Locked to current behavior; flipping this is Johnny's
// call (see header). If the skip logic is ever tightened, this assert flips.
{
  const s = seq({ videoTracks: [vtrack(1, [
    clip({ name: 'Title 01', sourceFile: null }),
    clip({ name: 'Black Video', sourceFile: null }),
  ])] });
  const u = extractCorpusUnits([s]);
  eq('LOCKED: named generators currently leak in (documented gap)', u.length, 2);
}

// Audio-track clips are NOT corpus units (video only).
{
  const s = seq({
    videoTracks: [vtrack(1, [clip({ name: 'V', sourceFile: file('V.mov') })])],
    audioTracks: [atrack(1, [clip({ name: 'A', sourceFile: file('A.wav') })])],
  });
  const u = extractCorpusUnits([s]);
  eq('only video clips become units', u.length, 1);
  eq('the unit is the video one', u[0].sourceClipName, 'V.mov');
}

// trackLabel reflects the actual track index (V2, V3...).
{
  const s = seq({ videoTracks: [
    vtrack(1, [clip({ name: 'a', sourceFile: file('a.mov') })]),
    vtrack(2, [clip({ name: 'b', sourceFile: file('b.mov') })]),
  ] });
  const u = extractCorpusUnits([s]);
  eq('V1 label', u[0].trackLabel, 'V1');
  eq('V2 label', u[1].trackLabel, 'V2');
}

// Multiple sequences flatten into one unit list, each tagged with its own name.
{
  const s1 = seq({ name: 'SEQ-A', videoTracks: [vtrack(1, [clip({ name: 'a', sourceFile: file('a.mov') })])] });
  const s2 = seq({ name: 'SEQ-B', videoTracks: [vtrack(1, [
    clip({ name: 'b', sourceFile: file('b.mov') }),
    clip({ name: 'c', sourceFile: file('c.mov') }),
  ])] });
  const u = extractCorpusUnits([s1, s2]);
  eq('flattened across sequences', u.length, 3);
  eq('seq-A unit tagged', u[0].sequenceName, 'SEQ-A');
  eq('seq-B units tagged', u[2].sequenceName, 'SEQ-B');
}

// Empty / no-track inputs → empty array, never throws.
eq('no sequences → []', extractCorpusUnits([]).length, 0);
eq('sequence with no video tracks → []', extractCorpusUnits([seq()]).length, 0);

// ───────────────────────── extractSourceClips ─────────────────────────

// Dedup by file name; count appearances across the sequence.
{
  const s = seq({ videoTracks: [vtrack(1, [
    clip({ sourceFile: file('A001.mov', '/vol/A001.mov') }),
    clip({ sourceFile: file('A001.mov', '/vol/A001.mov') }), // same source, 2nd appearance
    clip({ sourceFile: file('B002.mov', '/vol/B002.mov') }),
  ])] });
  const clips = extractSourceClips([s]);
  eq('two unique sources', clips.length, 2);
  const a = clips.find(c => c.name === 'A001.mov');
  eq('A001 counted twice', a.appearances, 2);
  eq('A001 pathUrl carried', a.pathUrl, '/vol/A001.mov');
  eq('B002 counted once', clips.find(c => c.name === 'B002.mov').appearances, 1);
}

// Clips with NO sourceFile are excluded from the source-clip list entirely
// (it's for file matching — a generator/bare-ref has nothing to match).
{
  const s = seq({ videoTracks: [vtrack(1, [
    clip({ name: 'Title 01', sourceFile: null }),
    clip({ name: 'real', sourceFile: file('R.mov') }),
  ])] });
  const clips = extractSourceClips([s]);
  eq('only sourced clips listed', clips.length, 1);
  eq('the sourced one', clips[0].name, 'R.mov');
}

// Includes BOTH video AND audio tracks (a clip on V+A counts on each).
{
  const s = seq({
    videoTracks: [vtrack(1, [clip({ sourceFile: file('sync.mov', '/v/sync.mov') })])],
    audioTracks: [atrack(1, [clip({ sourceFile: file('sync.mov', '/v/sync.mov') })])],
  });
  const clips = extractSourceClips([s]);
  eq('video+audio dedup to one source', clips.length, 1);
  eq('counted on both tracks', clips[0].appearances, 2);
}

// Dedup key falls back name → pathUrl → clip.name.
{
  const s = seq({ videoTracks: [vtrack(1, [
    clip({ name: 'cn', sourceFile: { id: 'f', name: '', pathUrl: '/only/path.mov' } }),
    clip({ name: 'cn', sourceFile: { id: 'f', name: '', pathUrl: '/only/path.mov' } }),
  ])] });
  const clips = extractSourceClips([s]);
  eq('keyed by pathUrl when name empty', clips.length, 1);
  eq('appearances merged on pathUrl key', clips[0].appearances, 2);
  eq('name falls back to clip.name', clips[0].name, 'cn');
}

// ─── INTENTIONAL A/V-track divergence between the two extractors ───
// extractSourceClips is for Dropbox FILE matching, so it must reach EVERY
// referenced media file — including ones that live only on audio tracks
// (interview .wav, VO, music). extractCorpusUnits, by contrast, is the
// editorial-selection corpus and stays video-only so a synced A/V pair counts
// as ONE decision, not two. This pair of asserts locks both halves so a future
// "these two look the same, let's consolidate" refactor can't silently drop
// audio media from file-matching (or double-count synced clips into the corpus).
{
  // An audio-ONLY source on an audio track (no video counterpart at all).
  const s = seq({
    videoTracks: [vtrack(1, [clip({ sourceFile: file('PIX.mov', '/vol/PIX.mov') })])],
    audioTracks: [atrack(1, [clip({ sourceFile: file('INTERVIEW.wav', '/vol/INTERVIEW.wav') })])],
  });
  const clips = extractSourceClips([s]);
  eq('audio-only source IS file-matched', clips.length, 2);
  eq('the audio source file is present', !!clips.find(c => c.name === 'INTERVIEW.wav'), true);
  // And the corpus stays video-only on the SAME input — the divergence is real.
  const u = extractCorpusUnits([s]);
  eq('corpus excludes the audio source (no double-count)', u.length, 1);
  eq('corpus unit is the picture', u[0].sourceClipName, 'PIX.mov');
}

// Empty input → empty list, never throws.
eq('no sequences → [] (source clips)', extractSourceClips([]).length, 0);
eq('sequence with no tracks → []', extractSourceClips([seq()]).length, 0);

// ── summary ──
const total = pass + fail;
console.log(`\nextract-units: ${pass} passed, ${fail} failed (${total} total)`);
if (fail > 0) process.exit(1);
