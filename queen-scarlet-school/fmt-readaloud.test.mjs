// Verifier-layer lock for the QSS read-aloud player clock formatter `fmt(t)`.
//
// THE BUG (fixed): fmt rendered "M:SS" with NO hour carry —
//   const m = Math.floor(t / 60); const s = Math.floor(t - m*60);
//   return `${m}:${pad(s)}`;
// The player's time label is `${fmt(cur)} / ${fmt(total)}` where total =
// session.totalDuration = sum of EVERY scene's TTS audio across the whole story.
// A long multi-scene story whose cumulative read-aloud crosses an hour rendered
// "65:30 / 72:10" instead of "1:05:30 / 1:12:10" — the hour silently dropped.
// Same hour-drop class as the essays/burma-essays/format-clock fixes.
//
// This test EXTRACTS the REAL shipped fmt from queen-scarlet-school/index.html
// at runtime (can't drift from a mirror), proves the fix, and is mutation-proven.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Extract the shipped `function fmt(t) { ... }` body by brace-matching.
function extractFn(src, signature) {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`signature not found: ${signature}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return src.slice(start, i);
}

const fmtSrc = extractFn(html, 'function fmt(t)');
// eslint-disable-next-line no-new-func
const fmt = new Function(`${fmtSrc}; return fmt;`)();

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error(`FAIL ${label}`); } };

// ---- inline RED proof: the OLD no-carry formatter drops the hour ----
const oldFmt = (t) => {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};
ok(oldFmt(3930) === '65:30', 'RED-proof: old formatter renders 3930s as "65:30"');
ok(fmt(3930) !== '65:30', 'RED-proof: shipped fmt does NOT render "65:30"');

// ---- the fix: hour carry ----
eq(fmt(3930), '1:05:30', '1:05:30 (65.5 min)');
eq(fmt(3600), '1:00:00', 'hour boundary');
eq(fmt(3599), '59:59', 'one under the hour');
eq(fmt(3661), '1:01:01', '1:01:01');
eq(fmt(7325), '2:02:05', 'multi-hour 2:02:05');
eq(fmt(4330), '1:12:10', 'a long story total 1:12:10');
eq(fmt(3725), '1:02:05', 'minutes zero-padded after the hour');

// ---- no-regression: sub-hour byte-identical to the old M:SS ----
for (const t of [0, 1, 5, 30, 59, 60, 61, 90, 125, 330, 599, 600, 3599, 3599.9]) {
  eq(fmt(t), oldFmt(t), `sub-hour byte-identical @ ${t}`);
}

// ---- guards preserved ----
eq(fmt(-5), '0:00', 'negative clamps to 0:00');
eq(fmt(NaN), '0:00', 'NaN -> 0:00');
eq(fmt(Infinity), '0:00', 'Infinity -> 0:00');
eq(fmt(undefined), '0:00', 'undefined -> 0:00');

// ---- fractional seconds floor (mirrors old behavior) ----
eq(fmt(65.9), '1:05', 'fractional floor sub-hour');
eq(fmt(3725.9), '1:02:05', 'fractional floor with hour');

console.log(`\nqss fmt read-aloud clock: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
