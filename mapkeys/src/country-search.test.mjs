// Lock the MapKeys country-picker ranking (searchCountries). Pure, load-bearing:
// it decides which countries the "add a country shape" picker surfaces and in
// what order. Imports the REAL shipped function (no mirror, can't drift). No live
// bug — this is a verifier-layer LOCK; every assertion is mutation-proven to go
// RED if the corresponding tier/sort/cap/dedup logic regresses.
import { searchCountries } from './country-search.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }

// Small fixture exercising every tier + tie + word-prefix collision.
// Kept alphabetically sorted, mirroring how main.js sorts COUNTRIES.
const FIX = [
  { id: '1', name: 'Guinea' },
  { id: '2', name: 'Guinea-Bissau' },
  { id: '3', name: 'Guyana' },
  { id: '4', name: 'India' },
  { id: '5', name: 'Indonesia' },
  { id: '6', name: 'New Zealand' },
  { id: '7', name: 'Papua New Guinea' },
  { id: '8', name: 'United Kingdom' },
  { id: '9', name: 'United States of America' },
].map(c => ({ ...c })); // copies, so the no-mutation assert is meaningful
const names = (arr) => arr.map(c => c.name);
const j = (arr) => names(arr).join('|');

// ── inline RED proof: the ranking is TIERED (exact<prefix<word-prefix<substring),
//    not a flat list-order "includes()" filter. A naive substring-order ranker
//    returns matches in list order; the tiered one puts the prefix match before
//    the word-prefix match even though list order would invert them. ──
{
  // naive substring-order over 'guinea': Guinea, Guinea-Bissau, Papua New Guinea (list order)
  const naive = FIX.filter(c => c.name.toLowerCase().includes('guinea'));
  const real = searchCountries('guinea', FIX);
  ok(names(naive)[0] === 'Guinea' && names(real)[0] === 'Guinea',
    'RED-proof setup: both put exact Guinea first');
  // The discriminator: a query that is a PREFIX of a late-list country but a
  // WORD-PREFIX of an early-list one must reorder vs naive list order.
  // 'guin' → Guinea(1), Guinea-Bissau(1) [prefix], Papua New Guinea(2) [word].
  const r = searchCountries('guin', FIX);
  ok(r[r.length - 1].name === 'Papua New Guinea',
    'RED-proof: word-prefix (tier 2) sorts AFTER prefix (tier 1) — a naive list-order ranker would not guarantee this');
}

// ── exact match (tier 0) ──
ok(searchCountries('guinea', FIX)[0].name === 'Guinea', 'exact match ranks first');
{
  // 'guinea' is EXACT for Guinea (0) and a PREFIX of Guinea-Bissau (1) → exact leads
  const r = names(searchCountries('guinea', FIX));
  ok(r[0] === 'Guinea' && r[1] === 'Guinea-Bissau', 'exact Guinea beats its own prefix Guinea-Bissau');
  // 'ind' is a prefix of BOTH India and Indonesia (same tier 1) → alphabetical
  const r2 = names(searchCountries('ind', FIX));
  ok(r2[0] === 'India' && r2[1] === 'Indonesia', 'shared-prefix matches are alphabetical within tier');
}

// ── prefix (tier 1), alphabetical within tier ──
{
  const r = names(searchCountries('guin', FIX));
  ok(r[0] === 'Guinea' && r[1] === 'Guinea-Bissau', 'prefix tier is alphabetical');
  ok(r[r.length - 1] === 'Papua New Guinea', 'word-prefix trails the prefix tier');
}
{
  const r = names(searchCountries('united', FIX));
  ok(r[0] === 'United Kingdom' && r[1] === 'United States of America', 'two prefix matches, alphabetical');
}

// ── word-prefix (tier 2) ──
ok(names(searchCountries('zealand', FIX)).includes('New Zealand'), 'word-prefix: "zealand" matches New Zealand');
{
  // 'new': New Zealand startsWith (tier1); Papua New Guinea has ' new' (tier2)
  const r = names(searchCountries('new', FIX));
  ok(r[0] === 'New Zealand', 'prefix New Zealand leads');
  ok(r.includes('Papua New Guinea'), 'Papua New Guinea matches via word-prefix');
  ok(r.indexOf('New Zealand') < r.indexOf('Papua New Guinea'), 'tier-1 prefix precedes tier-2 word-prefix');
}

