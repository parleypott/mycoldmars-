// borders-core.test.mjs
//
// FIRST coverage for the LIVE PRIMARY country-shape guessing game (borders/index.html — the one
// whose own share text points at newpress.com/borders, the clean public URL). Its logic is
// byte-identical to the older twin border-guesser/, which DOES have a winnability lock
// (border-guesser-core.test.mjs) — but that test locks border-guesser's data, NOT this one's.
// borders/ ships its OWN ALIASES (23) and its OWN CLUES_DB (257 countries), so a bad edit to the
// live game's data is currently unguarded. This locks the load-bearing pure cores that decide
// whether a player can ever win, against THIS file's shipped data:
//   - getDailyIndex(total)  — deterministic "same puzzle for everyone today" selector (xorshift over
//                             a date seed). A regression breaks the daily contract or returns an
//                             out-of-range / negative index.
//   - resolveGuess(raw)     — turns a typed guess into a canonical country name (ALIASES first, then
//                             exact case-insensitive feature-name match). submitGuess compares its
//                             return to puzzle.name, so this is the guess-correctness front door.
//   - detectNameProp(feats) — picks which geojson property holds the country name.
//
// THE WINNABILITY CONTRACT (same class as the pinglobe clue sweep that found unwinnable clues):
//   (a) every CLUES_DB answer is self-resolvable — resolveGuess(answer) === answer — so typing/
//       clicking the exact name the game shows actually wins; no ALIAS may silently hijack an
//       answer's own name to a DIFFERENT country.
//   (b) every ALIAS target is itself a real CLUES_DB answer (an alias to a phantom wastes a guess).
//   (c) every CLUES_DB entry carries enough non-empty clues to drip-reveal across MAX_GUESSES — a
//       country with zero clues is winnable only by shape, which is the degraded-winnability bug.
//
// Functions + data are EXTRACTED from the shipped index.html at runtime via brace-matching +
// new Function — no hand-copied mirror, so the lock can't drift from the live game. Mutation-proven:
// real source mutations of index.html each go RED, restore -> GREEN.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// --- quote/escape-aware brace matcher: from the `{` after `const NAME =` to its matching `}` ---
function sliceBalanced(src, fromIdx, open, close) {
  let depth = 0, inStr = false, q = '', i = fromIdx;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(fromIdx, i + 1); }
  }
  throw new Error('unbalanced');
}

function extractObject(name) {
  const m = HTML.match(new RegExp(`const\\s+${name}\\s*=\\s*`));
  if (!m) throw new Error(`object ${name} not found`);
  const braceAt = HTML.indexOf('{', m.index + m[0].length);
  const lit = sliceBalanced(HTML, braceAt, '{', '}');
  return new Function(`return (${lit});`)();
}

function extractFunctionSource(name) {
  const m = HTML.match(new RegExp(`function\\s+${name}\\s*\\(`));
  if (!m) throw new Error(`function ${name} not found`);
  const braceAt = HTML.indexOf('{', m.index);
  const body = sliceBalanced(HTML, braceAt, '{', '}');
  return `function ${name}${HTML.slice(m.index + `function ${name}`.length, braceAt)}${body}`;
}

// === extract the real shipped data + functions ===
const ALIASES = extractObject('ALIASES');
const GEO_NAME_MAP = extractObject('GEO_NAME_MAP');
const CLUES_DB = extractObject('CLUES_DB');

const getDailyIndex = new Function(`${extractFunctionSource('getDailyIndex')}\nreturn getDailyIndex;`)();
const detectNameProp = new Function(`${extractFunctionSource('detectNameProp')}\nreturn detectNameProp;`)();
// resolveGuess closes over ALIASES + allFeatures — inject them as params.
const makeResolveGuess = (aliases, allFeatures) =>
  new Function('ALIASES', 'allFeatures',
    `${extractFunctionSource('resolveGuess')}\nreturn resolveGuess;`)(aliases, allFeatures);

// Build a realistic allFeatures: one feature per CLUES_DB answer (the eligible set is exactly the
// features whose mapped name is a CLUES_DB key), as the live boot() produces.
const ANSWERS = Object.keys(CLUES_DB);
const allFeatures = ANSWERS.map(name => ({ name }));
const resolveGuess = makeResolveGuess(ALIASES, allFeatures);

