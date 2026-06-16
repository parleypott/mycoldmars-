/**
 * Tests for premiere-script.js — the .jsx generator for the Sacred Sequencer.
 *
 * Two surfaces:
 *  1. tcToSeconds — timecode → seconds. Uses split(':') so it must keep the
 *     hour on a fraction-less HH:MM:SS (the bug class that bit srt-builder).
 *  2. buildPremiereScript — the generated ExtendScript. The soundbite array is
 *     embedded via JSON.stringify into a DOUBLE-quoted JS string context, so a
 *     clip name with an apostrophe must survive WITHOUT a spurious backslash.
 *
 * Run: node premiere-script.test.mjs
 */
import { buildPremiereScript, tcToSeconds } from './premiere-script.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  // tolerant float compare for seconds
  const ok = typeof expected === 'number'
    ? Math.abs(actual - expected) < 1e-6
    : actual === expected;
  if (ok) { pass++; }
  else { fail++; fails.push(`${msg}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`); }
}
function ok(cond, msg) { eq(!!cond, true, msg); }

// ── tcToSeconds ──────────────────────────────────────────────────────────
// The load-bearing case: HH:MM:SS with NO fraction must keep the hour.
eq(tcToSeconds('01:02:03'), 3723, 'HH:MM:SS keeps the hour (1h2m3s = 3723s)');
eq(tcToSeconds('1:02:03'), 3723, 'H:MM:SS keeps the hour');
eq(tcToSeconds('00:00:00'), 0, 'all-zero HH:MM:SS = 0');
eq(tcToSeconds('02:00:00'), 7200, 'two hours = 7200s');
// Fractional forms (both . and , separators).
eq(tcToSeconds('01:02:03.500'), 3723.5, 'HH:MM:SS.mmm with dot');
eq(tcToSeconds('01:02:03,500'), 3723.5, 'HH:MM:SS,mmm with comma normalized to dot');
// M:SS forms.
eq(tcToSeconds('05:30'), 330, 'M:SS = 330s');
eq(tcToSeconds('05:30.250'), 330.25, 'M:SS.mmm');
eq(tcToSeconds('0:30'), 30, 'M:SS under a minute');
// Plain seconds.
eq(tcToSeconds('42'), 42, 'plain seconds');
eq(tcToSeconds('42.5'), 42.5, 'plain fractional seconds');
// Degenerate inputs.
eq(tcToSeconds(''), 0, 'empty string = 0');
eq(tcToSeconds(null), 0, 'null = 0');
eq(tcToSeconds(undefined), 0, 'undefined = 0');

// ── buildPremiereScript: apostrophe handling ────────────────────────────
// A soundbite prefix can include a speaker/block name (sot-hunter appends an
// upper-cased block label), e.g. "260322-04 - O'BRIEN". That apostrophe must
// land in the embedded JSON as a normal apostrophe — never as \' — because the
// array is consumed as a double-quoted JS string literal at runtime.
{
  const jsx = buildPremiereScript({
    soundbites: [{ prefix: "260322-04 - O'BRIEN", start: '00:00:01', end: '00:00:05' }],
    sacredSequenceName: 'Sacred',
    outputName: 'Out',
  });
  // The embedded array (double-quoted) should contain the plain apostrophe.
  ok(jsx.includes(`"name": "260322-04 - O'BRIEN"`),
     "apostrophe in clip name embeds cleanly (no spurious backslash)");
  // And must NOT contain the double-escaped form that the old code produced.
  ok(!jsx.includes("O\\'BRIEN"),
     "no double-escaped O\\'BRIEN in the generated script");
}

// ── buildPremiereScript: single-quoted name contexts still escaped ───────
// SACRED_NAME / OUTPUT_NAME ARE embedded into single-quoted literals, so an
// apostrophe there MUST be backslash-escaped (that escaping is correct).
{
  const jsx = buildPremiereScript({
    soundbites: [{ prefix: 'A', start: '0', end: '1' }],
    sacredSequenceName: "Lin's Cut",
    outputName: "Lin's Selects",
  });
  ok(jsx.includes("var SACRED_NAME = 'Lin\\'s Cut';"),
     "SACRED_NAME apostrophe is backslash-escaped for single-quote context");
  ok(jsx.includes("var OUTPUT_NAME = 'Lin\\'s Selects';"),
     "OUTPUT_NAME apostrophe is backslash-escaped for single-quote context");
}

// ── buildPremiereScript: in/out seconds + gap math ───────────────────────
{
  const jsx = buildPremiereScript({
    soundbites: [{ prefix: 'clip', start: '01:00:00', end: '01:00:10' }],
    sacredSequenceName: 'S',
    outputName: 'O',
    fps: 24,
    gapFrames: 12,
  });
  // start 1h = 3600s, end = 3610s must survive into the embedded JSON.
  ok(jsx.includes('"inSec": 3600'), 'inSec keeps the hour (3600s)');
  ok(jsx.includes('"outSec": 3610'), 'outSec keeps the hour (3610s)');
  // gapSec = gapFrames / fps = 12 / 24 = 0.5
  ok(jsx.includes('var GAP_SECONDS = 0.5;'), 'gap seconds = gapFrames/fps');
}

// ── buildPremiereScript: default output name when none given ─────────────
{
  const jsx = buildPremiereScript({
    soundbites: [{ prefix: 'x', start: '0', end: '1' }],
    sacredSequenceName: 'MyShow',
  });
  ok(jsx.includes("var OUTPUT_NAME = 'MyShow_Sacred Selects';"),
     "default output name = <sacred>_Sacred Selects");
}

// ── buildPremiereScript: missing prefix falls back to numbered name ──────
{
  const jsx = buildPremiereScript({
    soundbites: [{ start: '0', end: '1' }, { start: '2', end: '3' }],
    sacredSequenceName: 'S',
    outputName: 'O',
  });
  ok(jsx.includes('"name": "Soundbite 1"'), 'first missing-prefix → "Soundbite 1"');
  ok(jsx.includes('"name": "Soundbite 2"'), 'second missing-prefix → "Soundbite 2"');
}

// ── report ───────────────────────────────────────────────────────────────
console.log(`\npremiere-script: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
