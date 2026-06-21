// Lock for the selects → raw clip-name cross-reference matcher.
// Imports the REAL shipped functions. Proves the symmetric matching:
//  - documented direction (selects = original name) is byte-identical to the
//    OLD asymmetric inline matcher (zero regression);
//  - reverse direction (selects carries "_Proxy") now matches (the additive win).
import { clipMatchKeys, buildRawUnitMatcher, findRawMatch } from './selects-crossref.js';

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// ── Reconstruct the OLD inline matcher (the code this module replaces) ─────────
// Map keyed by 4 raw-side variants; lookup tried only 2 selects-side variants.
function oldBuild(rawUnits) {
  const m = new Map();
  for (const u of rawUnits) {
    m.set(u.source_clip_name, u);
    const noExt = u.source_clip_name.replace(/\.[^.]+$/, '');
    m.set(noExt, u);
    m.set(u.source_clip_name.replace(/_Proxy/i, ''), u);
    m.set(noExt.replace(/_Proxy/i, ''), u);
  }
  return m;
}
function oldLookup(m, sel) {
  return m.get(sel) || m.get(sel.replace(/\.[^.]+$/, '')) || null;
}

// ── INLINE RED PROOF: the old matcher misses a selects name carrying _Proxy ────
{
  const raw = [{ id: 'r1', source_clip_name: 'A001_C002.mov' }]; // raw = no proxy
  const sel = 'A001_C002_Proxy.mov'; // selects carries _Proxy (the reverse case)
  const oldHit = oldLookup(oldBuild(raw), sel);
  ok('RED: old matcher MISSES a _Proxy-carrying selects name', oldHit === null);
  const newHit = findRawMatch(buildRawUnitMatcher(raw), sel);
  ok('GREEN: new matcher FINDS it via no-_Proxy normalization', newHit && newHit.id === 'r1');
}

// ── clipMatchKeys units ────────────────────────────────────────────────────────
ok('keys: original name → [full, noExt] (no proxy → dedupes to 2)',
  eq(clipMatchKeys('A001.mov'), ['A001.mov', 'A001']));
ok('keys: proxy name → 4 distinct variants',
  eq(clipMatchKeys('A001_Proxy.mov'), ['A001_Proxy.mov', 'A001_Proxy', 'A001.mov', 'A001']));
ok('keys: no-extension name → just itself', eq(clipMatchKeys('clipname'), ['clipname']));
ok('keys: no-ext proxy → [full, noProxy]', eq(clipMatchKeys('A001_Proxy'), ['A001_Proxy', 'A001']));
ok('keys: _Proxy case-insensitive', eq(clipMatchKeys('A001_proxy.MP4'), ['A001_proxy.MP4', 'A001_proxy', 'A001.MP4', 'A001']));
ok('keys: non-string → []', eq(clipMatchKeys(null), []) && eq(clipMatchKeys(undefined), []) && eq(clipMatchKeys(123), []));
ok('keys: empty string → []', eq(clipMatchKeys(''), []));
ok('keys: dedupes when variants collide', eq(clipMatchKeys('A001'), ['A001']));

// ── NO-REGRESSION: documented direction matches old behavior exactly ───────────
// selects = Premiere original names (no _Proxy); raw = Dropbox _Proxy + maybe diff ext/case.
{
  const raw = [
    { id: 'r1', source_clip_name: 'A001_C002_Proxy.MP4' },
    { id: 'r2', source_clip_name: 'B007_C001.mov' },           // raw without proxy
    { id: 'r3', source_clip_name: 'C100_C009_Proxy.mov' },
  ];
  const oldM = oldBuild(raw);
  const newM = buildRawUnitMatcher(raw);
  const selectsNames = [
    'A001_C002.mov',   // original, ext differs from raw .MP4
    'A001_C002.MP4',   // original, same ext
    'A001_C002',       // no ext
    'B007_C001.mov',   // exact
    'B007_C001',       // no ext
    'C100_C009.mov',   // original of a proxy raw
    'Z999_NOMATCH.mov',// no match either way
  ];
  let allSame = true;
  for (const s of selectsNames) {
    const o = oldLookup(oldM, s);
    const n = findRawMatch(newM, s);
    const oId = o ? o.id : null, nId = n ? n.id : null;
    if (oId !== nId) { allSame = false; console.error(`  regress on "${s}": old=${oId} new=${nId}`); }
  }
  ok('NO-REGRESSION: documented direction → identical matches to old matcher', allSame);
}

// ── ADDITIVE WIN: reverse direction (selects carries _Proxy) now matches ───────
{
  const raw = [{ id: 'r1', source_clip_name: 'A001_C002.mov' }]; // raw = original
  const m = buildRawUnitMatcher(raw);
  ok('reverse: selects "A001_C002_Proxy.mov" → matches raw original', findRawMatch(m, 'A001_C002_Proxy.mov')?.id === 'r1');
  ok('reverse: selects "A001_C002_Proxy" (no ext) → matches', findRawMatch(m, 'A001_C002_Proxy')?.id === 'r1');
  ok('reverse: selects "A001_C002_proxy.MP4" (case+ext) → matches', findRawMatch(m, 'A001_C002_proxy.MP4')?.id === 'r1');
}

// ── findRawMatch edges ─────────────────────────────────────────────────────────
{
  const m = buildRawUnitMatcher([{ id: 'r1', source_clip_name: 'A001.mov' }]);
  ok('match: exact full name', findRawMatch(m, 'A001.mov')?.id === 'r1');
  ok('match: no-ext fallback', findRawMatch(m, 'A001')?.id === 'r1');
  ok('match: unknown → null', findRawMatch(m, 'ZZZ.mov') === null);
  ok('match: null matcher → null', findRawMatch(null, 'A001.mov') === null);
  ok('match: non-string selects → null', findRawMatch(m, null) === null);
}

// ── buildRawUnitMatcher robustness ─────────────────────────────────────────────
ok('build: empty/null units → empty map', buildRawUnitMatcher([]).size === 0 && buildRawUnitMatcher(null).size === 0);
ok('build: skips null units', findRawMatch(buildRawUnitMatcher([null, { id: 'r1', source_clip_name: 'A001.mov' }]), 'A001.mov')?.id === 'r1');
{
  // last-writer-wins on a shared variant key (preserves old .set semantics)
  const m = buildRawUnitMatcher([
    { id: 'first', source_clip_name: 'A001_Proxy.mov' },
    { id: 'second', source_clip_name: 'A001.mov' }, // shares the 'A001.mov' + 'A001' variant keys
  ]);
  ok('build: last-writer-wins on a shared variant key', findRawMatch(m, 'A001.mov')?.id === 'second');
}

console.log(`\nselects-crossref: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
