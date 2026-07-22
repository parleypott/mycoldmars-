/**
 * IMAGE CLICK-TO-SELECT + DELETE — regression guards (2026-07-22, "still can't click or delete
 * images or gifs").
 *
 * ROOT CAUSE the fix closes:
 *   The paste-status overlay `.wp-media-status` is `position:absolute; inset:0; display:flex` and
 *   is toggled with the `hidden` ATTRIBUTE. A stylesheet `display` value OVERRIDES the [hidden]
 *   attribute's UA `display:none`, so even when "hidden" the layer stayed laid out over the WHOLE
 *   image box and — with default pointer-events + the nodeview's stopEvent swallowing events in its
 *   own subtree — ate every click on the media. The image/gif could never become a NodeSelection,
 *   so it could never be clicked-to-select NOR keyboard-deleted. Same layer for stills AND the
 *   gif→<video> transcode, so both failed identically.
 *
 * Hit-testing needs real layout (verified live in a browser). Here we lock the two invariants a
 * headless suite CAN prove:
 *   1. CSS: the resting status layer is removed from hit-testing — `[hidden]{display:none}` AND the
 *      layer itself is `pointer-events:none` (only its buttons are interactive).
 *   2. DELETE VALIDITY: a NodeSelection + deleteSelection removes an imageBlock — including one that
 *      is the LONE block in its tableCell (content 'block+') — and leaves a SCHEMA-VALID doc. This
 *      is the transform deleteMediaNode (the right-click "DELETE IMAGE" entry) and PM's default
 *      Backspace/Delete both rely on.
 *
 * Run: bun burma-script/src/image-click-delete.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSchema } from '@tiptap/core';
import { EditorState, NodeSelection } from '@tiptap/pm/state';
import { deleteSelection } from '@tiptap/pm/commands';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';

setEpisode(BURMA);
let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
    history: { depth: 100, newGroupDelay: 750 },
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

// ---- 1: CSS regression guard — the resting overlay must not intercept clicks --------------------
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
ok('.wp-media-status[hidden] is display:none (a hidden overlay leaves the hit-test)', () => {
  assert.match(css, /\.wp-media-status\[hidden\]\s*\{[^}]*display:\s*none/,
    'without this the [hidden] attribute is overridden by the base display:flex and the layer eats clicks');
});
ok('.wp-media-status base layer is pointer-events:none (only its buttons are interactive)', () => {
  const block = css.match(/\.wp-media-status\s*\{[^}]*\}/);
  assert.ok(block && /pointer-events:\s*none/.test(block[0]),
    'the visible (uploading/error) overlay must not swallow clicks meant for the media either');
  assert.match(css, /\.wp-media-status-btn\s*\{[^}]*pointer-events:\s*auto/,
    'retry/remove buttons stay clickable');
});

// ---- doc helpers: top level is tableRow+, image lives inside a cell (block+) --------------------
const N = schema.nodes;
const image = (blockId, src) => N.imageBlock.create({ blockId, src, alt: '', kind: 'shot' });
const para = (t) => N.paragraph.create(null, t ? schema.text(t) : null);
const row = (...blocks) => N.tableRow.create(null, N.tableCell.create(null, blocks));

function stateWith(docNode) {
  return EditorState.create({ schema, doc: docNode });
}
const posOfImage = (doc, id) => { let p = null; doc.descendants((n, pos) => { if (n.type.name === 'imageBlock' && n.attrs.blockId === id) p = pos; }); return p; };

// ---- 2: NodeSelection + deleteSelection removes the image, keeps a valid doc --------------------
ok('deleting a LONE image in a cell removes it AND leaves a schema-valid doc', () => {
  const doc = N.doc.create(null, [row(image('lone', '/x.png')), row(para('after'))]);
  let state = stateWith(doc);
  const pos = posOfImage(state.doc, 'lone');
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  let newState = state;
  const handled = deleteSelection(state, (tr) => { newState = state.apply(tr); });
  assert.ok(handled, 'deleteSelection ran on the node selection');
  assert.equal(posOfImage(newState.doc, 'lone'), null, 'image is gone');
  newState.doc.check(); // throws if the delete stranded an illegal empty cell
});

ok('deleting an image that SHARES its cell with prose keeps the prose and stays valid', () => {
  const doc = N.doc.create(null, [row(para('caption line'), image('withText', '/y.png')), row(para('tail'))]);
  let state = stateWith(doc);
  const pos = posOfImage(state.doc, 'withText');
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  let newState = state;
  deleteSelection(state, (tr) => { newState = state.apply(tr); });
  assert.equal(posOfImage(newState.doc, 'withText'), null, 'image is gone');
  assert.ok(newState.doc.textContent.includes('caption line'), 'neighbouring prose survived');
  newState.doc.check();
});

ok('deleting a gif→video imageBlock (src .mp4) behaves identically to a still', () => {
  const doc = N.doc.create(null, [row(image('gif', 'https://x/loop.mp4')), row(para('after'))]);
  let state = stateWith(doc);
  const pos = posOfImage(state.doc, 'gif');
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  let newState = state;
  deleteSelection(state, (tr) => { newState = state.apply(tr); });
  assert.equal(posOfImage(newState.doc, 'gif'), null, 'video imageBlock is gone');
  newState.doc.check();
});

// ---- 3: FOCUS-RACE FIX — a blurred first click must yield a NodeSelection that HOLDS ------------
// Johnny 2026-07-22: "click an image, the orange box flashes for a microsecond then disappears;
// click AGAIN and it holds." Clicking a media atom while the editor is BLURRED lets the browser's
// focus-driven DOM-selection placement race ProseMirror's mouseup NodeSelection and clobber it. The
// fix takes authoritative control on mousedown: focus the view + set the NodeSelection ourselves,
// BEFORE the browser's placement resolves. Real hit-testing needs a browser (verified live), so here
// we lock the two invariants a headless suite CAN prove.
const blocksSrc = readFileSync(new URL('./extensions/blocks.js', import.meta.url), 'utf8');
ok('the imageBlock nodeview installs a media mousedown handler that sets a NodeSelection (edit-only)', () => {
  // The handler block: media.addEventListener('mousedown', …) that guards canEdit() and dispatches a
  // PMNodeSelection. If a refactor drops it, the blurred-first-click race re-opens silently.
  const m = blocksSrc.match(/media\.addEventListener\(\s*'mousedown'[\s\S]{0,600}?\}\);/);
  assert.ok(m, "media has a 'mousedown' handler in the nodeview");
  assert.match(m[0], /canEdit\(\)/, 'the handler is edit-only (read mode keeps click-to-zoom)');
  assert.match(m[0], /PMNodeSelection\.create/, 'the handler sets a NodeSelection on the clicked node');
  assert.match(m[0], /hasFocus\(\)[\s\S]*focus\(\)/, 'it focuses the view when blurred, before selecting');
  assert.ok(!/preventDefault\(\)/.test(m[0]), 'it must NOT preventDefault — the node stays draggable');
});

ok('a NodeSelection on an image HOLDS through a benign remote-like transaction (no degrade)', () => {
  // The "holds across ticks" property at the mapping layer: a NodeSelection on the image, carried
  // through an unrelated transaction (a remote teammate edit elsewhere in the doc), must remain a
  // NodeSelection on the SAME image — never silently degrade to a text caret.
  const doc = N.doc.create(null, [row(image('hold', '/x.png')), row(para('tail text'))]);
  let state = stateWith(doc);
  const pos = posOfImage(state.doc, 'hold');
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  assert.ok(state.selection instanceof NodeSelection, 'starts as a NodeSelection');
  // simulate an edit far from the image (append text to the tail paragraph)
  const tailEnd = state.doc.content.size - 1;
  const after = state.apply(state.tr.insertText(' more', tailEnd));
  assert.ok(after.selection instanceof NodeSelection, 'still a NodeSelection after an unrelated edit');
  assert.equal(after.selection.node.type.name, 'imageBlock', 'still selecting the SAME image');
  assert.equal(posOfImage(after.doc, 'hold'), after.selection.from, 'anchored on the image, not drifted');
});

console.log(`image-click-delete: ${pass} passed, 0 failed`);
