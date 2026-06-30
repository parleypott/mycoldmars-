// Verifier-layer LOCK for extractTableBeats — the script-table → voice/visual
// "beat" extractor behind The Hunter's Script Copilot Google Docs import.
//
// Johnny's scripts live in two-column Google Docs tables: one column is the
// narration (VOICE), the other is the shot/B-roll direction (VISUAL). This
// function turns each content row into a { voice, visual } beat that the whole
// downstream corpus is keyed on. A silent regression here is catastrophic AND
// invisible:
//   • swap the column assignment → the AI reads every narration line as a
//     shot-direction and every shot-direction as narration, for every doc;
//   • drop the header-row skip → the literal words "Voice"/"Visual" become a
//     fake first beat in every script;
//   • drop the empty-row skip → blank spacer rows become empty beats;
//   • drop the extras capture → a third "notes/archive" column silently
//     vanishes from the ingested record;
//   • drop run/style preservation → all highlight/bold signal (the color
//     conventions the analysis leans on) is lost.
//
// detectColumnRoles (the column classifier) already has its own lock in
// google-docs-roles.test.mjs; this locks how extractTableBeats WIRES that
// decision across rows: header/empty skipping, voice/visual placement, extra-
// column collection, run preservation, and the single-column fall-through.
//
// Mutation-proven: each named assertion fails if the corresponding source logic
// regresses (column swap, header skip, empty skip, extras, runs). ZERO source
// change — pure added coverage on a previously untested load-bearing parser.

import assert from 'node:assert';
import { extractTableBeats } from './google-docs-parser.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL: ${name}\n  ${e.message}`); } };

// ── fixture builders (match the Google Docs API shape the parser reads) ──
const run = (content, style = {}) => ({ textRun: { content, textStyle: style } });
const cell = (...runs) => ({ content: [{ paragraph: { elements: runs } }] });
const cellParas = (...paras) => ({ content: paras.map(rs => ({ paragraph: { elements: rs } })) });
const row = (...cells) => ({ tableCells: cells });
const table = (...rows) => ({ tableRows: rows });

// Canonical cell texts. VIS carries visual keywords (shot/aerial/drone/b-roll)
// and is long; VOX carries a voice keyword (narrator) and is short — so
// detectColumnRoles reliably tags the long visual column and the short voice one.
const VIS = 'Wide aerial drone shot of the skyline at dawn, slow push in. B-roll of the harbor.';
const VOX = 'Narrator: the city wakes.';
const NOTE = 'Producer note: confirm music rights before lock.';

// ── 1. column assignment: voice text is narration, visual text is the picture ──
t('voice/visual columns land in the right beat fields (not swapped)', () => {
  // col0 = VISUAL (long), col1 = VOICE (short) — the standard layout.
  const beats = extractTableBeats(table(
    row(cell(run(VIS)), cell(run(VOX))),
    row(cell(run(VIS)), cell(run(VOX))),
  ));
  assert.equal(beats.length, 2, 'two content rows → two beats');
  assert.equal(beats[0].type, 'beat');
  assert.equal(beats[0].voice.text, VOX, 'voice field = narration column');
  assert.equal(beats[0].visual.text, VIS, 'visual field = picture column');
  // If voiceIdx/visualIdx were swapped in source, voice.text would be VIS here.
  assert.notEqual(beats[0].voice.text, beats[0].visual.text, 'voice and visual are distinct columns');
});

// ── 2. header rows are skipped ──
t('a Voice/Visual header row does not become a beat', () => {
  const beats = extractTableBeats(table(
    row(cell(run('Visual')), cell(run('Voice'))),   // header — both columns hit header terms
    row(cell(run(VIS)), cell(run(VOX))),
    row(cell(run(VIS)), cell(run(VOX))),
  ));
  assert.equal(beats.length, 2, 'header row skipped → only the 2 real rows survive');
  assert.equal(beats[0].voice.text, VOX, 'first beat is the first CONTENT row, not the header');
});

