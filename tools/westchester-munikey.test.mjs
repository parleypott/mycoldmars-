// Lock for detectMuniKey (public/westchester/index.html) — the address→municipality
// mapper on Johnny's ACTIVE house hunt. Nominatim returns a parsed address; this
// function maps it to a TAX_DATA key, and that key drives the property-tax rate in
// computePinMonthly (the all-in monthly cost he compares houses by). If a returned
// key isn't in TAX_DATA, computePinMonthly silently returns null → NO monthly cost
// shown for that house. So the load-bearing contract is twofold:
//   (1) each place token maps to the right municipality, and
//   (2) every key detectMuniKey can return EXISTS in TAX_DATA (no silent null).
//
// No live bug found (all 9 returns are valid TAX_DATA keys) — this is a verifier-
// layer LOCK, same standard as the westchester-geo / monthly / sort / address /
// state-abbrev locks. EXTRACTS the real shipped detectMuniKey + TAX_DATA from
// index.html at runtime (new Function) so the lock can't drift from a mirror.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

function braceMatch(src, from) {
  let i = src.indexOf('{', from), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

function loadReal() {
  // const TAX_DATA = { ... }; — pure literals, safe to eval
  const tdStart = html.indexOf('const TAX_DATA = {');
  assert.ok(tdStart >= 0, 'TAX_DATA not found');
  const tdEnd = braceMatch(html, tdStart);
  assert.ok(tdEnd > 0, 'could not brace-match TAX_DATA');
  const tdSrc = html.slice(tdStart, tdEnd) + ';';

  const fnStart = html.indexOf('function detectMuniKey(addr) {');
  assert.ok(fnStart >= 0, 'detectMuniKey not found');
  const fnEnd = braceMatch(html, fnStart);
  assert.ok(fnEnd > 0, 'could not brace-match detectMuniKey');
  const fnSrc = html.slice(fnStart, fnEnd);

  const factory = new Function(`${tdSrc}\n${fnSrc}\n return { TAX_DATA, detectMuniKey };`);
  return factory();
}

const { TAX_DATA, detectMuniKey } = loadReal();
const W = 'Westchester County'; // the required county gate

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('✗', name, '—', e.message); } };

// ── The place-token → muni-key mapping (one representative address per branch) ──
// Each row: place token(s) Nominatim might return, and the muni key it must map to.
const CASES = [
  ['irvington',        { county: W, village: 'Irvington' },         'greenburgh_irvington_village'],
  ['pleasantville',    { county: W, village: 'Pleasantville' },     'mount_pleasant_pleasantville_village'],
  ['sleepy hollow',    { county: W, village: 'Sleepy Hollow' },     'mount_pleasant_sleepy_hollow_village'],
  ['briarcliff',       { county: W, village: 'Briarcliff Manor' },  'ossining_briarcliff_manor_village'],
  ['mount kisco',      { county: W, town: 'Mount Kisco' },          'north_castle_mount_kisco_village'],
  ['mt kisco (alias)', { county: W, city: 'Mt Kisco' },             'north_castle_mount_kisco_village'],
  ['valhalla',         { county: W, hamlet: 'Valhalla' },           'mount_pleasant_unincorporated'],
  ['hawthorne',        { county: W, hamlet: 'Hawthorne' },          'mount_pleasant_unincorporated'],
  ['thornwood',        { county: W, hamlet: 'Thornwood' },          'mount_pleasant_unincorporated'],
  ['chappaqua',        { county: W, hamlet: 'Chappaqua' },          'new_castle_chappaqua'],
  ['armonk',           { county: W, hamlet: 'Armonk' },             'north_castle_unincorporated_armonk'],
  ['edgemont',         { county: W, hamlet: 'Edgemont' },           'greenburgh_unincorporated'],
  ['hartsdale',        { county: W, hamlet: 'Hartsdale' },          'greenburgh_unincorporated'],
  ['ardsley',          { county: W, village: 'Ardsley' },           'greenburgh_unincorporated'],
  ['dobbs ferry',      { county: W, village: 'Dobbs Ferry' },       'greenburgh_unincorporated'],
];

for (const [label, addr, key] of CASES) {
  t(`maps "${label}" → ${key}`, () => {
    assert.strictEqual(detectMuniKey(addr), key);
  });
}

