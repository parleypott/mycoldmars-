// PASTE REGRESSION — "pasting DAY 1 00:09:44:16 still doesn't chip" (Johnny, reported 10×).
//
// ROOT-CAUSE FINDING (2026-07-22, evidence in a headless-Chromium harness driving a REAL paste event
// through the production plugin stack): his exact string ALREADY chips correctly on current main, in
// an empty paragraph, mid-sentence, and a bullet — the pasted code becomes a real timecode chip with
// DAY 1 captured (rendered "DAY 1 · 00:09:44:16", no red "DAY ?" nag), under both the library flag set
// (transcriptDrop OFF) and the Burma flag set (transcriptDrop ON). The transcript-drop text road does
// NOT consume his string: parseTranscriptText('DAY 1 00:09:44:16') returns null (no quote body), so the
// paste falls through cleanly to the timecode markPasteRule. Every other paste consumer bows out on his
// string (media-paste: no file; viz-paste-adopt: no active tag; link-kbd: not a bare URL; paste-sanitize:
// only Cmd+Shift+V). The historical failures were fixed by the combined day+bare paste regex on main.
//
// This suite is the HEADLESS guard that pins those load-bearing facts so a future paste-pipeline change
// can't silently re-break his string. The live browser paste (real ClipboardEvent → chip with data-day)
// is the authoritative event-path proof; this file pins the pure contracts that proof rests on:
//   1. transcript-drop REFUSES his lone day-timecode (→ it never hijacks the paste, in any context);
//   2. transcript-drop STILL accepts a genuine soundbite (code + quote) — the boundary is preserved;
//   3. the timecode machinery (the SAME tcChipGlobalRE the paste rule runs) captures DAY 1 for his exact
//      string in every lead context a paste can land in (standalone, after a space, after a dash).
//
// Run: bun burma-script/src/paste-timecode-regression.test.mjs   (auto-discovered by run-tests.mjs)

import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';
import { parseTranscriptText } from './extensions/transcript-drop.js';
import { convertTimecodesInRange } from './extensions/marks.js';

setEpisode(BURMA); // transcriptDrop + timecodeChips both ON — the strictest pipeline (Burma flagship)

const HIS_STRING = 'DAY 1 00:09:44:16';

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, strike: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);
const tcMark = schema.marks.timecode;

let pass = 0, fail = 0;
const ok = (label, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`  ✗ ${label}\n    ${e.message}`); } };

// ── 1. transcript-drop REFUSES his lone day-timecode (so it never eats the paste) ─────────────────
ok('parseTranscriptText refuses his exact lone string → paste falls through to the chip rule', () => {
  assert.equal(parseTranscriptText(HIS_STRING), null, 'a lone day-timecode is NOT a transcript soundbite');
});

ok('parseTranscriptText also refuses a bare lone code (no day, no quote)', () => {
  assert.equal(parseTranscriptText('00:09:44:16'), null);
});

// ── 2. transcript-drop STILL accepts a real soundbite (the boundary is preserved) ─────────────────
ok('parseTranscriptText STILL captures a genuine code+quote soundbite (transcript road intact)', () => {
  const p = parseTranscriptText('00:25:14:22 - 00:25:38:20 life on Earth depends on the ocean');
  assert.deepEqual(p, { tcIn: '00:25:14:22', tcOut: '00:25:38:20', text: 'life on Earth depends on the ocean', speaker: '' });
});

// ── 3. the timecode machinery captures DAY 1 for his string in every lead context ─────────────────
// convertTimecodesInRange runs the SAME tcChipGlobalRE the markPasteRule runs; asserting it here pins
// the end state a correct paste must reach (verified live via a real ClipboardEvent) without a DOM.
function chipDayFor(paragraphText, code) {
  const doc = PMNode.fromJSON(schema, { type: 'doc', content: [
    { type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null }, content: [
      { type: 'tableCell', attrs: { role: 'full' }, content: [
        { type: 'noneBlock', attrs: { blockId: 'r', flavor: null, chapterId: null },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: paragraphText }] }] },
      ] },
    ] },
  ] });
  let state = EditorState.create({ schema, doc });
  let tr = null;
  const changed = convertTimecodesInRange(state, 0, state.doc.content.size, (t) => { tr = t; });
  if (tr) state = state.apply(tr);
  let day = undefined;
  state.doc.descendants((node) => {
    if (node.isText && node.text === code) {
      const m = node.marks.find((mk) => mk.type === tcMark);
      if (m) day = m.attrs.day;
    }
  });
  return { changed, day };
}

ok('DAY 1 captured — standalone lead ("DAY 1 00:09:44:16")', () => {
  assert.deepEqual(chipDayFor('DAY 1 00:09:44:16', '00:09:44:16'), { changed: true, day: 1 });
});
ok('DAY 1 captured — mid-sentence lead ("... hello DAY 1 00:09:44:16")', () => {
  assert.deepEqual(chipDayFor('hello DAY 1 00:09:44:16', '00:09:44:16'), { changed: true, day: 1 });
});
ok('DAY 1 captured — dash separator ("DAY 1 - 00:09:44:16")', () => {
  assert.deepEqual(chipDayFor('DAY 1 - 00:09:44:16', '00:09:44:16'), { changed: true, day: 1 });
});
ok('DAY 1 captured — double-space separator ("DAY 1  00:09:44:16")', () => {
  assert.deepEqual(chipDayFor('DAY 1  00:09:44:16', '00:09:44:16'), { changed: true, day: 1 });
});

console.log(`paste-timecode-regression: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
