/*
 * oncam-rescope.test.mjs — /oncam is ON-CAMERA SPEECH, not a checkbox (Johnny 2026-07-09).
 *
 * On 2026-07-09 Johnny re-scoped /oncam from a "film this" checkbox chip (a red run + a clickable
 * ☐/☑ that cycles needed↔found, exactly like /archive) to ON-CAMERA SPEECH — bold-italic text
 * with NO box, NO checkbox, NO status cycle. That re-scope is TWO one-line edits in
 * direction-chip.js:
 *   • CHECKBOX_MARK_KINDS: ['archive', 'oncam'] → ['archive']   (oncam no longer draws a ☐)
 *   • defaultDirectionMarkAttrs('oncam').status: 'needed' → 'static'  (no red-todo paint)
 * Both were completely UNTESTED. The natural drift mistake — someone "restoring symmetry" by
 * re-adding 'oncam' to CHECKBOX_MARK_KINDS, or collapsing the oncam default back to 'needed' —
 * would silently resurrect a stray checkbox / red-todo on every on-camera-speech run in Johnny's
 * LIVE collab editor, with no error. This locks the re-scope end-to-end against exactly that.
 *
 * findCheckboxMarkRuns is the pure, DOM-free run-detector both plugins gate on (the checkbox
 * decoration AND the placeholder ☐), so proving it emits a run for an archive directionMark and
 * NONE for an oncam directionMark is the real behavioral proof — not just an array-literal check.
 *
 * Run: bun src/extensions/oncam-rescope.test.mjs
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import {
  DirectionMark,
  findCheckboxMarkRuns,
  defaultDirectionMarkAttrs,
  CHECKBOX_MARK_KINDS,
  DIRECTION_CHIP_KINDS,
} from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ok —', label); };

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);
const markType = schema.marks.directionMark;
assert.ok(markType, 'directionMark is in the schema');

// A voBlock paragraph carrying one directionMark-marked text run of the given kind.
function docWithMarkedRun(kind, status) {
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
              { type: 'text', text: 'see this ' },
              {
                type: 'text',
                text: 'on camera line',
                marks: [{ type: 'directionMark', attrs: { kind, status } }],
              },
            ],
          }],
        }],
      }],
    }],
  });
}

// ── The behavioral heart: does a marked run draw a ☐ checkbox? ──────────────────────────────
ok('an ARCHIVE directionMark run STILL draws a checkbox (unchanged by the re-scope)', () => {
  const d = defaultDirectionMarkAttrs('archive');
  const runs = findCheckboxMarkRuns(docWithMarkedRun('archive', d.status), markType);
  assert.equal(runs.length, 1, 'archive run yields exactly one checkbox run');
  assert.equal(runs[0].kind, 'archive');
});

ok('an ONCAM directionMark run draws NO checkbox (the re-scope)', () => {
  const d = defaultDirectionMarkAttrs('oncam');
  const runs = findCheckboxMarkRuns(docWithMarkedRun('oncam', d.status), markType);
  // LOAD-BEARING: re-adding 'oncam' to CHECKBOX_MARK_KINDS makes this 1 → RED.
  assert.equal(runs.length, 0, 'oncam is on-camera speech — never a checkbox run');
});

// ── The two source-of-truth constants the re-scope edited ─────────────────────────────────────
ok('CHECKBOX_MARK_KINDS is exactly [archive] — oncam removed', () => {
  assert.deepEqual([...CHECKBOX_MARK_KINDS].sort(), ['archive']);
  assert.ok(!CHECKBOX_MARK_KINDS.includes('oncam'), 'oncam is NOT a checkbox kind');
});

ok('defaultDirectionMarkAttrs(oncam) is static — not the red-todo "needed"', () => {
  const d = defaultDirectionMarkAttrs('oncam');
  // LOAD-BEARING: collapsing this back to 'needed' → RED (would paint on-cam speech red-todo).
  assert.deepEqual({ kind: d.kind, status: d.status }, { kind: 'oncam', status: 'static' });
  assert.notEqual(d.status, 'needed');
});

ok('archive default stays needed (the re-scope did NOT touch archive)', () => {
  assert.deepEqual(defaultDirectionMarkAttrs('archive'), { kind: 'archive', status: 'needed' });
});

// ── Only the checkbox kinds ever produce a run; every other viz kind stays boxless ────────────
ok('across ALL direction kinds, findCheckboxMarkRuns fires iff the kind is a CHECKBOX_MARK_KIND', () => {
  for (const kind of DIRECTION_CHIP_KINDS) {
    const d = defaultDirectionMarkAttrs(kind);
    const runs = findCheckboxMarkRuns(docWithMarkedRun(kind, d.status), markType);
    const expected = CHECKBOX_MARK_KINDS.includes(kind) ? 1 : 0;
    assert.equal(runs.length, expected, `kind "${kind}" → ${expected} run(s)`);
  }
});

console.log(`\noncam-rescope.test.mjs — ${pass} checks passed`);
