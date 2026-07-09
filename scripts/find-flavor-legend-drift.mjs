#!/usr/bin/env bun
//
// find-flavor-legend-drift.mjs — lock the WP Script engine's flavor DATA CONTRACT:
// every flavor tag actually USED in an episode's blocks JSON must be declared in
// that episode's `flavors` legend (config.js). A used-but-unlegended flavor is a
// real, silent, editorial data-LOSS bug.
//
// WHY THIS EXISTS
// The shared Burma/Palau script engine builds the per-flavor worklists — the
// task sheets Johnny hands his crew ("B-ROLL I LIKE", "ANIMATION", "STRAGGLER") —
// in burma-script/src/worklists.js:
//
//     const byFlavor = {};
//     for (const f of episode.flavors) byFlavor[f.id] = [];   // legend seeds the buckets
//     ...
//     if (b.flavor && byFlavor[b.flavor]) byFlavor[b.flavor].push(...);  // ← the trap
//
// A block whose `flavor` is NOT a legend id has NO bucket, so `byFlavor[b.flavor]`
// is `undefined` and the block is SILENTLY skipped — it appears in NO worklist at
// all. The block still exists in the doc (it round-trips via `data-flavor`), it
// just never reaches the editor's task list. There is no crash, no warning; the
// handoff sheet is simply missing lines.
//
// This is easy to introduce by hand: Johnny hand-edits both the config legend and
// the blocks JSON. RENAME a legend id (`gold` → `amber` in config) and every
// existing `"flavor": "gold"` block orphans instantly. Or ADD a block tagged with
// a brand-new flavor to the JSON and forget the legend row. Both ship a worklist
// that's quietly short — exactly the "registry ⊄ data" divergence class this loop
// has hand-fixed many times, here in the live script tool Johnny + his crew use
// while he travels.
//
// WHAT IT CHECKS  (a hard invariant — no ledger, no judgement calls)
// For every episode config (`*/config.js` that declares a `flavors:` legend AND
// imports a blocks JSON via `import scriptData from './*.json'`):
//   • parse the legend flavor ids from the `flavors:` array (scoped so the
//     sibling `genres:`/other `id:` arrays are never miscounted),
//   • parse the flavor set actually used across `blocks[].flavor` in the JSON,
//   • FAIL if any used flavor is missing from the legend.
// The reverse direction (a legend id with zero blocks — a dead filter chip) is a
// harmless no-op, so it is reported as an advisory note, never a failure.
//
// USAGE
//   scripts/find-flavor-legend-drift.mjs            # table: every episode + coverage
//   scripts/find-flavor-legend-drift.mjs --check    # exit 1 if any used flavor is unlegended
//   scripts/find-flavor-legend-drift.mjs --self-test # prove the parser + drift check on fixtures

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Pure cores (string in, data out — the self-test drives these directly) ──────

