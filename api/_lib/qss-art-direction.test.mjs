// Test: detectCharactersInScene — the QSS image-gen character detector.
//
// This module (api/_lib/qss-art-direction.js) is the reference copy of the
// detection logic that runs live, inline, inside queen-scarlet-school/index.html
// (QSSArt.detectCharacters). Both share the same alias-driven, word-boundary
// matcher, so locking the boundary behavior here pins the live behavior too.
//
// THE BUG (fixed): Mark Rober carried a bare alias 'mark'. The matcher is
// word-boundary (\bmark\b, case-insensitive), so the everyday words a kid
// actually writes — "question mark", "exclamation mark", "on your mark" —
// each falsely detected Mark Rober and injected a real YouTuber's full visual
// lookbook (backward cap, pegboard tool-wall) into illustrations of scenes he
// is not in. Dropping the bare alias kills the false positives while the
// canonical 'mark rober' / 'mr rober' / the full name still catch the cameo.
//
// Run: node api/_lib/qss-art-direction.test.mjs   (or `bun run test`)

import { detectCharactersInScene } from './qss-art-direction.js';

let pass = 0, fail = 0;
const fails = [];
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); }
}
// Did the detector flag this character key?
function has(scene, key) {
  return detectCharactersInScene(scene).some(c => c.key === key);
}

// ── THE FIX: common "mark" words must NOT summon Mark Rober ──────────────
check('question mark → no Mark Rober',
  !has('Kevin drew a big question mark on the chalkboard.', 'mark rober'));
check('exclamation mark → no Mark Rober',
  !has('She ended every sentence with an exclamation mark!', 'mark rober'));
check('on your mark → no Mark Rober',
  !has('On your mark, get set, GO! the whole class shouted.', 'mark rober'));
check('made his mark → no Mark Rober',
  !has('Benny made his mark on the bunker wall.', 'mark rober'));
check('a perfect mark → no Mark Rober',
  !has('Kevin got a perfect mark on the apocalypse-prep quiz.', 'mark rober'));

// ── Regression: the real cameo is still detected ────────────────────────
check('full name "Mark Rober" still detected',
  has('Mark Rober wheeled in a giant glitter-bomb catapult.', 'mark rober'));
check('"mr rober" alias still detected',
  has('Then mr rober flipped the switch and grinned.', 'mark rober'));
check('"Mark Rober" inside longer prose still detected',
  has('The whole class gasped when Mark Rober opened the door.', 'mark rober'));

// ── Regression: other cast members unaffected ───────────────────────────
check('Kevin detected by name',
  has('Kevin adjusted his calculator-helmet nervously.', 'kevin'));
check('Benny detected by name',
  has('Benny zipped up his safety vest.', 'benny'));
check('Benny detected by alias "benny the beaver"',
  has('Everyone cheered for Benny the Beaver.', 'benny'));
check('Queen Scarlet detected by full name',
  has('Queen Scarlet unfurled her teal-and-orange wings.', 'queen scarlet'));
check('Queen Scarlet detected by deliberate "scarlet" alias',
  has('Scarlet announced her newest monetization scheme.', 'queen scarlet'));
check('empty scene → nobody detected',
  detectCharactersInScene('').length === 0);
check('unrelated prose → nobody detected',
  detectCharactersInScene('A quiet hallway, lockers, dust in a sunbeam.').length === 0);

// ── word-boundary sanity: substrings must NOT match ─────────────────────
check('"benny" not matched inside another word',
  !has('The chimney was old.', 'benny'));  // "benny" not present; guards regex sanity
check('"marker" does NOT trigger Mark Rober (word boundary)',
  !has('She uncapped a red marker.', 'mark rober'));
check('"Denmark" does NOT trigger Mark Rober',
  !has('The story was set in Denmark.', 'mark rober'));

console.log(`qss-art-direction: ${pass}/${pass + fail} passed`);
if (fail) { console.error('FAILED:', fails.join(' | ')); process.exit(1); }