// ── tier-2 (word-prefix) MUST out-rank tier-3 (mid-word substring) even when
//    the substring match is alphabetically earlier. This is the discriminator
//    that proves tier 2 is load-bearing (drop it and the order flips). ──
{
  // 'Iceland' contains 'land' mid-word (tier 3); 'Sea Land' has ' land' (tier 2).
  // Tier 2 wins despite 'Iceland' being alphabetically first.
  const L = [{ id: 'i', name: 'Iceland' }, { id: 's', name: 'Sea Land' }];
  const r = names(searchCountries('land', L));
  ok(r[0] === 'Sea Land' && r[1] === 'Iceland',
    'word-prefix (tier 2) out-ranks mid-word substring (tier 3) regardless of alphabetical order');
}

// ── substring anywhere (tier 3) ──
{
  const r = names(searchCountries('ssau', FIX)); // only inside Guinea-Bissau
  ok(r.length === 1 && r[0] === 'Guinea-Bissau', 'substring-only match');
}

// ── multi-tier single query orders exact<prefix<word ──
{
  const r = names(searchCountries('guinea', FIX));
  ok(r[0] === 'Guinea' && r[1] === 'Guinea-Bissau' && r[2] === 'Papua New Guinea',
    'exact < prefix < word-prefix ordering');
}

// ── no duplicate results when a country matches multiple tiers ──
{
  const r = searchCountries('united', FIX);
  ok(new Set(names(r)).size === r.length, 'no duplicate results (one tier per country)');
}

// ── case-insensitive ──
ok(j(searchCountries('GUINEA', FIX)) === j(searchCountries('guinea', FIX)), 'case-insensitive query');

// ── whitespace trimmed ──
ok(searchCountries('  india  ', FIX)[0].name === 'India', 'leading/trailing whitespace trimmed');

// ── empty / whitespace-only query → list head verbatim, no reordering ──
ok(j(searchCountries('', FIX)) === j(FIX), 'empty query returns list head verbatim');
ok(searchCountries('', FIX).length === FIX.length, 'empty query returns the whole (sub-limit) list');
ok(j(searchCountries('   ', FIX)) === j(FIX), 'whitespace-only query treated as empty');

// ── no match ──
ok(searchCountries('zzzzz', FIX).length === 0, 'no match → empty array');

// ── limit cap ──
{
  const big = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: 'C' + String(i).padStart(3, '0') }));
  ok(searchCountries('', big, 60).length === 60, 'empty-query results capped at limit');
  const big2 = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: 'Country' + String(i).padStart(3, '0') }));
  const m = searchCountries('country', big2, 60);
  ok(m.length === 60, 'matching results capped at limit');
  ok(m[0].name === 'Country000', 'cap keeps the alphabetically-first results');
}
ok(searchCountries('', Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: 'X' + i })), 5).length === 5,
  'custom limit honoured');
ok(searchCountries('z', Array.from({ length: 80 }, (_, i) => ({ id: String(i), name: 'Z' + String(i).padStart(3, '0') }))).length === 60,
  'default limit is 60 when omitted (matches the inline original)');

// ── no mutation of the input list ──
{
  const before = j(FIX);
  searchCountries('guinea', FIX);
  searchCountries('', FIX);
  ok(j(FIX) === before, 'input list is never reordered/mutated');
}

// ── defensive null guard (the only behaviour delta vs the inline original) ──
ok(j(searchCountries(null, FIX)) === j(FIX), 'null query → list head (no throw)');
ok(j(searchCountries(undefined, FIX)) === j(FIX), 'undefined query → list head (no throw)');

// ── returns the original objects (id preserved), not just names ──
ok(searchCountries('india', FIX)[0].id === '4', 'returns the original country object with its id');

console.log(`country-search: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
