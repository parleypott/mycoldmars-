/*
 * toast-tone.test.mjs — ux-01 guard. A REJECTED action (invalid timecode, moved marker) must NOT
 * render as a green "COPIED" toast. This locks the wiring: the error producers dispatch a distinct
 * { tone:'error', msg } payload, copies dispatch { tc, tone:'ok' }, and CopyToast renders an
 * "INVALID" red state for the error tone instead of "COPIED". Source-level assertions so the
 * regression (hardcoded "COPIED" on every payload) can't silently come back.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const marks = readFileSync(join(here, 'extensions', 'marks.js'), 'utf8');
const editor = readFileSync(join(here, 'Editor.jsx'), 'utf8');
const main = readFileSync(join(here, 'main.jsx'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('  ✗', name); } }

// Producers: errors carry tone:'error', copies carry tone:'ok'.
ok('marks: invalid-timecode dispatches tone error', /not a valid timecode[\s\S]*?tone:\s*'error'/.test(marks) ||
  /tone:\s*'error'[\s\S]*?not a valid timecode/.test(marks));
ok('marks: copy dispatches tone ok', /tc[,\s][^}]*tone:\s*'ok'/.test(marks) || /tone:\s*'ok'/.test(marks));
ok('editor: moved-marker abort dispatches tone error', /that marker moved[\s\S]*?tone:\s*'error'/.test(editor) ||
  /tone:\s*'error'[\s\S]*?that marker moved/.test(editor));

// No error producer still ships a bare {tc:'<sentence>'} that the toast would label COPIED.
ok('marks: invalid msg not sent as tc', !/tc:\s*'not a valid timecode/.test(marks));
ok('editor: moved msg not sent as tc', !/tc:\s*'that marker moved/.test(editor));

// CopyToast renders a distinct INVALID label + is-error class for the error tone.
ok('CopyToast reads tone error', /tone\s*===\s*'error'/.test(main) || /d\.tone\s*===\s*'error'/.test(main));
ok('CopyToast renders INVALID label', /'INVALID'/.test(main) || /INVALID/.test(main));
ok('CopyToast adds is-error class', /is-error/.test(main));

console.log(`toast-tone: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
