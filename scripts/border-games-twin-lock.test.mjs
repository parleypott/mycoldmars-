// border-games-twin-lock.test.mjs
//
// A FRONT-LOADED VERIFIER for the loop's single richest bug class: the "divergent-weaker twin."
//
// borders/index.html and border-guesser/index.html are two separately-shipped country-shape
// guessing games that carry a BYTE-IDENTICAL game engine — the same 17 load-bearing logic
// functions (getDailyIndex, resolveGuess, submitGuess, endGame, loadPuzzle, showSuggestions,
// updateCounter, ...) copy-pasted into both files. There is no shared module; the only thing
// keeping them in sync is hope.
//
// That is EXACTLY the setup that has produced ~50 real bugs across this repo: someone fixes a
// defect in one copy of a paired function and the other copy silently keeps the bug (the FCP7
// NTSC writer/reader, the cookie-regex gates, the Gemini leading-model-turn copies, the hour-drop
// formatters, ... — the whole "divergent twin" vein). These two games are a landmine waiting for
// the next bug fix to land in only one of them.
//
// This gate LOCKS the engine: every shared logic function must be byte-identical between the two
// files. If a future edit fixes (or breaks) one copy without the other, `bun run test` goes RED
// and names the function that drifted — turning a silent divergence into a loud one.
//
// DELIBERATELY EXCLUDED: drawGrid — it differs ONLY in cosmetic grid-line stroke colors
// (#1a1a1a gray in borders, #1a2a4a blue in border-guesser). That is intentional per-game
// theming, not engine logic. We still assert it EXISTS in both (so a rename/removal is caught),
// just not that it's identical.
//
// Mutation-proven: change any byte of a shared logic function in ONE file -> this goes RED.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BORDERS = readFileSync(join(ROOT, 'borders', 'index.html'), 'utf8');
const GUESSER = readFileSync(join(ROOT, 'border-guesser', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// Extract a top-level `function NAME(...) { ... }` body from src, brace-matching with
// string/comment awareness so a `}` inside a string literal doesn't end the function early.
// Returns the exact source slice (verbatim, including indentation) or null if not found.
function extractFn(src, name) {
  const re = new RegExp(`(^|\\n)([ \\t]*)function ${name}\\s*\\(`, '');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + (m[1] ? m[1].length : 0); // start at the indentation
  // find the first `{` of the body, then brace-match to its close
  let i = src.indexOf('{', start);
  if (i < 0) return null;
  let depth = 0, inStr = false, q = '', inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// The shared GAME ENGINE — every function that lives in BOTH files and carries logic, not theme.
// (Derived from a full shared-function sweep: 18 shared, drawGrid is the only intentional diff.)
const SHARED_LOGIC = [
  'getDailyIndex', 'detectNameProp', 'loadPuzzle', 'nextPuzzle', 'updateTestBanner',
  'showError', 'startPlaying', 'updateCounter', 'resolveGuess', 'submitGuess', 'addClue',
  'endGame', 'showSuggestions', 'hideSuggestions', 'openShare', 'closeShare', 'debugLog',
];

// Normalize ONLY by stripping a single leading indentation difference: border-guesser nests its
// <script> one level, borders does not, so identical bodies can differ purely by a constant
// leading-whitespace shift. We compare the dedented forms so the lock fires on LOGIC drift, not
// indentation. (A real logic change survives dedent and still trips the gate.)
function dedent(s) {
  return s.split('\n').map(l => l.replace(/^[ \t]+/, '')).join('\n').trimEnd();
}

for (const fn of SHARED_LOGIC) {
  const a = extractFn(BORDERS, fn);
  const b = extractFn(GUESSER, fn);
  ok(a !== null, `borders/index.html defines ${fn}()`);
  ok(b !== null, `border-guesser/index.html defines ${fn}()`);
  if (a !== null && b !== null) {
    ok(dedent(a) === dedent(b),
       `engine drift: ${fn}() differs between borders and border-guesser — one copy was edited ` +
       `without the other (the "divergent twin" bug class). Sync both or move to a shared module.`);
  }
}

// drawGrid: cosmetic-only twin. Must EXIST in both (catch rename/removal) but is allowed to differ.
{
  const a = extractFn(BORDERS, 'drawGrid');
  const b = extractFn(GUESSER, 'drawGrid');
  ok(a !== null, 'borders/index.html defines drawGrid() (cosmetic twin)');
  ok(b !== null, 'border-guesser/index.html defines drawGrid() (cosmetic twin)');
  // Sanity: the ONLY expected divergence is the grid stroke color. If drawGrid ever diverges in
  // something other than a color literal, we want a human to look — assert the non-color lines match.
  if (a !== null && b !== null) {
    const stripColors = (s) => dedent(s).replace(/#[0-9a-fA-F]{3,6}/g, '#COLOR');
    ok(stripColors(a) === stripColors(b),
       'drawGrid diverges beyond grid color literals — verify the cosmetic-twin assumption still holds');
  }
}

// Guard against the engine quietly SHRINKING: if a real shared logic fn is dropped from this
// list, the lock silently stops covering it. Assert the list still matches the live intersection
// of shared logic functions (minus the known cosmetic one).
{
  const namesIn = (src) => new Set(
    [...src.matchAll(/(?:^|\n)[ \t]*function ([a-zA-Z0-9_]+)\s*\(/g)].map(m => m[1])
  );
  const A = namesIn(BORDERS), B = namesIn(GUESSER);
  const shared = [...A].filter(n => B.has(n));
  // Every name we lock must actually be shared.
  for (const fn of SHARED_LOGIC) ok(shared.includes(fn), `locked fn ${fn} is present in both files`);
  // And the live shared set, minus the cosmetic drawGrid, must be fully covered by our list —
  // so a NEW shared engine function can't sneak in unlocked.
  const expected = new Set([...SHARED_LOGIC]);
  const uncovered = shared.filter(n => n !== 'drawGrid' && !expected.has(n));
  ok(uncovered.length === 0,
     `new shared engine function(s) not covered by the twin-lock: ${uncovered.join(', ')} — add them to SHARED_LOGIC`);
}

console.log(`border-games-twin-lock: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
