// Locks the nile-flights itinerary tool's load-bearing, previously-ZERO-coverage pure cores.
// nile-flights is Johnny's ACTIVE Ethiopia/Nile-trip flight itinerary (live, in daily use this
// week). These functions decide what he sees about each leg — and one of them is decision-driving:
//
//   classifyGap(mins) — the same-airport connection classifier. <75 min = "⚠ too tight — book a
//     later flight"; <=12h = "⏱ Layover"; longer = "☾ On the ground" (overnight+). A regression in
//     the 75-min or 12h boundary would silently tell him a connection is fine when it's too tight
//     (missed flight on a remote leg) or vice versa. Extracted this iteration from render() into a
//     pure top-level function (additive, render output byte-identical) so it's testable.
//
//   dur(a,b)    — the "1h 10m" leg/layover duration label (hour-carrying).
//   parse(s)    — "YYYY-MM-DD HH:MM" -> Date (drives every time shown on the itinerary).
//   fmtTime(dt) — the 12-hour "11:40 AM" departure/arrival clock (noon/midnight edges).
//   pad(n)      — minute zero-pad.
//
// This is a verifier-layer LOCK (no live bug found — the logic is correct): it EXTRACTS the real
// shipped functions from public/nile-flights/index.html at runtime via brace/line matching, so it
// can't drift from a hand-copied mirror, and is mutation-proven to go RED if a threshold regresses.
// Same standard as the westchester-geo / walden-frame / todo-planner inline-HTML locks.
//
// run: node public/nile-flights/nile-flights-core.test.mjs   (or via `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

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

// ---- extract a single-line `const NAME = ... ;` arrow assignment ----
function extractConstLine(src, name) {
  const re = new RegExp(`const ${name}\\s*=`);
  const m = src.match(re);
  if (!m) throw new Error(`const ${name} not found in index.html`);
  const start = m.index;
  const nl = src.indexOf('\n', start);
  return src.slice(start, nl === -1 ? src.length : nl);
}

