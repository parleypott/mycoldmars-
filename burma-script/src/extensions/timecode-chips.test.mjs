/*
 * timecode-chips.test.mjs — Johnny 2026-07-21: "these still don't render into timecode tags."
 *
 * The exact failing line from his session: an ON-CAM (directionMark kind=oncam) run holding TWO
 * dead, day-prefixed timecodes —
 *   "ALT: the explanation at day 1 00:11:17:19  DAY 1 00:11:17:19"
 * Neither is a chip. Two root causes, both proven here:
 *
 *   (1) FLAG GATE. The chip input/paste rules were gated on `palauTimecodes`, which is FORBIDDEN in
 *       Burma (data-touching). So Burma — his flagship — never ran the DAY-collapse rule. The rules
 *       are now gated on a NEW presentation flag `timecodeChips` (ON for burma/palau/palau2/library),
 *       split from the heavy document-builder `palauTimecodes` parsing (which stays Palau-only).
 *
 *   (2) RETROACTIVITY. Input rules fire only at the caret the instant a code is typed; text already
 *       sitting on the page never retro-converts, and there was NO user path to fix it (the tc menu
 *       only opens on an existing chip). `convertTimecodesInRange` is that path — user-initiated, ONE
 *       transaction (COLLAB LOOP LAW), day captured + prefix stripped exactly like the live rule, and
 *       it works INSIDE a directionMark (oncam) run (mark coexistence — diagnosis #3).
 *
 * Run: bun src/extensions/timecode-chips.test.mjs
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS, TimecodeMark, collectTimecodeConversions, convertTimecodesInRange } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ok —', label); };

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
const timecodeType = schema.marks.timecode;

// A day-based episode stub with the two flags the fix distinguishes. `days` mirrors Burma.
function episode(features) {
  return {
    id: 'test', title: 'T', days: [1, 2, 3], sequences: [], genres: [], flavors: [],
    features, storage: {}, cloud: {},
  };
}

// Johnny's exact line, as an ON-CAM directionMark run inside a voBlock paragraph.
const ONCAM_LINE = 'ALT: the explanation at day 1 00:11:17:19  DAY 1 00:11:17:19';
function docWithOncamLine() {
  return PMNode.fromJSON(schema, {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{
        type: 'tableCell', attrs: { role: 'full' },
        content: [{
          type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' },
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: ONCAM_LINE, marks: [{ type: 'directionMark', attrs: { kind: 'oncam', status: 'static' } }] },
            ],
          }],
        }],
      }],
    }],
  });
}

function timecodeRuns(doc) {
  const runs = [];
  doc.descendants((node) => {
    if (!node.isText) return;
    const m = node.marks.find((mk) => mk.type === timecodeType);
    if (m) runs.push({ text: node.text, day: m.attrs.day, tc: m.attrs.tc, hasOncam: node.marks.some((k) => k.type.name === 'directionMark' && k.attrs.kind === 'oncam') });
  });
  return runs;
}

// ── ROOT CAUSE 1: the FLAG GATE ──────────────────────────────────────────────────────────────
ok('addInputRules returns NO rules when timecodeChips is OFF (Burma pre-fix behavior)', () => {
  setEpisode(episode({ palauTimecodes: false }));           // chips flag absent
  const rules = TimecodeMark.config.addInputRules.call({ type: timecodeType });
  assert.equal(rules.length, 0, 'no chip input rule without timecodeChips');
});

ok('addInputRules returns a chip rule when timecodeChips is ON — independent of palauTimecodes', () => {
  setEpisode(episode({ timecodeChips: true, palauTimecodes: false })); // Burma-after-fix shape
  const rules = TimecodeMark.config.addInputRules.call({ type: timecodeType });
  assert.equal(rules.length, 1, 'one chip input rule with timecodeChips on');
});

ok('the chip rule regex captures the shoot DAY (group 1) + bare code (group 2) — day-collapse', () => {
  setEpisode(episode({ timecodeChips: true }));
  const [rule] = TimecodeMark.config.addPasteRules.call({ type: timecodeType });
  const re = rule.find;            // the live RegExp — same one typing/paste run
  re.lastIndex = 0;
  const m = re.exec('day 1 00:11:17:19');
  assert.ok(m, 'matches a day-prefixed code');
  assert.equal(m[1], '1', 'group 1 is the shoot day');
  assert.equal(m[2], '00:11:17:19', 'group 2 is the bare broadcast code');
  // A bare code (no day prefix) still matches, with no day group.
  const re2 = rule.find; re2.lastIndex = 0;
  const b = re2.exec('cut at 00:04:30:00 here');
  assert.ok(b && b[2] === '00:04:30:00' && b[1] === undefined, 'bare code chips with no day');
});

// ── ROOT CAUSE 2: RETROACTIVITY — the user-initiated retro-convert ────────────────────────────
ok('collectTimecodeConversions finds BOTH dead timecodes in the oncam line', () => {
  setEpisode(episode({ timecodeChips: true }));
  const state = EditorState.create({ schema, doc: docWithOncamLine() });
  const hits = collectTimecodeConversions(state, 0, state.doc.content.size);
  assert.equal(hits.length, 2, 'two dead timecodes detected');
  assert.deepEqual(hits.map((h) => ({ day: h.day, tc: h.tc })), [
    { day: 1, tc: '00:11:17:19' },
    { day: 1, tc: '00:11:17:19' },
  ]);
});

ok('convertTimecodesInRange chips BOTH — inside the oncam run — with day captured + prefix stripped', () => {
  setEpisode(episode({ timecodeChips: true }));
  let state = EditorState.create({ schema, doc: docWithOncamLine() });
  const applied = convertTimecodesInRange(state, 0, state.doc.content.size, (tr) => { state = state.apply(tr); });
  assert.equal(applied, true, 'command reports it did work');

  const runs = timecodeRuns(state.doc);
  assert.equal(runs.length, 2, 'two timecode chips now exist');
  for (const r of runs) {
    assert.equal(r.tc, '00:11:17:19', 'chip text is the bare code');
    assert.equal(r.day, 1, 'chip carries day=1 from the "day 1" prefix');
    assert.equal(r.hasOncam, true, 'chip still carries the surrounding oncam directionMark (coexistence)');
  }
  // The literal "day 1 " / "DAY 1 " prefixes were stripped (mirrors the live input rule): the plain
  // text no longer contains a standalone "day 1" before a code.
  const plain = state.doc.textBetween(0, state.doc.content.size, ' ', ' ');
  assert.ok(!/day\s*1\s*00:11:17:19/i.test(plain), 'no "day 1 <code>" left as dead text');
});

ok('convertTimecodesInRange is a no-op (false) when the range holds no dead timecodes', () => {
  setEpisode(episode({ timecodeChips: true }));
  const doc = PMNode.fromJSON(schema, {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [{
        type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'just prose, no codes here' }] }],
      }] }],
    }],
  });
  const state = EditorState.create({ schema, doc });
  assert.equal(convertTimecodesInRange(state, 0, state.doc.content.size, () => { throw new Error('should not dispatch'); }), false);
});

ok('an already-chipped timecode is NOT re-collected (idempotent — no double-marking)', () => {
  setEpisode(episode({ timecodeChips: true }));
  let state = EditorState.create({ schema, doc: docWithOncamLine() });
  convertTimecodesInRange(state, 0, state.doc.content.size, (tr) => { state = state.apply(tr); });
  const hits = collectTimecodeConversions(state, 0, state.doc.content.size);
  assert.equal(hits.length, 0, 'nothing left to convert after one pass');
});

console.log(`\ntimecode-chips.test.mjs — ${pass} checks passed`);
