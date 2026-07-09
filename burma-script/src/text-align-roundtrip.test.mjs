/**
 * text-align-roundtrip.test.mjs — paragraph alignment (TextAlign) survives the schema round-trip
 * that autosave + migration + clipboard all funnel through, and the extension is collab-safe.
 *
 * Contract:
 *   §1 The live schema (StarterKit + Burma nodes/marks + TextAlign) accepts a paragraph carrying
 *      textAlign:'center' INSIDE a voBlock inside a table row, and fromJSON->check->toJSON returns
 *      it byte-identical — the same serialize autosave (getJSON) and the migrate-doc save gate use.
 *   §2 A paragraph with textAlign:'right' round-trips its attr (proves it is a real schema attr,
 *      not silently dropped — the failure mode if TextAlign were missing from the mirror schema).
 *   §3 COLLAB LOOP LAW — TextAlign registers NO ProseMirror plugin (no appendTransaction/normalizer
 *      that could echo-loop under y-sync). It only adds global attrs + commands.
 *   §4 KEYMAP STRIP (a343112, Johnny 2026-07-09) — Editor.jsx wraps TextAlign in
 *      `.extend({ addKeyboardShortcuts: () => ({}) })` so its built-in Mod-Shift-l/e/r/j chords are
 *      GONE. Mod-Shift-r was hijacking Chrome's hard-reload and right-aligning the script instead.
 *      This pins: the plain form (migrate-doc.js) binds all four incl. Mod-Shift-r; the stripped
 *      form (Editor.jsx) binds NONE. Re-adding the keymap to Editor.jsx goes RED.
 *   §5 The strip is SCHEMA-INERT — the stripped-form schema round-trips a doc byte-identically to the
 *      plain-form schema, so migrate-doc.js keeping the un-stripped (headless, no keyboard) form is
 *      collab/serialization-safe: the divergence is keymap-only, never schema.
 *   §6 SOURCE TIE — Editor.jsx actually carries the `addKeyboardShortcuts: () => ({})` strip on
 *      TextAlign; migrate-doc.js deliberately does NOT (headless migration needs no keymap). Catches
 *      the real regression: someone "restoring lockstep" by dropping the strip re-breaks Cmd+Shift+R.
 *
 * Run: bun src/text-align-roundtrip.test.mjs
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import TextAlign from '@tiptap/extension-text-align';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ok —', label); };
const clone = (x) => JSON.parse(JSON.stringify(x));

// EXACT mirror of Editor.jsx / migrate-doc.js buildSchema() WITH TextAlign registered.
function buildSchema() {
  return getSchema([
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
    TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'], defaultAlignment: 'left' }),
  ]);
}

const schema = buildSchema();

// The TWO real forms in the codebase (kept in sync with the source by §6):
//   plain    → migrate-doc.js buildSchema()  (headless; keeps the built-in keymap, harmless)
//   stripped → Editor.jsx buildExtensions()   (live editor; keymap removed so Cmd+Shift+R reloads)
const TA_CFG = { types: ['paragraph'], alignments: ['left', 'center', 'right'], defaultAlignment: 'left' };
const taPlain = TextAlign.configure(TA_CFG);
const taStripped = TextAlign.extend({ addKeyboardShortcuts: () => ({}) }).configure(TA_CFG);

// Enumerate an extension's keymap chords WITHOUT a live editor — addKeyboardShortcuts references
// this.editor only inside the (uncalled) handler closures, so a stub `this` returns the key set.
const keymapChords = (ext) => {
  const fn = ext.config.addKeyboardShortcuts;
  return typeof fn === 'function' ? Object.keys(fn.call({ options: ext.options, editor: {} })) : [];
};

// A schema built with the STRIPPED TextAlign form (mirror of buildSchema but swapping the extension).
const schemaStripped = getSchema([
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
  taStripped,
]);

// full-width table row -> tableCell(full) -> voBlock -> paragraph[textAlign].
const makeDoc = (align) => ({
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' },
        content: [{
          type: 'paragraph', attrs: { textAlign: align },
          content: [{ type: 'text', text: 'the border town wakes before the checkpoint does' }],
        }],
      }],
    }],
  }],
});

ok('§1 center paragraph survives fromJSON->check->toJSON byte-identical', () => {
  const before = makeDoc('center');
  const node = PMNode.fromJSON(schema, clone(before)); // throws on shape/attr mismatch
  node.check();                                          // throws on invalid content fit
  const after = node.toJSON();
  const para = after.content[0].content[0].content[0].content[0];
  assert.equal(para.type, 'paragraph');
  assert.equal(para.attrs.textAlign, 'center');
});

ok('§2 right alignment is a real schema attr (not dropped)', () => {
  const node = PMNode.fromJSON(schema, makeDoc('right'));
  const para = node.toJSON().content[0].content[0].content[0].content[0];
  assert.equal(para.attrs.textAlign, 'right');
});

ok('§3 COLLAB LOOP LAW — TextAlign adds NO ProseMirror plugin (no auto-dispatch to echo-loop)', () => {
  const ext = TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'], defaultAlignment: 'left' });
  assert.equal(typeof ext.config.addProseMirrorPlugins, 'undefined');
  assert.equal(ext.name, 'textAlign');
});

ok('§4 keymap strip — plain binds Mod-Shift-l/e/r/j; stripped (Editor.jsx form) binds NONE', () => {
  assert.deepEqual(keymapChords(taPlain), ['Mod-Shift-l', 'Mod-Shift-e', 'Mod-Shift-r', 'Mod-Shift-j']);
  assert.deepEqual(keymapChords(taStripped), []);
  // the load-bearing one: the stripped form must NOT bind Mod-Shift-r (Chrome hard-reload).
  assert.ok(keymapChords(taPlain).includes('Mod-Shift-r'), 'plain form still binds the reload chord');
  assert.ok(!keymapChords(taStripped).includes('Mod-Shift-r'), 'stripped form frees Cmd+Shift+R for Chrome');
});

ok('§5 the strip is schema-inert — stripped-form round-trip is byte-identical to plain-form', () => {
  for (const align of ['center', 'right']) {
    const before = makeDoc(align);
    const viaPlain = PMNode.fromJSON(schema, clone(before)).toJSON();
    const viaStripped = (() => { const n = PMNode.fromJSON(schemaStripped, clone(before)); n.check(); return n.toJSON(); })();
    assert.deepEqual(viaStripped, viaPlain);
    // and the alignment attr genuinely survives the stripped schema (not just equal-because-both-dropped)
    assert.equal(viaStripped.content[0].content[0].content[0].content[0].attrs.textAlign, align);
  }
});

ok('§6 source tie — Editor.jsx strips the keymap on TextAlign; migrate-doc.js keeps it plain', () => {
  const editorSrc = readFileSync(new URL('./Editor.jsx', import.meta.url), 'utf8');
  const migrateSrc = readFileSync(new URL('./migrate-doc.js', import.meta.url), 'utf8');
  // Editor.jsx must wrap TextAlign in the keymap-strip extend (regression: dropping it re-hijacks reload).
  assert.match(editorSrc, /TextAlign\.extend\(\{\s*addKeyboardShortcuts:\s*\(\)\s*=>\s*\(\{\}\)\s*\}\)/,
    'Editor.jsx no longer strips TextAlign keymap — Cmd+Shift+R will right-align instead of reload');
  // migrate-doc.js is headless: it should stay on the plain configure (no extend needed).
  assert.match(migrateSrc, /TextAlign\.configure\(/, 'migrate-doc.js should register TextAlign');
  assert.doesNotMatch(migrateSrc, /TextAlign\.extend\(/,
    'migrate-doc.js gained an unexpected TextAlign.extend — headless migration needs no keymap');
});

console.log(`\ntext-align-roundtrip.test.mjs — ${pass} checks passed`);
