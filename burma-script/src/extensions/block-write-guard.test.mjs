/*
 * block-write-guard.test.mjs — the READ-mode write guard for block-head controls
 * (the ✓ done tick + the REC/VO status pill in extensions/blocks.js).
 *
 * Both controls dispatch a `setAttr` doc write on activation, which fires PAST the editor's
 * `editable:false` flag (ProseMirror commands ignore `editable`). Their sibling controls
 * (direction-chip, bubble-menu marks) refuse the write in CODE with `isReadOnly() ||
 * !editor.view.editable`; the done tick and REC pill relied on doctrine.css `display:none`
 * alone. This locks the shared predicate's truth table so the guard can't silently regress:
 * writing is allowed ONLY when editing is truly armed (not a `?read` share, editable true).
 *
 * Mutation proof: flip the predicate to `!readOnly` (drop the editable term) and the READ-mode
 * case (readOnly false, editable false) goes RED; flip it to `!!editable` (drop the readOnly
 * term) and the share case goes RED. Both restore GREEN with the shipped `!readOnly && !!editable`.
 *
 * Run: bun src/extensions/block-write-guard.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { blockHeadControlWritable } from './block-write-guard.js';

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); pass++; };

// ── EDIT MODE, full edit rights: the only state that may write ──
eq(blockHeadControlWritable({ readOnly: false, editable: true }), true,
  'armed edit session (not read-only, editable) → write allowed');

// ── in-session READ latch (edit-mode.js): editable is flipped false → NO write ──
// This is the load-bearing case: the keyboard path (Tab → Enter on the ✓/REC control) would
// otherwise fire setAttr past `editable:false`.
eq(blockHeadControlWritable({ readOnly: false, editable: false }), false,
  'READ latch (editable false) → write refused — the bug this guard closes');

// ── `?read` share: structurally write-incapable regardless of the editable flag ──
eq(blockHeadControlWritable({ readOnly: true, editable: false }), false,
  'read-only share → write refused');
eq(blockHeadControlWritable({ readOnly: true, editable: true }), false,
  'read-only share wins even if editable somehow true → write refused');

// ── fail-CLOSED on an unknown editable (mirrors direction-chip `!editor.view.editable`) ──
eq(blockHeadControlWritable({ readOnly: false, editable: undefined }), false,
  'undefined editable → fail-closed (refuse)');
eq(blockHeadControlWritable({ readOnly: false }), false,
  'missing editable → fail-closed (refuse)');
eq(blockHeadControlWritable({}), false, 'empty args → fail-closed (refuse)');
eq(blockHeadControlWritable(), false, 'no args → fail-closed (refuse)');

// ── boolean coercion is honest (truthy editable, falsy readonly-ish inputs) ──
eq(blockHeadControlWritable({ readOnly: false, editable: 1 }), true, 'truthy editable coerces true');
eq(blockHeadControlWritable({ readOnly: 0, editable: true }), true, 'falsy readOnly coerces to "not read-only"');
ok(blockHeadControlWritable({ readOnly: '', editable: 'yes' }) === true, 'falsy readOnly + truthy editable → allowed');

console.log(`block-write-guard.test.mjs — ${pass} assertions passed`);
