// food-quiz-twin-lock.test.mjs
//
// A FRONT-LOADED VERIFIER for the loop's single richest bug class: the "divergent-weaker twin."
//
// night-market/ and hakka/ are two separately-shipped food-learning quiz games that carry a
// BYTE-IDENTICAL engine. Their entire src/ui.js (303 lines — the quiz core: buildChoices,
// buildNameChoices, buildTriviaAnswers, revealCorrectChoices, closeQuiz, shuffle, ...) is
// copy-pasted into both tools, and src/studied-store.js is code-identical too (it differs ONLY
// in comment lines documenting the storage-key name). There is no shared module; the only thing
// keeping the two engines in sync is hope.
//
// That is EXACTLY the setup that has produced ~50 real bugs across this repo — someone fixes a
// defect in one copy and the other silently keeps the bug (FCP7 NTSC writer/reader, the cookie-
// regex gates, the Gemini leading-model-turn copies, the hour-drop formatters, ...). This very
// pair already paid the tax: the shuffle()-result and shuffle-in-place bugs (see BACKLOG) had to
// be fixed in BOTH ui.js copies, and a one-sided fix would have left one game broken.
//
// This gate LOCKS the engine:
//   • ui.js          — must be byte-identical between the two games (it has no tool-specific
//                      tokens; verified zero "hakka"/"night market"/"hk-"/"nm-" strings).
//   • studied-store.js — its CODE (comment lines stripped) must be identical. The only intended
//                      divergence is the 'hk-studied' vs 'nm-studied' key documented in comments.
//   • main.js        — intentionally DIVERGES (storage-key prefix + tool name), so it is NOT
//                      locked for identity, only required to EXIST in both (catch a rename).
//
// Plus a coverage guard: the set of non-test src/*.js files must match across both games, and any
// such file other than the known-divergent main.js must be covered by a lock above — so a NEW
// shared logic file can't sneak into one game unlocked.
//
// Mutation-proven: change any byte of ui.js (or any code line of studied-store.js) in ONE game
// without the other -> `bun run test` goes RED and names the file that drifted.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GAMES = ['hakka', 'night-market'];

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

const read = (game, rel) => readFileSync(join(ROOT, game, 'src', rel), 'utf8');
// Reduce to CODE lines only: drop whole-line `//` comments (the only intended divergence in
// studied-store.js is a documented key-name in comments) and drop blank lines (so comment reflow
// that shifts blank-line count doesn't masquerade as drift). A real code change survives this and
// still trips the lock.
const codeLines = (s) => s.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//')).join('\n');

// ── ui.js: full byte-identity (the quiz logic core — the richest bug surface) ──
{
  const a = read('hakka', 'ui.js');
  const b = read('night-market', 'ui.js');
  ok(a === b,
     'engine drift: hakka/src/ui.js and night-market/src/ui.js are no longer byte-identical — ' +
     'one copy of the quiz engine was edited without the other (the "divergent twin" bug class). ' +
     'Sync both files or extract a shared module.');
  // Belt-and-suspenders: ui.js must stay tool-agnostic. If a tool-specific token ever lands, the
  // byte-identity lock above would force the SAME token into both — assert there is none to begin with.
  ok(!/hakka|night.?market|hk-|nm-/i.test(a),
     'hakka/src/ui.js gained a tool-specific token (hakka/night-market/hk-/nm-) — ui.js must stay ' +
     'tool-agnostic so the byte-identity lock means "same logic", not "same hardcoded tool".');
}

// ── studied-store.js: code-identity (comments may differ to document the key name) ──
{
  const a = codeLines(read('hakka', 'studied-store.js'));
  const b = codeLines(read('night-market', 'studied-store.js'));
  ok(a === b,
     'engine drift: hakka/src/studied-store.js and night-market/src/studied-store.js differ in CODE ' +
     '(beyond the documented hk-/nm- key comment) — one localStorage-guard copy was edited without ' +
     'the other. Sync both or extract a shared module.');
}

// ── main.js: intentionally divergent, but must exist in both (catch a rename/removal) ──
for (const game of GAMES) {
  let exists = true;
  try { read(game, 'main.js'); } catch { exists = false; }
  ok(exists, `${game}/src/main.js exists (intentionally divergent twin — key prefix + tool name)`);
}

// ── coverage guard: a NEW shared src/*.js logic file must not sneak into one game unlocked ──
{
  const srcJs = (game) => new Set(
    readdirSync(join(ROOT, game, 'src'))
      .filter(f => f.endsWith('.js') && !f.endsWith('.test.mjs') && !f.endsWith('.test.js'))
  );
  const A = srcJs('hakka'), B = srcJs('night-market');
  const union = new Set([...A, ...B]);
  for (const f of union) {
    ok(A.has(f) && B.has(f),
       `src/${f} exists in only one game — a logic file drifted between hakka and night-market. ` +
       `Add it to both (and to this twin-lock if it carries shared logic).`);
  }
  // Everything except the known-divergent main.js must be covered by an identity lock above.
  const LOCKED = new Set(['ui.js', 'studied-store.js', 'main.js']);
  const uncovered = [...union].filter(f => !LOCKED.has(f));
  ok(uncovered.length === 0,
     `new shared src file(s) not covered by the twin-lock: ${uncovered.join(', ')} — ` +
     `add an identity lock for them above.`);
}

console.log(`food-quiz-twin-lock: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
