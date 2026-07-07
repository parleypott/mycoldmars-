/*
 * chapter-frames.test.mjs — locks buildDecorations (chapter-frames.js), the node-decoration
 * core the editor uses to draw the light book-header FRAME around each chapter's rows in the
 * SCRIPTS editor (Johnny's outline-rail redesign, commit 9d5dea8 gutted this file's frame
 * logic to ~170 lines). It was exported "for the headless suite" but only ONE thin assertion
 * touched it (slash-structure.test.mjs §8: a fresh single /chapter row gets wp-chframe-first).
 * The load-bearing multi-chapter RUN logic was unlocked. This locks the whole contract:
 *
 *   1. FRAME BOUNDARIES — a multi-row chapter opens with wp-chframe-first, closes with
 *      wp-chframe-last, and every interior row is wp-chframe-mid; all share one data-chapter-run.
 *   2. SCENES LIVE INSIDE THE CHAPTER FRAME (Johnny's model) — a sceneBlock row does NOT open a
 *      new frame run; it inherits its chapter's run id + genre and renders as an interior row.
 *   3. NO ORPHAN FRAME — rows BEFORE the first chapterBlock carry no decoration at all.
 *   4. ADJACENT CHAPTERS SPLIT — two chapters in a row get distinct data-chapter-run ids, and a
 *      single-row chapter is BOTH first and last (first+last, never mid).
 *   5. GENRE CARRIES — every framed row (chapter, scene, body) carries the opening chapter's genre.
 *   6. OFF-EPISODE — when the chapterFrames feature flag is off, buildDecorations is empty.
 *
 * Every assertion is mutation-proven load-bearing on the shipped chapter-frames.js:
 *   • make sceneBlock a run-start in chapterRunStartForRow  → §2 RED (scene splits to run 2).
 *   • drop the `if (!row.chapterId) continue` guard          → §3 RED (leading rows decorated).
 *   • drop the isLast branch / force mid                     → §4 RED (single-row loses last).
 *   • neuter isPalauEpisode()/the off short-circuit          → §6 RED (frames on off-episode).
 *
 * Run: bun src/extensions/chapter-frames.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { buildDecorations } from './chapter-frames.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA); // BURMA carries features.chapterFrames = true (the frames-on episode)

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

// The same schema the live editor + migrate-doc save gate enforce (mirrors slash-structure.test).
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
const row = (blocks) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
const chapter = (id, genre) => ({
  type: 'chapterBlock', attrs: { blockId: id, genre },
  content: [{ type: 'paragraph' }],
});
const scene = (id) => ({
  type: 'sceneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph' }],
});
const vo = (id) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph' }],
});

// Build the doc, then return one record per TOP-LEVEL row: { index, deco|null } where deco is
// the flattened { run, genre, class } of the chapter-frame node decoration on that row (or null
// when the row carries no frame). Matches decorations back to rows by their start position.
function frameByRow(docJson) {
  const doc = docFrom(docJson);
  const found = buildDecorations(doc).find();
  const byPos = new Map();
  for (const d of found) {
    byPos.set(d.from, {
      run: d.type.attrs['data-chapter-run'],
      genre: d.type.attrs['data-chapter-genre'],
      class: d.type.attrs.class || '',
    });
  }
  const out = [];
  doc.forEach((node, pos, index) => { out.push({ index, deco: byPos.get(pos) || null }); });
  return { rows: out, total: found.length };
}

// ── 1: FRAME BOUNDARIES — first / mid / last across a 3-row chapter, one shared run ──────────
ok('a multi-row chapter opens first, closes last, interiors are mid — all one run', () => {
  const { rows, total } = frameByRow({
    type: 'doc',
    content: [row([chapter('c1', 'history')]), row([vo('v1')]), row([vo('v2')])],
  });
  assert.equal(total, 3, 'all three rows framed');
  assert.equal(rows[0].deco.class, 'wp-chframe wp-chframe-first', 'chapter row opens the frame');
  assert.equal(rows[1].deco.class, 'wp-chframe wp-chframe-mid', 'interior body row is mid');
  assert.equal(rows[2].deco.class, 'wp-chframe wp-chframe-last', 'final body row closes the frame');
  const runs = new Set(rows.map((r) => r.deco.run));
  assert.equal(runs.size, 1, 'the whole chapter is ONE frame run');
  assert.equal(rows[0].deco.run, '1', 'first chapter is run 1');
});

// ── 2: SCENES LIVE INSIDE THE CHAPTER FRAME — a scene row does NOT open a new run ────────────
// Load-bearing: chapterRunStartForRow returns null for sceneBlock on purpose (Johnny's model —
// a scene sits inside its chapter's one big frame). If a scene opened its own run, the frame
// would visually shatter mid-chapter.
ok('a sceneBlock row inherits its chapter run + genre (does not split the frame)', () => {
  const { rows } = frameByRow({
    type: 'doc',
    content: [row([chapter('c1', 'ground')]), row([scene('s1')]), row([vo('v1')])],
  });
  assert.equal(rows[0].deco.run, '1');
  assert.equal(rows[1].deco.run, '1', 'the scene stays in the chapter frame (same run, NOT run 2)');
  assert.equal(rows[2].deco.run, '1');
  assert.equal(rows[1].deco.genre, 'ground', 'scene inherits the chapter genre');
  assert.equal(rows[1].deco.class, 'wp-chframe wp-chframe-mid', 'scene renders as an interior row');
});

// ── 3: NO ORPHAN FRAME — rows before the first chapterBlock carry no decoration ──────────────
ok('rows before the first chapter are unframed; the frame starts at the chapter', () => {
  const { rows, total } = frameByRow({
    type: 'doc',
    content: [row([vo('v0')]), row([vo('v0b')]), row([chapter('c1', 'history')]), row([vo('v1')])],
  });
  assert.equal(total, 2, 'only the chapter row + its body row are framed');
  assert.equal(rows[0].deco, null, 'leading pre-chapter row has NO frame');
  assert.equal(rows[1].deco, null, 'second pre-chapter row has NO frame');
  assert.equal(rows[2].deco.class, 'wp-chframe wp-chframe-first', 'the chapter opens the frame');
  assert.equal(rows[3].deco.class, 'wp-chframe wp-chframe-last');
  assert.equal(rows[2].deco.run, '1');
});

// ── 4: ADJACENT CHAPTERS SPLIT — distinct runs; a single-row chapter is first AND last ───────
ok('two adjacent chapters get distinct runs; a lone chapter row is first+last', () => {
  const { rows } = frameByRow({
    type: 'doc',
    content: [row([chapter('c1', 'history')]), row([chapter('c2', 'ground')]), row([vo('v2')])],
  });
  // c1 stands alone (next row opens a new chapter) → it is BOTH the first and last of run 1.
  assert.equal(rows[0].deco.run, '1');
  assert.equal(rows[0].deco.class, 'wp-chframe wp-chframe-first wp-chframe-last',
    'a single-row chapter is first AND last, never mid');
  // c2 opens run 2 and its body row closes it.
  assert.equal(rows[1].deco.run, '2', 'the second chapter is a NEW run');
  assert.equal(rows[1].deco.class, 'wp-chframe wp-chframe-first');
  assert.equal(rows[2].deco.run, '2');
  assert.equal(rows[2].deco.class, 'wp-chframe wp-chframe-last');
});

// ── 5: GENRE CARRIES — the opening chapter's genre rides every row of its run ────────────────
ok('genre carries from the opening chapter onto every framed row of the run', () => {
  const { rows } = frameByRow({
    type: 'doc',
    content: [row([chapter('c1', 'history')]), row([vo('v1')]), row([chapter('c2', 'ground')]), row([vo('v2')])],
  });
  assert.equal(rows[0].deco.genre, 'history');
  assert.equal(rows[1].deco.genre, 'history', 'body row inherits the chapter genre');
  assert.equal(rows[2].deco.genre, 'ground');
  assert.equal(rows[3].deco.genre, 'ground', 'the genre switches at the new chapter');
});

// ── 6: OFF-EPISODE — no frames when the chapterFrames feature flag is off ─────────────────────
ok('buildDecorations is empty when the episode has chapterFrames off', () => {
  setEpisode({ ...BURMA, features: { ...BURMA.features, chapterFrames: false } });
  try {
    const doc = docFrom({ type: 'doc', content: [row([chapter('c1', 'history')]), row([vo('v1')])] });
    assert.equal(buildDecorations(doc).find().length, 0, 'off-episode draws no frames');
  } finally {
    setEpisode(BURMA); // restore the frames-on episode for any later assertions
  }
});

console.log(`chapter-frames.test.mjs: ${pass} assertions passed`);