// sanity on the extraction itself
ok(ANSWERS.length > 50, `extracted a real CLUES_DB (${ANSWERS.length} answers)`);
ok(Object.keys(ALIASES).length > 5, `extracted ALIASES (${Object.keys(ALIASES).length})`);
ok(typeof getDailyIndex === 'function' && typeof resolveGuess === 'function', 'extracted functions callable');

// pull MAX_GUESSES out of the source so the clue-floor assertion tracks the real cap
const maxM = HTML.match(/const\s+MAX_GUESSES\s*=\s*(\d+)/);
ok(maxM, 'MAX_GUESSES present in source');
const MAX_GUESSES = maxM ? parseInt(maxM[1], 10) : 6;

// ============================================================================================
// RED PROOFS — reconstruct broken variants and assert they violate the contracts the real code holds
// ============================================================================================
// (1) a resolveGuess that DROPS the exact-name fallback can't resolve a non-aliased country.
const noFallbackResolve = (raw) => {
  if (!raw) return null;
  const q = raw.trim().toLowerCase();
  if (ALIASES[q]) return ALIASES[q];
  return null; // bug: no exact-name match
};
ok(noFallbackResolve('Brazil') === null && resolveGuess('Brazil') === 'Brazil',
   'RED-proof: dropping the exact-name fallback makes a non-aliased country unguessable');

// (2) a getDailyIndex without Math.abs can return a NEGATIVE index (xorshift goes negative).
const noAbsIndex = (total) => {
  const seed = 20251231; // a fixed seed whose xorshift result is negative
  let s = seed; s ^= s << 13; s ^= s >> 17; s ^= s << 5;
  return s % total;
};
ok(noAbsIndex(50) < 0, 'RED-proof: a Math.abs-less daily index can be negative (out of range)');
ok(getDailyIndex(50) >= 0, 'real getDailyIndex is never negative');

// ============================================================================================
// WINNABILITY SWEEP — every puzzle answer must be self-resolvable, else that daily puzzle is unwinnable
// ============================================================================================
let unwinnable = 0;
const hijacked = [];
for (const answer of ANSWERS) {
  const r = resolveGuess(answer);
  if (r !== answer) { unwinnable++; hijacked.push(`${answer} -> ${r}`); }
}
eq(unwinnable, 0, `every CLUES_DB answer is self-resolvable (unwinnable/hijacked: ${hijacked.join(', ')})`);

// the answer must also be self-resolvable when typed in any casing (players type lowercase)
let caseUnwinnable = 0;
for (const answer of ANSWERS) {
  if (resolveGuess(answer.toLowerCase()) !== answer) caseUnwinnable++;
}
eq(caseUnwinnable, 0, 'every answer is self-resolvable typed in lowercase');

// every ALIAS must point at a name that is itself a real, resolvable CLUES_DB answer (an alias to a
// phantom country silently wastes a guess). Stronger than the twin's lock, which only checked length.
const answerSet = new Set(ANSWERS);
const phantomAliases = [];
for (const [k, v] of Object.entries(ALIASES)) {
  ok(typeof v === 'string' && v.length > 1, `ALIAS "${k}" has a real target`);
  if (!answerSet.has(v)) phantomAliases.push(`${k} -> ${v}`);
  // and the alias must actually resolve (resolveGuess of the alias key returns its target)
  eq(resolveGuess(k), v, `ALIAS "${k}" resolves to ${v}`);
}
eq(phantomAliases.length, 0, `no ALIAS points at a phantom (non-CLUES_DB) country: ${phantomAliases.join(', ')}`);

// GEO_NAME_MAP targets must be non-empty strings (a blank mapping would erase a country's name)
for (const [k, v] of Object.entries(GEO_NAME_MAP)) {
  ok(typeof v === 'string' && v.length > 1, `GEO_NAME_MAP "${k}" maps to a real name`);
}

