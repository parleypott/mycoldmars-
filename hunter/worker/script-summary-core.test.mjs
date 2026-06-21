// Lock for buildScriptSummary — the Hunter Script Copilot's per-script training-summary
// builder (script-summary-core.js, extracted verbatim from build-script-context.mjs).
//
// It turns one Google Docs script snapshot into the compact, diverse summary fed to Gemini
// in analyzeBatch — i.e. it is what TEACHES the copilot Johnny's color language, structure,
// and conventions. A silent regression (the stratified beat sampler dropping the middle,
// the color summary mis-ordered so the model sees the wrong dominant colors first, the
// run-formatter losing a highlight/bold tag, the voice/visual fallback chain breaking)
// corrupts the training corpus with NO signal. Zero coverage before this; this is a
// verifier-layer LOCK (no live bug found — the logic is correct), mutation-proven so it
// goes RED on any regression.
//
// Mutation-proven a real verifier (run from the shell, not the test): editing the source
// and re-running goes RED, restoring → GREEN byte-identical. See the journal/backlog entry.

import { buildScriptSummary } from './script-summary-core.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(`✗ ${msg}`); } }
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}

// A beat with a plain-text voice line (no runs) for index-tracking tests.
const beat = (label) => ({ type: 'beat', voice: { text: label }, visual: { text: label + '-vis' } });
const heading = (text, isTab = false) => ({ type: 'heading', text, isTab });
const docOf = (elements, extra = {}) => ({
  parsed_doc: { title: 'T', elements, stats: { wordCount: 100, coloredRunCount: 5 }, ...extra.doc },
  color_profile: extra.color_profile || {},
});

// ── A. small doc (≤20 beats): EVERY beat sampled, in order ──────────────────────────
{
  const elements = Array.from({ length: 5 }, (_, i) => beat('B' + i));
  const out = buildScriptSummary(docOf(elements), 0);
  for (let i = 0; i < 5; i++) ok(out.includes(`Beat ${i + 1}/5:`), `small doc: Beat ${i + 1}/5 present`);
  ok(out.includes('VOICE: B0'), 'small doc: voice text B0 rendered');
  ok(out.includes('VISUAL: B0-vis'), 'small doc: visual text rendered');
  ok(out.startsWith('=== SCRIPT 1: "T" ==='), 'small doc: title + 1-based script index');
  ok(out.includes('Stats: 5 beats, 100 words, 5 colored runs'), 'small doc: stats line');
}

// Boundary: exactly 20 beats still takes the all-beats path.
{
  const elements = Array.from({ length: 20 }, (_, i) => beat('B' + i));
  const out = buildScriptSummary(docOf(elements), 0);
  ok(out.includes('Beat 1/20:') && out.includes('Beat 20/20:'), '20 beats: first and last both sampled (≤20 path)');
  ok(out.includes('Beat 11/20:'), '20 beats: a middle beat sampled (all-beats path)');
}

// ── B. large doc (>20 beats): start 7 + middle 6 + end 7, deduped; gaps excluded ─────
// 25 beats → start {0..6}, mid=12 {9..14}, end {18..24}. Gaps: 7,8,15,16,17.
{
  const elements = Array.from({ length: 25 }, (_, i) => beat('B' + i));
  const out = buildScriptSummary(docOf(elements), 0);
  // START block (first 7)
  ok(out.includes('Beat 1/25:') && out.includes('VOICE: B0'), '25 beats: START first beat (1/25, B0)');
  ok(out.includes('Beat 7/25:') && out.includes('VOICE: B6'), '25 beats: START last beat (7/25, B6)');
  // MIDDLE block (mid-3..mid+2 = 9..14) — the load-bearing diversity sample
  ok(out.includes('Beat 10/25:') && out.includes('VOICE: B9'), '25 beats: MIDDLE start (10/25, B9)');
  ok(out.includes('Beat 13/25:') && out.includes('VOICE: B12'), '25 beats: MIDDLE center (13/25, B12)');
  ok(out.includes('Beat 15/25:') && out.includes('VOICE: B14'), '25 beats: MIDDLE end (15/25, B14)');
  // END block (last 7 = 18..24)
  ok(out.includes('Beat 19/25:') && out.includes('VOICE: B18'), '25 beats: END first (19/25, B18)');
  ok(out.includes('Beat 25/25:') && out.includes('VOICE: B24'), '25 beats: END last (25/25, B24)');
  // GAPS excluded
  ok(!out.includes('Beat 8/25:'), '25 beats: gap 8/25 NOT sampled');
  ok(!out.includes('Beat 9/25:'), '25 beats: gap 9/25 NOT sampled');
  ok(!out.includes('Beat 16/25:'), '25 beats: gap 16/25 NOT sampled');
  ok(!out.includes('Beat 18/25:'), '25 beats: gap 18/25 NOT sampled');
  // Count: 20 unique sampled beats (7 + 6 + 7, disjoint here)
  const sampled = (out.match(/Beat \d+\/25:/g) || []).length;
  eq(sampled, 20, '25 beats: exactly 20 stratified samples');
}

