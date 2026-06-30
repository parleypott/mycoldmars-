// data-contract.test.mjs — FIRST coverage for the live `bounce` game (mycoldmars.com/bounce/).
//
// `bounce` is a public country-shape spotting game: a ball bounces on a platform while country
// shapes cycle behind it; the player taps when the TARGET country is showing. The whole game —
// level intro, HUD, win/lose, the per-bounce difficulty ramp — is driven off three inline data
// structures with NO module boundary and (until now) NO test:
//
//   • LEVELS      — { 1: [{name, path}, ...], 2: [...], ... }   the country shapes per level
//   • LEVEL_META  — [{title, desc, bounces, baseInterval}, ...]  the per-level config
//   • TOTAL_LEVELS / MIN_INTERVAL — loop + indexing constants
//
// These three MUST stay in lockstep. The game indexes them by level number with no guard:
//   startLevel(lvl):  meta = LEVEL_META[lvl - 1];  levelCountries = LEVELS[lvl];
//   showLevelIntro(lvl):  meta = LEVEL_META[lvl - 1];  ... uses meta.title/desc
// so if LEVEL_META has fewer entries than TOTAL_LEVELS, the last level crashes on
// `meta.title` (undefined). If LEVELS[lvl] is missing, the shuffle crashes on `[...undefined]`.
//
// And winnability rests on the DATA itself, not on any code the loop can lock with a unit test:
//   - a level needs ≥2 countries or target===current always (degenerate / no real round);
//   - every country needs a RENDERABLE path — draw() only paints `if (parsedPaths[name])`, and a
//     country whose `new Path2D(path)` throws is silently skipped (invisible). If the TARGET is
//     invisible, the round is UNWINNABLE — the exact "dead on live" class already fixed in this
//     game once (LEVEL_META strings) and in the endLevel idempotency fix (obs 4408);
//   - bounces ≥ 1 and baseInterval ≥ MIN_INTERVAL, else the ramp is broken or the timer fires
//     before a shape can even appear.
//
// This gate reads the live HTML, extracts the three structures, and asserts the contract. It is
// the front-loaded verifier for the next time someone edits the level data: add a 7th level to
// LEVELS but forget LEVEL_META, paste a malformed SVG path, drop a country so a level has one
// shape — `bun run test` goes RED and names exactly what broke, instead of the game shipping
// broken to a public URL with nobody watching.
//
// Mutation-proven (see the asserts): delete a LEVEL_META entry, blank a path, give a level a
// single country, or set a bounces:0 — each trips a distinct assertion.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// ── Extract the constants ────────────────────────────────────────────────────
function intConst(name) {
  const m = new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(HTML);
  return m ? Number(m[1]) : null;
}
const TOTAL_LEVELS = intConst('TOTAL_LEVELS');
const MIN_INTERVAL = intConst('MIN_INTERVAL');
ok(Number.isInteger(TOTAL_LEVELS) && TOTAL_LEVELS > 0, `TOTAL_LEVELS is a positive int (got ${TOTAL_LEVELS})`);
ok(Number.isInteger(MIN_INTERVAL) && MIN_INTERVAL > 0, `MIN_INTERVAL is a positive int (got ${MIN_INTERVAL})`);

