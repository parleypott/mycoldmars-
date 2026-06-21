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

console.log(`selects-parse-core: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
