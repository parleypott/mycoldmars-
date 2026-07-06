// quiz-game-twin-lock.test.mjs
//
// A FRONT-LOADED VERIFIER for the loop's single richest bug class: the "divergent twin."
//
// fascism/ and flyingmoney/ are two separately-shipped map-quiz games that carry a BYTE-IDENTICAL
// engine. They both import the shared answer core (../../shared/quiz-answer.js), but the entire
// UI/game glue ON TOP of that core — pickQuestions, startGame, showQuestion, handleAnswer,
// showScorecard, setDifficulty, the whole "Game State" region of src/main.js — is copy-pasted
// into both tools. There is no shared module for that glue; the only thing keeping the two engines
// in sync is hope.
//
// That is EXACTLY the setup that has produced ~200 real bugs across this repo — someone fixes a
// defect in one copy and the other silently keeps the bug. This very family already paid the tax
// TWICE (see BACKLOG): the hardcoded `TOTAL = 5` progress bug and the double-click double-count bug
// each had to be fixed in ALL THREE quiz games by hand, and a one-sided fix would have left a game
// wrong. The sibling food-quiz pair (night-market/hakka) and the border-games pair are already
// twin-locked; this pair was not.
//
// This gate LOCKS the engine:
//   • main.js engine region — from the "Game State" anchor to EOF, must be byte-identical between
//                             fascism and flyingmoney (this is the whole game-logic surface).
//   • the shared-core import line — must be identical (catch an import drift that points one game
//                             at a different/forked answer core).
//   • questions.js / the config block (VIDEO_ID, MAP_COLORS, map center/zoom — everything ABOVE the
//                             anchor) intentionally DIVERGE per game and are NOT locked for identity,
//                             only required to EXIST (catch a rename/removal).
//
// modern-middle-east/ is a THIRD game in this family but its main.js has intentionally diverged
// (372 vs 228 lines — extra features), so it is NOT locked for identity here; it is only required
// to still exist as a sibling so a future maintainer notices it when touching the family.
//
// Plus a coverage guard: the set of non-test src/*.js files must match across the two twins, and any
// such file other than the known-divergent questions.js must be covered by a lock above — so a NEW
// shared logic file can't sneak into one game unlocked.
//
// Mutation-proven: change any byte of the main.js engine region (or the import line) in ONE game
// without the other -> `bun run test` goes RED and names what drifted.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TWINS = ['fascism', 'flyingmoney'];
const ANCHOR = '─── Game State ───';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

const read = (game, rel) => readFileSync(join(ROOT, game, 'src', rel), 'utf8');

// Slice main.js from the "Game State" anchor to EOF — the engine/game-logic region. The config
// that legitimately diverges per game (video id, map colors, center/zoom) all lives ABOVE this
// anchor, so identity below it means "same game logic", not "same hardcoded theme".
function engineRegion(src) {
  const idx = src.indexOf(ANCHOR);
  return idx >= 0 ? src.slice(idx) : null;
}
// The shared answer-core import line — pin it so neither game can be repointed at a forked core.
function coreImport(src) {
  const m = src.match(/^import .*shared\/quiz-answer\.js.*$/m);
  return m ? m[0] : null;
}

const aMain = read('fascism', 'main.js');
const bMain = read('flyingmoney', 'main.js');

// ── anchor sanity: present exactly once in each (a moved/duplicated anchor would silently shrink
//    the locked region) ──
for (const [game, src] of [['fascism', aMain], ['flyingmoney', bMain]]) {
  const count = src.split(ANCHOR).length - 1;
  ok(count === 1,
     `${game}/src/main.js must contain the "${ANCHOR}" anchor exactly once (found ${count}) — ` +
     `the twin-lock slices the engine region from it; a missing/duplicated anchor breaks the lock.`);
}

// ── main.js engine region: full byte-identity (the game-logic core — the richest bug surface) ──
{
  const a = engineRegion(aMain);
  const b = engineRegion(bMain);
  ok(a && b && a === b,
     'engine drift: the "Game State"->EOF region of fascism/src/main.js and flyingmoney/src/main.js ' +
     'is no longer byte-identical — one copy of the quiz engine glue (pickQuestions/startGame/' +
     'showQuestion/handleAnswer/showScorecard/setDifficulty) was edited without the other (the ' +
     '"divergent twin" bug class). Sync both files or extract a shared module.');
  // Belt-and-suspenders: the engine region must stay theme-agnostic. If a game-specific token ever
  // lands, the byte-identity lock above would force the SAME token into both — assert there is none.
  if (a) {
    ok(!/fascism|flyingmoney|flying.?money/i.test(a),
       'fascism engine region gained a theme-specific token (fascism/flyingmoney) — the engine must ' +
       'stay theme-agnostic so the byte-identity lock means "same logic", not "same hardcoded theme".');
  }
}

