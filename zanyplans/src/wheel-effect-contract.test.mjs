// Mutation-proven lock on the glitch-wheel EFFECT DELIVERY contract (zanyplans).
//
// Hand-rolled assert style to match the repo runner (bun <file>, no node:test).
//
// THE WHOLE POINT of the wheel is: spin -> land on a segment -> that segment's
// effect actually renders. But the mapping from a landed segment to a rendered
// effect is spread across FOUR disconnected places with NO shared source:
//   1. wheel.js       SEGMENTS[].effect        — the name announced on landing
//   2. effects.js     EFFECT_CSS_MAP[name]     — the CSS class toggled on the container
//   3. effects.js     switch(name) in startCanvasEffect — the canvas draw dispatched
//   4. style.css      .fx-*                     — the CSS rule the class actually applies
//
// If ANY of the four drifts — Johnny renames "DEEP FRY", adds a 10th segment,
// deletes an fx- rule, drops a switch case — a spin can land on a segment whose
// effect silently renders NOTHING (no canvas draw, or no CSS, or both). The wheel
// still spins and announces the name, so it LOOKS fine; the effect just never
// appears. Nothing in the build catches that: the names are plain strings, the
// switch has no default, and an absent CSS class is a silent no-op.
//
// This test reads the four sources and asserts the chain is closed for every
// segment: name -> css-map entry -> switch case -> defined .fx- rule. Source-read
// only (no DOM), deterministic, mutation-proof (see the self-checks at the end).

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const here = (p) => new URL(p, import.meta.url);
const wheelSrc = readFileSync(here('./wheel.js'), 'utf8');
const fxSrc = readFileSync(here('./effects.js'), 'utf8');
const cssSrc = readFileSync(here('./style.css'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── Extractors (pure string parsing over the real source) ──

// wheel.js: the SEGMENTS array. Pull every `effect: 'NAME'`.
function segmentEffects(src) {
  const arr = src.match(/const SEGMENTS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(arr, 'could not locate SEGMENTS array in wheel.js');
  return [...arr[1].matchAll(/effect:\s*'([^']+)'/g)].map((m) => m[1]);
}

// effects.js: EFFECT_CSS_MAP object -> { NAME: 'fx-class' }.
function cssMap(src) {
  const obj = src.match(/const EFFECT_CSS_MAP\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(obj, 'could not locate EFFECT_CSS_MAP in effects.js');
  const map = {};
  for (const m of obj[1].matchAll(/'([^']+)':\s*'([^']+)'/g)) map[m[1]] = m[2];
  return map;
}

// effects.js: the `case 'NAME':` labels inside startCanvasEffect's switch.
function switchCases(src) {
  const fn = src.match(/function startCanvasEffect\([\s\S]*?\n}/);
  assert.ok(fn, 'could not locate startCanvasEffect in effects.js');
  return [...fn[0].matchAll(/case\s*'([^']+)':/g)].map((m) => m[1]);
}

// style.css: every defined `.fx-*` selector.
function definedFxClasses(src) {
  return new Set([...src.matchAll(/\.(fx-[a-z0-9]+)\b/g)].map((m) => m[1]));
}

const effects = segmentEffects(wheelSrc);
const map = cssMap(fxSrc);
const cases = new Set(switchCases(fxSrc));
const fxClasses = definedFxClasses(cssSrc);

// ── Sanity: we actually parsed something ──
ok(effects.length >= 2, `parsed >=2 wheel segments (got ${effects.length})`);
ok(Object.keys(map).length >= 2, `parsed >=2 css-map entries (got ${Object.keys(map).length})`);
ok(cases.size >= 2, `parsed >=2 switch cases (got ${cases.size})`);
ok(fxClasses.size >= 2, `parsed >=2 .fx- classes (got ${fxClasses.size})`);

// ── The load-bearing contract: every landable segment renders SOMETHING ──
for (const name of effects) {
  const cls = map[name];
  ok(cls != null, `segment "${name}" has an EFFECT_CSS_MAP entry (else no CSS effect on landing)`);
  ok(cases.has(name), `segment "${name}" has a switch case in startCanvasEffect (else no canvas draw on landing)`);
  ok(cls != null && fxClasses.has(cls), `segment "${name}" -> "${cls}" is a DEFINED .${cls} rule in style.css (else the class is a no-op)`);
}

// No duplicate segment names (a dup would shadow effect-selection intent).
ok(new Set(effects).size === effects.length, 'segment effect names are unique');

// Symmetry: no orphan css-map entry pointing at an undefined .fx- class.
for (const [name, cls] of Object.entries(map)) {
  ok(fxClasses.has(cls), `EFFECT_CSS_MAP["${name}"] -> .${cls} exists in style.css`);
}

// ── Mutation self-checks: prove each assertion is load-bearing by re-running
// the extractors against deliberately-broken copies of the source. ──
(() => {
  // (a) rename a segment in wheel.js -> css-map lookup misses -> RED
  const renamed = wheelSrc.replace(/effect:\s*'([^']+)'/, "effect: '__ZZZ_UNMAPPED__'");
  const broken = segmentEffects(renamed);
  const stillClosed = broken.every((n) => map[n] != null && cases.has(n));
  ok(!stillClosed, 'MUTATION: a renamed segment breaks the chain (guard is load-bearing)');

  // (b) drop a switch case in effects.js -> that segment loses its canvas draw -> RED
  const noCase = fxSrc.replace(/case\s*'VHS MELT':[\s\S]*?break;/, '');
  const brokenCases = new Set(switchCases(noCase));
  ok(!brokenCases.has('VHS MELT'), 'MUTATION: deleting the VHS MELT case removes it from the switch set');
  ok(effects.includes('VHS MELT') && !brokenCases.has('VHS MELT'),
     'MUTATION: a landable segment with no switch case would be caught');

  // (c) delete an fx- rule from style.css -> mapped class becomes a no-op -> RED
  const noRule = cssSrc.replace(/\.fx-vhs\b/g, '.fx-REMOVED');
  const brokenClasses = definedFxClasses(noRule);
  ok(!brokenClasses.has('fx-vhs'), 'MUTATION: removing .fx-vhs from CSS drops it from the defined set');
})();

console.log(`wheel-effect-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
