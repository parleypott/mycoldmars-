// Tests for the FCP7/Premiere XML parse core (hunter/worker/selects-parse-core.js),
// the selects-ingest worker's pure parse cluster. Imports the REAL shipped
// functions and exercises them with @xmldom — the same DOM implementation the
// worker uses at runtime — so this runs the byte-for-byte production code.
//
// REAL FIX locked here: the fileDefs resolution. In FCP7/Premiere XML a <file>
// is defined ONCE with full <name>/<pathurl>, then referenced on every later
// clip by a bare <file id="..."/> (no children). Selects sequences pull many
// cuts from one source file, so most clips after the first per-file are bare
// references. Before the fix, parseClipItem dropped those to sourceFile=null:
//   - extractCorpusUnits then fell back to the clipitem's own <name>, which —
//     when an editor renames a clip on the timeline — DIFFERS from the source
//     file name, so the same source split across two sourceClipNames and the
//     worker's selects→raw cross-reference (rawUnitsMap.get(sourceClipName))
//     missed for every renamed repeat cut.
//   - the unique-source count was undercounted.
// buildFileDefs + the bare-ref resolve make every repeat cut carry its real
// source name, consistent with the first reference.
//
// Run: bun hunter/worker/selects-parse-core.test.mjs

import { DOMParser } from '@xmldom/xmldom';
import {
  parseFCP7XML,
  extractCorpusUnits,
  buildFileDefs,
  parseClipItem,
  normalizeSourceFrames,
  getText,
  getNum,
  getDirectChildren,
  isNestedInClipItem,
} from './selects-parse-core.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

// A realistic selects sequence: file-1 fully defined on the first cut, then
// referenced by bare <file id="file-1"/> on two repeat cuts (one of which the
// editor renamed on the timeline). file-2 is a second source, fully defined.
const SELECTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="4">
  <sequence id="seq-1">
    <name>SELECTS V1</name>
    <duration>1000</duration>
    <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <video>
        <track>
          <clipitem id="ci-1">
            <name>A001_C001.mov</name>
            <start>0</start><end>48</end><in>100</in><out>148</out><duration>48</duration>
            <file id="file-1"><name>A001_C001.mov</name><pathurl>file:///vol/A001_C001.mov</pathurl></file>
          </clipitem>
          <clipitem id="ci-2">
            <name>A001_C001.mov</name>
            <start>48</start><end>96</end><in>200</in><out>248</out><duration>48</duration>
            <file id="file-1"/>
          </clipitem>
          <clipitem id="ci-3">
            <name>RENAMED ON TIMELINE</name>
            <start>96</start><end>144</end><in>300</in><out>348</out><duration>48</duration>
            <file id="file-1"/>
          </clipitem>
          <clipitem id="ci-4">
            <name>B002_C005.mov</name>
            <start>144</start><end>192</end><in>10</in><out>58</out><duration>48</duration>
            <file id="file-2"><name>B002_C005.mov</name><pathurl>file:///vol/B002_C005.mov</pathurl></file>
          </clipitem>
        </track>
      </video>
    </media>
  </sequence>