// ── THE CONSISTENCY CONTRACT (the high-value lock) ──
// Every key detectMuniKey can return MUST exist in TAX_DATA, or computePinMonthly
// silently returns null (no monthly cost shown). Collect every key the mapping
// emits across all branches and assert each is a real TAX_DATA key.
t('every key detectMuniKey returns EXISTS in TAX_DATA (no silent-null monthly)', () => {
  const returned = new Set(CASES.map(([, addr]) => detectMuniKey(addr)));
  assert.ok(returned.size >= 9, `expected ≥9 distinct muni keys, got ${returned.size}`);
  for (const k of returned) {
    assert.ok(k && TAX_DATA[k], `detectMuniKey returned "${k}" which is NOT in TAX_DATA → monthly would null`);
    assert.ok(typeof TAX_DATA[k].effectiveRate === 'number', `TAX_DATA["${k}"] has no effectiveRate`);
  }
});

// ── Inline RED proof: a typo'd return key would silently null the monthly ──
// (reconstruct the failure the consistency lock guards against)
t('RED PROOF: a key not in TAX_DATA breaks the monthly contract', () => {
  function buggyDetect(addr) {
    if (!addr) return null;
    const place = [(addr.village||''),(addr.town||''),(addr.city||''),(addr.hamlet||'')].join(' ').toLowerCase();
    if (!String(addr.county||'').toLowerCase().includes('westchester')) return null;
    if (place.includes('irvington')) return 'greenburgh_irvington_villageX'; // typo
    return null;
  }
  const k = buggyDetect({ county: W, village: 'Irvington' });
  assert.strictEqual(k, 'greenburgh_irvington_villageX');
  assert.ok(!TAX_DATA[k], 'buggy typo key must NOT be in TAX_DATA (would null the monthly)');
  // the shipped function gets it right:
  assert.ok(TAX_DATA[detectMuniKey({ county: W, village: 'Irvington' })], 'shipped key IS in TAX_DATA');
});

// ── The county gate ──
t('non-Westchester county → null (gate)', () => {
  assert.strictEqual(detectMuniKey({ county: 'Fairfield County', village: 'Irvington' }), null);
  assert.strictEqual(detectMuniKey({ county: 'Putnam County', hamlet: 'Armonk' }), null);
});
t('missing county → null (gate, county is required)', () => {
  assert.strictEqual(detectMuniKey({ village: 'Irvington' }), null);
});
t('county match is case-insensitive + substring', () => {
  assert.strictEqual(detectMuniKey({ county: 'westchester', village: 'Irvington' }), 'greenburgh_irvington_village');
  assert.strictEqual(detectMuniKey({ county: 'WESTCHESTER COUNTY', village: 'Chappaqua' }), 'new_castle_chappaqua');
});

// ── Null / unknown / empty cases ──
t('null / undefined addr → null', () => {
  assert.strictEqual(detectMuniKey(null), null);
  assert.strictEqual(detectMuniKey(undefined), null);
});
t('Westchester county but unknown place → null (no false muni)', () => {
  assert.strictEqual(detectMuniKey({ county: W, village: 'Scarsdale' }), null);
  assert.strictEqual(detectMuniKey({ county: W, city: 'Yonkers' }), null);
  assert.strictEqual(detectMuniKey({ county: W }), null); // no place tokens at all
});

// ── Place can arrive in ANY of the four address fields ──
t('place token recognized regardless of which address field carries it', () => {
  assert.strictEqual(detectMuniKey({ county: W, village: 'Chappaqua' }), 'new_castle_chappaqua');
  assert.strictEqual(detectMuniKey({ county: W, town: 'Chappaqua' }), 'new_castle_chappaqua');
  assert.strictEqual(detectMuniKey({ county: W, city: 'Chappaqua' }), 'new_castle_chappaqua');
  assert.strictEqual(detectMuniKey({ county: W, hamlet: 'Chappaqua' }), 'new_castle_chappaqua');
});

// ── Document the latent coverage gap (NOT a bug — logged for Johnny) ──
// TAX_DATA carries an `ossining_town_unincorporated` bracket that detectMuniKey can
// never return: there's a Briarcliff branch but no plain-Ossining branch, so an
// unincorporated Ossining-town home falls through to null. This lock PINS that fact
// so a future edit that adds the branch is a deliberate, visible change.
t('LATENT GAP: ossining_town_unincorporated bracket exists but is unreachable by detectMuniKey', () => {
  assert.ok(TAX_DATA['ossining_town_unincorporated'], 'the bracket exists in TAX_DATA');
  // a plain Ossining-town home (not Briarcliff) currently maps to null:
  assert.strictEqual(detectMuniKey({ county: W, town: 'Ossining', hamlet: 'Ossining' }), null);
});

console.log(`\nwestchester-munikey: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