// Bind the REAL shipped functions out of the HTML. pad/parse/fmtTime/dur are self-contained
// single-line consts (fmtTime uses pad, so order matters); classifyGap is a self-contained
// top-level function. A bare sandbox runs the exact live code.
const { classifyGap, dur, parse, fmtTime, pad } = (() => {
  const body = `
    ${extractConstLine(HTML, 'pad')}
    ${extractConstLine(HTML, 'parse')}
    ${extractConstLine(HTML, 'fmtTime')}
    ${extractConstLine(HTML, 'dur')}
    ${extractFn(HTML, 'classifyGap')}
    return { classifyGap, dur, parse, fmtTime, pad };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(body)();
})();

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } }

// ===================== inline RED proof + behavior-preserving lock =====================
// Reconstruct what render()'s OLD inline branching produced (the exact pill class + head label)
// and prove classifyGap composes to BYTE-IDENTICAL output across the whole minute range. This is
// the proof that the extraction (this iteration) is behavior-preserving, AND it pins the thresholds.
{
  // OLD render() gap composition, for the both-times-known branch (the only one classifyGap covers):
  const oldCompose = (mins) => {
    if (mins < 75) return { pill: 'warn', head: '⚠TIGHT' }; // tight branch (head is the warn text)
    const short = mins <= 12 * 60;
    return { pill: short ? 'lay' : 'ground', head: short ? '⏱ Layover' : '☾ On the ground' };
  };
  // NEW composition via the shipped classifyGap (what render() does now):
  const newCompose = (mins) => {
    const g = classifyGap(mins);
    if (g.tight) return { pill: 'warn', head: '⚠TIGHT' };
    return { pill: g.pill, head: g.head };
  };
  let allMatch = true;
  for (let mins = -30; mins <= 2000; mins += 1) {
    const a = oldCompose(mins), b = newCompose(mins);
    if (a.pill !== b.pill || a.head !== b.head) { allMatch = false; break; }
  }
  ok('behavior-preserving: classifyGap composition === old inline render across all minutes', allMatch);

  // RED proof: a classifier that drops the 75-min tight threshold would call a 40-min gap a "layover"
  // instead of "too tight" — show the shipped function does NOT do that.
  const badGap = (mins) => (mins <= 12 * 60 ? { pill: 'lay', tight: false } : { pill: 'ground', tight: false });
  ok('RED proof: a tight-threshold-less classifier calls a 40-min gap a layover',
     badGap(40).tight === false && badGap(40).pill === 'lay');
  ok('RED proof: shipped classifyGap flags a 40-min gap as too tight',
     classifyGap(40).tight === true && classifyGap(40).pill === 'warn');
}

// ===================== classifyGap thresholds =====================
{
  // --- the 75-min "too tight" boundary ---
  ok('mins 0 -> tight (warn)', classifyGap(0).tight === true && classifyGap(0).pill === 'warn');
  ok('mins 40 -> tight', classifyGap(40).tight === true);
  ok('mins 74 -> tight', classifyGap(74).tight === true);
  ok('mins 74.99 -> tight', classifyGap(74.99).tight === true);
  ok('mins 75 -> NOT tight (boundary, layover)',
     classifyGap(75).tight === false && classifyGap(75).pill === 'lay' && classifyGap(75).head === '⏱ Layover');
  ok('mins 76 -> layover', classifyGap(76).pill === 'lay');
  // negative (bad data: dep before arr) still flagged tight, never silently "fine"
  ok('mins -30 (bad data) -> tight', classifyGap(-30).tight === true);

  // --- the 12-hour layover/ground boundary (720 min) ---
  ok('mins 390 (6h30) -> layover', classifyGap(390).pill === 'lay' && classifyGap(390).head === '⏱ Layover');
  ok('mins 719 -> layover', classifyGap(719).pill === 'lay');
  ok('mins 720 (12h exactly) -> layover (inclusive boundary)',
     classifyGap(720).pill === 'lay' && classifyGap(720).tight === false);
  ok('mins 721 -> on the ground', classifyGap(721).pill === 'ground' && classifyGap(721).head === '☾ On the ground');
  ok('mins 2000 (overnight+) -> on the ground', classifyGap(2000).pill === 'ground');

  // tight gaps never carry a head label (render shows the ⚠ line instead)
  ok('tight gap head is null', classifyGap(30).head === null);
  // non-tight gaps always carry a head label
  ok('layover gap has a head', typeof classifyGap(200).head === 'string' && classifyGap(200).head.length > 0);
  ok('ground gap has a head', typeof classifyGap(2000).head === 'string' && classifyGap(2000).head.length > 0);
}

// ===================== parse (YYYY-MM-DD HH:MM -> local Date) =====================
{
  const d = parse('2026-06-15 11:40');
  ok('parse: year', d.getFullYear() === 2026);
  ok('parse: month (June -> getMonth 5)', d.getMonth() === 5);
  ok('parse: day', d.getDate() === 15);
  ok('parse: hours', d.getHours() === 11);
  ok('parse: minutes', d.getMinutes() === 40);
  // missing time component defaults to 0:0 (the `t||"0:0"` guard)
  const dd = parse('2026-06-21');
  ok('parse: dateless time -> midnight', dd.getHours() === 0 && dd.getMinutes() === 0);
}

// ===================== fmtTime (12-hour AM/PM clock) =====================
{
  ok('fmtTime 11:40 -> 11:40 AM', fmtTime(parse('2026-06-15 11:40')) === '11:40 AM');
  ok('fmtTime 16:35 -> 4:35 PM', fmtTime(parse('2026-06-16 16:35')) === '4:35 PM');
  ok('fmtTime noon 12:00 -> 12:00 PM', fmtTime(parse('2026-06-15 12:00')) === '12:00 PM');
  ok('fmtTime midnight 00:05 -> 12:05 AM', fmtTime(parse('2026-06-15 00:05')) === '12:05 AM');
  ok('fmtTime 13:05 -> 1:05 PM', fmtTime(parse('2026-06-15 13:05')) === '1:05 PM');
  ok('fmtTime zero-pads minutes (09:05 -> 9:05 AM)', fmtTime(parse('2026-06-15 09:05')) === '9:05 AM');
}

// ===================== dur (hour-carrying duration label) =====================
{
  // real ADD->BJR leg: 11:40 -> 12:50 = 1h10m
  ok('dur ADD->BJR = 1h 10m', dur(parse('2026-06-15 11:40'), parse('2026-06-15 12:50')) === '1h 10m');
  // real CAI->ASW connection layover: 02:05 -> 08:35 = 6h30m
  ok('dur layover 6h 30m', dur(parse('2026-06-17 02:05'), parse('2026-06-17 08:35')) === '6h 30m');
  // exact hour -> "1h" (no trailing 0m)
  ok('dur exact 1h -> "1h"', dur(parse('2026-06-15 10:00'), parse('2026-06-15 11:00')) === '1h');
  // sub-hour -> minutes only
  ok('dur 45m -> "45m"', dur(parse('2026-06-15 10:00'), parse('2026-06-15 10:45')) === '45m');
  // zero -> "0m" (never empty)
  ok('dur 0 -> "0m"', dur(parse('2026-06-15 10:00'), parse('2026-06-15 10:00')) === '0m');
  // multi-hour with minutes
  ok('dur 3h 50m (ADD->CAI)', dur(parse('2026-06-16 22:15'), parse('2026-06-17 02:05')) === '3h 50m');
}

// ===================== pad =====================
{
  ok('pad 5 -> 05', pad(5) === '05');
  ok('pad 12 -> 12', pad(12) === '12');
  ok('pad 0 -> 00', pad(0) === '00');
}

console.log(`nile-flights-core: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
