/*
 * workspaces.test.mjs — the WORKSPACES DATA CORE contract (workspaces.js).
 *
 * Proves:
 *   1. REGISTRY — WORKSPACE_ROLES order/labels; overlapping crafts wear the lens tint
 *      (roles.js ROLE_DEFS); PENDING wears the stage-1 alert red.
 *   2. LENS AGREEMENT — for every craft the ROLE FOCUS HUB also serves, the workspace
 *      membership surfaces are EXACTLY the lens selector's atoms (roles-lens-contract
 *      doctrine extended: workspace ↔ lens can never silently drift).
 *   3. MEMBERSHIP — per role over rows: directionMark kinds, the legacy [data-fc]
 *      (factCheckSpan) + [data-broll] (brollBlock) surfaces, voBlock, pendingViz attr.
 *   4. SECTIONS — scanWorkspace groups contiguous member runs; a gap splits sections.
 *   5. CHAPTERS — walkRows attributes each row to the most recent chapter-opening row
 *      (ordinal + telemetry-style ord + first-paragraph title, brackets stripped).
 *   6. TIMED WORDS — vo/oncam/sot/montage count; bin/note/broll/heads don't; the
 *      `shown` lane never counts (innermost cell role wins, Palau nesting included);
 *      minutes = timedWords / WORDS_PER_MINUTE (130).
 *   7. ARCHIVE done/total — ☐/☑ chips counted as contiguous runs (found vs needed);
 *      a chip split across text nodes (bold inside) is ONE chip.
 *   8. NESTED ROWS (Palau) — only TOP-LEVEL rows are enumerated/numbered; surfaces
 *      inside nested rows still make the wrapper row a member.
 *
 * Run: bun src/workspaces.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import {
  WORKSPACE_ROLES, workspaceRole, rowIsMember, walkTopRows, walkRows, chapterTitle,
  scanWorkspace, workspaceMetrics, timedWordsInRow, isTimedBlock, TIMED_BLOCK_TYPES,
  countWords, WORDS_PER_MINUTE, PENDING_TINT,
} from './workspaces.js';
import { ROLE_DEFS } from './roles.js';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, strike: false, dropcursor: false, gapcursor: false,
    history: { depth: 100, newGroupDelay: 750 },
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const docFrom = (json) => PMNode.fromJSON(schema, json);
const cell = (blocks, role = 'full') => ({ type: 'tableCell', attrs: { role }, content: blocks });
const row = (blocks) => ({ type: 'tableRow', attrs: { cols: 1, pairId: null }, content: [cell(blocks)] });
const splitRow = (said, shown) => ({
  type: 'tableRow', attrs: { cols: 2, pairId: 'pair_t' },
  content: [cell(said, 'said'), cell(shown, 'shown')],
});
const txt = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const para = (...inline) => ({ type: 'paragraph', content: inline });
const dhl = (kind, status, text) => txt(text, [{ type: 'directionMark', attrs: { kind, status: status || 'static' } }]);
const fcSpan = (text) => txt(text, [{ type: 'factCheckSpan', attrs: { status: 'pending' } }]);

const block = (type, id, content, extra) => ({ type, attrs: { blockId: id, ...(extra || {}) }, content });
const vo = (id, text, extra) => block('voBlock', id, [para(txt(text))], { status: 'todo', ...(extra || {}) });
const oncam = (id, text) => block('oncamBlock', id, [para(txt(text))]);
const sot = (id, text) => block('sotBlock', id, [para(txt(text))]);
const montage = (id, text) => block('montageBlock', id, [para(txt(text))]);
const bin = (id, ...inline) => block('binBlock', id, [para(...inline)]);
const note = (id, ...inline) => block('noteBlock', id, [para(...inline)], { kind: 'note' });
const broll = (id, text) => block('brollBlock', id, [para(txt(text))]);
const chapterBlk = (id, title) => block('chapterBlock', id, [para(txt(title))], { genre: 'other' });
// imageBlock (media-paste lineage) is an ATOM — no content, attrs only. baseAttrs (incl. pendingViz)
// ride it exactly like every cartridge block, so it can be a /pending member.
const image = (id, extra) => ({ type: 'imageBlock', attrs: { blockId: id, src: 'blob:x', kind: 'shot', ...(extra || {}) } });

// ── 1. REGISTRY ──────────────────────────────────────────────────────────────
ok('WORKSPACE_ROLES: order, labels, lens tints, pending red', () => {
  assert.deepEqual(WORKSPACE_ROLES.map((r) => r.key),
    ['3d', 'animation', 'archive', 'broll', 'mapdata', 'factcheck', 'vo', 'pending']);
  assert.deepEqual(WORKSPACE_ROLES.map((r) => r.label),
    ['3D ANIMATION', 'ANIMATION', 'ARCHIVE', 'B-ROLL', 'MAP DATA', 'FACT CHECK', 'VO', 'PENDING VISUAL PLAN']);
  // Overlapping crafts wear the lens tint — one legend, one ink.
  const lens = (id) => ROLE_DEFS.find((r) => r.id === id).tint;
  assert.equal(workspaceRole('vo').tint, lens('vo'));
  assert.equal(workspaceRole('3d').tint, lens('3d'));
  assert.equal(workspaceRole('animation').tint, lens('animation'));
  assert.equal(workspaceRole('archive').tint, lens('archive'));
  assert.equal(workspaceRole('broll').tint, lens('broll'));
  assert.equal(workspaceRole('factcheck').tint, lens('factcheck'));
  assert.equal(workspaceRole('mapdata').tint, lens('cartography'), 'mapdata rides the cartography lens tint');
  assert.equal(workspaceRole('pending').tint, PENDING_TINT);
  assert.equal(PENDING_TINT, '#b02318', 'the stage-1 /pending alert red');
});

// ── 2. LENS AGREEMENT — workspace surfaces == lens selector atoms ────────────
// Selector-atom → surface translation (the render contracts these stand on are pinned
// by roles-lens-contract.test.mjs + the marks/blocks renderHTML):
//   .wp-dhl[data-kind="K"] → directionMark kind K      (direction-chip.js renderHTML)
//   [data-vo]              → voBlock                   (blocks.js VoBlock renderHTML)
//   [data-fc]              → factCheckSpan mark        (marks.js FactCheckSpan renderHTML)
//   [data-broll]           → brollBlock                (blocks.js BrollBlock renderHTML)
ok('every lens-overlapping craft: workspace surfaces are EXACTLY the lens sel atoms', () => {
  const ATOM_SURFACE = { vo: { blockTypes: 'voBlock' }, fc: { markTypes: 'factCheckSpan' }, broll: { blockTypes: 'brollBlock' } };
  for (const role of WORKSPACE_ROLES) {
    if (role.key === 'pending') continue; // /pending has no lens craft — attr-only surface
    const def = ROLE_DEFS.find((r) => r.id === role.key)
      || ROLE_DEFS.find((r) => r.sel.includes(`data-kind="${role.key}"`));
    assert.ok(def, `craft "${role.key}" must have a lens counterpart in ROLE_DEFS`);
    const want = { markKinds: [], markTypes: [], blockTypes: [] };
    for (const atom of def.sel.split(',').map((s) => s.trim())) {
      const kind = (atom.match(/data-kind="([^"]+)"/) || [])[1];
      if (kind) { want.markKinds.push(kind); continue; }
      const attr = (atom.match(/\[data-([a-z-]+)\]/) || [])[1];
      const mapped = ATOM_SURFACE[attr];
      assert.ok(mapped, `lens atom "${atom}" (craft "${role.key}") has a known surface translation`);
      for (const [k, v] of Object.entries(mapped)) want[k].push(v);
    }
    const got = {
      markKinds: role.surfaces.markKinds || [],
      markTypes: role.surfaces.markTypes || [],
      blockTypes: role.surfaces.blockTypes || [],
    };
    assert.deepEqual(got, want,
      `craft "${role.key}": workspace surfaces must equal the lens selector atoms — the two lists have DRIFTED`);
  }
});

// ── 3. MEMBERSHIP ────────────────────────────────────────────────────────────
const MEMBER_DOC = docFrom({
  type: 'doc',
  content: [
    row([vo('vo_1', 'Plain narration line here')]),                       // 1 → vo
    row([bin('bin_anim', txt('cutaway: '), dhl('animation', 'static', 'animated map push'))]), // 2 → animation
    row([note('note_3d', dhl('3d', 'static', 'orbital station flythrough'))]),                 // 3 → 3d
    row([bin('bin_fc', fcSpan('the junta seized power in 2021'))]),        // 4 → factcheck (legacy span)
    row([broll('br_1', 'street market, golden hour')]),                    // 5 → broll (legacy block)
    row([bin('bin_br', dhl('broll', 'unchecked', 'monastery exteriors'))]),// 6 → broll (chip)
    row([vo('vo_p', 'Stamped narration', { pendingViz: true })]),          // 7 → pending + vo
    row([bin('bin_arc', dhl('archive', 'needed', 'ARCHIVE NEEDED colonial rail footage'))]), // 8 → archive
    row([bin('bin_map', dhl('mapdata', 'static', 'border overlay 1948'))]),// 9 → mapdata
    row([bin('bin_fck', dhl('factcheck', 'todo', 'GDP figure'))]),         // 10 → factcheck (chip)
    { type: 'paragraph' },                                                 // bare stray — no row
  ],
});

ok('membership per role: chips, legacy surfaces, vo blocks, pending attr', () => {
  const rows = walkTopRows(MEMBER_DOC).map((r) => r.node);
  const members = (key) => rows.map((n, i) => (rowIsMember(n, key) ? i + 1 : null)).filter(Boolean);
  assert.deepEqual(members('vo'), [1, 7]);
  assert.deepEqual(members('animation'), [2]);
  assert.deepEqual(members('3d'), [3]);
  assert.deepEqual(members('factcheck'), [4, 10], 'chip AND legacy [data-fc] span both count');
  assert.deepEqual(members('broll'), [5, 6], 'legacy [data-broll] block AND chip both count');
  assert.deepEqual(members('pending'), [7]);
  assert.deepEqual(members('archive'), [8]);
  assert.deepEqual(members('mapdata'), [9]);
});

// imageBlock (media-paste) crosses lineages here: main's new atom node vs. workspaces' scan.
// It joins a workspace the SAME two ways any row does — by carrying a craft chip, or by the
// pendingViz attr riding the atom — and is NEVER mistaken for a brollBlock by type alone.
ok('imageBlock rows join workspaces by chip + pending attr, never by type', () => {
  // A media-paste image row whose caption block carries a broll chip is a B-ROLL member.
  const withChip = docFrom({
    type: 'doc',
    content: [row([image('img_1'), bin('bin_cap', dhl('broll', 'static', 'archival harbor footage'))])],
  });
  assert.equal(rowIsMember(withChip.child(0), 'broll'), true, 'an image row carrying a broll chip is a B-ROLL member');

  // pendingViz rides the imageBlock atom (baseAttrs), so a /pending-stamped image cell is a member
  // (and its data-pending-viz paints the cell red — same attr the CSS keys on).
  const pendingImg = docFrom({ type: 'doc', content: [row([image('img_2', { pendingViz: true })])] });
  assert.equal(rowIsMember(pendingImg.child(0), 'pending'), true, 'pendingViz on the imageBlock makes its row a PENDING member');

  // A bare imageBlock — no chip, no pending — belongs to nothing; it is not a brollBlock.
  const bare = docFrom({ type: 'doc', content: [row([image('img_3')])] });
  assert.equal(rowIsMember(bare.child(0), 'broll'), false, 'a bare imageBlock is NOT a broll member (imageBlock ≠ brollBlock)');
  assert.equal(rowIsMember(bare.child(0), 'pending'), false, 'an unstamped imageBlock row is not a pending member');
});

// A timecode chip (main's timecodeChips lineage) is the `timecode` MARK — not listed as a surface
// by any WORKSPACE_ROLE. So it is transparent to membership: a row's timecode never makes it a
// craft member, and a craft-member row's timecode just rides the cutout and renders normally.
ok('timecode chips are transparent to workspace membership (ride cutouts, never gate them)', () => {
  const tc = (code, day) => txt(code, [{ type: 'timecode', attrs: { tc: code, day: day ?? null } }]);

  // A vo row whose only inline chip is a timecode is a member ONLY of vo (its block), of nothing else.
  const tcRow = docFrom({
    type: 'doc',
    content: [row([block('voBlock', 'vo_tc', [para(txt('cut at '), tc('00:11:17:19', 1))], { status: 'todo' })])],
  });
  for (const role of WORKSPACE_ROLES) {
    if (role.key === 'vo') continue; // it IS a voBlock — vo membership is expected and correct
    assert.equal(rowIsMember(tcRow.child(0), role.key), false, `a timecode chip does not make a row a "${role.key}" member`);
  }
  assert.equal(rowIsMember(tcRow.child(0), 'vo'), true, 'the row is a vo member by its voBlock, never by the timecode');

  // A B-ROLL member row that also carries a timecode chip stays a B-ROLL member — the chip rides along.
  const brollPlusTc = docFrom({
    type: 'doc',
    content: [row([bin('bin_tc', dhl('broll', 'static', 'harbor exteriors'), txt(' '), tc('00:20:18:16', 2))])],
  });
  assert.equal(rowIsMember(brollPlusTc.child(0), 'broll'), true, 'a broll chip beside a timecode chip is still a B-ROLL member');
});

ok('rowIsMember accepts a role entry or its key; unknown keys are never members', () => {
  const first = walkTopRows(MEMBER_DOC)[0].node;
  assert.equal(rowIsMember(first, workspaceRole('vo')), true);
  assert.equal(rowIsMember(first, 'vo'), true);
  assert.equal(rowIsMember(first, 'nonsense'), false);
});

// ── 4 + 5. SECTIONS + CHAPTERS ───────────────────────────────────────────────
const SECTION_DOC = docFrom({
  type: 'doc',
  content: [
    row([vo('pre', 'Pre-script narration')]),                               // 1 — before any chapter
    row([chapterBlk('chA', 'The Coup [candidate notes here] and after')]),  // 2 — opens ch 1
    row([bin('a1', dhl('animation', 'static', 'map push one'))]),           // 3 — member
    row([bin('a2', dhl('animation', 'static', 'map push two'))]),           // 4 — member
    row([vo('gap', 'No animation here')]),                                  // 5 — gap
    row([chapterBlk('chB', 'Borderlands')]),                                // 6 — opens ch 2
    row([bin('a3', dhl('animation', 'static', 'route trace'))]),            // 7 — member
    { type: 'paragraph' },
  ],
});

ok('walkRows: chapter attribution (null before, opener owns its row, ord zero-padded, brackets stripped)', () => {
  const rows = walkRows(SECTION_DOC);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((r) => r.index), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(rows[0].chapter, null, 'rows before the first chapter carry null');
  assert.deepEqual(rows[1].chapter, { ordinal: 1, ord: '01', title: 'The Coup and after' },
    'the opening row belongs to its own chapter; bracketed asides stripped');
  assert.deepEqual(rows[4].chapter, { ordinal: 1, ord: '01', title: 'The Coup and after' });
  assert.deepEqual(rows[6].chapter, { ordinal: 2, ord: '02', title: 'Borderlands' });
  assert.equal(rows[2].firstBlockId, 'a1', 'row identity = first block id (table.js pattern)');
});

ok('chapterTitle: word-boundary clamp at 72 with ellipsis', () => {
  const long = 'word '.repeat(30).trim(); // 149 chars
  const t = chapterTitle(docFrom(row([chapterBlk('c', long)])).child(0).child(0).child(0));
  assert.ok(t.length <= 73 && t.endsWith('…'), `clamped: "${t}"`);
});

ok('scanWorkspace: contiguous member runs; a gap splits sections; chapter = first row of the run', () => {
  const sections = scanWorkspace(SECTION_DOC, 'animation');
  assert.equal(sections.length, 2);
  assert.deepEqual(
    sections.map(({ startIndex, endIndex, rowCount, firstBlockId }) => ({ startIndex, endIndex, rowCount, firstBlockId })),
    [
      { startIndex: 3, endIndex: 4, rowCount: 2, firstBlockId: 'a1' },
      { startIndex: 7, endIndex: 7, rowCount: 1, firstBlockId: 'a3' },
    ],
  );
  assert.equal(sections[0].chapter.ord, '01');
  assert.equal(sections[1].chapter.ord, '02');
  assert.deepEqual(scanWorkspace(SECTION_DOC, '3d'), [], 'no members → no sections');
});

// ── 6. TIMED WORDS ───────────────────────────────────────────────────────────
ok('TIMED taxonomy: vo/oncam/sot/montage timed, everything else untimed; WPM = 130', () => {
  assert.deepEqual([...TIMED_BLOCK_TYPES.keys()].sort(), ['montageBlock', 'oncamBlock', 'sotBlock', 'voBlock']);
  assert.equal(WORDS_PER_MINUTE, 130);
  const d = docFrom({ type: 'doc', content: [row([vo('v', 'x'), bin('b', txt('y'))])] });
  const cellNode = d.child(0).child(0);
  assert.equal(isTimedBlock(cellNode.child(0)), true, 'voBlock is timed');
  assert.equal(isTimedBlock(cellNode.child(1)), false, 'binBlock is not');
});

ok('countWords matches the telemetry rule (whitespace split, word-ish tokens only)', () => {
  assert.equal(countWords('one two  three'), 3);
  assert.equal(countWords('  — … !! '), 0, 'punctuation-only tokens do not count');
  assert.equal(countWords(''), 0);
});

ok('timedWordsInRow: timed types count; direction prose does not; shown lane never counts', () => {
  assert.equal(timedWordsInRow(docFrom(row([vo('v', 'five words of spoken narration')])).child(0)), 5);
  assert.equal(timedWordsInRow(docFrom(row([oncam('o', 'three spoken words')])).child(0)), 3);
  assert.equal(timedWordsInRow(docFrom(row([sot('s', 'a four word quote')])).child(0)), 4);
  assert.equal(timedWordsInRow(docFrom(row([montage('m', 'montage narration counts too')])).child(0)), 4);
  assert.equal(timedWordsInRow(docFrom(row([bin('b', txt('director notes never count'))])).child(0)), 0);
  assert.equal(timedWordsInRow(docFrom(row([broll('br', 'shot descriptions never count')])).child(0)), 0);
  // Split row: said counts, shown does not — even for a timed-type block parked there.
  const split = docFrom({ type: 'doc', content: [splitRow([vo('v', 'two words')], [vo('x', 'planning text over here')])] });
  assert.equal(timedWordsInRow(split.child(0)), 2, 'the shown lane is visual planning, not narration');
});

ok('workspaceMetrics: member rows only; minutes = timedWords / 130', () => {
  const d = docFrom({
    type: 'doc',
    content: [
      row([vo('v1', 'word '.repeat(13).trim())]),   // 13 timed words, member of vo
      row([bin('b1', txt('untimed direction row'))]),// not a member
      row([vo('v2', 'word '.repeat(13).trim()), bin('b2', txt('same row direction ignored'))]), // 13 more
    ],
  });
  const m = workspaceMetrics(d, 'vo');
  assert.deepEqual(m, { timedWords: 26, minutes: 26 / 130, sectionCount: 2, rowCount: 2 });
  assert.ok(!('done' in m), 'done/total are archive-only');
});

// ── 7. ARCHIVE done/total ────────────────────────────────────────────────────
ok('archive metrics: found/needed chips over member rows; split-text chips count once', () => {
  const d = docFrom({
    type: 'doc',
    content: [
      row([bin('arc1',
        dhl('archive', 'needed', 'ARCHIVE NEEDED 1962 coup newsreel'))]),
      row([bin('arc2',
        // ONE chip whose run is split across two text nodes (bold word inside) — one chip.
        txt('ARCHIVE FOUND rail ', [{ type: 'directionMark', attrs: { kind: 'archive', status: 'found' } }]),
        txt('bridge', [{ type: 'directionMark', attrs: { kind: 'archive', status: 'found' } }, { type: 'bold' }]),
        txt('  and between  '),
        dhl('archive', 'needed', 'ARCHIVE NEEDED station interior'))]),
      row([vo('v', 'A non-archive row with an archive word in prose')]), // not a member
    ],
  });
  const m = workspaceMetrics(d, 'archive');
  assert.equal(m.rowCount, 2);
  assert.equal(m.total, 3, 'three chips (the split-run chip counts ONCE)');
  assert.equal(m.done, 1, 'one FOUND');
});

// ── 8. NESTED ROWS (Palau shape) ─────────────────────────────────────────────
const NESTED_DOC = docFrom({
  type: 'doc',
  content: [
    row([vo('n_pre', 'Top level one')]),
    { // wrapper: full-width row whose cell NESTS a said|shown row (the legal Palau shape)
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [cell([
        chapterBlk('n_ch', 'Nested Chapter'),
        splitRow([vo('n_said', 'six spoken words ride the clock')], [bin('n_shown', dhl('animation', 'static', 'nested craft work'))]),
      ])],
    },
    row([vo('n_post', 'Top level three')]),
  ],
});

ok('nested rows: only TOP-LEVEL rows are enumerated; nesting never gets its own number', () => {
  const rows = walkRows(NESTED_DOC);
  assert.equal(rows.length, 3, 'the nested said|shown row is NOT a top-level row');
  assert.deepEqual(rows.map((r) => r.index), [1, 2, 3]);
  assert.equal(rows[1].firstBlockId, 'n_ch', 'wrapper identity = its OWN first block, never the nested row\'s');
  assert.deepEqual(rows[2].chapter, { ordinal: 1, ord: '01', title: 'Nested Chapter' });
});

ok('nested rows: surfaces inside the nesting make the WRAPPER a member; lanes stay honest', () => {
  const wrapper = NESTED_DOC.child(1);
  assert.equal(rowIsMember(wrapper, 'animation'), true, 'craft work in a nested shown lane lights the wrapper');
  assert.equal(timedWordsInRow(wrapper), 6, 'nested said lane counts; nested shown lane does not');
  const m = workspaceMetrics(NESTED_DOC, 'animation');
  assert.deepEqual(m, { timedWords: 6, minutes: 6 / 130, sectionCount: 1, rowCount: 1 });
});

console.log(`workspaces.test.mjs: ${pass} assertions passed`);
