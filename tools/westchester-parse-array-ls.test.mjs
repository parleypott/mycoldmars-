// Locks parseArrayLS in public/westchester/index.html — the array-guard that
// every pins/villages localStorage read now routes through (top-level load +
// the cloud-hydrated re-read after a cross-machine sync). The hardened contract:
// a valid-but-NON-array stored value (legacy/corrupt store, or a non-array value
// synced down verbatim from the cloud singleton row) must degrade to [], NEVER
// reach the in-memory pins/villages array and crash the 42 .map/.forEach sites.
//
// EXTRACTS the real shipped function from index.html at runtime (brace-match +
// new Function with an injected localStorage mock), so the lock can't drift.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// --- brace-match-extract a top-level `function NAME(...) { ... }` from the html ---
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// Build a fresh parseArrayLS bound to a Map-backed localStorage mock.
function makeParseArrayLS(fnSource) {
  const factory = new Function('localStorage', `${fnSource}; return parseArrayLS;`);
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  return { fn: factory(localStorage), store };
}

const realSource = extractFn(HTML, 'parseArrayLS');

// ---------------- harness ----------------
let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; fails.push(`${msg}: expected ${e}, got ${a}`); }
}
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// ===== inline RED proof: the OLD verbatim-return logic leaks a non-array =====
{
  // Reconstruct the pre-fix read (no Array.isArray guard) and prove it returns a
  // non-array AND that the non-array then throws on the .map every pins consumer does.
  const oldRead = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };
  const leaked = oldRead('{}');
  ok(!Array.isArray(leaked), 'RED: old logic returns a non-array ({}) for a non-array store');
  let threw = false;
  try { leaked.map(() => 1); } catch { threw = true; }
  ok(threw, 'RED: the leaked non-array throws on .map (the live crash)');

  // The shipped function defeats both.
  const { fn } = makeParseArrayLS(realSource);
  const { store } = makeParseArrayLS(realSource); // separate store
}

// ===== the fix: every non-array stored value degrades to [] =====
{
  const { fn, store } = makeParseArrayLS(realSource);

  // valid-but-non-array shapes (the bug class)
  store.set('k', '{}');            eq(fn('k'), [], 'object store -> []');
  store.set('k', '{"a":1}');       eq(fn('k'), [], 'populated object store -> []');
  store.set('k', '5');             eq(fn('k'), [], 'number store -> []');
  store.set('k', '"hello"');       eq(fn('k'), [], 'string store -> []');
  store.set('k', 'true');          eq(fn('k'), [], 'boolean store -> []');
  store.set('k', 'null');          eq(fn('k'), [], 'null store -> []');

  // malformed / missing
  store.set('k', '{not json');     eq(fn('k'), [], 'malformed JSON -> []');
  store.set('k', '');              eq(fn('k'), [], 'empty string store -> [] (|| "[]")');
  eq(fn('absent-key'), [], 'absent key -> []');

  // ALWAYS-array invariant + consumer ops never throw
  for (const raw of ['{}', '5', '"x"', 'true', 'null', '{bad', '']) {
    store.set('k', raw);
    const out = fn('k');
    ok(Array.isArray(out), `always array for store=${raw}`);
    let safe = true;
    try { out.map(x => x); out.forEach(() => {}); out.filter(() => true); } catch { safe = false; }
    ok(safe, `consumer ops never throw for store=${raw}`);
  }
}

// ===== no regression: a real array passes through verbatim (contents + order) =====
{
  const { fn, store } = makeParseArrayLS(realSource);
  store.set('k', '[]');                          eq(fn('k'), [], 'empty array preserved');
  store.set('k', '[{"id":"a"},{"id":"b"}]');     eq(fn('k'), [{ id: 'a' }, { id: 'b' }], 'array of pins preserved');
  store.set('k', '[3,1,2]');                      eq(fn('k'), [3, 1, 2], 'order preserved');
  store.set('k', '["only"]');                     eq(fn('k'), ['only'], 'single-entry array preserved');
}

const name = 'westchester-parse-array-ls';
if (fail === 0) console.log(`✓ ${name}: ${pass} passed, 0 failed`);
else { console.log(`✗ ${name}: ${pass} passed, ${fail} failed`); for (const f of fails) console.log('   - ' + f); process.exit(1); }
