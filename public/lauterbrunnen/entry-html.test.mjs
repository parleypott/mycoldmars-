// Verifier-layer test for the Lauterbrunnen menu RENDER path — the sibling of
// leg-features.test.mjs (map render) and journey-data-contract.test.mjs (data shape).
//
// CONTRACT: entryHTML(e) turns one ENTRIES record into the adventure-card HTML that fills
// #menu (`ENTRIES.map(entryHTML).join('')`). Every card on the page is built here, so a
// silent regression in its branching logic quietly drops content from the whole list. The
// load-bearing pieces this locks:
//   1. Zero-padded index — `String(e.n).padStart(2,'0')` (1 -> "01", 16 -> "16").
//   2. The "Map it" button gate — it renders IFF some JOURNEYS entry has `entryId === e.n`.
//      This is a STRICT-equality cross-reference between two separate data tables. Both sides
//      ship as numbers today; if either ever drifts to a string ("3" vs 3), the button
//      silently vanishes for that entry even though its route exists on the map. That
//      type-drift-hides-a-feature class is exactly what this loop keeps finding — pin it.
//   3. The notes fallback — `(e.notes || (e.note ? [e.note] : []))`. New entries use a
//      `notes:[...]` array; legacy ones a single `note:'...'`. Break the fallback and legacy
//      cards lose their note, or the whole card throws on `.map` of undefined.
//   4. data-mapit carries e.n (so the click handler can find the journey).
//
// EXTRACTS the real shipped entryHTML from index.html at runtime (regex + new Function) so it
// can't drift from a hand-mirrored copy. entryHTML closes over module-level JOURNEYS and
// ICON_MAPIT; the sandbox supplies its OWN small versions of both so the mapit gate can be
// driven deterministically (the shipped 7-journey table would make "no button" untestable).
// Mutation-proven: change `entryId === e.n` to `==`/loosen it, drop the padStart, or break the
// notes fallback, and the matching assertion turns RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const m = html.match(/function entryHTML\(e\)\{[\s\S]*?\n\}/);
assert.ok(m, 'could not find entryHTML() in index.html');

// Build the function with a controlled sandbox: our own JOURNEYS + ICON_MAPIT.
// JOURNEYS below deliberately has entryId 4 as a number; entry n=4 must match, n=9 must not.
function makeEntryHTML(journeys) {
  return new Function(
    'JOURNEYS', 'ICON_MAPIT',
    `${m[0]}\nreturn entryHTML;`
  )(journeys, '<svg id="mapit-icon"></svg>');
}
const JOURNEYS = [{ entryId: 4 }, { entryId: 7 }];
const entryHTML = makeEntryHTML(JOURNEYS);

const base = { n: 4, name: 'The Mirror Lake', overview: 'ov', steps: ['a', 'b'] };

// --- 1. zero-padded index -------------------------------------------------------------------
assert.match(entryHTML({ ...base, n: 4 }), /class="num">04</, 'single-digit n -> zero-padded "04"');
assert.match(entryHTML({ ...base, n: 16 }), /class="num">16</, 'two-digit n unchanged "16"');
assert.match(entryHTML({ ...base, n: 4 }), /id="entry-4"/, 'article id carries raw n');

// --- 2. the "Map it" gate: strict entryId === n cross-reference ------------------------------
// n=4 IS in JOURNEYS -> button present, and carries data-mapit="4".
const withJourney = entryHTML({ ...base, n: 4 });
assert.match(withJourney, /class="mapit" data-mapit="4"/, 'entry with a journey -> Map it button, data-mapit=n');
assert.match(withJourney, /Map it<\/button>/, 'button label present');

// n=9 is NOT in JOURNEYS -> no button. (This is the assertion the loose-equality / always-on
// mutations break.)
const noJourney = entryHTML({ ...base, n: 9 });
assert.doesNotMatch(noJourney, /class="mapit"/, 'entry with NO journey -> no Map it button');

// Strict-equality type contract: a journey whose entryId is the STRING "4" must NOT light up
// the numeric n=4 entry. If entryHTML ever used `==`, this string-vs-number case would wrongly
// render the button — so this pins `===`.
const stringIdJourneys = makeEntryHTML([{ entryId: '4' }]);
assert.doesNotMatch(stringIdJourneys({ ...base, n: 4 }),
  /class="mapit"/, 'string entryId "4" must NOT match numeric n=4 (strict === contract)');

// --- 3. notes / note fallback ---------------------------------------------------------------
// Modern array form.
const arrNotes = entryHTML({ ...base, notes: ['first note', 'second note'] });
assert.match(arrNotes, /first note/, 'notes[] rendered (item 1)');
assert.match(arrNotes, /second note/, 'notes[] rendered (item 2)');
assert.equal((arrNotes.match(/class="enote"/g) || []).length, 2, 'one .enote per notes[] item');

// Legacy single-note form falls back when notes is absent.
const legacyNote = entryHTML({ ...base, note: 'legacy single note' });
assert.match(legacyNote, /legacy single note/, 'legacy note:string rendered via fallback');
assert.equal((legacyNote.match(/class="enote"/g) || []).length, 1, 'legacy note -> exactly one .enote');

// Neither present -> no notes, and crucially NO throw (the .map-of-undefined trap).
const noNotes = entryHTML({ ...base });
assert.doesNotMatch(noNotes, /class="enote"/, 'no notes/note -> zero .enote, no throw');

// --- 4. route + overview + steps render -----------------------------------------------------
const routed = entryHTML({ ...base, route: ['Wengen', 'First', 'Bachalpsee'] });
assert.match(routed, /class="route"/, 'route present -> .route block');
assert.match(routed, /Wengen[\s\S]*First[\s\S]*Bachalpsee/, 'route items rendered in order');
assert.doesNotMatch(entryHTML({ ...base, route: undefined }), /class="route"/, 'no route -> no .route block');
assert.equal((entryHTML(base).match(/<li>/g) || []).length, 2, 'one <li> per step');
assert.match(entryHTML(base), /class="overview">ov</, 'overview rendered');

console.log('entry-html.test.mjs: all assertions passed');
