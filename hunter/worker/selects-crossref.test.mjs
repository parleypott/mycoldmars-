// Lock for the selects → raw clip-name cross-reference matcher.
// Imports the REAL shipped functions. Proves the symmetric matching:
//  - documented direction (selects = original name) is byte-identical to the
//    OLD asymmetric inline matcher (zero regression);
//  - reverse direction (selects carries "_Proxy") now matches (the additive win).
import { clipMatchKeys, buildRawUnitMatcher, findRawMatch, buildClipNameKeySet, clipNameMatchesSet } from './selects-crossref.js';

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

// ── Set-membership matching (cross-tier-matching.mjs "which raw appear in selects?") ──
// Reconstruct the OLD inline asymmetric Set/membership test the helpers replace:
// the selects Set stored {full, no-extension} only (never stripping _Proxy); the
// raw side stripped _Proxy. So a proxy-edited selects sequence (clip names carry
// _Proxy, raw = camera originals without it) never matched.
function oldSetBuild(selectsUnits) {
  const s = new Set();
  for (const u of selectsUnits) {
    s.add(u.source_clip_name);
    s.add(u.source_clip_name.replace(/\.[^.]+$/, ''));
  }
  return s;
}
function oldSetHas(set, rawName) {
  const noProxy = rawName.replace(/_Proxy/i, '');
  const noExt = noProxy.replace(/\.[^.]+$/, '');
  return set.has(noProxy) || set.has(noExt);
}

// INLINE RED PROOF: proxy-editing direction — selects carries _Proxy, raw doesn't.
{
  const selectsUnits = [{ source_clip_name: 'A001_C002_Proxy.mov' }]; // edited with proxies
  const rawName = 'A001_C002.mov';                                     // camera original
  ok('RED: old Set membership MISSES proxy-edited selects ↔ original raw', oldSetHas(oldSetBuild(selectsUnits), rawName) === false);
  ok('GREEN: new Set membership FINDS it (symmetric _Proxy strip)', clipNameMatchesSet(buildClipNameKeySet(selectsUnits), rawName) === true);
}

// NO-REGRESSION: documented direction (selects = original, raw = _Proxy) — identical decisions.
{
  const selectsUnits = [
    { source_clip_name: 'A001_C002.mov' },
    { source_clip_name: 'B007_C001.mov' },
    { source_clip_name: 'C100_C009.MP4' },
  ];
  const oldSet = oldSetBuild(selectsUnits);
  const newSet = buildClipNameKeySet(selectsUnits);
  const rawNames = [
    'A001_C002_Proxy.MP4',  // raw proxy, ext differs — documented direction
    'A001_C002_Proxy.mov',  // raw proxy, same ext
    'A001_C002.mov',        // exact
    'B007_C001.mov',        // exact
    'C100_C009.MP4',        // exact
    'C100_C009_Proxy.mov',  // raw proxy of a .MP4 select
    'Z999_NOMATCH.mov',     // no match either way
    'UNRELATED.mov',        // no match
  ];
  let allSame = true;
  for (const r of rawNames) {
    const o = oldSetHas(oldSet, r), n = clipNameMatchesSet(newSet, r);
    if (o !== n) { allSame = false; console.error(`  set-regress on "${r}": old=${o} new=${n}`); }
  }
  ok('NO-REGRESSION: documented direction → identical kept/discarded decisions', allSame);
}

// ADDITIVE WIN: every reverse-direction variant now matches.
{
  const set = buildClipNameKeySet([{ source_clip_name: 'A001_C002_Proxy.mov' }]);
  ok('reverse-set: raw "A001_C002.mov" → matches proxy-edited selects', clipNameMatchesSet(set, 'A001_C002.mov') === true);
  ok('reverse-set: raw "A001_C002.MP4" (diff ext) → matches', clipNameMatchesSet(set, 'A001_C002.MP4') === true);
  ok('reverse-set: raw "A001_C002" (no ext) → matches', clipNameMatchesSet(set, 'A001_C002') === true);
  ok('reverse-set: unrelated raw → no match', clipNameMatchesSet(set, 'B999_X.mov') === false);
}

// buildClipNameKeySet / clipNameMatchesSet robustness.
ok('set-build: empty/null units → empty set', buildClipNameKeySet([]).size === 0 && buildClipNameKeySet(null).size === 0);
ok('set-build: skips null units', clipNameMatchesSet(buildClipNameKeySet([null, { source_clip_name: 'A001.mov' }]), 'A001.mov') === true);
ok('set-has: null set → false', clipNameMatchesSet(null, 'A001.mov') === false);
ok('set-has: non-string name → false', clipNameMatchesSet(buildClipNameKeySet([{ source_clip_name: 'A001.mov' }]), null) === false);
ok('set-build: a proxy-named unit indexes all 4 key variants',
  (() => { const s = buildClipNameKeySet([{ source_clip_name: 'A001_Proxy.mov' }]);
    return s.has('A001_Proxy.mov') && s.has('A001_Proxy') && s.has('A001.mov') && s.has('A001'); })());

console.log(`\nselects-crossref: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
