// TRANSCRIPT DROP — the drop/paste-a-transcript-soundbite feature (extensions/transcript-drop.js).
//
// Locks the load-bearing contracts:
//   1. PARSER: parseTranscriptText covers the real Interpreter/Trint shapes (range, single code,
//      speaker line, inline "NAME:" label, [...] ellipsis stripping) and REFUSES plain prose / empty
//      input — so a normal paste is never hijacked (the writing-tool paste path stays sacred).
//   2. INSERTION SHAPE: buildQuoteRowNode builds a full-width row → noneBlock → [timecode-chip para]
//      + [ON CAM quote para]; the timecode chips carry day=null (the DAY ? state), the quote carries
//      directionMark('oncam') so the run-tag machinery sees it, and a "NAME:" speaker rides inside.
//   3. ROUND-TRIP: the row survives the mirror-schema fromJSON → check → toJSON (marks preserved) —
//      the same serialization localStorage/cloud/collab read-back use — and docToBlocks reads it back
//      as a { type:'none' } block without loss/crash.
//   4. ONE UNDO: insertQuoteRow is a single transaction — one undo removes the whole row.
//   5. CONVERT-TO-SOT: applying directionMark('sot') over the oncam run (what the right-click convert
//      menu does) flips the run kind cleanly and still round-trips.
//   6. CHOICE default-to-MEDIA: choiceForKey maps everything but Q to MEDIA (a drop is never lost).
//
// Run: bun burma-script/src/transcript-drop.test.mjs

import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { Node as PMNode } from '@tiptap/pm/model';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark, defaultDirectionMarkAttrs, findCheckboxMarkRuns } from './extensions/direction-chip.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';
import {
  parseTranscriptText, buildQuoteRowNode, buildQuoteParagraphs, insertQuoteRow,
  choiceForKey, findQuoteRow, mintQuoteBlockId,
} from './extensions/transcript-drop.js';

setEpisode(BURMA); // transcriptDrop + timecodeChips on; needed before document-builder import
const { docToBlocks, ensureTableDoc, buildEditorDocument } = await import('./document-builder.js');

let pass = 0, fail = 0;
const ok = (label, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`  ✗ ${label}\n    ${e.message}`); } };
const clone = (x) => JSON.parse(JSON.stringify(x));

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

// ── 1. PARSER ────────────────────────────────────────────────────────────────────────────────────
ok('parses a range + trailing quote (code leads the block)', () => {
  const p = parseTranscriptText('00:25:14:22 - 00:25:38:20 life on Earth depends on the ocean');
  assert.deepEqual(p, { tcIn: '00:25:14:22', tcOut: '00:25:38:20', text: 'life on Earth depends on the ocean', speaker: '' });
});

ok('parses a speaker LINE, then a code LINE, then the quote line', () => {
  const p = parseTranscriptText('TOMMY BAKER\n00:25:14:22 - 00:25:38:20\nthe reef is dying');
  assert.deepEqual(p, { tcIn: '00:25:14:22', tcOut: '00:25:38:20', text: 'the reef is dying', speaker: 'TOMMY BAKER' });
});

ok('parses an inline "NAME:" label + a single code', () => {
  const p = parseTranscriptText('DREW: 00:04:30:00 we walked for miles');
  assert.deepEqual(p, { tcIn: '00:04:30:00', tcOut: '', text: 'we walked for miles', speaker: 'DREW' });
});

ok('strips Interpreter [...] / [ellipsis] markers from the quote', () => {
  const p = parseTranscriptText('00:25:14:22 the water [...] used to be […] clear');
  assert.equal(p.text, 'the water used to be clear');
});

ok('accepts a 3-part code and an en-dash range separator', () => {
  const p = parseTranscriptText('00:25:14 – 00:25:38 quote here');
  assert.deepEqual(p, { tcIn: '00:25:14', tcOut: '00:25:38', text: 'quote here', speaker: '' });
});

ok('REFUSES plain prose (a normal paste must fall through untouched)', () => {
  assert.equal(parseTranscriptText('The interview was great and we talked for an hour.'), null);
  assert.equal(parseTranscriptText('The meeting at 10:30:00 was fine.'), null); // buried time, prose leads
  assert.equal(parseTranscriptText(''), null);
  assert.equal(parseTranscriptText('   \n  '), null);
});