</xmeml>`;

// ── buildFileDefs ──
{
  const doc = new DOMParser().parseFromString(SELECTS_XML, 'text/xml');
  const defs = buildFileDefs(doc);
  ok(defs instanceof Map, 'buildFileDefs returns a Map');
  eq(defs.size, 2, 'two distinct file ids defined');
  eq(defs.get('file-1')?.name, 'A001_C001.mov', 'file-1 full def name recorded');
  eq(defs.get('file-1')?.pathUrl, 'file:///vol/A001_C001.mov', 'file-1 pathurl recorded');
  eq(defs.get('file-2')?.name, 'B002_C005.mov', 'file-2 full def name recorded');
  // A bare-only id (no full def anywhere) is NOT recorded.
  const bareDoc = new DOMParser().parseFromString(
    `<xmeml><sequence><name>S</name><media><video><track><clipitem><name>C</name><file id="ghost"/></clipitem></track></video></media></sequence></xmeml>`,
    'text/xml');
  eq(buildFileDefs(bareDoc).size, 0, 'a bare-only file id with no full def is not recorded');
}

// ── parseFCP7XML end-to-end + the fix ──
{
  const seqs = parseFCP7XML(SELECTS_XML);
  eq(seqs.length, 1, 'one top-level sequence parsed');
  const clips = seqs[0].videoTracks[0].clips;
  eq(clips.length, 4, 'all four cuts parsed');

  // The fix: bare repeat refs resolve to their real source file.
  eq(clips[1].sourceFile?.name, 'A001_C001.mov', 'bare repeat ref (ci-2) resolves source name');
  eq(clips[1].sourceFile?.id, 'file-1', 'bare repeat ref keeps the file id');
  eq(clips[1].sourceFile?.pathUrl, 'file:///vol/A001_C001.mov', 'bare repeat ref resolves pathurl');
  // THE load-bearing case: a renamed timeline clip whose file is a bare ref.
  eq(clips[2].name, 'RENAMED ON TIMELINE', 'ci-3 keeps its timeline name');
  eq(clips[2].sourceFile?.name, 'A001_C001.mov', 'renamed clip still resolves its real source file');
  // First (full-def) reference is unchanged.
  eq(clips[0].sourceFile?.name, 'A001_C001.mov', 'first full-def ref unchanged');
  eq(clips[3].sourceFile?.name, 'B002_C005.mov', 'second source full-def ref unchanged');

  // Frame→seconds at 24fps, rounded to 2dp (in/out are the SOURCE range).
  eq(clips[0].inSeconds, Math.round((100 / 24) * 100) / 100, 'inSeconds at 24fps');
  eq(clips[0].outSeconds, Math.round((148 / 24) * 100) / 100, 'outSeconds at 24fps');
}

// ── extractCorpusUnits: source-name consistency (the real win) ──
{
  const units = extractCorpusUnits(parseFCP7XML(SELECTS_XML));
  eq(units.length, 4, 'four corpus units');
  // All three file-1 cuts (including the renamed one) now key to the SAME
  // source name — so the worker's selects→raw cross-reference matches them all.
  const file1Names = units.slice(0, 3).map(u => u.sourceClipName);
  ok(file1Names.every(n => n === 'A001_C001.mov'),
    `all three file-1 cuts share one sourceClipName — got ${JSON.stringify(file1Names)}`);
  eq(units[3].sourceClipName, 'B002_C005.mov', 'second source keeps its name');
  eq(units[0].trackLabel, 'V1', 'track label V1');
  eq(units[0].sequenceName, 'SELECTS V1', 'sequence name carried');
}

// ── No-regression: generators, skips, NTSC, empties ──
{
  // A title/black generator clip has a <name> but NO <file> — kept, source null.
  const genXml = `<xmeml><sequence><name>S</name><media><video><track>
    <clipitem id="g1"><name>Black Video</name><start>0</start><end>24</end><in>0</in><out>24</out></clipitem>
    <clipitem id="c1"><name>X.mov</name><start>24</start><end>48</end><in>0</in><out>24</out><file id="f1"><name>X.mov</name></file></clipitem>
  </track></video></media></sequence></xmeml>`;
  const gseq = parseFCP7XML(genXml);
  const gclips = gseq[0].videoTracks[0].clips;
  eq(gclips[0].sourceFile, null, 'generator clip has null sourceFile');
  const gunits = extractCorpusUnits(gseq);
  eq(gunits.length, 2, 'generator kept (has a name)');
  eq(gunits[0].sourceClipName, 'Black Video', 'generator falls back to clip name');

  // NTSC 30→29.97
  const ntscXml = `<xmeml><sequence><name>N</name><rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate>
    <media><video><track><clipitem><name>C</name><start>0</start><end>30</end><in>0</in><out>30</out>
    <file id="f1"><name>C.mov</name></file></clipitem></track></video></media></sequence></xmeml>`;
  eq(parseFCP7XML(ntscXml)[0].fps, 29.97, 'NTSC timebase 30 → 29.97 fps');

  // NTSC 60→59.94 — the divergent-weaker copy bug: the worker's old inline
  // derivation fell through on timebase 60, reading 59.94p footage as flat 60fps
  // and inflating every source timecode ~0.1%. Now via shared deriveFps.
  // out=360 frames is chosen so the 0.1% rate error crosses a 2-decimal boundary:
  // 360/59.94 = 6.01s but 360/60 = 6.00s — so this assertion actually distinguishes
  // the fixed rate from the buggy flat-60, not just the fps field.
  const ntsc60Xml = `<xmeml><sequence><name>N60</name><rate><timebase>60</timebase><ntsc>TRUE</ntsc></rate>
    <media><video><track><clipitem><name>C</name><start>0</start><end>360</end><in>0</in><out>360</out>
    <file id="f1"><name>C.mov</name></file></clipitem></track></video></media></sequence></xmeml>`;
  const seq60 = parseFCP7XML(ntsc60Xml)[0];
  eq(seq60.fps, 59.94, 'NTSC timebase 60 → 59.94 fps (was flat 60 — the bug)');
  eq(seq60.videoTracks[0].clips[0].outSeconds, Math.round((360 / 59.94) * 100) / 100,
     'outSeconds at 59.94 (6.01s) not flat 60 (6.00s) — exposes the ~0.1% drift');

  // "Nested Sequence N" auto-names are skipped.
  const nestedNameXml = `<xmeml><sequence><name>Nested Sequence 2</name><media><video><track>
    <clipitem><name>C</name><start>0</start><end>24</end><in>0</in><out>24</out><file id="f1"><name>C.mov</name></file></clipitem>
  </track></video></media></sequence></xmeml>`;
  eq(parseFCP7XML(nestedNameXml).length, 0, 'auto-named "Nested Sequence N" skipped');

  // Empty sequence (no clips) skipped.
  const emptyXml = `<xmeml><sequence><name>Empty</name><media><video><track></track></video></media></sequence></xmeml>`;
  eq(parseFCP7XML(emptyXml).length, 0, 'empty sequence skipped');

  // A sequence nested inside a clipitem is not treated as top-level.
  const nestSeqXml = `<xmeml><sequence><name>Top</name><media><video><track>
    <clipitem><name>C</name><start>0</start><end>24</end><in>0</in><out>24</out><file id="f1"><name>C.mov</name></file>
      <sequence id="inner"><name>Inner</name><media><video><track>
        <clipitem><name>D</name><start>0</start><end>24</end><in>0</in><out>24</out><file id="f2"><name>D.mov</name></file></clipitem>
      </track></video></media></sequence>
    </clipitem>
  </track></video></media></sequence></xmeml>`;
  const ns = parseFCP7XML(nestSeqXml);
  eq(ns.length, 1, 'only the top-level sequence is returned (nested skipped)');
  eq(ns[0].name, 'Top', 'top sequence name');
}

// ── helper units ──
{
  const doc = new DOMParser().parseFromString(
    `<root><a>  hi  </a><n>3.5</n><b>x</b><b>y</b></root>`, 'text/xml');
  const root = doc.documentElement;
  eq(getText(root, 'a'), 'hi', 'getText trims');
  eq(getText(root, 'missing'), '', 'getText missing → empty');
  eq(getText(null, 'a'), '', 'getText null el → empty');
  eq(getNum(root, 'n'), 3.5, 'getNum parses float');
  eq(getNum(root, 'a'), 0, 'getNum non-numeric → 0');
  eq(getDirectChildren(root, 'b').length, 2, 'getDirectChildren counts direct matches');
}

// ── FCP7 "-1" unset-in/out sentinel: no negative source timecodes ──
// FCP7's interchange format writes -1 for an UNTRIMMED source in/out ("use the
// full media"); FCP7-native and DaVinci Resolve FCP7-XML exports emit it. Left
// raw, -1/fps gives a NEGATIVE source timecode that poisons the corpus
// (extractCorpusUnits keys each unit on in/outSeconds). normalizeSourceFrames
// clamps it: -1 in → 0, -1 out → in + duration (run `duration` frames from in).
{
  // pure helper — the contract, directly.
  eq(JSON.stringify(normalizeSourceFrames(-1, -1, 48)), JSON.stringify({ inPoint: 0, outPoint: 48 }),
    'both unset (-1) → in 0, out in+duration');
  eq(JSON.stringify(normalizeSourceFrames(100, -1, 48)), JSON.stringify({ inPoint: 100, outPoint: 148 }),
    'unset out only → in + duration');
  eq(JSON.stringify(normalizeSourceFrames(-1, 240, 48)), JSON.stringify({ inPoint: 0, outPoint: 240 }),
    'unset in only → 0, out kept');
  eq(JSON.stringify(normalizeSourceFrames(-1, -1, 0)), JSON.stringify({ inPoint: 0, outPoint: 0 }),
    'both unset with unknown duration → 0/0 (non-negative, never inverted)');
  // Byte-identical for every clip with valid (>=0) in/out — the no-regression leg.
  eq(JSON.stringify(normalizeSourceFrames(100, 148, 48)), JSON.stringify({ inPoint: 100, outPoint: 148 }),
    'valid in/out pass through unchanged');
  eq(JSON.stringify(normalizeSourceFrames(0, 24, 24)), JSON.stringify({ inPoint: 0, outPoint: 24 }),
    'zero-in valid clip unchanged');

  // End-to-end through parseFCP7XML: a full-media B-roll cut with <in>-1/<out>-1.
  const sentinelXml = `<xmeml><sequence><name>S</name>
    <rate><timebase>24</timebase><ntsc>FALSE</ntsc></rate>
    <media><video><track>
      <clipitem id="c1"><name>BROLL.mov</name>
        <start>0</start><end>48</end><in>-1</in><out>-1</out><duration>48</duration>
        <file id="f1"><name>BROLL.mov</name><pathurl>file:///vol/BROLL.mov</pathurl></file>
      </clipitem>
    </track></video></media></sequence></xmeml>`;
  const sclip = parseFCP7XML(sentinelXml)[0].videoTracks[0].clips[0];
  ok(sclip.inSeconds >= 0, `sentinel in never negative — got ${sclip.inSeconds}`);
  ok(sclip.outSeconds >= 0, `sentinel out never negative — got ${sclip.outSeconds}`);
  eq(sclip.inSeconds, 0, 'sentinel in → 0s');
  eq(sclip.outSeconds, Math.round((48 / 24) * 100) / 100, 'sentinel out → (in+duration)/fps = 2s');
  // The corpus unit carries a clean, forward [0, 2] source range (not [-0.04, -0.04]).
  const sunit = extractCorpusUnits(parseFCP7XML(sentinelXml))[0];
  ok(sunit.startSeconds >= 0 && sunit.endSeconds >= sunit.startSeconds,
    `corpus source range is forward & non-negative — got [${sunit.startSeconds}, ${sunit.endSeconds}]`);

  // INLINE RED proof: the OLD raw behavior (no normalize) WOULD have produced a
  // negative source timecode. Reconstruct it and assert it was broken.
  const rawIn = -1, fps = 24;
  const oldInSeconds = Math.round((rawIn / fps) * 100) / 100;
  ok(oldInSeconds < 0, `old raw -1/fps was negative (${oldInSeconds}) — the bug this locks`);
}

console.log(`selects-parse-core: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
