// collab-anchors.test.mjs — locks the Yjs RELATIVE-POSITION anchor adapter (collab-anchors.js),
// the chunk image-drop.js uses to keep an upload placeholder alive across a y-sync FULL-DOC
// replace (see COLLAB LOOP LAW). The load-bearing contract this test pins:
//   • toRel/toAbs return null the moment the y-sync binding isn't up — callers treat null as
//     "site gone, abort", so a placeholder never resolves to a wrong offset and corrupts the doc.
//   • toAbs returns ONLY a real numeric position; anything else (deleted item, unexpected shape)
//     degrades to null. This is the guard that stops a non-number leaking into a PM position.
//   • the adapter wires isRemote to the REAL isRemoteEchoTransaction (no divergent re-impl).
//
// @tiptap/y-tiptap needs a live Yjs binding to exercise the happy path, which can't be stood up
// headless — so we mock that boundary (bun mock.module) and drive getState / the two converters
// directly. collab-anchors.js's own guard logic is what's under test, not y-tiptap's internals.
//
// Run: bun src/collab-anchors.test.mjs

import assert from 'node:assert/strict';
import { mock } from 'bun:test';

// Mutable boundary the mock reads — flipped per assertion to simulate binding up/down + deletes.
let gsReturn = null; // ySyncPluginKey.getState(state)
let relReturn = 'REL-POS'; // absolutePositionToRelativePosition(...)
let absReturn = 42; // relativePositionToAbsolutePosition(...)

mock.module('@tiptap/y-tiptap', () => ({
  ySyncPluginKey: { getState: () => gsReturn },
  absolutePositionToRelativePosition: () => relReturn,
  relativePositionToAbsolutePosition: () => absReturn,
}));

// Import AFTER the mock is registered so collab-anchors.js binds the mocked converters.
const { makeCollabAnchorAdapter } = await import('./collab-anchors.js');
const { isRemoteEchoTransaction } = await import('./collab-echo.js');

const adapter = makeCollabAnchorAdapter();
const BOUND = { type: 'T', doc: 'D', binding: { mapping: 'M' } }; // a synced binding

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

// ── wiring ──────────────────────────────────────────────────────────────────
ok('isRemote is the REAL isRemoteEchoTransaction (no divergent copy)', () => {
  assert.equal(adapter.isRemote, isRemoteEchoTransaction);
});

// ── toRel ─────────────────────────────────────────────────────────────────────
ok('toRel → null when the y-sync binding is not up (getState null) — abort, do not anchor', () => {
  gsReturn = null;
  assert.equal(adapter.toRel({}, 5), null);
});

ok('toRel → null when the plugin state exists but has no binding yet', () => {
  gsReturn = { type: 'T', binding: null };
  assert.equal(adapter.toRel({}, 5), null);
});

ok('toRel with a live binding returns the RelativePosition from the converter (guard admits it)', () => {
  // Reddens on: return-break in toRel, OR inverting the `!ys.binding` guard to reject-when-present.
  gsReturn = BOUND;
  relReturn = 'REL-POS';
  assert.equal(adapter.toRel({}, 5), 'REL-POS');
});

ok('toRel swallows any throw → null (never bubbles into the transaction)', () => {
  // getState whose .type access throws mid-conversion; the try/catch must degrade to null.
  gsReturn = { get type() { throw new Error('boom'); }, binding: { mapping: 'M' } };
  assert.equal(adapter.toRel({}, 5), null);
});

// ── toAbs ─────────────────────────────────────────────────────────────────────
ok('toAbs → null when the binding is not up (getState null)', () => {
  gsReturn = null;
  assert.equal(adapter.toAbs({}, 'anchor'), null);
});

ok('toAbs with a live binding returns the numeric absolute position', () => {
  // Reddens on: return-break in toAbs, OR inverting the `!ys.binding` guard.
  gsReturn = BOUND;
  absReturn = 42;
  assert.equal(adapter.toAbs({}, 'anchor'), 42);
});

ok('toAbs → null when the anchored item was deleted (converter returns null)', () => {
  gsReturn = BOUND;
  absReturn = null;
  assert.equal(adapter.toAbs({}, 'anchor'), null);
});

ok('toAbs → null on a NON-number resolution (the typeof guard — nothing but a real pos leaks out)', () => {
  // Reddens on dropping `typeof abs === "number" ? abs : null` — the object would leak to the caller.
  gsReturn = BOUND;
  absReturn = { unexpected: 'shape' };
  assert.equal(adapter.toAbs({}, 'anchor'), null);
});

ok('toAbs → 0 is a VALID position and survives the typeof guard (truthy-zero safe)', () => {
  gsReturn = BOUND;
  absReturn = 0;
  assert.equal(adapter.toAbs({}, 'anchor'), 0);
});

console.log(`\ncollab-anchors: ${pass} assertions passed`);