// ── Extract LEVELS = { N: [ {name, path}, ... ], ... } ────────────────────────
// Slice the LEVELS object literal, then split on its top-level numeric keys.
const levelsSeg = HTML.slice(HTML.indexOf('const LEVELS'), HTML.indexOf('const LEVEL_META'));
const levelKeys = [...levelsSeg.matchAll(/^\s*(\d+):\s*\[/gm)].map(m => Number(m[1]));
const levelBlocks = levelsSeg.split(/^\s*\d+:\s*\[/m).slice(1);

// Country entries use single-quoted strings:  { name: '...', path: '...' }
function countriesIn(block) {
  return [...block.matchAll(/name:\s*'([^']+)'\s*,\s*path:\s*'([^']*)'/g)].map(m => ({ name: m[1], path: m[2] }));
}

// A renderable SVG path: starts with a moveto (M/m) and contains only path command letters,
// digits, separators, signs and decimals. A blank/garbage path is what `new Path2D()` rejects,
// leaving the shape invisible — the unwinnable-target failure mode.
const RENDERABLE_PATH = /^\s*[Mm][\sMmLlHhVvCcSsQqTtAaZz0-9.,\-+eE]*$/;

// LEVELS key integrity: contiguous 1..TOTAL_LEVELS, exactly TOTAL_LEVELS of them.
ok(levelKeys.length === TOTAL_LEVELS,
   `LEVELS has ${levelKeys.length} levels but TOTAL_LEVELS=${TOTAL_LEVELS} — startLevel(${TOTAL_LEVELS}) would read LEVELS[${TOTAL_LEVELS}]=undefined and crash the shuffle`);
for (let i = 1; i <= TOTAL_LEVELS; i++) {
  ok(levelKeys.includes(i), `LEVELS defines level ${i} (keys must be contiguous 1..${TOTAL_LEVELS})`);
}

// Per-level country contract.
levelBlocks.forEach((block, idx) => {
  const lvl = idx + 1;
  const cs = countriesIn(block);
  ok(cs.length >= 2,
     `level ${lvl} has ${cs.length} countries — needs ≥2 or target===current always (degenerate round)`);
  const names = cs.map(c => c.name);
  const dup = names.find((n, j) => names.indexOf(n) !== j);
  ok(!dup, `level ${lvl} has a duplicate country name "${dup}" — ambiguous win match / wasted slot`);
  for (const c of cs) {
    ok(c.name.trim().length > 0, `level ${lvl}: every country has a non-empty name`);
    ok(RENDERABLE_PATH.test(c.path),
       `level ${lvl}: country "${c.name}" has a malformed/empty SVG path — it would render INVISIBLE, ` +
       `making the round unwinnable if it's the target`);
  }
});

// ── Extract LEVEL_META = [ {title, desc, bounces, baseInterval}, ... ] ────────
const metaSeg = HTML.slice(HTML.indexOf('const LEVEL_META'), HTML.indexOf('const TOTAL_LEVELS'));
const metaEntries = [...metaSeg.matchAll(/\{\s*title:[\s\S]*?bounces:\s*(\d+)\s*,\s*baseInterval:\s*(\d+)\s*\}/g)]
  .map(m => ({ bounces: Number(m[1]), baseInterval: Number(m[2]) }));
// title/desc presence (non-empty single-quoted strings, escapes allowed).
const titleCount = [...metaSeg.matchAll(/title:\s*'(?:[^'\\]|\\.)+'/g)].length;
const descCount = [...metaSeg.matchAll(/desc:\s*'(?:[^'\\]|\\.)+'/g)].length;

ok(metaEntries.length === TOTAL_LEVELS,
   `LEVEL_META has ${metaEntries.length} entries but TOTAL_LEVELS=${TOTAL_LEVELS} — showLevelIntro(${TOTAL_LEVELS}) reads LEVEL_META[${TOTAL_LEVELS - 1}]=undefined and crashes on meta.title`);
ok(titleCount === TOTAL_LEVELS, `every LEVEL_META entry has a non-empty title (${titleCount}/${TOTAL_LEVELS})`);
ok(descCount === TOTAL_LEVELS, `every LEVEL_META entry has a non-empty desc (${descCount}/${TOTAL_LEVELS})`);

metaEntries.forEach((m, i) => {
  const lvl = i + 1;
  ok(m.bounces >= 1,
     `level ${lvl}: bounces=${m.bounces} — needs ≥1 or the level times out before a shape can appear`);
  ok(m.baseInterval >= MIN_INTERVAL,
     `level ${lvl}: baseInterval=${m.baseInterval} < MIN_INTERVAL=${MIN_INTERVAL} — the difficulty ramp floors immediately`);
});

console.log(`bounce/data-contract: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