// ── C. color summary: sorted by count DESC, top-3 sample texts, 50-char slice ────────
{
  const color_profile = {
    '#ff0000': { count: 3, sampleTexts: ['low'] },
    '#00ff00': { count: 30, sampleTexts: ['a', 'b', 'c', 'd'] },
    '#0000ff': { count: 12, sampleTexts: ['mid'] },
  };
  const out = buildScriptSummary(docOf([beat('B0')], { color_profile }), 0);
  const colorsBlock = out.slice(out.indexOf('Colors:'));
  const order = ['#00ff00', '#0000ff', '#ff0000'].map(c => colorsBlock.indexOf(c));
  ok(order[0] < order[1] && order[1] < order[2], 'colors ordered by count DESC (30 > 12 > 3)');
  ok(out.includes('#00ff00: 30x'), 'color count rendered');
  // top-3 sample texts only
  ok(out.includes('"a", "b", "c"') && !out.includes('"d"'), 'only first 3 sample texts shown');
  // RED-proof: an unsorted (insertion-order) color summary would lead with #ff0000, not #00ff00.
  const insertionOrder = Object.keys(color_profile);
  ok(insertionOrder[0] === '#ff0000', 'RED-proof setup: insertion order leads with the LOW-count color');
  ok(colorsBlock.indexOf('#00ff00') < colorsBlock.indexOf('#ff0000'),
     'RED-proof: shipped output leads with the HIGH-count color, not insertion order');
  // 50-char sample slice
  const long = 'x'.repeat(80);
  const out2 = buildScriptSummary(docOf([beat('B0')], { color_profile: { '#abc': { count: 1, sampleTexts: [long] } } }), 0);
  ok(out2.includes('"' + 'x'.repeat(50) + '"') && !out2.includes('x'.repeat(51)), 'sample text sliced to 50 chars');
  // no colors
  ok(buildScriptSummary(docOf([beat('B0')]), 0).includes('  (no colors)'), 'empty color_profile → "(no colors)"');
}

// ── D. fmtRuns: highlight / bold / italic / struck tags; text trim + 80-char slice ───
{
  const runBeat = (runs) => ({ type: 'beat', voice: { runs }, visual: { text: 'v' } });
  const out = (runs) => buildScriptSummary(docOf([runBeat(runs)]), 0);
  ok(out([{ text: 'plain' }]).includes('VOICE: plain'), 'fmtRuns: plain run = bare text');
  ok(out([{ text: 'hi', style: { highlight: 'YELLOW' } }]).includes('VOICE: [YELLOW: hi]'), 'fmtRuns: highlight tag');
  ok(out([{ text: 'b', style: { bold: true } }]).includes('VOICE: [BOLD: b]'), 'fmtRuns: BOLD tag');
  ok(out([{ text: 'i', style: { italic: true } }]).includes('VOICE: [ITALIC: i]'), 'fmtRuns: ITALIC tag');
  ok(out([{ text: 's', style: { strikethrough: true } }]).includes('VOICE: [STRUCK: s]'), 'fmtRuns: STRUCK tag');
  ok(out([{ text: 'x', style: { highlight: 'RED', bold: true, italic: true } }]).includes('VOICE: [RED/BOLD/ITALIC: x]'),
     'fmtRuns: combined tags in order highlight/bold/italic');
  // trim + 80-char slice
  const big = '  ' + 'y'.repeat(120) + '  ';
  ok(out([{ text: big }]).includes('VOICE: ' + 'y'.repeat(80)) && !out([{ text: big }]).includes('y'.repeat(81)),
     'fmtRuns: text trimmed and sliced to 80 chars');
  // multiple runs joined by space
  ok(out([{ text: 'one' }, { text: 'two' }]).includes('VOICE: one two'), 'fmtRuns: runs joined by space');
  // empty-text runs filtered
  ok(out([{ text: '' }, { text: 'kept' }]).includes('VOICE: kept'), 'fmtRuns: blank run filtered out');
}

// ── E. voice/visual fallback chain: runs → text → '(empty)' ──────────────────────────
{
  // runs present and non-empty → runs win
  const b1 = { type: 'beat', voice: { runs: [{ text: 'fromRuns' }], text: 'fromText' }, visual: { text: 'v' } };
  ok(buildScriptSummary(docOf([b1]), 0).includes('VOICE: fromRuns'), 'fallback: runs win over text');
  // runs absent → text
  const b2 = { type: 'beat', voice: { text: 'onlyText' }, visual: { text: 'v' } };
  ok(buildScriptSummary(docOf([b2]), 0).includes('VOICE: onlyText'), 'fallback: text when no runs');
  // runs all-empty AND no text → '(empty)'
  const b3 = { type: 'beat', voice: { runs: [{ text: '' }] }, visual: {} };
  const o3 = buildScriptSummary(docOf([b3]), 0);
  ok(o3.includes('VOICE: (empty)'), 'fallback: (empty) when runs blank and no text');
  ok(o3.includes('VISUAL: (empty)'), 'fallback: visual (empty) when nothing present');
  // text sliced to 100
  const b4 = { type: 'beat', voice: { text: 'z'.repeat(140) }, visual: { text: 'v' } };
  const o4 = buildScriptSummary(docOf([b4]), 0);
  ok(o4.includes('VOICE: ' + 'z'.repeat(100)) && !o4.includes('z'.repeat(101)), 'fallback: text sliced to 100 chars');
}

// ── F. headings, title, stats, index ─────────────────────────────────────────────────
{
  const elements = [heading('ACT ONE'), heading('TAB', true), heading('ACT TWO'), beat('B0')];
  const out = buildScriptSummary(docOf(elements), 4);
  ok(out.includes('Headings: ACT ONE → ACT TWO'), 'headings joined with arrow, isTab excluded');
  ok(out.startsWith('=== SCRIPT 5: "T" ==='), 'script index is 1-based (index 4 → SCRIPT 5)');
  // no headings → (none)
  ok(buildScriptSummary(docOf([beat('B0')]), 0).includes('Headings: (none)'), 'no headings → (none)');
  // missing stats → fallbacks
  const noStats = { parsed_doc: { title: 'X', elements: [beat('B0')] }, color_profile: {} };
  const o2 = buildScriptSummary(noStats, 0);
  ok(o2.includes('Stats: 1 beats, ? words, 0 colored runs'), 'missing stats → ? words, 0 colored runs');
}

console.log(`script-summary-core: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + fails.join('\n')); process.exit(1); }