ok('REFUSES a code with no quote text after it', () => {
  assert.equal(parseTranscriptText('00:25:14:22 - 00:25:38:20'), null);
});

// ── 2. INSERTION SHAPE ──────────────────────────────────────────────────────────────────────────
ok('buildQuoteParagraphs: para1 = two day=null timecode chips, para2 = one ON CAM run with the speaker', () => {
  const [tcPara, quotePara] = buildQuoteParagraphs(schema, { tcIn: '00:25:14:22', tcOut: '00:25:38:20', text: 'the reef is dying', speaker: 'TOMMY' });
  const tcMark = schema.marks.timecode;
  const chips = [];
  tcPara.descendants((n) => { if (n.isText) { const m = n.marks.find((mk) => mk.type === tcMark); if (m) chips.push(m.attrs); } });
  assert.equal(chips.length, 2, 'in + out chips');
  assert.deepEqual(chips.map((a) => a.tc), ['00:25:14:22', '00:25:38:20']);
  assert.ok(chips.every((a) => a.day === null), 'chips land bare (day=null → the DAY ? state)');

  const dir = schema.marks.directionMark;
  let oncamText = '';
  quotePara.descendants((n) => { if (n.isText && n.marks.some((m) => m.type === dir && m.attrs.kind === 'oncam')) oncamText += n.text; });
  assert.equal(oncamText, 'TOMMY: the reef is dying', 'speaker prefix rides inside the oncam run');
});

const ROW_DOC = {
  type: 'doc',
  content: [
    // a starting row so the insert has an outermost row to land below
    { type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null }, content: [
      { type: 'tableCell', attrs: { role: 'full' }, content: [
        { type: 'voBlock', attrs: { blockId: 'vo_1', flavor: null, chapterId: null, status: 'todo' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'opening line' }] }] },
      ] },
    ] },
  ],
};

ok('buildQuoteRowNode produces a valid full-width noneBlock row that checks against the schema', () => {
  const row = buildQuoteRowNode(schema, 'quote_x', { tcIn: '00:25:14:22', tcOut: '00:25:38:20', text: 'the reef is dying', speaker: 'TOMMY' });
  assert.ok(row, 'row built');
  const doc = PMNode.fromJSON(schema, { type: 'doc', content: [clone(ROW_DOC.content[0]), row.toJSON()] });
  doc.check();
  assert.equal(row.type.name, 'tableRow');
  assert.equal(row.child(0).child(0).type.name, 'noneBlock');
});

// ── 3. ROUND-TRIP (mirror schema + docToBlocks) ───────────────────────────────────────────────────
ok('the quote row round-trips through the mirror schema (fromJSON → check → toJSON) STABLE, marks intact', () => {
  const row = buildQuoteRowNode(schema, 'quote_rt', { tcIn: '00:25:14:22', tcOut: '00:25:38:20', text: 'the reef is dying', speaker: 'TOMMY' });
  const json1 = clone(PMNode.fromJSON(schema, { type: 'doc', content: [clone(ROW_DOC.content[0]), row.toJSON()] }).toJSON());
  const node2 = PMNode.fromJSON(schema, json1);
  node2.check();
  assert.deepEqual(clone(node2.toJSON()), json1, 'serialization is stable');
  const s = JSON.stringify(json1);
  assert.ok(s.includes('"timecode"'), 'timecode marks survived serialization');
  assert.ok(s.includes('"directionMark"') && s.includes('"oncam"'), 'oncam directionMark survived serialization');
});

ok('docToBlocks reads the quote row back as a { type:"none" } block (no crash / loss of the words)', () => {
  const row = buildQuoteRowNode(schema, 'quote_db', { tcIn: '00:25:14:22', tcOut: '', text: 'the reef is dying', speaker: 'TOMMY' });
  const docJson = PMNode.fromJSON(schema, { type: 'doc', content: [clone(ROW_DOC.content[0]), row.toJSON()] }).toJSON();
  const blocks = docToBlocks(clone(docJson));
  const none = blocks.find((b) => b.id === 'quote_db');
  assert.ok(none, 'the quote block came back');
  assert.equal(none.type, 'none');
  assert.ok(none.text.includes('00:25:14:22'), 'the timecode round-trips as literal text');
  assert.ok(none.text.includes('TOMMY: the reef is dying'), 'the quote words round-trip');
});