// ── shared-core import: must be identical (catch a repoint at a forked answer core) ──
{
  const a = coreImport(aMain);
  const b = coreImport(bMain);
  ok(a && b && a === b,
     'import drift: fascism and flyingmoney no longer import the shared answer core identically — ' +
     'one game was pointed at a different/forked quiz-answer module. Keep both on ../../shared/quiz-answer.js.');
}

// ── questions.js: intentionally divergent data, but must exist in both (catch a rename/removal) ──
for (const game of TWINS) {
  let exists = true;
  try { read(game, 'questions.js'); } catch { exists = false; }
  ok(exists, `${game}/src/questions.js exists (intentionally divergent per-game data)`);
}

// ── modern-middle-east: third game in the family, intentionally diverged — require it still exists
//    as a sibling so the family stays visible to a future maintainer ──
{
  let exists = true;
  try { read('modern-middle-east', 'main.js'); } catch { exists = false; }
  ok(exists, 'modern-middle-east/src/main.js exists (third quiz game in the family, intentionally divergent)');
}

// ── answer-position fairness wiring: ALL THREE games (incl. the divergent modern-middle-east)
//    must apply shuffleOptions in pickQuestions ──
//
// The hand-authored banks cluster the correct answer on ONE position (fascism 42/50 on index 1,
// modern-middle-east 36/~65 on index 1), so a player who always picks the second option scores
// ~84% knowing nothing. Commit 19a18e4 killed that "always pick B" tell by mapping every picked
// question through shared shuffleOptions(). The pure function is mutation-locked in
// quiz-answer.test.mjs, and the fascism/flyingmoney WIRING rides the engine byte-lock above — but
// modern-middle-east's main.js is INTENTIONALLY divergent and exempt from that lock, so its wiring
// is otherwise unguarded. mme is precisely the game where the exploit was worst, and it's the one
// that could silently drop `.map(q => shuffleOptions(q))` in a refactor and quietly resurrect the
// exploit with every other test still green. Lock the wiring for all three so the fairness property
// can't regress in any family member.
{
  const FAMILY = ['fascism', 'flyingmoney', 'modern-middle-east'];
  for (const game of FAMILY) {
    const src = read(game, 'main.js');
    // 1) the shared-core import must actually bring shuffleOptions in (a wired-but-unimported name
    //    would ReferenceError at play time; an imported-but-unwired name is the silent regress).
    ok(/import\s*\{[^}]*\bshuffleOptions\b[^}]*\}\s*from\s*['"][^'"]*shared\/quiz-answer\.js['"]/.test(src),
       `${game}/src/main.js must import shuffleOptions from the shared answer core.`);
    // 2) pickQuestions must APPLY it. Isolate the pickQuestions body (from its declaration to the
    //    next top-level function or EOF) so a stray shuffleOptions reference elsewhere can't satisfy
    //    the check — the fairness map has to live in the question-selection path itself.
    const pqIdx = src.indexOf('function pickQuestions');
    ok(pqIdx >= 0, `${game}/src/main.js must define pickQuestions (the question-selection path).`);
    if (pqIdx >= 0) {
      const after = src.slice(pqIdx + 'function pickQuestions'.length);
      const nextFn = after.indexOf('\nfunction ');
      const body = nextFn >= 0 ? after.slice(0, nextFn) : after;
      ok(/shuffleOptions\s*\(/.test(body),
         `${game}/src/main.js pickQuestions no longer applies shuffleOptions — the answer-position ` +
         `"always pick B" exploit (commit 19a18e4) has silently regressed for this game. Restore ` +
         `\`.map((q) => shuffleOptions(q))\` on the picked pool.`);
    }
  }
}

// ── coverage guard: a NEW shared src/*.js logic file must not sneak into one twin unlocked ──
{
  const srcJs = (game) => new Set(
    readdirSync(join(ROOT, game, 'src'))
      .filter(f => f.endsWith('.js') && !f.endsWith('.test.mjs') && !f.endsWith('.test.js'))
  );
  const A = srcJs('fascism'), B = srcJs('flyingmoney');
  const union = new Set([...A, ...B]);
  for (const f of union) {
    ok(A.has(f) && B.has(f),
       `src/${f} exists in only one twin — a logic file drifted between fascism and flyingmoney. ` +
       `Add it to both (and to this twin-lock if it carries shared logic).`);
  }
  // main.js is identity-locked (engine region) above; questions.js is the known-divergent data file.
  const LOCKED = new Set(['main.js', 'questions.js']);
  const uncovered = [...union].filter(f => !LOCKED.has(f));
  ok(uncovered.length === 0,
     `new shared src file(s) not covered by the twin-lock: ${uncovered.join(', ')} — ` +
     `add an identity lock for them above.`);
}

console.log(`quiz-game-twin-lock: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
