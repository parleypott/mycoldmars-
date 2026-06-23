// Lock for parseObjectLS (public/westchester/index.html) — the object-shaped
// JSON.parse(localStorage) type-confusion guard on Johnny's ACTIVE house hunt.
//
// The layers-panel section-state reader did
//   sectionState = JSON.parse(localStorage.getItem(SECTION_KEY) || '{}')
// and used the parsed value VERBATIM. A corrupt/legacy/tampered store holding the
// literal 'null' -> JSON.parse('null') === null -> null. The next line does
// `if (sectionState[name])` -> null[name] THROWS at load. That throw is OUTSIDE the
// parse try/catch, inside a top-level layers IIFE (`})();`), so an uncaught error
// halts the rest of the script (MONEY MODE + everything below it) — the whole tool
// breaks at page load with no recovery. parseObjectLS GUARANTEES a plain object;
// a non-plain-object (null/number/string/array/malformed) degrades to {}.
//
// EXTRACTS the real shipped parseObjectLS from index.html at runtime (brace-match +
// new Function with an injected Map-backed localStorage) so the lock can't drift.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// Brace-match the shipped `function parseObjectLS(key) { ... }` and bind it to an
// injected localStorage so the test exercises the byte-for-byte production code.
function loadParseObjectLS(store) {
  const marker = 'function parseObjectLS(key) {';
  const at = html.indexOf(marker);
  assert.ok(at >= 0, 'parseObjectLS not found in index.html');
  let i = html.indexOf('{', at), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, 'could not brace-match parseObjectLS');
  const fnSrc = html.slice(at, end);
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
  };
  const factory = new Function('localStorage', `${fnSrc}\n return parseObjectLS;`);
  return factory(ls);
}

const KEY = 'whh:layers:sections:v1';
const make = (raw) => loadParseObjectLS(raw === undefined ? {} : { [KEY]: raw });

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  FAIL:', name); }
}
function throws(name, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(name, threw);
}

// ---------------------------------------------------------------------------
// RED PROOF: reconstruct the OLD verbatim read and show it returns a non-object
// that crashes the real `sectionState[name]` consumer; the shipped fn defuses it.
// ---------------------------------------------------------------------------
{
  const store = { [KEY]: 'null' };
  const oldRead = (k) => { try { return JSON.parse(store[k] ?? '{}'); } catch { return {}; } };
  const oldVal = oldRead(KEY);
  ok('RED: old read returns null on a literal-null store', oldVal === null);
  throws('RED: old null value crashes sectionState[name] read', () => { const _ = oldVal['general']; void _; });

  const parseObjectLS = make('null');
  const v = parseObjectLS(KEY);
  ok('FIX: parseObjectLS returns {} on literal-null store', v && typeof v === 'object' && !Array.isArray(v));
  ok('FIX: consumer read is safe (undefined, no throw)', v['general'] === undefined);
}

// ---------------------------------------------------------------------------
// Every non-object shape -> {}
// ---------------------------------------------------------------------------
for (const [label, raw] of [
  ['literal null', 'null'],
  ['number', '5'],
  ['zero', '0'],
  ['boolean true', 'true'],
  ['string', '"x"'],
  ['empty array', '[]'],
  ['populated array', '[1,2,3]'],
  ['malformed JSON', '{bad'],
  ['truncated', '{"general":tr'],
]) {
  const v = make(raw)(KEY);
  ok(`non-object (${label}) -> plain object`, v && typeof v === 'object' && !Array.isArray(v));
  ok(`non-object (${label}) -> empty`, Object.keys(v).length === 0);
}

// absent / empty store -> {}
ok('absent key -> {}', Object.keys(make(undefined)(KEY)).length === 0);
ok('empty-string store -> {}', Object.keys(make('')(KEY)).length === 0);
ok('literal empty-object store -> {}', Object.keys(make('{}')(KEY)).length === 0);

// ---------------------------------------------------------------------------
// Consumer-safety invariant: parseObjectLS(...) is ALWAYS obj[key]-read AND
// obj[key]=v-write safe across every hostile input (the live crash vector).
// ---------------------------------------------------------------------------
for (const raw of ['null', '5', '0', 'true', 'false', '"x"', '[]', '[1,2]', '{bad', '', '{}']) {
  const v = make(raw)(KEY);
  ok(`invariant: read safe on (${raw})`, (() => { try { const _ = v['general']; void _; return true; } catch { return false; } })());
  ok(`invariant: write safe on (${raw})`, (() => { try { v['general'] = true; return true; } catch { return false; } })());
}

// ---------------------------------------------------------------------------
// No-regression: a real section-state object passes through verbatim
// ---------------------------------------------------------------------------
{
  const real = { general: true, proximity: false, money: true };
  const v = make(JSON.stringify(real))(KEY);
  ok('real object: key count preserved', Object.keys(v).length === 3);
  ok('real object: general true', v.general === true);
  ok('real object: proximity false', v.proximity === false);
  ok('real object: money true', v.money === true);
  // and the real consumer logic works
  let collapsed = [];
  for (const name of ['general', 'proximity', 'money']) if (v[name]) collapsed.push(name);
  ok('real object: consumer collapses the truthy sections', collapsed.join(',') === 'general,money');
}

// nested values preserved verbatim
{
  const real = { a: { x: 1 }, b: [1, 2] };
  const v = make(JSON.stringify(real))(KEY);
  ok('nested object preserved', v.a.x === 1 && Array.isArray(v.b) && v.b[1] === 2);
}

console.log(`\nwestchester-section-state: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
