// The Glossary — drafting-bench store: loadBench type-confusion hardening.
//
// THE BUG (fixed, latent): loadBench returned `JSON.parse(localStorage.getItem(BENCH_KEY)||'[]')`
// VERBATIM. JSON.parse of a valid-but-non-array stored value (a corrupt/tampered/legacy
// 'glossary-bench:v1' holding '{}' or '"x"' or '5') succeeds — so the catch never fires — and
// loadBench returned that non-array. Its consumers then do `names.map(...)` (benchTraditions),
// `list.includes(...)/list.push(...)` (addToBench), and `list.filter(...)` (removeFromBench),
// each of which throws a TypeError on a non-array → the Kingdom-tab drafting bench breaks on
// page load (renderBench() runs at init) with no recovery. Same JSON.parse(localStorage)
// type-confusion class already hardened across the repo this week (commentbank, the interpreter
// command-palette parseRecent). Fix: return [] unless the parsed value is a real Array.
//
// This test EXTRACTS the REAL shipped loadBench from public/glossary/index.html at runtime
// (new Function, with the real BENCH_KEY const + an injected localStorage), so it can never
// drift from a hand-copied mirror.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

// Pull the exact shipped BENCH_KEY const + loadBench() out of the inline script.
const keyM = html.match(/const BENCH_KEY\s*=\s*'[^']*';/);
const loadM = html.match(/function loadBench\(\)\s*\{[\s\S]*?\}\s*$/m);

// RETIRED-WHEN-ABSENT: the glossary was redesigned (commit 7f64b8e, Jun 28 2026) from the
// "drafting bench" into the "Taste Kingdom" — the bench store (BENCH_KEY/loadBench) was
// intentionally removed and replaced by the stateless crown→sendToKingdom flow. This gate
// locked a feature that no longer exists, so it can never pass as written. Rather than delete
// the institutional memory (the JSON.parse type-confusion hardening it proves), this test
// self-retires with a clear notice when the feature is absent — and AUTOMATICALLY REACTIVATES
// its full mutation-lock the moment a BENCH_KEY/loadBench pair reappears in the page.
if (!keyM || !loadM) {
  console.log('bench-store: SKIPPED — drafting-bench retired in the Taste Kingdom redesign ' +
    '(no BENCH_KEY/loadBench in glossary/index.html). Test reactivates if the bench returns.');
  process.exit(0);
}

// Build the real loadBench bound to the real BENCH_KEY and an injected localStorage.
function makeLoadBench(src) {
  return new Function('localStorage', `${keyM[0]}\n${src}\nreturn loadBench;`)(mockLS);
}

// Minimal Map-backed localStorage mock (loadBench only calls getItem).
let store = new Map();
const mockLS = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
const set = (raw) => { store = new Map(); if (raw !== undefined) store.set('glossary-bench:v1', raw); };

const loadBench = makeLoadBench(loadM[0]);

// The OLD, buggy loadBench — for the inline RED proof (returns the parsed value verbatim).
const oldLoadBench = makeLoadBench(
  `function loadBench(){ try{ return JSON.parse(localStorage.getItem(BENCH_KEY)||'[]'); }catch(e){ return []; } }`
);

let pass = 0, fail = 0;
const ok = (cond, msg) => { try { assert.ok(cond, msg); pass++; } catch (e) { fail++; console.error('  ✗', msg, '—', e.message); } };
const deep = (got, want, msg) => { try { assert.deepEqual(got, want, msg); pass++; } catch (e) { fail++; console.error('  ✗', msg, '—', e.message); } };

// ---- RED proof: the OLD loadBench leaks a non-array; consumers then throw ----
set('{}');
ok(!Array.isArray(oldLoadBench()), 'RED proof: old loadBench returns a non-array ({}) for a corrupt store');
assert.throws(() => oldLoadBench().map(x => x), TypeError,
  'RED proof: a non-array breaks benchTraditions().map (the live crash)');

// ---- THE FIX: loadBench always returns an array ----
set('{}');                 deep(loadBench(), [], 'object value → []');
set('"teenage-soul"');     deep(loadBench(), [], 'string value → []');
set('5');                  deep(loadBench(), [], 'number value → []');
set('true');               deep(loadBench(), [], 'boolean value → []');
set('null');               deep(loadBench(), [], 'null value → []');
set('not json {');         deep(loadBench(), [], 'malformed JSON → [] (catch path, unchanged)');
set(undefined);            deep(loadBench(), [], 'absent key → [] (|| "[]" default)');
set('[]');                 deep(loadBench(), [], 'empty array passthrough');

// ---- no regression: a real saved bench passes through verbatim ----
set('["Bauhaus","Psychedelic"]');
deep(loadBench(), ['Bauhaus', 'Psychedelic'], 'valid array passthrough, contents + order preserved');
ok(Array.isArray(loadBench()), 'a valid array is returned as an array');
set('["Teenage Soul"]');
deep(loadBench(), ['Teenage Soul'], 'single-entry array passthrough');

// ---- the guard is mutation-detectable: every consumer-safe input is an array ----
for (const raw of ['{}', '"x"', '5', 'true', 'null', 'oops', '[]', '["A"]']) {
  set(raw);
  ok(Array.isArray(loadBench()), `loadBench() is always an array (store=${raw})`);
  // never throws on the consumer ops the live code runs
  assert.doesNotThrow(() => { const l = loadBench(); l.map(x => x); l.includes('A'); l.filter(Boolean); },
    `consumer ops never throw (store=${raw})`);
  pass++;
}

if (fail) { console.error(`bench-store: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`bench-store: ${pass} passed, 0 failed`);