// Slice the balanced [...] that follows the `flavors:` key in a config source.
// String- and bracket-aware so commas/brackets inside string literals or nested
// objects don't end the scan early. Returns '' if the array isn't found. (The
// key is a fixed literal — no dynamic RegExp — so the sibling `genres:` array,
// which also carries `id:`/`color:`, is never in scope.)
export function sliceFlavorsArray(src) {
  const m = /\bflavors\s*:\s*\[/.exec(src);
  if (!m) return '';
  const open = m.index + m[0].length - 1; // index of the '['
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
}

// Parse the legend flavor ids from a config source. Scoped to the `flavors:`
// array only, so the sibling `genres:` (which also carries `id:`/`color:`) can
// never leak in.
export function parseLegendIds(configSrc) {
  const block = sliceFlavorsArray(configSrc);
  if (!block) return [];
  const out = [];
  const re = /\bid\s*:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
}

// Collect the set of non-empty string `flavor` values used across a blocks JSON.
// Accepts either the raw text or an already-parsed object; walks `blocks[]`.
export function parseUsedFlavors(jsonTextOrObj) {
  let data;
  if (typeof jsonTextOrObj === 'string') {
    try { data = JSON.parse(jsonTextOrObj); } catch { return []; }
  } else {
    data = jsonTextOrObj;
  }
  const blocks = Array.isArray(data?.blocks) ? data.blocks : Array.isArray(data) ? data : [];
  const seen = new Set();
  for (const b of blocks) {
    const f = b && typeof b.flavor === 'string' ? b.flavor.trim() : '';
    if (f) seen.add(f);
  }
  return [...seen];
}

// The invariant: every used flavor must be a legend id. Returns the sorted set of
// used-but-unlegended flavors (empty ⇒ contract holds) plus legend ids that go
// unused (advisory only — a dead chip, never a failure).
export function flavorDrift(legendIds, usedFlavors) {
  const legend = new Set(legendIds);
  const used = new Set(usedFlavors);
  const missing = [...used].filter((f) => !legend.has(f)).sort((a, b) => a.localeCompare(b));
  const dead = [...legend].filter((f) => !used.has(f)).sort((a, b) => a.localeCompare(b));
  return { missing, dead };
}

// ── File discovery ──────────────────────────────────────────────────────────────
// An "episode config" is any `<dir>/config.js` that declares a `flavors:` legend
// AND imports a blocks JSON (`import <name> from './<file>.json'`). This
// auto-includes future episodes without touching this gate.
function findEpisodeConfigs() {
  const out = [];
  let entries;
  try { entries = readdirSync(ROOT); } catch { return out; }
  for (const name of entries) {
    const dir = join(ROOT, name);
    let st;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory() || name === 'node_modules' || name === '.git') continue;
    const cfg = join(dir, 'config.js');
    let src;
    try { src = readFileSync(cfg, 'utf8'); } catch { continue; }
    if (!/\bflavors\s*:/.test(src)) continue;
    const imp = /import\s+\w+\s+from\s+['"](\.\/[^'"]+\.json)['"]/.exec(src);
    if (!imp) continue;
    out.push({ configPath: cfg, dir, rel: relative(ROOT, cfg), jsonPath: join(dir, imp[1]) });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function analyzeEpisode(ep) {
  const configSrc = readFileSync(ep.configPath, 'utf8');
  const legend = parseLegendIds(configSrc);
  let jsonText = '';
  try { jsonText = readFileSync(ep.jsonPath, 'utf8'); } catch { /* missing JSON → no used flavors */ }
  const used = parseUsedFlavors(jsonText);
  const { missing, dead } = flavorDrift(legend, used);
  return { ...ep, legend, used, missing, dead };
}

// ── Self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0, fail = 0;
  const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${label}`); } };
  const eqArr = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // parseLegendIds scopes to the flavors array, ignoring a sibling genres array.
  const cfg = `
    export const EP = {
      id: 'demo',
      genres: [
        { id: 'ground', label: 'GROUND', color: '#1f8a72', head: 'GR' },
        { id: 'reef',   label: 'REEF',   color: '#0c7d8c' },
      ],
      flavors: [
        { id: 'purple', label: 'ANIMATION',     color: '#7a5cc0' },
        { id: 'pink',   label: 'STRAGGLER',     color: '#e0608f' },
        { id: 'gold',   label: 'B-ROLL I LIKE', color: '#c9a227' },
      ],
    };`;
  ok(eqArr(parseLegendIds(cfg), ['purple', 'pink', 'gold']), 'parseLegendIds scoped to flavors (genres ignored)');
  ok(eqArr(parseLegendIds('export const E = { flavors: [] };'), []), 'empty legend → []');
  ok(eqArr(parseLegendIds('export const E = { id: "x" };'), []), 'no flavors key → []');

  // parseUsedFlavors walks blocks[].flavor, de-dupes, drops empties/non-strings.
  const blocks = JSON.stringify({
    title: 'Demo',
    blocks: [
      { id: 'a', flavor: 'pink' },
      { id: 'b', flavor: 'pink' },
      { id: 'c', flavor: 'gold' },
      { id: 'd' },                 // no flavor
      { id: 'e', flavor: '' },     // empty
      { id: 'f', flavor: 42 },     // non-string
      { id: 'g', type: 'chapter' },
    ],
  });
  ok(eqArr(parseUsedFlavors(blocks).sort((a, b) => a.localeCompare(b)), ['gold', 'pink']), 'parseUsedFlavors de-dupes + drops empty/non-string');
  ok(eqArr(parseUsedFlavors('not json'), []), 'malformed JSON → [] (no throw)');
  ok(eqArr(parseUsedFlavors('{"nope":1}'), []), 'no blocks array → []');

  // flavorDrift: covered legend ⇒ no missing; an unlegended flavor ⇒ flagged.
  const covered = flavorDrift(['purple', 'pink', 'gold'], ['pink', 'gold']);
  ok(eqArr(covered.missing, []) && eqArr(covered.dead, ['purple']), 'covered: no missing, purple is dead (advisory)');

  const drift = flavorDrift(['purple', 'pink'], ['pink', 'gold', 'amber']);
  ok(eqArr(drift.missing, ['amber', 'gold']), 'drift: gold+amber flagged as unlegended (RED PROOF of the bug)');

  // The load-bearing rename case: legend renames gold→amber, blocks still say gold.
  const renamed = flavorDrift(['purple', 'pink', 'amber'], ['pink', 'gold']);
  ok(eqArr(renamed.missing, ['gold']), 'rename orphans existing gold blocks (the silent-worklist-drop bug)');

  // End-to-end on the real repo: every episode's contract must currently HOLD.
  const eps = findEpisodeConfigs().map(analyzeEpisode);
  ok(eps.length >= 2, `discovered ${eps.length} episode config(s) (expect ≥2: palau, palau2, …)`);
  const broken = eps.filter((e) => e.missing.length);
  if (broken.length === 0) pass++;
  else {
    fail++;
    console.log(`  ✗ live repo has ${broken.length} episode(s) with unlegended flavors:`);
    for (const e of broken) console.log(`      ${e.rel}: used-but-unlegended = ${e.missing.join(', ')}`);
  }

  console.log(`\nself-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
if (args.has('--self-test')) process.exit(selfTest());

const eps = findEpisodeConfigs().map(analyzeEpisode);
const broken = eps.filter((e) => e.missing.length);

if (args.has('--check')) {
  if (broken.length) {
    console.log(`✗ ${broken.length} episode(s) ship a flavor used in blocks but MISSING from the legend — those blocks silently vanish from every worklist export (worklists.js). Add the missing legend row(s) in config.js OR retag the blocks:`);
    for (const e of broken) {
      console.log(`  ${e.rel}`);
      console.log(`    used-but-unlegended: ${e.missing.join(', ')}`);
      console.log(`    legend: [${e.legend.join(', ')}]   blocks-use: [${e.used.join(', ')}]`);
    }
    process.exit(1);
  }
  console.log(`✓ ${eps.length} episode(s): every used flavor is declared in its legend.`);
  process.exit(0);
}

// Default: full table.
console.log('flavor legend ↔ blocks-data coverage  [✓ covered · ✗ unlegended-flavor bug]');
for (const e of eps) {
  const mark = e.missing.length ? '✗' : '✓';
  console.log(`  ${mark} ${e.rel}`);
  console.log(`      legend    : [${e.legend.join(', ')}]`);
  console.log(`      blocks-use: [${e.used.join(', ')}]`);
  if (e.missing.length) console.log(`      UNLEGENDED (drops from worklists): ${e.missing.join(', ')}`);
  if (e.dead.length) console.log(`      dead chip (legend, no blocks): ${e.dead.join(', ')}`);
}
const nBad = broken.length;
console.log(`\n→ ${eps.length} episode(s): ${eps.length - nBad} clean, ${nBad} with unlegended flavors.`);
