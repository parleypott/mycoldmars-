// Verifier-layer LOCK for labelFromText() in queen-scarlet-school/index.html — the
// pure, Henry-facing label generator used at FOUR sites in the QSS Storybook reader
// + cue carousel:
//   • buildStorybookCues: the non-auto cue label (labelFromText(cue.source_text))
//   • buildStorybookCues: the block title (b.summary || labelFromText(b.text) || ...)
//   • the image/cue-list builder (×2): labelFromText(cue.source_text) || `image N`
// So it produces the scene/cue/image LABELS Henry actually sees throughout the
// storybook UI. A regression (wrong truncation length, dropping the first sentence,
// losing the whitespace collapse) silently mislabels his scenes, with no signal.
//
// It was ZERO-coverage (obs 4173). NO live bug — it's a correct "first sentence,
// collapse whitespace, truncate to 48 + ellipsis" helper — so this is a
// verifier-layer LOCK (same standard as the snap-boundary / text-for-cue /
// qss-art client-logic locks), NOT a fix. The test EXTRACTS the REAL shipped
// function from index.html at runtime (regex + new Function) so it can't drift
// from a hand-copied mirror, and is mutation-proven against an in-memory rebuild
// of the source (and, in the iteration, against real on-disk mutations of
// index.html with byte-identical restore).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractSrc() {
  const m = HTML.match(/function labelFromText\(text\) \{[\s\S]*?\n    \}/);
  if (!m) throw new Error('could not locate labelFromText in index.html');
  return m[0];
}
const labelFromText = new Function(extractSrc() + '\nreturn labelFromText;')();

// Build a labelFromText from a mutated copy of the REAL source (proves a given
// mutation actually flips a test RED — a real verifier, not a rubber stamp).
function buildMutant(transform) {
  const mutated = transform(extractSrc());
  return new Function(mutated + '\nreturn labelFromText;')();
}

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; }
  else { fail++; console.error(`FAIL: ${label}\n  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
function ok(cond, label) { eq(!!cond, true, label); }

// ── Inline RED proof: a no-truncation mutant returns the full long label ──
// (proves the 48-char truncation is real + load-bearing for the cue UI.)
{
  const long = 'a'.repeat(80); // 80-char first "sentence", no terminal punct
  const mutantNoTrunc = buildMutant(s => s.replace('s.length > 48', 's.length > 9999'));
  eq(mutantNoTrunc(long).length, 80, 'RED proof: no-truncation mutant returns the full 80-char label');
  eq(labelFromText(long), 'a'.repeat(48) + '…', 'shipped fn truncates an 80-char label to 48 + ellipsis');
}

// ── falsy / empty inputs → '' ──
eq(labelFromText(null), '', 'null → ""');
eq(labelFromText(undefined), '', 'undefined → ""');
eq(labelFromText(''), '', 'empty string → ""');
eq(labelFromText(0), '', '0 (falsy) → ""');
eq(labelFromText('   '), '', 'whitespace-only → "" (collapses + trims to empty)');
eq(labelFromText('\t\n  \n'), '', 'tabs/newlines only → ""');

// ── first-sentence extraction (stops at the FIRST terminal punct, keeps ONE) ──
eq(labelFromText('Hello. World.'), 'Hello.', 'first sentence kept with its period');
eq(labelFromText('What? Then.'), 'What?', 'first sentence kept with its question mark');
eq(labelFromText('Wow! Next thing.'), 'Wow!', 'first sentence kept with its exclamation');
eq(labelFromText('Hi?!'), 'Hi?', 'only ONE trailing terminal punct is kept');
eq(labelFromText('No punctuation here'), 'No punctuation here', 'no terminal punct → whole string');

// ── whitespace collapse + trim ──
eq(labelFromText('a\n\n  b   c'), 'a b c', 'internal whitespace runs collapse to single spaces');
eq(labelFromText('   hi there  '), 'hi there', 'leading/trailing whitespace trimmed');
eq(labelFromText('\t\nHi there\n'), 'Hi there', 'tab + newline whitespace collapsed/trimmed');
eq(labelFromText('Two\twords.\tMore.'), 'Two words.', 'tab inside first sentence collapsed to a space');

// ── leading-terminal-punct fallback: regex match fails → whole trimmed string ──
eq(labelFromText('.hello'), '.hello', 'leading "." → no match → whole trimmed string');
eq(labelFromText('...'), '...', 'all-terminal-punct → no match → whole string');
eq(labelFromText('?why'), '?why', 'leading "?" → no match → whole string');

// ── 48-char truncation boundary ──
{
  const at48 = 'b'.repeat(48); // no terminal punct, exactly 48
  eq(labelFromText(at48), at48, 'exactly 48 chars → returned as-is (no ellipsis)');
  const at49 = 'c'.repeat(49);
  eq(labelFromText(at49), 'c'.repeat(48) + '…', '49 chars → sliced to 48 + ellipsis');
  // The trailing terminal punct counts toward length: 48 letters + "." = 49 → truncate.
  const sentence49 = 'd'.repeat(48) + '.';
  eq(labelFromText(sentence49), 'd'.repeat(48) + '…', 'first sentence of 49 (48 + ".") → sliced to 48 + ellipsis');
  // A 47-letter sentence + "." = 48 → kept whole (period survives, no ellipsis).
  const sentence48 = 'e'.repeat(47) + '.';
  eq(labelFromText(sentence48), sentence48, '48-char first sentence (47 + ".") kept whole with its period');
}

// ── realistic Henry scene text ──
eq(labelFromText('Queen Scarlet swooped down over the castle. The students gasped.'),
   'Queen Scarlet swooped down over the castle.',
   'realistic first sentence kept whole (under 48? no — 43 chars, kept)');
eq(labelFromText('The dragon flew high above the misty mountains and far beyond the sea forever'),
   'The dragon flew high above the misty mountains a' + '…',
   'long no-punct prose truncated at 48 with ellipsis');

// ── MUTATION PROOFS: each rebuilds labelFromText from a mutated source and
//    confirms a real assertion would flip. ──
{
  // M1: shrink the truncation length 48 → 40 — the boundary cases must differ.
  const m1 = buildMutant(s => s.replace(/48/g, '40'));
  ok(m1('c'.repeat(49)) !== labelFromText('c'.repeat(49)), 'M1: truncation-length mutation (48→40) is caught');

  // M2: drop the whitespace collapse — the collapse cases must differ.
  const m2 = buildMutant(s => s.replace(".replace(/\\s+/g, ' ')", ''));
  ok(m2('a\n\n  b   c') !== labelFromText('a\n\n  b   c'), 'M2: whitespace-collapse removal is caught');

  // M3: drop the optional trailing terminal punct from the regex — first-sentence
  //     terminal must be lost.
  const m3 = buildMutant(s => s.replace('/^[^.!?]+[.!?]?/', '/^[^.!?]+/'));
  ok(m3('Hello. World.') !== labelFromText('Hello. World.'), 'M3: terminal-punct capture removal is caught');
  eq(m3('Hello. World.'), 'Hello', 'M3: without the [.!?]? the period is dropped (proof the capture matters)');
}

// ── source binding: the live regex + truncation contract are present ──
{
  const src = extractSrc();
  ok(src.includes('/^[^.!?]+[.!?]?/'), 'first-sentence regex present in shipped source');
  ok(src.includes("replace(/\\s+/g, ' ')"), 'whitespace-collapse present in shipped source');
  ok(src.includes('s.length > 48'), '48-char truncation threshold present in shipped source');
}

console.log(`label-from-text: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
