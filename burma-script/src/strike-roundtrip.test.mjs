/**
 * strike-roundtrip.test.mjs — the Strike mark (Johnny 2026-07-22, commit f8a786b: "command
 * shift X doesn't strike thru") survives the schema round-trip that autosave + migration all
 * funnel through, and the Cmd/Ctrl+Shift+X chord is guaranteed at priority 1001.
 *
 * Strike was schema-DISABLED (`strike: false` in both Editor.jsx and migrate-doc.js) since the
 * editor's birth. This commit enabled it, added `strike` to blocks.js MARKS_ALLOWLIST, and bound
 * the chord in the priority-1001 ListShortcuts keymap. Three regressions this pins:
 *
 *   §1 A struck text span inside a voBlock->paragraph round-trips fromJSON->check->toJSON
 *      byte-identical — the SAME serialize path autosave (getJSON) and the migrate-doc save
 *      read-back gate use. Guards the schema-ENABLE: re-adding `strike: false` removes the mark
 *      from the schema, and because MARKS_ALLOWLIST references `strike`, getSchema then THROWS
 *      "Unknown mark type: 'strike'" (see §2) — so buildSchema() here throws and this goes RED.
 *   §2 COUPLING ORACLE — after this commit the enable and the allowlist are load-bearingly
 *      coupled: MARKS_ALLOWLIST names `strike`, so a schema built with `strike: false` throws
 *      "Unknown mark type: 'strike'" at build time (the whole editor would fail to construct).
 *      This proves the enable is now MANDATORY, not optional — you cannot silently re-disable it.
 *   §3 MARKS_ALLOWLIST SOURCE TIE — blocks.js keeps `strike` in the block-content mark allowlist,
 *      so a struck span isn't dropped from a script block during editing. Dropping it goes RED.
 *   §4 SCHEMA-PARITY SOURCE TIE — neither Editor.jsx nor migrate-doc.js re-disables strike. The
 *      save read-back gate demands byte-identical schemas; re-adding `strike: false` to EITHER
 *      side (they must stay in lockstep) fires wp-save-failed on every struck doc. Either goes RED.
 *   §5 KEYMAP (Johnny's literal complaint) — ListShortcuts binds `Mod-Shift-x` at priority 1001
 *      like the list chords, so no extension-default change or keymap reshuffle can drop it; the
 *      handler is isEditable-guarded and toggles strike. Removing the chord goes RED.
 *
 * Run: bun src/strike-roundtrip.test.mjs
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
import { ListShortcuts } from './extensions/list-shortcuts.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ok —', label); };
const clone = (x) => JSON.parse(JSON.stringify(x));

// EXACT mirror of Editor.jsx / migrate-doc.js buildSchema() — StarterKit no longer disables strike,
// so the mark is live. `strikeDisabled` flips just that one flag to reproduce the pre-commit form.
function buildSchema(strikeDisabled = false) {
  return getSchema([
    StarterKit.configure({
      heading: false, blockquote: false, codeBlock: false, code: false,
      horizontalRule: false, ...(strikeDisabled ? { strike: false } : {}),
      dropcursor: false, gapcursor: false,
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

// full-width table row -> tableCell(full) -> voBlock -> paragraph -> struck text span.
const strikeDoc = () => ({
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
            { type: 'text', text: 'keep ' },
            { type: 'text', marks: [{ type: 'strike' }], text: 'cut this line' },
          ],
        }],
      }],
    }],
  }],
});

// Enumerate an extension's keymap chords WITHOUT a live editor — the handlers reference
// this.editor only inside the (uncalled) closures, so a stub `this` returns the key set.
const keymapChords = (ext) => {
  const fn = ext.config.addKeyboardShortcuts;
  return typeof fn === 'function' ? Object.keys(fn.call({ options: ext.options, editor: {} })) : [];
};

ok('§1 struck span survives fromJSON->check->toJSON byte-identical (the autosave/migrate path)', () => {
  assert.ok('strike' in schema.marks, 'strike must be a live mark in the schema');
  const before = strikeDoc();
  const node = PMNode.fromJSON(schema, clone(before)); // throws on shape/attr mismatch
  node.check();                                          // throws on invalid content fit
  const after = node.toJSON();
  const spans = after.content[0].content[0].content[0].content[0].content;
  assert.equal(spans[0].text, 'keep ');
  assert.ok(!spans[0].marks, 'the plain span carries no marks');
  assert.equal(spans[1].text, 'cut this line');
  assert.deepEqual(spans[1].marks, [{ type: 'strike' }], 'the struck span keeps exactly the strike mark');
});

ok('§2 coupling oracle — re-disabling strike THROWS "Unknown mark type" (enable is now mandatory)', () => {
  // MARKS_ALLOWLIST names `strike`, so a schema with `strike: false` cannot resolve the allowlist.
  assert.throws(() => buildSchema(true), /Unknown mark type: 'strike'/,
    're-adding `strike: false` must break the schema build — the allowlist depends on the enable');
});

ok('§3 MARKS_ALLOWLIST source tie — blocks.js keeps `strike` in the block-content allowlist', () => {
  const src = readFileSync(new URL('./extensions/blocks.js', import.meta.url), 'utf8');
  const m = src.match(/const MARKS_ALLOWLIST\s*=\s*'([^']*)'/);
  assert.ok(m, 'MARKS_ALLOWLIST literal must be present in blocks.js');
  assert.ok(m[1].split(/\s+/).includes('strike'),
    'MARKS_ALLOWLIST dropped `strike` — a struck span would be filtered out of script blocks on edit');
});

ok('§4 schema-parity source tie — neither Editor.jsx nor migrate-doc.js re-disables strike (lockstep)', () => {
  const editorSrc = readFileSync(new URL('./Editor.jsx', import.meta.url), 'utf8');
  const migrateSrc = readFileSync(new URL('./migrate-doc.js', import.meta.url), 'utf8');
  assert.doesNotMatch(editorSrc, /strike:\s*false/,
    'Editor.jsx re-disabled strike — struck docs will fire wp-save-failed on the read-back gate');
  assert.doesNotMatch(migrateSrc, /strike:\s*false/,
    'migrate-doc.js re-disabled strike — the save read-back schema diverged from Editor.jsx');
});

ok('§5 keymap — ListShortcuts binds Mod-Shift-x at priority 1001, isEditable-guarded, toggling strike', () => {
  assert.equal(ListShortcuts.config.priority, 1001, 'ListShortcuts must sit above Collaboration (1000)');
  assert.ok(keymapChords(ListShortcuts).includes('Mod-Shift-x'),
    'the Cmd/Ctrl+Shift+X strike chord was dropped from the guaranteed keymap');
  const src = readFileSync(new URL('./extensions/list-shortcuts.js', import.meta.url), 'utf8');
  assert.match(src, /'Mod-Shift-x':[\s\S]*?isEditable[\s\S]*?toggleStrike/,
    'the Mod-Shift-x handler must guard isEditable and call toggleStrike');
});

console.log(`\nstrike-roundtrip.test.mjs — ${pass} checks passed`);