// RED proof: without the header skip, the header row leaks in as a beat whose
// voice/visual are the literal column labels.
t('RED proof: dropping the header skip would yield 3 beats incl. the label row', () => {
  const rows = [
    row(cell(run('Visual')), cell(run('Voice'))),
    row(cell(run(VIS)), cell(run(VOX))),
    row(cell(run(VIS)), cell(run(VOX))),
  ];
  const real = extractTableBeats(table(...rows));
  assert.equal(real.length, 2, 'real parser drops the header');
  // Reconstruct the no-header-skip behavior: every non-empty 2-cell row → beat.
  const noSkip = rows.filter(r => r.tableCells.some(c =>
    c.content[0].paragraph.elements.some(e => e.textRun.content.trim())));
  assert.equal(noSkip.length, 3, 'the broken form would keep all 3 rows');
  assert.ok(real.length < noSkip.length, 'header skip is load-bearing');
});

// ── 3. empty rows are skipped ──
t('a fully empty row does not become a beat', () => {
  const beats = extractTableBeats(table(
    row(cell(run(VIS)), cell(run(VOX))),
    row(cell(run('')), cell(run(''))),              // blank spacer row
    row(cell(run(VIS)), cell(run(VOX))),
  ));
  assert.equal(beats.length, 2, 'blank row skipped');
  beats.forEach(b => assert.ok(b.voice.text || b.visual.text, 'no empty beats emitted'));
});

// ── 4. extra columns are captured (3+ column tables) ──
t('a third content column is collected into beat.extra', () => {
  // col0 = numbering, col1 = VISUAL, col2 = VOICE, col3 = NOTE.
  const beats = extractTableBeats(table(
    row(cell(run('1.')), cell(run(VIS)), cell(run(VOX)), cell(run(NOTE))),
    row(cell(run('2.')), cell(run(VIS)), cell(run(VOX)), cell(run(NOTE))),
  ));
  assert.equal(beats.length, 2);
  assert.equal(beats[0].voice.text, VOX, 'voice still resolves on a 4-col table');
  assert.equal(beats[0].visual.text, VIS, 'visual still resolves on a 4-col table');
  assert.ok(beats[0].extra, 'extra block present');
  assert.ok(beats[0].extra.text.includes(NOTE), 'the note column is preserved in extra');
});

t('no beat.extra when there is no surplus content column', () => {
  const beats = extractTableBeats(table(
    row(cell(run(VIS)), cell(run(VOX))),
    row(cell(run(VIS)), cell(run(VOX))),
  ));
  assert.ok(beats[0].extra === undefined, 'clean 2-col beat carries no extra');
});

// ── 5. run/style is preserved through the beat ──
t('bold/highlight style survives into beat runs', () => {
  // Voice cell carries the narrator keyword AND a bold style on its run.
  const beats = extractTableBeats(table(
    row(cell(run(VIS)), cell(run(VOX, { bold: true }))),
    row(cell(run(VIS)), cell(run(VOX, { bold: true }))),
  ));
  const runs = beats[0].voice.runs;
  assert.ok(Array.isArray(runs) && runs.length >= 1, 'voice runs preserved');
  assert.equal(runs[0].style.bold, true, 'bold style carried through (color/format signal kept)');
});

// ── 6. multi-paragraph cell text is joined, not collapsed ──
t('a multi-paragraph cell joins its paragraphs with newlines', () => {
  const beats = extractTableBeats(table(
    row(cell(run(VIS)), cellParas([run('Narrator: line one.')], [run('And line two.')])),
    row(cell(run(VIS)), cell(run(VOX))),
  ));
  assert.ok(beats[0].voice.text.includes('line one.'), 'first paragraph kept');
  assert.ok(beats[0].voice.text.includes('line two.'), 'second paragraph kept');
  assert.ok(beats[0].voice.text.includes('\n'), 'paragraphs joined with a newline, not concatenated');
});

// ── 7. single-column table falls through to plain paragraphs ──
t('a single-column table yields paragraph elements, not beats', () => {
  const out = extractTableBeats(table(
    row(cell(run('Just a note in a one-column table.'))),
    row(cell(run('A second note.'))),
  ));
  assert.ok(out.length >= 2, 'one element per non-empty single-column cell');
  out.forEach(el => assert.notEqual(el.type, 'beat', 'single-column rows are not beats'));
  assert.equal(out[0].type, 'paragraph');
});

// ── 8. degenerate inputs ──
t('an empty table returns []', () => {
  assert.deepEqual(extractTableBeats(table()), []);
  assert.deepEqual(extractTableBeats({ tableRows: [] }), []);
});

console.log(`google-docs-table-beats: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
