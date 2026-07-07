// Verifier-layer test for the Switzerland PWA menu RENDER path — the sibling of
// leg-info.test.mjs (leg popups), gondola-network.test.mjs (map data) and
// place-link.test.mjs (link helpers). This is the LAST untested pure core in the
// switzerland/ tool: entryHTML(e), the adventure-card renderer.
//
// CONTRACT: entryHTML(e) turns one ENTRIES record into the card HTML that fills #menu
// (`ENTRIES.map(entryHTML).join('')`). EVERY card in the live menu is built here, so a
// silent regression in its branching quietly drops content from — or throws on — the whole
// list. Its Lauterbrunnen twin (lauterbrunnen/entry-html.test.mjs) is already locked; this
// tool is the newer, still-actively-edited one and was NOT. The load-bearing pieces:
//   1. Zero-padded index — `String(e.n).padStart(2,'0')` (3 -> "03", 16 -> "16"); the raw n
//      still carries into the article id (`entry-${e.n}`) and the Map-it data attr.
//   2. The "Map it" button gate — renders IFF some JOURNEYS row has `entryId === e.n` (STRICT
//      equality across two separate data tables). On the live page entry 6 has NO journey, so
//      it must get NO button; entries 1-5,7 do. If either side ever drifts number->string
//      ("6" vs 6) the button silently vanishes (or wrongly appears) — the type-drift-hides-a-
//      feature class this loop keeps finding. Pin the strict compare.
//   3. The route strip — `e.route.join('<span class="sep">›</span>')`, rendered only when a
//      route array exists (entry 6 has none).
//   4. The dist chip — only when `e.dist` is present.
//   5. steps — one <li> per step inside <ol class="steps">.
//   6. The notes fallback — `(e.notes || (e.note ? [e.note] : []))`. Array-style `notes:[...]`
//      OR a single legacy `note:'...'` OR neither. Break it and a card loses its note, or the
//      whole render throws on `.map` of undefined.
//   7. The chain-note pill — prepended ONLY when `e.chain` is set (entry 3's "a continuation
//      of this itinerary" banner). This branch is Switzerland-specific — Lauterbrunnen's twin
//      has no chain note — so it gets its own lock here.
//
// EXTRACTS the real shipped entryHTML from index.html at runtime (regex + new Function) so it
// can't drift from a hand-mirrored copy. entryHTML closes over module-level JOURNEYS and
// ICON_MAPIT; the sandbox supplies its OWN small versions so the map-it gate is deterministic
// (the shipped 7-journey table would make the "no button" case untestable).
// Mutation-proven: loosen `entryId === e.n` to `==`, drop the padStart, break the notes
// fallback, or drop the `e.chain?` guard, and the matching assertion turns RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const m = html.match(/function entryHTML\(e\)\{[\s\S]*?\n\}/);
assert.ok(m, 'could not find entryHTML() in index.html');

// Build the function with a controlled sandbox. JOURNEYS deliberately holds entryId 4 and 7
// as NUMBERS; entry n=4 must match, n=6 must not.
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
assert.match(entryHTML({ ...base, n: 3 }), /class="num">03</, 'single-digit n -> zero-padded "03"');
assert.match(entryHTML({ ...base, n: 16 }), /class="num">16</, 'two-digit n unchanged "16"');
assert.match(entryHTML({ ...base, n: 4 }), /id="entry-4"/, 'article id carries raw n');

// --- 2. the "Map it" gate: strict entryId === n cross-reference ------------------------------
// n=4 IS in JOURNEYS -> button present, carries data-mapit="4".
const withJourney = entryHTML({ ...base, n: 4 });
assert.match(withJourney, /class="mapit" data-mapit="4"/, 'entry with a journey -> Map it button, data-mapit=n');
assert.match(withJourney, /Map it<\/button>/, 'button label present');

// n=6 is NOT in JOURNEYS -> no button. (The assertion the loose-equality / always-on mutations
// break — and the exact live shape: entry 6 "Mountain Peak Experiences" has no journey.)
const noJourney = entryHTML({ ...base, n: 6 });
assert.doesNotMatch(noJourney, /class="mapit"/, 'entry with no journey -> NO Map it button');

// strict-equality proof: a STRING "4" in JOURNEYS must NOT match numeric n=4 (=== not ==).
const looseJourneys = makeEntryHTML([{ entryId: '4' }]);
assert.doesNotMatch(looseJourneys({ ...base, n: 4 }), /class="mapit"/,
  'string entryId "4" must NOT satisfy the strict === against numeric n=4');

// --- 3. route strip -------------------------------------------------------------------------
const withRoute = entryHTML({ ...base, route: ['Wengen', 'Männlichen', 'Kleine Scheidegg'] });
assert.match(withRoute, /class="route">Wengen<span class="sep">›<\/span>Männlichen<span class="sep">›<\/span>Kleine Scheidegg<\/div>/,
  'route joined with the sep-span between each stop');
assert.doesNotMatch(entryHTML({ ...base }), /class="route"/, 'no route array -> no route strip (entry 6)');

// --- 4. dist chip ---------------------------------------------------------------------------
assert.match(entryHTML({ ...base, dist: '≈3 mi' }), /class="dist">≈3 mi<\/span>/, 'dist present -> dist chip');
assert.doesNotMatch(entryHTML({ ...base }), /class="dist"/, 'no dist -> no dist chip');

// --- 5. steps: one <li> per step ------------------------------------------------------------
const steps3 = entryHTML({ ...base, steps: ['one', 'two', 'three'] });
assert.match(steps3, /<ol class="steps"><li>one<\/li><li>two<\/li><li>three<\/li><\/ol>/, 'each step -> its own <li>');

// --- 6. notes fallback: notes[] | note | neither --------------------------------------------
const withNotes = entryHTML({ ...base, notes: ['first note', 'second note'] });
assert.match(withNotes, /<span>first note<\/span>/, 'notes[] rendered');
assert.match(withNotes, /<span>second note<\/span>/, 'all notes rendered');
assert.equal((withNotes.match(/class="enote"/g) || []).length, 2, 'one enote per notes entry');

const withSingleNote = entryHTML({ ...base, note: 'legacy single note' });
assert.match(withSingleNote, /<span>legacy single note<\/span>/, 'legacy single `note` wrapped into one enote');
assert.equal((withSingleNote.match(/class="enote"/g) || []).length, 1, 'single note -> exactly one enote');

const noNotes = entryHTML({ ...base });
assert.doesNotMatch(noNotes, /class="enote"/, 'neither notes nor note -> no enote (and must not throw)');

// --- 7. chain-note pill (Switzerland-specific branch) ---------------------------------------
const chained = entryHTML({ ...base, n: 3, chain: 'a continuation of this itinerary' });
assert.match(chained, /class="chain-pill">⤵ a continuation of this itinerary<\/span>/, 'e.chain -> chain-note pill prepended');
// the pill sits BEFORE the article, not inside it.
assert.ok(chained.indexOf('chain-pill') < chained.indexOf('<article'), 'chain pill precedes the article');
assert.doesNotMatch(entryHTML({ ...base }), /chain-pill/, 'no e.chain -> no chain note');

console.log('switzerland entry-html: all assertions passed');
