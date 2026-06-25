// todo/time-format.test.mjs
//
// First coverage for the todo day-planner's TIME-DISPLAY formatters (todo/index.html,
// in vite.config.js, live at /todo/, ZERO prior coverage). These three pure functions
// render every block's time chip, every drag/create ghost label, and every hour
// gridline label — the numbers Johnny actually reads off the planner:
//   - minToTimeStr(absMin) — minutes-since-midnight -> "6:30a" / "12:00p" clock label
//   - formatHour(h)        — 0..23 hour -> "6 AM" / "12 PM" gridline label
//   - snap15(min)          — snap a minute value to the nearest 15-min grid step
//
// Locks the CORRECT behavior for every reachable input AND the two latent-landmine
// hardenings added this iteration (both behavior-preserving for in-range values):
//   * formatHour(24) must read midnight "12 AM", not the old "12 PM".
//   * minToTimeStr(negative / >1440 / NaN) must fold onto the clock, not emit
//     "-1:-30a" garbage — the todo import handler was found (obs 4323, 2026-06-24)
//     to corrupt state, which is a real path to an out-of-range startMin.
//
// The functions are EXTRACTED from the shipped index.html at runtime via brace
// matching + new Function — no hand-copied mirror, so the lock can't drift from the
// live page. Mutation-proven: reverting either hardening (or breaking the core math)
// goes RED; restoring index.html byte-for-byte goes GREEN.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// --- quote/escape-aware brace matcher: from the `{` at fromIdx to its matching `}` ---
function sliceBalanced(src, fromIdx) {
  let depth = 0, inStr = false, q = '', i = fromIdx;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(fromIdx, i + 1); }
  }
  throw new Error('unbalanced');
}

function extractFn(name) {
  const m = HTML.match(new RegExp(`function\\s+${name}\\s*\\(`));
  if (!m) throw new Error(`function ${name} not found`);
  const braceAt = HTML.indexOf('{', m.index);
  const body = sliceBalanced(HTML, braceAt);
  const sig = HTML.slice(m.index + `function ${name}`.length, braceAt);
  const src = `function ${name}${sig}${body}`;
  return new Function(`${src}\nreturn ${name};`)();
}

const minToTimeStr = extractFn('minToTimeStr');
const formatHour = extractFn('formatHour');
const snap15 = extractFn('snap15');

ok(typeof minToTimeStr === 'function' && typeof formatHour === 'function' && typeof snap15 === 'function',
   'extracted all three formatters');

// ============================================================================
// minToTimeStr — the block/ghost time chip
// ============================================================================
eq(minToTimeStr(0),    '12:00a', 'midnight -> 12:00a');
eq(minToTimeStr(60),   '1:00a',  '01:00 -> 1:00a');
eq(minToTimeStr(390),  '6:30a',  '06:30 -> 6:30a');
eq(minToTimeStr(719),  '11:59a', '11:59 -> 11:59a');
eq(minToTimeStr(720),  '12:00p', 'noon -> 12:00p');
eq(minToTimeStr(780),  '1:00p',  '13:00 -> 1:00p');
eq(minToTimeStr(1380), '11:00p', '23:00 -> 11:00p');
eq(minToTimeStr(1439), '11:59p', '23:59 -> 11:59p');
// end-of-day edge: a block clamped to hourEnd=24 stores endMin=1440. Must still read midnight.
eq(minToTimeStr(1440), '12:00a', 'end-of-day 1440 -> 12:00a (preserved)');
// minute zero-padding
eq(minToTimeStr(125),  '2:05a',  '02:05 zero-pads the minute');

// --- hardening: out-of-range / corrupt input folds onto the clock, no garbage ---
eq(minToTimeStr(-30),  '11:30p', 'HARDEN: negative folds to 11:30p (was "-1:-30a")');
eq(minToTimeStr(-1),   '11:59p', 'HARDEN: -1 folds to 11:59p');
eq(minToTimeStr(1500), '1:00a',  'HARDEN: 1500 (>1440) folds to 1:00a');
eq(minToTimeStr(NaN),  '12:00a', 'HARDEN: NaN -> 12:00a (no NaN leak)');
eq(minToTimeStr(Infinity), '12:00a', 'HARDEN: Infinity -> 12:00a');
ok(!minToTimeStr(-30).includes('-'), 'HARDEN: no negative sign ever leaks into the label');

// RED proof: the OLD buggy body would emit a negative-laden garbage string for -30.
const buggyMinToTimeStr = (absMin) => {
  const h = Math.floor(absMin / 60) % 24;
  const m = absMin % 60;
  const ampm = h < 12 ? 'a' : 'p';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
};
ok(buggyMinToTimeStr(-30).includes('-') && !minToTimeStr(-30).includes('-'),
   'RED-proof: pre-hardening minToTimeStr leaks "-" on negative input; real one does not');

// ============================================================================
// formatHour — the hour gridline label
// ============================================================================
eq(formatHour(0),  '12 AM', 'h=0 -> 12 AM (midnight)');
eq(formatHour(1),  '1 AM',  'h=1 -> 1 AM');
eq(formatHour(6),  '6 AM',  'h=6 -> 6 AM');
eq(formatHour(11), '11 AM', 'h=11 -> 11 AM');
eq(formatHour(12), '12 PM', 'h=12 -> 12 PM (noon)');
eq(formatHour(13), '1 PM',  'h=13 -> 1 PM');
eq(formatHour(23), '11 PM', 'h=23 -> 11 PM');

// --- hardening: 24 reads as midnight, out-of-range hours fold ---
eq(formatHour(24), '12 AM', 'HARDEN: h=24 -> 12 AM midnight (was "12 PM")');
eq(formatHour(25), '1 AM',  'HARDEN: h=25 -> 1 AM');
eq(formatHour(-1), '11 PM', 'HARDEN: h=-1 -> 11 PM');

// RED proof: the OLD body returned "12 PM" for 24 (noon, not midnight).
const buggyFormatHour = (h) => {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
};
ok(buggyFormatHour(24) === '12 PM' && formatHour(24) === '12 AM',
   'RED-proof: pre-hardening formatHour(24) was "12 PM"; real one is "12 AM"');

// ============================================================================
// snap15 — nearest 15-min grid step
// ============================================================================
eq(snap15(0),  0,  '0 -> 0');
eq(snap15(7),  0,  '7 snaps down to 0');
eq(snap15(8),  15, '8 snaps up to 15');
eq(snap15(15), 15, '15 stays 15');
eq(snap15(22), 15, '22 snaps down to 15');
eq(snap15(23), 30, '23 snaps up to 30');
eq(snap15(60), 60, '60 stays 60');

// ============================================================================
console.log(`todo/time-format: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
