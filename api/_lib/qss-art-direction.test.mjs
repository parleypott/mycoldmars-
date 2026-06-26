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

import {
  detectCharactersInScene,
  assembleImagePrompt,
  resolveLookbookEntry,
  GLOBAL_STYLE_PREFACE,
  COMPOSITION_RULE,
  GLOBAL_PROP_RULE,
} from './qss-art-direction.js';

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

// ════════════════════════════════════════════════════════════════════════
//  assembleImagePrompt — the central image-gen prompt assembler.
//  First coverage. The load-bearing fix: the EXPLICIT character-list path
//  must resolve aliases the same way prose detection does, or an aliased key
//  silently drops the character — and with it the DON'T rules that stop
//  trope-bleed (the exact thing this file exists to prevent).
// ════════════════════════════════════════════════════════════════════════

// ── resolveLookbookEntry: alias-aware key resolution ─────────────────────
check('resolveLookbookEntry: canonical key resolves', resolveLookbookEntry('kevin')?.name === 'Kevin');
check('resolveLookbookEntry: alias "scarlet" resolves to Queen Scarlet',
  resolveLookbookEntry('scarlet')?.name === 'Queen Scarlet');
check('resolveLookbookEntry: alias "mr rober" resolves to Mark Rober',
  resolveLookbookEntry('mr rober')?.name === 'Mark Rober');
check('resolveLookbookEntry: alias "benny the beaver" resolves',
  resolveLookbookEntry('benny the beaver')?.name === 'Benny the Prepared Beaver');
check('resolveLookbookEntry: case + whitespace insensitive',
  resolveLookbookEntry('  Queen Scarlet  ')?.name === 'Queen Scarlet');
check('resolveLookbookEntry: unknown name → null', resolveLookbookEntry('santa claus') === null);
check('resolveLookbookEntry: null/undefined → null',
  resolveLookbookEntry(null) === null && resolveLookbookEntry(undefined) === null);

// ── THE BUG: explicit ALIAS keys must NOT be dropped from the prompt ──────
// Under the old bare `CHARACTER_LOOKBOOK[key]` lookup these three all returned
// undefined → filtered out → the character (and their DON'T rules) vanished.
const scarletByAlias = assembleImagePrompt({ sceneText: 'A throne room.', charactersInScene: ['scarlet'] });
check('explicit alias ["scarlet"] includes Queen Scarlet',
  scarletByAlias.includes('Queen Scarlet'));
check('explicit alias ["scarlet"] keeps her DON\'T rule (no human/calculator-helmet)',
  scarletByAlias.includes("DON'T") && scarletByAlias.includes('Never appears as a human'));

const roberByAlias = assembleImagePrompt({ sceneText: 'A studio.', charactersInScene: ['mr rober'] });
check('explicit alias ["mr rober"] includes Mark Rober', roberByAlias.includes('Mark Rober'));
check('explicit alias ["mr rober"] keeps the calculator-helmet DON\'T (anti trope-bleed)',
  roberByAlias.includes('NEVER wears a calculator-helmet'));

const bennyByAlias = assembleImagePrompt({ sceneText: 'A loading dock.', charactersInScene: ['benny the beaver'] });
check('explicit alias ["benny the beaver"] includes Benny + vest',
  bennyByAlias.includes('Benny the Prepared Beaver') && bennyByAlias.includes('orange'));

// ── Regression: canonical keys still resolve (no behavior change) ─────────
const kevinByKey = assembleImagePrompt({ sceneText: 'A classroom.', charactersInScene: ['kevin'] });
check('explicit canonical ["kevin"] includes Kevin + calculator-helmet',
  kevinByKey.includes('Kevin') && kevinByKey.includes('calculator-helmet'));

// ── Dedup: an alias + its canonical key must not double the entry ─────────
const dupd = assembleImagePrompt({ sceneText: 'A throne room.', charactersInScene: ['scarlet', 'queen scarlet'] });
check('alias + canonical key dedupe to ONE Queen Scarlet signature block',
  (dupd.match(/- Queen Scarlet:/g) || []).length === 1);

// ── Unknown-only list → the "no established cast" fallback, no crash ──────
const unknownOnly = assembleImagePrompt({ sceneText: 'A quiet road.', charactersInScene: ['santa claus'] });
check('unknown-only explicit list → no-established-cast fallback',
  unknownOnly.includes('no established cast members in this scene'));

// ── null sceneText must not throw (old `sceneText.slice` crashed) ─────────
let nullSceneOk = false;
try {
  const p = assembleImagePrompt({ sceneText: null, charactersInScene: ['kevin'] });
  nullSceneOk = typeof p === 'string' && p.includes('SCENE TO ILLUSTRATE:');
} catch { nullSceneOk = false; }
check('null sceneText with explicit chars does not throw', nullSceneOk);

// ── Auto-detect path (charactersInScene null) still reads the prose ───────
const autoDetected = assembleImagePrompt({ sceneText: 'Kevin adjusted his calculator-helmet.' });
check('auto-detect path still finds Kevin from prose', autoDetected.includes('Kevin'));
const autoEmpty = assembleImagePrompt({ sceneText: 'A dusty empty hallway.' });
check('auto-detect with no cast → no-established-cast fallback',
  autoEmpty.includes('no established cast members in this scene'));

// ── Structure: the three global rule blocks are always present ───────────
check('prompt always carries the global style preface', kevinByKey.includes(GLOBAL_STYLE_PREFACE));
check('prompt always carries the composition rule', kevinByKey.includes(COMPOSITION_RULE));
check('prompt always carries the prop rule', kevinByKey.includes(GLOBAL_PROP_RULE));

// ── variation + extra blocks are appended when requested ─────────────────
const varied = assembleImagePrompt({ sceneText: 'A studio.', charactersInScene: ['kevin'], variation: true });
check('variation:true appends the VARIATION instruction', varied.includes('VARIATION'));
check('variation:false omits the VARIATION instruction', !kevinByKey.includes('VARIATION'));
const withExtra = assembleImagePrompt({ sceneText: 'A studio.', extra: 'make the dragon bigger.' });
check('extra string is appended as an EXTRA INSTRUCTION',
  withExtra.includes('EXTRA INSTRUCTION: make the dragon bigger.'));

console.log(`qss-art-direction: ${pass}/${pass + fail} passed`);
if (fail) { console.error('FAILED:', fails.join(' | ')); process.exit(1); }
