/*
 * edit-mode.test.mjs — locks the READ/EDIT mode module (edit-mode.js), the in-session latch
 * behind the sticky top-center switch. The contract Johnny asked for, verbatim: "it starts in
 * read mode". Everything editable in the session keys off isEditMode(), so the load-bearing
 * facts are:
 *
 *   1. DEFAULT IS READ — a fresh module load answers isEditMode() === false. If this ever
 *      flips, every visit opens armed and a scroll-through can type into the live script.
 *   2. THE SWITCH WORKS BOTH WAYS — setEditMode(true/false) flips the answer and returns it.
 *   3. BROADCAST — a real flip dispatches ONE `wp-edit-mode` window event carrying the new
 *      state; a NO-OP set (same state) dispatches NOTHING (listeners must never see dupes).
 *   4. WINDOW-LESS SAFETY — with no window at all, setEditMode still flips state and never
 *      throws (the dispatch is best-effort chrome, not the state machine).
 *
 * Run: bun src/edit-mode.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

// §4 first — import with NO window present: module must load and flip cleanly.
const mod = await import('./edit-mode.js');
const { isEditMode, setEditMode, __setEditModeForTest } = mod;

ok('§1 default is READ (isEditMode false on fresh load)', () => {
  assert.equal(isEditMode(), false);
});

ok('§4 window-less setEditMode flips state without throwing', () => {
  assert.equal(setEditMode(true), true);
  assert.equal(isEditMode(), true);
  assert.equal(setEditMode(false), false);
  assert.equal(isEditMode(), false);
});

// Now mount a fake window and check the broadcast discipline.
const events = [];
globalThis.window = {
  dispatchEvent(e) { events.push(e); return true; },
};
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; }
  };
}

ok('§2/§3 a real flip broadcasts wp-edit-mode with the new state', () => {
  __setEditModeForTest(false);
  events.length = 0;
  setEditMode(true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'wp-edit-mode');
  assert.equal(events[0].detail.edit, true);
  setEditMode(false);
  assert.equal(events.length, 2);
  assert.equal(events[1].detail.edit, false);
});

ok('§3 a no-op set broadcasts nothing', () => {
  __setEditModeForTest(true);
  events.length = 0;
  assert.equal(setEditMode(true), true);
  assert.equal(events.length, 0, 'same-state set must not re-dispatch');
});

ok('§4 test seam sets silently', () => {
  events.length = 0;
  assert.equal(__setEditModeForTest(false), false);
  assert.equal(isEditMode(), false);
  assert.equal(events.length, 0);
});

delete globalThis.window;
console.log(`edit-mode: ${pass} sections green`);
