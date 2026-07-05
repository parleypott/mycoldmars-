// Verifier-layer LOCK for prawn's SHOPPING-LIST splitter, splitItems().
//
// prawn/index.html (Johnny + Marisa's live weekend RSVP tracker) builds the
// aggregated shopping list — "🛒 every request, attributed" — by running every
// guest's free-text `food` and `drink` field through splitItems() and pushing
// each returned fragment as its own checkable line:
//     splitItems(p.food).forEach(t => foodItems.push({ text: t, who: p.name }))
// So splitItems is the SOLE decider of what lands on the shopping list. A silent
// regression here either drops a real request or explodes one into noise, with
// no signal. It was the LAST zero-coverage pure core in prawn (the timeline
// engine + shopColKey are already locked).
//
// This test EXTRACTS the real shipped function from index.html at runtime
// (brace-matched), so it can't drift from a hand-copied mirror.
//
// NO code change — this is a LOCK, not a fix. Two current behaviors are
// deliberately pinned and DOCUMENTED (see the "CHARACTERIZED BEHAVIOR" block):
//   (A) " and " / "&" split compound names: "mac and cheese" -> ["mac","cheese"].
//       This is a documented design choice in the source ("... commas, ' and ',
//       bullets ...") that is wrong for compound FOOD names but right for real
//       "beer and wine" lists. It's an unresolved product question, flagged for
//       Johnny in BACKLOG.md — NOT silently changed while unattended. If that
//       call is ever made, these assertions change WITH it, on purpose.
//   (B) items <= 1 char are dropped: "a; b; c" -> [] (the s.length > 1 filter).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'index.html'), 'utf8');

// --- runtime extractor (can't drift) --------------------------------------
function braceMatch(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces from ' + openIdx);
}
function extractFn(src, name) {
  const sig = src.indexOf('function ' + name + '(');
  assert.ok(sig !== -1, 'missing function ' + name);
  const open = src.indexOf('{', sig);
  return src.slice(sig, braceMatch(src, open));
}

const splitItems = new Function(
  extractFn(SRC, 'splitItems') + '\nreturn splitItems;'
)();

// --- tiny harness ---------------------------------------------------------
let pass = 0, fail = 0;
function eq(a, b, msg) {
  try { assert.deepStrictEqual(a, b); pass++; }
  catch { fail++; console.error('  ✗', msg, '\n    got', JSON.stringify(a), 'want', JSON.stringify(b)); }
}
function ok(c, msg) {
  if (c) pass++; else { fail++; console.error('  ✗', msg); }
}

// ── INLINE RED PROOFS — what a regression would do ────────────────────────
// (1) Multi-separator: a comma-ONLY splitter (a plausible "simplification"
//     regression) would fail to break newline- and semicolon-separated lists.
{
  const commaOnly = (t) => (t || '').split(',').map(s => s.trim()).filter(s => s && s.length > 1);
  ok(commaOnly('eggs\nmilk').length === 1, 'RED proof: comma-only splitter keeps "eggs\\nmilk" as ONE item');
  eq(splitItems('eggs\nmilk'), ['eggs', 'milk'], 'shipped splitItems breaks a NEWLINE-separated list');
  eq(splitItems('ketchup; mustard; relish'), ['ketchup', 'mustard', 'relish'], 'shipped splitItems breaks a SEMICOLON list');
  eq(splitItems('eggs, milk, bread'), ['eggs', 'milk', 'bread'], 'shipped splitItems breaks a COMMA list');
}
// (2) Length filter: without the `> 1 && < 200` guard, a runaway paste (a whole
//     paragraph) or single-char noise would leak onto the shopping list.
{
  const noFilter = (t) => (t || '').split(/,\s*/).map(s => s.trim());
  const blob = 'z'.repeat(250);
  ok(noFilter(blob).includes(blob), 'RED proof: unfiltered splitter leaks a 250-char blob');
  eq(splitItems(blob), [], 'shipped splitItems DROPS an over-200-char blob');
  eq(splitItems('ok, ' + blob + ', fine'), ['ok', 'fine'], 'over-cap fragment dropped, real items kept');
}

// ── core separators ───────────────────────────────────────────────────────
eq(splitItems('beer, wine'), ['beer', 'wine'], 'comma');
eq(splitItems('beer\nwine'), ['beer', 'wine'], 'newline');
eq(splitItems('beer; wine'), ['beer', 'wine'], 'semicolon');
eq(splitItems('  spaced  ,  out  '), ['spaced', 'out'], 'trims each fragment');
eq(splitItems('beer\n\n\nwine'), ['beer', 'wine'], 'collapses runs of newlines');

// ── guards ────────────────────────────────────────────────────────────────
eq(splitItems(''), [], 'empty string -> []');
eq(splitItems(null), [], 'null -> []');
eq(splitItems(undefined), [], 'undefined -> []');
eq(splitItems('   '), [], 'whitespace-only -> []');

// ── CHARACTERIZED BEHAVIOR (documented, deliberate — see BACKLOG discovery) ─
// (A) " and " / "&" split compound names. Correct for real lists, WRONG for
//     compound food/drink names. This is the live product wrinkle. Pinned here
//     so any future change to it is a deliberate, test-visible decision.
eq(splitItems('beer and wine'), ['beer', 'wine'], 'CHARACTERIZED: " and " splits (good for real lists)');
eq(splitItems('mac and cheese'), ['mac', 'cheese'], 'CHARACTERIZED: " and " ALSO splits compound food names (product wrinkle)');
eq(splitItems('gin & tonic'), ['gin', 'tonic'], 'CHARACTERIZED: "&" splits too');
eq(splitItems('fish and chips, salad'), ['fish', 'chips', 'salad'], 'CHARACTERIZED: mixed compound + comma');
// (B) items <= 1 char are dropped by the `s.length > 1` filter.
eq(splitItems('a; b; c'), [], 'CHARACTERIZED: single-char items are dropped (length > 1 filter)');
eq(splitItems('x, eggs'), ['eggs'], 'CHARACTERIZED: single-char "x" dropped, real item kept');

console.log(`split-items: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
