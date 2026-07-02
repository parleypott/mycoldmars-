// Locks buildSystemInstruction (api/_lib/cutter-prompt.js) — the two-column
// script Gemini reads to help restructure a rough cut in the Cutter tool.
//
// The load-bearing invariant: a segment missing any field (timestamp_start,
// timestamp_end, words, visual) must render BLANK, never the literal string
// "undefined". The client's renderScript already guards this (`?? ''`/`|| ''`);
// the server prompt builder was the divergent-weaker copy that interpolated
// raw. This test mutation-proves the guard: reverting to raw interpolation
// makes the "undefined"-leak assertions go RED.
//
// Also pins: numeric 0 start timecode survives (truthy-zero class), a fully
// populated segment renders both columns, and empty/non-array collapses to the
// '(no script loaded)' sentinel.
//
// Run: node api/_lib/cutter-system-instruction.test.mjs  (or `bun run test`)
import { buildSystemInstruction } from './cutter-prompt.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

// --- a segment missing every field must not leak "undefined" (load-bearing) ---
{
  const out = buildSystemInstruction([{}], 'Cut A');
  ok('empty segment: no "undefined" leak', !out.includes('undefined'));
  ok('empty segment: blank timecodes collapse to [–]', out.includes('[–]'));
  ok('empty segment: blank WORDS line', out.includes('WORDS: \n'));
  ok('empty segment: blank VISUAL line', /VISUAL: (\n|$)/.test(out));
}

// --- a partially-populated segment blanks only the missing field ---
{
  const out = buildSystemInstruction(
    [{ timestamp_start: '0:10', words: 'hello' /* no end, no visual */ }],
    'Cut B'
  );
  ok('partial segment: no "undefined" leak', !out.includes('undefined'));
  ok('partial segment: present field renders', out.includes('WORDS: hello'));
  ok('partial segment: missing end blanks, start kept', out.includes('[0:10–]'));
}

// --- numeric 0 start timecode preserved, not blanked (truthy-zero class) ---
{
  const out = buildSystemInstruction(
    [{ timestamp_start: 0, timestamp_end: 12, words: 'w', visual: 'v' }],
    'Cut C'
  );
  ok('numeric 0 start survives', out.includes('[0–12]'));
}

// --- a fully populated segment renders both columns intact ---
{
  const out = buildSystemInstruction(
    [{ timestamp_start: '0:00', timestamp_end: '0:15', words: 'the words', visual: 'wide shot' }],
    'My Cut'
  );
  ok('full: title rendered', out.includes('THE CUT — "My Cut"'));
  ok('full: timecodes rendered', out.includes('[0:00–0:15]'));
  ok('full: words rendered', out.includes('WORDS: the words'));
  ok('full: visual rendered', out.includes('VISUAL: wide shot'));
}

// --- empty / non-array segments collapse to the no-script sentinel ---
{
  ok('empty array → sentinel', buildSystemInstruction([], 'T').includes('(no script loaded)'));
  ok('null → sentinel', buildSystemInstruction(null, 'T').includes('(no script loaded)'));
  ok('undefined → sentinel', buildSystemInstruction(undefined).includes('(no script loaded)'));
  ok('missing title → Untitled', buildSystemInstruction([]).includes('THE CUT — "Untitled"'));
}

console.log(`cutter-system-instruction: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