// ── 4. ONE UNDO ────────────────────────────────────────────────────────────────────────────────
function fakeView(doc) {
  const state = EditorState.create({ schema, doc, plugins: [history()] });
  return {
    state,
    editable: true,
    isDestroyed: false,
    dispatch(tr) { this.state = this.state.apply(tr); },
    focus() {},
    coordsAtPos() { return { left: 0, top: 0, bottom: 0, right: 0 }; },
  };
}

ok('insertQuoteRow adds exactly one row, and a single undo removes it', () => {
  const view = fakeView(PMNode.fromJSON(schema, clone(ROW_DOC)));
  const rowsBefore = view.state.doc.childCount;
  const caret = view.state.doc.content.size - 4; // inside the opening voBlock paragraph
  const id = insertQuoteRow(view, { tcIn: '00:25:14:22', tcOut: '00:25:38:20', text: 'the reef is dying', speaker: 'TOMMY' }, caret);
  assert.ok(id, 'insert returned an id');
  assert.equal(view.state.doc.childCount, rowsBefore + 1, 'exactly one new row');
  assert.ok(findQuoteRow(view.state, id), 'the quote row is findable by its blockId');

  // ONE undo → back to the original doc.
  const undid = undo(view.state, (tr) => { view.state = view.state.apply(tr); });
  assert.equal(undid, true, 'undo ran');
  assert.equal(view.state.doc.childCount, rowsBefore, 'the row is gone after ONE undo');
  assert.equal(findQuoteRow(view.state, id), null, 'no quote row remains');
});

// ── 5. CONVERT-TO-SOT (what the right-click convert menu does) ─────────────────────────────────────
ok('applying directionMark(sot) over the oncam run reclassifies it cleanly and round-trips', () => {
  const row = buildQuoteRowNode(schema, 'quote_sot', { tcIn: '00:25:14:22', tcOut: '', text: 'the reef is dying', speaker: '' });
  let state = EditorState.create({ schema, doc: PMNode.fromJSON(schema, { type: 'doc', content: [clone(ROW_DOC.content[0]), row.toJSON()] }) });
  const dir = schema.marks.directionMark;

  // The oncam run BEFORE conversion (run-tag machinery finds it via findCheckboxMarkRuns).
  const oncamRuns = findCheckboxMarkRuns(state.doc, dir, ['oncam']);
  assert.equal(oncamRuns.length, 1, 'exactly one oncam run to reclass');
  const { from, to } = oncamRuns[0];

  // The convert menu's applyMarkRange = setMark(directionMark, defaultDirectionMarkAttrs('sot')) over
  // the selection. setMark replaces the same-type mark's attrs, so drive it as removeMark + addMark.
  const sotAttrs = defaultDirectionMarkAttrs('sot');
  state = state.apply(state.tr.removeMark(from, to, dir).addMark(from, to, dir.create(sotAttrs)));

  const sotRuns = findCheckboxMarkRuns(state.doc, dir, ['sot']);
  assert.equal(sotRuns.length, 1, 'the run is now SOT');
  assert.equal(findCheckboxMarkRuns(state.doc, dir, ['oncam']).length, 0, 'no oncam run remains');
  PMNode.fromJSON(schema, clone(state.doc.toJSON())).check(); // still a legal doc
});

// ── 6. CHOICE default-to-MEDIA ────────────────────────────────────────────────────────────────────
ok('choiceForKey: only Q chooses QUOTE; Enter / Escape / anything else = MEDIA (a drop is never lost)', () => {
  assert.equal(choiceForKey('q'), 'quote');
  assert.equal(choiceForKey('Q'), 'quote');
  assert.equal(choiceForKey('Enter'), 'media');
  assert.equal(choiceForKey('Escape'), 'media');
  assert.equal(choiceForKey(undefined), 'media');
  assert.equal(choiceForKey('x'), 'media');
});

// ── 7. INERT for a bare doc / no regressions to existing episodes ──────────────────────────────────
ok('mintQuoteBlockId is stable-shaped and unique-ish', () => {
  const a = mintQuoteBlockId(), b = mintQuoteBlockId();
  assert.ok(/^quote_[a-z0-9]+$/.test(a) && a !== b);
});

ok('a real Burma seed doc still builds + round-trips with the feature present (no schema regression)', () => {
  const doc = ensureTableDoc(buildEditorDocument(BURMA.blocksData.slice(0, 6)));
  PMNode.fromJSON(schema, clone(doc)).check();
});

console.log(`transcript-drop: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
