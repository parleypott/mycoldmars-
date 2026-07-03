// nile-flights booking tracker — background-poll / save race lock.
//
// THE BUG (fixed): the page background-polls the cloud every 20s (so Johnny sees
// Marisa's checks land and vice-versa) and load() blindly REASSIGNS the module
// `state` from the server. A booking check is a two-step local edit: toggle()
// mutates `state` + renders instantly, then a 350ms-debounced save() POSTs it.
// If a poll fired inside that window, load() overwrote `state` with the server's
// (pre-check) copy — reverting the just-tapped box — and if the poll landed
// mid-debounce, the pending save then serialized the polled-in stale state,
// PERMANENTLY LOSING the booking. On a page two people edit at once, that race
// is real.
//
// THE FIX: a pure shouldPoll(visible, pendingTimer, inFlight) gate. The poll only
// runs when the page is visible AND there is no pending debounce (saveTimer) AND
// no in-flight save. save() nulls saveTimer when the debounce fires and clears
// saveInFlight in a finally, so polling can never get wedged off after a save.
//
// This test extracts the SHIPPED shouldPoll out of index.html and mutation-locks
// its truth table, and pins the source wiring (save() flag discipline + the
// interval calling shouldPoll) so the race can't silently return.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  try { assert.ok(cond, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};

// ---- extract a `function NAME(...) { ... }` body by brace-matching ----
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in index.html`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const shouldPoll = new Function(`${extractFn(HTML, 'shouldPoll')}; return shouldPoll;`)();

// ---- truth table: poll ONLY when visible AND idle (no pending + no in-flight) ----
ok(shouldPoll(true, null, false) === true, 'visible + idle → poll');
ok(shouldPoll(false, null, false) === false, 'hidden tab → never poll');
ok(shouldPoll(true, 123, false) === false, 'pending debounce (saveTimer set) → skip poll');
ok(shouldPoll(true, null, true) === false, 'save in flight → skip poll');
ok(shouldPoll(true, 123, true) === false, 'pending AND in flight → skip poll');
ok(shouldPoll(false, 123, true) === false, 'hidden + busy → skip poll');

// a real (elapsed but non-null) timer id is truthy → still counts as pending
ok(shouldPoll(true, 1, false) === false, 'any truthy timer id blocks the poll');

// ---- MUTATION PROOF: a gate that ignored the save window would let the race back
// in. Model the pre-fix behavior (visible-only) and assert it DISAGREES with the
// shipped gate exactly on the states the fix exists to block. ----
const naive = (visible) => visible === true; // the old `visibilityState==="visible"` check
ok(naive(true) === true && shouldPoll(true, 123, false) === false,
   'RED-proof: old visible-only gate would poll mid-debounce; shouldPoll blocks it');
ok(naive(true) === true && shouldPoll(true, null, true) === false,
   'RED-proof: old visible-only gate would poll mid-flight; shouldPoll blocks it');

// ---- source wiring: the guard must actually be wired into the live loop ----
ok(/setInterval\(\s*\(\)\s*=>\s*\{\s*if\(\s*shouldPoll\(/.test(HTML),
   'the 20s poll interval is gated by shouldPoll(...)');
ok(!/if\(document\.visibilityState==="visible"\)\s*load\(\)/.test(HTML),
   'the old un-gated visible-only poll check is gone');

// ---- save() flag discipline: saveTimer nulled on fire, saveInFlight set + cleared ----
ok(/let saveTimer=null,\s*saveInFlight=false;/.test(HTML), 'saveInFlight flag declared');
ok(/saveTimer=null;\s*saveInFlight=true;/.test(HTML),
   'save() nulls the debounce timer and marks in-flight when the POST starts');
ok(/finally\{\s*saveInFlight=false;\s*\}/.test(HTML),
   'save() always clears saveInFlight in a finally (poll can never wedge off)');

console.log(`poll-guard: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
