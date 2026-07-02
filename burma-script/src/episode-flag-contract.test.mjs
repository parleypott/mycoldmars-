// episode-flag-contract.test.mjs
//
// A FRONT-LOADED VERIFIER for commit 41cbf46 ("engine: episode feature flags replace
// id==='palau' gates — phase 1 of design unification — zero behavior change").
//
// That refactor swapped ~19 hardcoded `getEpisode()?.id === 'palau'` gates in the SHARED WP
// engine (burma-script/src) for `episodeFlag('NAME')` reads, and moved the on/off decision into
// each episode's config `features: {}` object (burma-script/config.js, palau-script/config.js).
//
// The ENTIRE "zero behavior change" claim rests on THREE things staying true — and NOTHING in the
// repo enforces any of them today:
//
//   A. PALAU-COMPLETENESS. Every flag the engine reads (`episodeFlag('X')`) must be enabled in
//      Palau's config. Miss one — a typo, or a new `episodeFlag('newThing')` added in code but
//      not to the config — and Palau SILENTLY loses that Palau-era affordance (the drag grip, the
//      SOT inline name, the widened timecodes...). A producer-facing regression that no other test
//      would catch, because the flag just quietly reads false.
//
//   B. BURMA-PURITY. Burma's `features` object must stay EMPTY. The moment a flag leaks into
//      Burma's config, Burma stops rendering byte-for-byte as it did before the flag system — the
//      exact thing the commit promises it won't do.
//
//   C. NO-DEAD-FLAG. Every flag KEY enabled in Palau's config must actually be read by some
//      `episodeFlag('X')` in the engine. A config flag that no code reads is either a typo (so the
//      real flag is missing → also caught by A) or a stale leftover that lies about what's wired.
//
// This gate is drift-proof: it statically scans the engine SOURCE for every string-literal
// episodeFlag() call site and both config `features` blocks, then locks A/B/C. If a future edit
// breaks the contract, `bun run test` goes RED and NAMES the offending flag.
//
// Mutation-proven:
//   • delete a flag from Palau's features  -> A goes RED (naming the now-unwired engine flag)
//   • add a flag to Burma's features       -> B goes RED
//   • rename/typo a flag in Palau's config  -> A + C go RED (missing wire + dead flag)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));       // burma-script/src
const ENGINE = HERE;                                        // shared WP engine root
const REPO = join(HERE, '..', '..');                        // mycoldmars/
const BURMA_CONFIG = join(HERE, '..', 'config.js');         // burma-script/config.js
const PALAU_CONFIG = join(REPO, 'palau-script', 'config.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// ---- collect every string-literal episodeFlag('NAME') call site in the engine source ----
function walkJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { out.push(...walkJs(p)); continue; }
    if (!/\.(js|jsx)$/.test(name)) continue;
    if (/\.test\.mjs$/.test(name)) continue;
    if (name === 'episode-config.js') continue;  // the DEFINITION, not a call site
    out.push(p);
  }
  return out;
}

const CALL_RE = /episodeFlag\(\s*['"]([A-Za-z0-9_]+)['"]/g;
const codeFlags = new Set();
for (const file of walkJs(ENGINE)) {
  const src = readFileSync(file, 'utf8');
  let m;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(src)) !== null) codeFlags.add(m[1]);
}

// Guard against a silently-broken scanner (a regex that matches nothing would make A/C pass
// vacuously). The refactor wired 11 distinct flags; assert we still see a plausible engine.
ok(codeFlags.size >= 8, `engine reads a plausible set of flags (found ${codeFlags.size}, expect >=8)`);

// ---- extract the truthy keys of a config's `features: { ... }` block from SOURCE ----
// Source-level (not import-level) on purpose: the configs import JSON + a .ts sibling, which a
// plain node .test.mjs can't load. Locking the source is also what we actually want — it's the
// human-edited contract.
function featuresBlock(src, label) {
  const at = src.indexOf('features:');
  ok(at !== -1, `${label}: has a features: block`);
  if (at === -1) return '';
  const open = src.indexOf('{', at);
  if (open === -1) return '';
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(open, i);  // includes the outer braces
}

function enabledFlags(block) {
  const set = new Set();
  const re = /([A-Za-z0-9_]+)\s*:\s*true\b/g;
  let m;
  while ((m = re.exec(block)) !== null) set.add(m[1]);
  return set;
}

const burmaBlock = featuresBlock(readFileSync(BURMA_CONFIG, 'utf8'), 'burma');
const palauBlock = featuresBlock(readFileSync(PALAU_CONFIG, 'utf8'), 'palau');
const burmaFlags = enabledFlags(burmaBlock);
const palauFlags = enabledFlags(palauBlock);

// ---- LOCK A: PALAU-COMPLETENESS — every engine flag is enabled in Palau ----
for (const f of codeFlags) {
  ok(palauFlags.has(f), `A: engine flag '${f}' is enabled in Palau config (else Palau silently loses it)`);
}

// ---- LOCK B: BURMA DATA-SAFETY — Burma may adopt Palau's LOOK, but never a flag that
//      reinterprets or restructures its already-saved (and once-lost) document. ----
// History: Phase 1 kept Burma's features EMPTY for a byte-identical "zero behavior change" proof.
// The product decision then changed deliberately (Johnny: "sunset Burma style, make it all Palau"),
// so Burma now enables the PRESENTATION + interaction flags. What must NEVER leak into Burma is the
// DATA-TOUCHING set: these three re-read or rewrite Burma's stored doc on load/rebuild —
//   • palauTimecodes     — changes what counts as a timecode in Burma's existing prose
//   • inlineSotName       — restructures SOT blocks on rebuild
//   • normalizeTableRows  — the sharp one: splits full-width rows and SILENTLY DROPS word-less
//                           rows on LOAD, which the next autosave then persists.
//   • rebuildFromSourceWhenPristine — the SHARPEST one: when the saved doc looks byte-pristine,
//                           migrate-doc.js DISCARDS it entirely and rebuilds the editor doc from the
//                           episode's source blocks (sample-blocks.json). On Burma that would silently
//                           throw away Johnny's once-lost precious doc the moment it matched source.
// Turning any of these on for Burma is a content migration, not a style change, and is gated on an
// explicit human decision. This lock is the guard on Johnny's precious doc — keep it RED-on-leak.
// The list mirrors burma-script/config.js's own "every DATA-touching flag (…)" comment — all four,
// not three: the fourth (rebuildFromSourceWhenPristine) was named in the config but missing here.
const BURMA_FORBIDDEN = ['palauTimecodes', 'inlineSotName', 'normalizeTableRows', 'rebuildFromSourceWhenPristine'];
for (const f of BURMA_FORBIDDEN) {
  ok(!burmaFlags.has(f),
    `B: Burma must NOT enable data-touching flag '${f}' (it reshapes the saved doc; needs an explicit migration decision)`);
}

// ---- LOCK C: NO-DEAD-FLAG — every Palau flag is actually read by the engine ----
for (const f of palauFlags) {
  ok(codeFlags.has(f), `C: Palau flag '${f}' is read by the engine (else it's a dead/typo'd flag)`);
}

console.log(`episode-flag-contract: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
