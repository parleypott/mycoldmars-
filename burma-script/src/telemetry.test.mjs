/*
 * telemetry.test.mjs — PERF-3/PERF-7/ux-10 guard.
 *
 * The telemetry recompute (full-doc getJSON + nodeText word-recount + outline rebuild) was moved
 * OFF the synchronous per-keystroke path onto a trailing 200ms debounce in Editor.jsx onUpdate, so a
 * 225-block doc no longer serializes + tree-walks on every keypress. This test locks the PURE telemetry
 * output (words / blocks / sot / done / scaffold / outline) so the debounce refactor can never silently
 * change WHAT telemetry reports — only WHEN it runs. It walks the same table-spine flatten the editor uses.
 */
import { telemetry } from './Editor.jsx';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name, extra != null ? '— ' + JSON.stringify(extra) : ''); }
}

// Build a doc using the table-spine shape (tableRow > tableCell(full) > block) the editor produces.
function row(block) {
  return { type: 'tableRow', attrs: { cols: 1 }, content: [
    { type: 'tableCell', attrs: { role: 'full' }, content: [block] },
  ] };
}
function para(text) { return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }; }

const doc = {
  type: 'doc',
  content: [
    row({ type: 'chapterBlock', attrs: { blockId: 'c1' }, content: [para('Chapter One')] }),
    row({ type: 'sceneBlock', attrs: { blockId: 's1' }, content: [para('Scene A')] }),
    row({ type: 'scriptStart' }),
    row({ type: 'voBlock', attrs: { blockId: 'v1' }, content: [para('hello there friend')] }),       // 3 words
    row({ type: 'oncamBlock', attrs: { blockId: 'o1' }, content: [para('one two')] }),                 // 2 words
    row({ type: 'montageBlock', attrs: { blockId: 'm1' }, content: [para('alpha beta gamma delta')] }),// 4 words
    row({ type: 'sotBlock', attrs: { blockId: 't1', done: true }, content: [para('soundbite')] }),
    row({ type: 'sotBlock', attrs: { blockId: 't2', done: false }, content: [para('soundbite two')] }),
    row({ type: 'binBlock', attrs: { blockId: 'b1', scaffold: true }, content: [para('a note')] }),
  ],
};

const t = telemetry(doc);

// scriptStart is a decorative divider and must NOT count as a block.
ok('blocks excludes scriptStart', t.blocks === 8, t.blocks);
ok('words = vo+oncam+montage only', t.words === 9, t.words); // 3+2+4
ok('sot count', t.sot === 2, t.sot);
ok('done count', t.done === 1, t.done);
ok('scaffold count', t.scaffold === 1, t.scaffold);
ok('outline has chapter+scene', t.outline.length === 2, t.outline);
ok('outline chapter level 0', t.outline[0].level === 0 && t.outline[0].title === 'Chapter One', t.outline[0]);
ok('outline scene level 1', t.outline[1].level === 1 && t.outline[1].title === 'Scene A', t.outline[1]);
ok('outline keys by blockId', t.outline[0].id === 'c1' && t.outline[1].id === 's1', t.outline.map((o) => o.id));

// Empty / nullish doc must be safe (telemetry runs on a trailing timer; the editor may have unmounted).
const empty = telemetry({ type: 'doc', content: [] });
ok('empty doc safe', empty.blocks === 0 && empty.words === 0 && empty.outline.length === 0, empty);
ok('nullish doc safe', (() => { const e = telemetry(null); return e.blocks === 0 && e.words === 0; })(), 'null');

console.log(`telemetry: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
