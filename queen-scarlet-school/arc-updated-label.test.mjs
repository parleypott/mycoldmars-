// Verifier-layer FIX-lock for arcUpdatedLabel(iso) in queen-scarlet-school/index.html —
// the arc-stat chip in the QSS WRITE page's Arc Inspector (Henry's primary tool).
// renderArcInspector() renders "updated <time>" from arc.updated_at (the qss_story_arc
// row's DB-set timestamp). The OLD code guarded only with `arc?.updated_at ?` — falsy
// only — so a PRESENT-but-unparseable updated_at (corrupt/legacy/tampered row, schema
// drift) made new Date(x) an Invalid Date, and .toLocaleTimeString() RETURNS the literal
// string "Invalid Date" (never throws) → "updated Invalid Date" in the arc chip.
//
// This is the LAST surviving member of the present-but-bad-date class swept this week
// across hunter / burma-essays / nile-flights / qss-style / westchester / interpreter
// (the previous iteration's own NOTE logged this exact site as "the only remaining bare
// toLocale on the codebase").
//
// FIX: arcUpdatedLabel guards `isFinite(d.getTime())` and degrades a nullish OR corrupt
// timestamp to 'no analysis yet' (the SAME fallback the absent-timestamp case already
// used). Byte-identical for every valid date + nullish → zero regression; only the
// corrupt case changes ("updated Invalid Date" → "no analysis yet").
//
// The test EXTRACTS the REAL shipped function from index.html at runtime (regex +
// new Function) so it can't drift from a hand-copied mirror, and is mutation-proven
// against an in-memory rebuild of the source (proving the isFinite guard is load-bearing).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractSrc() {
  const m = HTML.match(/function arcUpdatedLabel\(iso\) \{[\s\S]*?\n    \}/);
  if (!m) throw new Error('could not locate arcUpdatedLabel in index.html');
  return m[0];
}
const arcUpdatedLabel = new Function(extractSrc() + '\nreturn arcUpdatedLabel;')();

// Build an arcUpdatedLabel from a mutated copy of the REAL source (proves a given
// mutation actually flips a test RED — a real verifier, not a rubber stamp).
function buildMutant(transform) {
  const mutated = transform(extractSrc());
  return new Function(mutated + '\nreturn arcUpdatedLabel;')();
}

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; }
  else { fail++; console.error(`FAIL: ${label}\n  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
function ok(cond, label) { eq(!!cond, true, label); }

const FALLBACK = 'no analysis yet';
const validIso = '2026-06-24T03:17:53.000Z';

// ── Inline RED proof: the OLD inline form (no isFinite guard) leaks "Invalid Date" ──
// OLD: arc?.updated_at ? `updated ${new Date(arc.updated_at).toLocaleTimeString()}` : 'no analysis yet'
function oldInlineLabel(iso) {
  return iso ? `updated ${new Date(iso).toLocaleTimeString()}` : FALLBACK;
}
{
  eq(oldInlineLabel('garbage'), 'updated Invalid Date', 'RED proof: OLD inline form leaks "updated Invalid Date" on a corrupt timestamp');
  eq(arcUpdatedLabel('garbage'), FALLBACK, 'shipped fn degrades a corrupt timestamp to the absent-fallback');
}

// ── MUTATION proof: removing the isFinite guard re-introduces the bug ──
{
  // Rebuild without the finite guard: `d && isFinite(d.getTime())` → `d`
  const mutant = buildMutant(s => s.replace('d && isFinite(d.getTime())', 'd'));
  eq(mutant('garbage'), 'updated Invalid Date', 'MUTATION: dropping the isFinite guard leaks "updated Invalid Date"');
  eq(arcUpdatedLabel('garbage'), FALLBACK, 'shipped (guarded) fn does NOT — proves the guard is load-bearing');
}

// ── FIX: every corrupt / unparseable shape → fallback (never "Invalid Date") ──
for (const bad of ['garbage', 'not-a-date', '2026-13-40T99:99', 'soon', '99:99:99', '2026-99-99', 'xyz']) {
  eq(arcUpdatedLabel(bad), FALLBACK, `corrupt "${bad}" → "${FALLBACK}"`);
}

// ── nullish / falsy → fallback (matches the OLD truthiness branch) ──
eq(arcUpdatedLabel(null), FALLBACK, 'null → fallback');
eq(arcUpdatedLabel(undefined), FALLBACK, 'undefined → fallback');
eq(arcUpdatedLabel(''), FALLBACK, 'empty string → fallback');
eq(arcUpdatedLabel(0), FALLBACK, '0 (falsy) → fallback');
eq(arcUpdatedLabel(false), FALLBACK, 'false → fallback');

// ── no-"Invalid Date" / no-"NaN" invariant across hostile inputs ──
for (const x of ['garbage', '', null, undefined, 0, {}, [], 'NaN', '2026-13-99T99:99', false, '   ']) {
  const out = arcUpdatedLabel(x);
  ok(!out.includes('Invalid Date'), `invariant: "${String(x)}" output never contains "Invalid Date"`);
  ok(!out.includes('NaN'), `invariant: "${String(x)}" output never contains "NaN"`);
}

// ── NO-REGRESSION: a VALID date renders byte-identically to the OLD inline form ──
// (computed in-process so the locale/timezone output is exact — only the corrupt case
// changes; every valid date is preserved.)
for (const iso of [
  validIso,
  '2026-01-01T12:00:00.000Z',
  '2026-12-31T23:59:59.000Z',
  '2025-06-15T08:30:00.000Z',
  Date.now(),                      // epoch ms (finite, valid)
  new Date().toISOString(),
]) {
  eq(arcUpdatedLabel(iso), oldInlineLabel(iso), `NO-REGRESSION: valid date ${iso} === OLD inline form`);
}

// ── a valid date produces a non-empty "updated …" label (not the fallback) ──
{
  const out = arcUpdatedLabel(validIso);
  ok(out.startsWith('updated '), 'valid date → starts with "updated "');
  ok(out !== FALLBACK, 'valid date → is NOT the absent-fallback');
  ok(out.length > 'updated '.length, 'valid date → carries an actual time string');
}

// ── epoch 0 is a FINITE, valid date — not swallowed as corrupt ──
{
  const out = arcUpdatedLabel(new Date(0).toISOString());
  ok(out.startsWith('updated '), 'epoch-0 ISO is valid → "updated …", not fallback');
}

// ── SOURCE-BINDING: the live source carries the isFinite guard + the fallback ──
const src = extractSrc();
ok(/isFinite\(d\.getTime\(\)\)/.test(src), 'source-binding: arcUpdatedLabel uses isFinite(d.getTime())');
ok(src.includes(FALLBACK), 'source-binding: arcUpdatedLabel returns the "no analysis yet" fallback');
ok(src.includes('toLocaleTimeString'), 'source-binding: arcUpdatedLabel renders via toLocaleTimeString');
// and the OLD unguarded inline form is GONE from the whole file
ok(!/updated \$\{new Date\(arc\.updated_at\)\.toLocaleTimeString\(\)\}/.test(HTML),
  'source-binding: the OLD unguarded `new Date(arc.updated_at).toLocaleTimeString()` inline form is gone');
ok(HTML.includes('arcUpdatedLabel(arc?.updated_at)'),
  'source-binding: the arc-stat chip routes through arcUpdatedLabel(arc?.updated_at)');

console.log(`\narc-updated-label.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
