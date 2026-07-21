// Lock normalizeBorders — the BORDERS-hub persistence contract in main.js.
// It's the single funnel every world-border style passes through on load: the
// boot default (normalizeBorders(null)) AND every project restore
// (hydrateSnapshotIntoState → normalizeBorders(parsed.borders)). Its job is to
// coerce a possibly-corrupt/legacy/absent `borders` value from a saved snapshot
// into a well-shaped { primary, secondary } object so applyBordersToMap can feed
// each field straight into map.setPaintProperty without a crash or a garbage
// paint value. Fresh code (commit 7302265 area), zero coverage.
//
// No live bug — this is a verifier-layer LOCK. normalizeBorders is
// module-scoped, so we source-extract it VERBATIM from main.js (can't drift from
// the shipped code) and mutation-prove every field's TYPE guard: the contract is
// per-field type-checking (typeof === 'boolean'/'string'/'number'), NOT a
// spread-merge — a spread would let a corrupt non-typed field (a stringified
// number width, a null color, an object `on`) reach the map paint call. Each
// assertion below goes RED if the corresponding guard regresses to a spread or a
// truthy check.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'main.js'), 'utf8');

// Extract the two blocks verbatim: the const default table + the function.
const defMatch = src.match(/const DEFAULT_BORDERS = \{[\s\S]*?\n\};/);
const fnMatch = src.match(/function normalizeBorders\(raw\) \{[\s\S]*?\n\}/);
if (!defMatch) throw new Error('could not extract DEFAULT_BORDERS from main.js');
if (!fnMatch) throw new Error('could not extract normalizeBorders from main.js');

// Eval both together in an isolated scope; return the real shipped function.
// eslint-disable-next-line no-eval
const normalizeBorders = (0, eval)(
  `(function(){ ${defMatch[0]}\n${fnMatch[0]}\n return normalizeBorders; })()`,
);

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }

// The shipped defaults (mirrors main.js DEFAULT_BORDERS for the assertions).
const D = {
  primary:   { on: false, color: '#6b5640', width: 1,   opacity: 0.85, dashed: false },
  secondary: { on: false, color: '#a8482b', width: 2.5, opacity: 0.35, dashed: true },
};

// ── 1. null / undefined / absent → full defaults (boot + fresh project) ──
for (const empty of [null, undefined]) {
  const r = normalizeBorders(empty);
  ok(JSON.stringify(r.primary) === JSON.stringify(D.primary), `${empty}: primary all defaults`);
  ok(JSON.stringify(r.secondary) === JSON.stringify(D.secondary), `${empty}: secondary all defaults`);
}

// ── 2. non-object raw (corrupt store: string / number / array) → defaults, no throw ──
for (const junk of ['nope', 42, [1, 2, 3], true]) {
  const r = normalizeBorders(junk);
  ok(r.primary.on === false && r.primary.color === '#6b5640', `junk ${JSON.stringify(junk)}: primary defaults`);
  ok(r.secondary.dashed === true, `junk ${JSON.stringify(junk)}: secondary defaults`);
}

// ── 3. a per-side that is a non-object (null / string / number) → that side defaults ──
{
  const r = normalizeBorders({ primary: 'garbage', secondary: 99 });
  ok(r.primary.color === '#6b5640' && r.primary.width === 1, 'non-object primary → default');
  ok(r.secondary.color === '#a8482b' && r.secondary.width === 2.5, 'non-object secondary → default');
}

// ── 4. valid partial override merges over defaults per-field ──
{
  const r = normalizeBorders({ primary: { on: true, color: '#123456' } });
  ok(r.primary.on === true, 'primary.on honored');
  ok(r.primary.color === '#123456', 'primary.color honored');
  ok(r.primary.width === 1, 'primary.width falls to default (absent)');
  ok(r.primary.opacity === 0.85, 'primary.opacity falls to default (absent)');
  ok(r.secondary.on === false, 'secondary untouched → default');
}

// ── 5. LOAD-BEARING type guards — a WRONG-TYPE field is REJECTED to the default,
//    not passed through. This is what a spread-merge would break. Each of these
//    is the value that would reach map.setPaintProperty and either crash or paint
//    garbage if it leaked. ──
{
  const bad = normalizeBorders({
    primary: {
      on: 'true',          // string, not boolean → default false
      color: 123,          // number, not string  → default color
      width: '3',          // stringified number  → default width
      opacity: null,       // null                → default opacity
      dashed: 1,           // number, not boolean  → default false
    },
  });
  ok(bad.primary.on === false, 'string "true" on REJECTED → default false');
  ok(bad.primary.color === '#6b5640', 'numeric color REJECTED → default color');
  ok(bad.primary.width === 1, 'stringified "3" width REJECTED → default 1');
  ok(bad.primary.opacity === 0.85, 'null opacity REJECTED → default 0.85');
  ok(bad.primary.dashed === false, 'numeric dashed REJECTED → default false');
}

// ── 6. RED-proof: a spread-merge variant (the plausible regression) LEAKS the
//    wrong-type fields the real per-field type guard rejects. Proves assertion
//    block 5 is load-bearing — it only passes because the shipped code type-checks. ──
{
  const spreadOne = (d, r) => ({ ...d, ...(r && typeof r === 'object' ? r : {}) });
  const spreadNormalize = (raw) => ({
    primary: spreadOne(D.primary, raw && raw.primary),
    secondary: spreadOne(D.secondary, raw && raw.secondary),
  });
  const leak = spreadNormalize({ primary: { width: '3', color: 123 } });
  ok(leak.primary.width === '3' && leak.primary.color === 123,
    'RED-proof: spread-merge LEAKS the "3"/123 the shipped type-guard rejects');
}

// ── 7. no aliasing — result never shares object identity with DEFAULT_BORDERS,
//    so mutating one restored project can't corrupt the module default. ──
{
  const a = normalizeBorders(null);
  a.primary.color = '#ffffff';
  const b = normalizeBorders(null);
  ok(b.primary.color === '#6b5640', 'default table not aliased/mutated across calls');
}

console.log(`borders-normalize: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
