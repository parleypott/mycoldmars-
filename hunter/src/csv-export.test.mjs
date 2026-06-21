// Lock the Hunter corpus CSV export against the truthy-zero clobber bug:
// a keepability_score of 0 must export as "0", not an empty cell, while every
// string/null field escapes byte-identically to the old inline escaper.
//
// Run: node hunter/src/csv-export.test.mjs   (auto-discovered by `bun run test`)

import { csvCell, buildCorpusCsv, CORPUS_CSV_HEADERS } from './csv-export.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`✗ ${msg}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`✗ ${msg}`); } };

// A simple, deterministic timecode stub standing in for the real formatTc.
const fmtTc = (s) => {
  if (!Number.isFinite(s)) return '--:--';
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
};

// ── The bug, reproduced RED against the OLD inline escaper ──────────────────
// The old code: csvEscape = (s) => `"${String(s || '').replace(/"/g, '""')}"`
const oldCsvEscape = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
ok(oldCsvEscape(0) === '""', 'RED PROOF: old escaper clobbers numeric 0 to an empty cell');
ok(csvCell(0) === '"0"', 'FIX: csvCell preserves numeric 0 as "0"');

// ── csvCell unit behavior ───────────────────────────────────────────────────
eq(csvCell(0), '"0"', 'numeric 0 -> "0" (the fix)');
eq(csvCell(0.85), '"0.85"', 'numeric 0.85 preserved');
eq(csvCell(1), '"1"', 'numeric 1 preserved');
eq(csvCell(''), '""', 'empty string -> empty cell');
eq(csvCell(null), '""', 'null -> empty cell');
eq(csvCell(undefined), '""', 'undefined -> empty cell');
eq(csvCell('foo'), '"foo"', 'plain string verbatim');
eq(csvCell('a,b'), '"a,b"', 'comma stays inside the quoted cell (CSV-safe)');
eq(csvCell('say "hi"'), '"say ""hi"""', 'inner double-quote doubled');
eq(csvCell('line1\nline2'), '"line1\nline2"', 'newline stays inside the quoted cell');
eq(csvCell('NEG-1.5'), '"NEG-1.5"', 'arbitrary string verbatim');

// No-regression: for every non-zero, non-nullish value csvCell === the old escaper.
for (const v of ['', 'a', 'a,b', 'x"y', 'multi\nline', '0:00', '1.5', 'Project X']) {
  ok(csvCell(v) === oldCsvEscape(v), `no-regression: csvCell === old escaper for ${JSON.stringify(v)}`);
}

// ── buildCorpusCsv end-to-end ───────────────────────────────────────────────
// Headers are joined raw (unquoted) — byte-identical to the original inline export.
const headerLine = CORPUS_CSV_HEADERS.join(',');

// Empty input -> just the header row.
eq(buildCorpusCsv([], fmtTc), headerLine, 'empty units -> header only');
eq(buildCorpusCsv(null, fmtTc), headerLine, 'null units -> header only (no throw)');

// A realistic unit whose clip is scored 0 keepability ("definitely cut").
const zeroUnit = {
  source_clip_name: 'A001_C012.mov',
  media_assets: { tier: 'raw', hunter_projects: { name: 'Burma' } },
  start_seconds: 0,
  end_seconds: 65,
  analyses: [{
    output_json: {
      keepability_score: 0,
      shot_type: 'wide',
      camera_movement: 'static',
      editorial_function: 'establishing',
      emotional_register: 'neutral',
    },
    output_text: 'A quiet establishing wide of the street.',
  }],
};
const csv0 = buildCorpusCsv([zeroUnit], fmtTc);
const lines0 = csv0.split('\n');
eq(lines0[0], headerLine, 'header line correct');
ok(lines0.length === 2, 'one unit -> two lines (header + row)');
// The keepability cell is column index 5 (clip,project,tier,start,end,keepability,...).
const cells0 = lines0[1].split(',');
eq(cells0[5], '"0"', 'END-TO-END: a 0-keepability clip exports "0", not "" (the bug)');
eq(cells0[0], '"A001_C012.mov"', 'clip name cell');
eq(cells0[3], '"0:00"', 'start at 0s -> "0:00" (string, never empty)');
eq(cells0[4], '"1:05"', 'end timecode cell');

// A non-zero score round-trips and a missing analysis -> empty cells.
const mixUnit = {
  source_clip_name: 'B002.mov',
  media_assets: { tier: 'selects', hunter_projects: { name: 'Burma' } },
  start_seconds: 90,
  end_seconds: 95,
  analyses: [{ output_json: { keepability_score: 0.8, shot_type: 'cu' }, output_text: '' }],
};
const noAnalysisUnit = { source_clip_name: 'C003.mov' };
const csvMix = buildCorpusCsv([mixUnit, noAnalysisUnit], fmtTc);
const rowsMix = csvMix.split('\n');
eq(rowsMix[1].split(',')[5], '"0.8"', 'non-zero score 0.8 preserved');
eq(rowsMix[2].split(',')[5], '""', 'missing analysis -> empty keepability cell');
eq(rowsMix[2].split(',')[0], '"C003.mov"', 'unit with no analysis still emits its clip name');

// A clip name with a comma + quote stays a single CSV cell (escaping intact).
const trickyUnit = {
  source_clip_name: 'Take 2, "best".mov',
  analyses: [{ output_json: { keepability_score: 0 }, output_text: 'has, comma' }],
};
const csvTricky = buildCorpusCsv([trickyUnit], fmtTc);
const trickyCells = csvTricky.split('\n')[1];
ok(trickyCells.startsWith('"Take 2, ""best"".mov"'), 'comma+quote clip name escaped as one cell');

if (fail === 0) console.log(`csv-export: ${pass} passed, 0 failed`);
else { console.error(`csv-export: ${pass} passed, ${fail} FAILED`); process.exit(1); }
