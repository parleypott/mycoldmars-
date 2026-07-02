/**
 * Locks the timecode-chip `day` attr in the WP-01 Burma Script editor's PRIMARY build path
 * (buildEditorDocument). Run: node src/document-builder-day-attr.test.mjs  (suite runs it under bun).
 *
 * WHY THIS EXISTS: every embedded broadcast timecode in the editor renders as a clickable chip
 * that DISPLAYS "DAY N · …" so the producer knows which shoot day a soundbite/visual belongs to.
 * That `day` attr is threaded by two cooperating mechanisms in document-builder.js:
 *   1. CONTEXT SEED — buildEditorDocument tracks a `runningDay` from each block's own
 *      timecode.day (sot/broll) or a "DAY N" in its source, calls setContextDay(runningDay),
 *      and threads it ACROSS blocks so a later day-less block still shows the right day.
 *   2. IN-PROSE OVERRIDE — pushTextWithTimecodes scans the prose before each timecode for a
 *      "DAY N" (DAY_LOCAL) and lets it override the context for chips that follow it in the
 *      same fragment (documented: "the nearest preceding DAY N").
 *
 * document-builder.test.mjs only asserts round-trip TEXT (docToBlocks(buildEditorDocument(...))),
 * so BOTH mechanisms were unlocked: a refactor could stamp the wrong day (or null) on every chip
 * while the text round-trip stayed green — a silent producer-facing regression. This file walks
 * the built ProseMirror doc and asserts the chip `day` directly. Mutation-proven: neutering the
 * in-prose override (drop the DAY_LOCAL update in pushTextWithTimecodes) reddens C1/C3; breaking
 * the runningDay thread or the context seed (`let localDay = _ctxDay`) reddens C2.
 */
import { buildEditorDocument } from './document-builder.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};

// Collect every timecode-chip text node with its stamped `day`, in document order.
const chips = (node, acc = []) => {
  if (Array.isArray(node)) { node.forEach((n) => chips(n, acc)); return acc; }
  if (node && typeof node === 'object') {
    if (node.type === 'text' && Array.isArray(node.marks)) {
      const tc = node.marks.find((m) => m.type === 'timecode');
      if (tc) acc.push({ tc: node.text, day: tc.attrs?.day });
    }
    if (node.content) chips(node.content, acc);
  }
  return acc;
};
const chipsOf = (blocks) => chips(buildEditorDocument(blocks));

// ── C1 — a "DAY N" in one block's TEXT (no timecode) seeds runningDay and THREADS to a later
// timecode-bearing, day-less block. Isolates the block-text DAY branch of blockDay: the DAY and
// the timecode live in SEPARATE blocks, so the in-prose override can't also supply it. ──
const c1 = chipsOf([
  { id: 'v0', type: 'vo', voStatus: 'todo', text: 'opening DAY 3 setup notes' },
  { id: 'v1', type: 'vo', voStatus: 'todo', text: 'later 00:09:19:03 and 00:10:00:00 more' },
]);
eq(c1.length, 2, 'C1: two prose timecodes become two chips');
eq(c1[0]?.day, 3, 'C1: block-text DAY 3 seeds runningDay, threads to the next block chip');
eq(c1[1]?.day, 3, 'C1: threaded day persists to the later same-fragment chip');

// ── C2 — block timecode.day seeds the chip, and runningDay THREADS to a later day-less block ──
const c2 = chipsOf([
  { id: 's1', type: 'sot', timecode: { tc: '02:00:00:00', day: 2 }, text: 'JACK: 00:01:02:03 hello' },
  { id: 'v2', type: 'vo', voStatus: 'todo', text: 'later 00:05:00:00 shot' },
]);
eq(c2.length, 2, 'C2: one chip per block prose timecode');
eq(c2[0]?.day, 2, 'C2: block timecode.day=2 seeds its own prose chip');
eq(c2[1]?.day, 2, 'C2: runningDay=2 threads across to the day-less vo block');

// ── C3 — in-prose "DAY 3" OVERRIDES a differing context seed (day=1) ──
const c3 = chipsOf([
  { id: 's3', type: 'sot', timecode: { tc: '02:00:00:00', day: 1 }, text: 'JACK: intro DAY 3 00:07:00:00 here' },
]);
eq(c3.length, 1, 'C3: one prose chip');
eq(c3[0]?.day, 3, 'C3: in-prose DAY 3 beats the block seed day=1 for the following chip');

console.log(`\ndocument-builder-day-attr: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