// ============================================================================================
// CLUE DATA-INTEGRITY / drip-reveal winnability — every answer carries enough non-empty clues
// ============================================================================================
// The reveal drips one clue per wrong guess up to MAX_GUESSES-1; a country with zero clues is
// winnable only by shape (degraded). Lock: every entry has >=1 non-empty string clue, and the
// current data contract (exactly MAX_GUESSES-1 = 5 clues per country) holds.
let zeroClue = 0, blankClue = 0, shortClue = 0;
const FLOOR = Math.max(1, MAX_GUESSES - 1);
for (const [k, v] of Object.entries(CLUES_DB)) {
  const clues = Array.isArray(v.clues) ? v.clues : [];
  if (clues.length === 0) zeroClue++;
  if (clues.some(c => typeof c !== 'string' || !c.trim())) blankClue++;
  if (clues.length < FLOOR) shortClue++;
}
eq(zeroClue, 0, 'no CLUES_DB answer has zero clues (winnable by clue, not just shape)');
eq(blankClue, 0, 'no CLUES_DB answer has a blank/non-string clue');
eq(shortClue, 0, `every answer carries the full drip (>= ${FLOOR} clues for MAX_GUESSES=${MAX_GUESSES})`);

// RED-proof the clue-floor sweep actually catches a bad entry
const badClueDB = { ...CLUES_DB, __BROKEN__: { clues: [] } };
let zeroClueBad = 0;
for (const v of Object.values(badClueDB)) { if ((Array.isArray(v.clues) ? v.clues : []).length === 0) zeroClueBad++; }
ok(zeroClueBad === 1, 'RED-proof: an empty-clues entry is detected by the clue sweep');

// ============================================================================================
// resolveGuess unit behavior
// ============================================================================================
eq(resolveGuess(''), null, 'empty -> null');
eq(resolveGuess(null), null, 'null -> null');
eq(resolveGuess('   '), null, 'whitespace -> null');
eq(resolveGuess('Notacountry'), null, 'unknown -> null');
if (ALIASES['usa']) eq(resolveGuess('  USA  '), ALIASES['usa'], 'alias usa trims + case-folds');
if (ALIASES['uk']) eq(resolveGuess('UK'), ALIASES['uk'], 'alias uk resolves');
if (ALIASES['burma']) eq(resolveGuess('burma'), ALIASES['burma'], 'alias burma resolves');
// a non-aliased country present as a feature resolves by exact name (case-insensitive)
const featureNames = new Set(allFeatures.map(f => f.name));
ok(featureNames.has('France') ? resolveGuess('france') === 'France' : true, 'exact-name match case-insensitive');

// ============================================================================================
// getDailyIndex range + determinism
// ============================================================================================
for (const total of [1, 2, 7, 50, ANSWERS.length, 195, 9999]) {
  const idx = getDailyIndex(total);
  ok(Number.isInteger(idx), `getDailyIndex(${total}) is an integer`);
  ok(idx >= 0 && idx < total, `getDailyIndex(${total}) in [0,${total}) -> ${idx}`);
}
eq(getDailyIndex(1), 0, 'total=1 -> 0');
eq(getDailyIndex(137), getDailyIndex(137), 'getDailyIndex is deterministic for a given total');
// Date-mocked: force a day whose raw xorshift goes NEGATIVE (2025-12-31 -> seed 20251231) so the
// Math.abs range guard is exercised on EVERY run, not only on days that happen to seed positive.
{
  const RealDate = globalThis.Date;
  globalThis.Date = function () { return { getFullYear: () => 2025, getMonth: () => 11, getDate: () => 31 }; };
  let negDayIdx;
  try { negDayIdx = getDailyIndex(50); } finally { globalThis.Date = RealDate; }
  ok(negDayIdx >= 0 && negDayIdx < 50,
     `getDailyIndex stays in [0,50) on a negative-seed day (Math.abs guard) -> ${negDayIdx}`);
  ok(Number.isInteger(negDayIdx), 'negative-seed-day index is an integer');
}

// ============================================================================================
// detectNameProp — candidate priority + null fallback
// ============================================================================================
eq(detectNameProp([{ properties: { ADMIN: 'France', name: 'france' } }]), 'ADMIN',
   'ADMIN wins over name (candidate order)');
eq(detectNameProp([{ properties: { name: 'France' } }]), 'name', 'falls to name');
eq(detectNameProp([{ properties: { NAME_LONG: 'Republic of France' } }]), 'NAME_LONG', 'falls to NAME_LONG');
eq(detectNameProp([{ properties: { foo: 'bar' } }]), null, 'no candidate -> null');
eq(detectNameProp([{ properties: { ADMIN: 'A' } }]), null, 'single-char ADMIN rejected (length>1 guard)');

// ============================================================================================
console.log(`borders-core: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.error('  FAIL:', f); process.exit(1); }
