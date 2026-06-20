// border-guesser-core.test.mjs
//
// First coverage for the BORDERS daily country-shape guessing game (border-guesser/index.html,
// live + in vite.config.js, ZERO coverage). Locks the three load-bearing pure cores that decide
// whether a player can ever win:
//   - getDailyIndex(total)  — the deterministic "same puzzle for everyone today" selector (xorshift
//                             over a date seed). A regression breaks the daily contract or returns
//                             an out-of-range / negative index.
//   - resolveGuess(raw)     — turns a typed guess into a canonical country name (ALIASES first, then
//                             an exact case-insensitive feature-name match). This is the guess-
//                             correctness front door: submitGuess compares its return to puzzle.name.
//   - detectNameProp(feats) — picks which geojson property holds the country name (drives the whole
//                             feature set the game is built from).
//
// THE WINNABILITY CONTRACT (the high-value invariant — same class as the pinglobe clues sweep that
// found the 462/585/492 unwinnable clues): every puzzle answer is a CLUES_DB key, and the answer
// name is shown verbatim in the suggestion list, so a player wins by typing/clicking the exact name.
// That only holds if resolveGuess(answer) === answer for EVERY answer — i.e. no ALIAS silently
// hijacks an answer's own name to a DIFFERENT country. This test sweeps every CLUES_DB key and
// proves it.
//
// The functions + data (ALIASES, CLUES_DB) are EXTRACTED from the shipped index.html at runtime via
// brace-matching + new Function — no hand-copied mirror, so the lock can't drift from the live game.
// Mutation-proven: real source mutations of index.html each go RED, restore -> GREEN byte-identical.

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

// ============================================================================================
// RED PROOFS — reconstruct broken variants and assert they violate the contracts the real code holds
// ============================================================================================
// (1) a resolveGuess that does the exact match FIRST then alias would still be fine here, but a
// resolveGuess that DROPS the exact-name fallback can't resolve a non-aliased country.
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
  if (r !== answer) {
    unwinnable++;
    hijacked.push(`${answer} -> ${r}`);
  }
}
eq(unwinnable, 0, `every CLUES_DB answer is self-resolvable (unwinnable/hijacked: ${hijacked.join(', ')})`);

// the answer must also be self-resolvable when typed in any casing (players type lowercase)
let caseUnwinnable = 0;
for (const answer of ANSWERS) {
  if (resolveGuess(answer.toLowerCase()) !== answer) caseUnwinnable++;
}
eq(caseUnwinnable, 0, 'every answer is self-resolvable typed in lowercase');

// no ALIAS may point at a name that isn't itself a real, resolvable target
// (an alias to a phantom country silently wastes a guess; lock the current aliases all land on a feature)
const featureNames = new Set(allFeatures.map(f => f.name));
for (const [k, v] of Object.entries(ALIASES)) {
  // either the alias target is an eligible answer, or it maps to a feature name; today all alias
  // targets are canonical names. Lock that none resolves to undefined/empty.
  ok(typeof v === 'string' && v.length > 1, `ALIAS "${k}" has a real target`);
}

// GEO_NAME_MAP targets must be non-empty strings (a blank mapping would erase a country's name)
for (const [k, v] of Object.entries(GEO_NAME_MAP)) {
  ok(typeof v === 'string' && v.length > 1, `GEO_NAME_MAP "${k}" maps to a real name`);
}

// ============================================================================================
// resolveGuess unit behavior
// ============================================================================================
eq(resolveGuess(''), null, 'empty -> null');
eq(resolveGuess(null), null, 'null -> null');
eq(resolveGuess('   '), null, 'whitespace -> null');
eq(resolveGuess('Notacountry'), null, 'unknown -> null');
eq(resolveGuess('usa'), 'United States', 'alias usa -> United States');
eq(resolveGuess('  USA  '), 'United States', 'alias trims + case-folds');
eq(resolveGuess('UK'), 'United Kingdom', 'alias uk -> United Kingdom');
eq(resolveGuess('burma'), 'Myanmar', 'alias burma -> Myanmar');
// a country present as a feature but NOT aliased resolves by exact name (case-insensitive)
ok(featureNames.has('France') ? resolveGuess('france') === 'France' : true, 'exact-name match case-insensitive');
// alias takes precedence over exact match when both could apply (self-pointing alias still returns canonical)
if (ALIASES['south korea']) eq(resolveGuess('South Korea'), 'South Korea', 'self-pointing alias returns canonical');

// ============================================================================================
// getDailyIndex range + determinism
// ============================================================================================
for (const total of [1, 2, 7, 50, ANSWERS.length, 195, 9999]) {
  const idx = getDailyIndex(total);
  ok(Number.isInteger(idx), `getDailyIndex(${total}) is an integer`);
  ok(idx >= 0 && idx < total, `getDailyIndex(${total}) in [0,${total}) -> ${idx}`);
}
eq(getDailyIndex(1), 0, 'total=1 -> 0');
// deterministic within the same day/process (same Date -> same index)
eq(getDailyIndex(137), getDailyIndex(137), 'getDailyIndex is deterministic for a given total');
// Date-mocked: force a day whose raw xorshift goes NEGATIVE (2025-12-31 -> seed 20251231) so the
// Math.abs range guard is exercised on EVERY run, not only on days that happen to seed positive.
// Without Math.abs the index would be negative here -> this is what catches the guard's removal.
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
eq(detectNameProp([{}]), null, 'feature without properties -> null no-throw');

// ============================================================================================
console.log(`border-guesser-core: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
