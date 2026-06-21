// Lock for normalizeStateAbbrev (public/westchester/index.html) — the state
// abbreviation contract on Johnny's ACTIVE house hunt. Nominatim returns full
// state names; this function maps them to USPS codes for the table/popup address
// display (pinAddressParts) and the geocode. An incomplete US_STATE_ABBREV map
// fell through to an initials fallback that produced WRONG, COLLIDING abbrevs.
//
// EXTRACTS the real shipped US_STATE_ABBREV + normalizeStateAbbrev from index.html
// at runtime (new Function) so the lock can't drift from a mirror.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// Pull the const US_STATE_ABBREV = { ... }; block + the function body.
function extractBlock(src, startMarker) {
  const at = src.indexOf(startMarker);
  assert.ok(at >= 0, `marker not found: ${startMarker}`);
  // find the matching close for the first { after the marker, OR the function body
  return at;
}

// Build a sandbox that defines the real US_STATE_ABBREV then normalizeStateAbbrev.
function loadReal() {
  const mapStart = html.indexOf('const US_STATE_ABBREV = {');
  assert.ok(mapStart >= 0, 'US_STATE_ABBREV not found');
  const mapEnd = html.indexOf('};', mapStart) + 2;
  const mapSrc = html.slice(mapStart, mapEnd);

  const fnStart = html.indexOf('function normalizeStateAbbrev(s) {', mapEnd);
  assert.ok(fnStart >= 0, 'normalizeStateAbbrev not found');
  // brace-match the function body
  let i = html.indexOf('{', fnStart);
  let depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, 'could not brace-match normalizeStateAbbrev');
  const fnSrc = html.slice(fnStart, end);

  const factory = new Function(`${mapSrc}\n${fnSrc}\n return { US_STATE_ABBREV, normalizeStateAbbrev };`);
  return factory();
}

const { US_STATE_ABBREV, normalizeStateAbbrev } = loadReal();

// The canonical USPS truth — all 50 states + DC.
const USPS = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('✗', name, '—', e.message); } };

// ── Inline RED proof: the OLD 15-entry map + initials fallback got these wrong ──
const OLD_MAP = {
  'new york': 'NY', 'connecticut': 'CT', 'new jersey': 'NJ', 'pennsylvania': 'PA',
  'massachusetts': 'MA', 'rhode island': 'RI', 'vermont': 'VT', 'new hampshire': 'NH',
  'maine': 'ME', 'maryland': 'MD', 'delaware': 'DE', 'virginia': 'VA',
  'california': 'CA', 'florida': 'FL', 'texas': 'TX',
};
function oldNormalize(s) {
  const v = String(s || '').trim();
  if (!v) return '';
  if (v.length === 2) return v.toUpperCase();
  const lower = v.toLowerCase();
  if (OLD_MAP[lower]) return OLD_MAP[lower];
  const initials = v.split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2);
  return initials || v.toUpperCase().slice(0, 2);
}
t('RED PROOF: old map gave broken (single-letter / wrong) abbrevs for unmapped states', () => {
  // One-word states fell to initials-of-words = a SINGLE LETTER (not a USPS code):
  assert.strictEqual(oldNormalize('Nevada'), 'N');      // should be NV
  assert.strictEqual(oldNormalize('Arizona'), 'A');     // should be AZ
  assert.strictEqual(oldNormalize('Alaska'), 'A');      // should be AK
  assert.strictEqual(oldNormalize('Missouri'), 'M');    // should be MO
  assert.strictEqual(oldNormalize('Tennessee'), 'T');   // should be TN
  assert.strictEqual(oldNormalize('Kentucky'), 'K');    // should be KY
  assert.strictEqual(oldNormalize('Georgia'), 'G');     // should be GA
  assert.strictEqual(oldNormalize('Iowa'), 'I');        // should be IA
  // and the shipped (fixed) function gets every one of these RIGHT:
  for (const s of ['Nevada','Arizona','Alaska','Missouri','Tennessee','Kentucky','Georgia','Iowa'])
    assert.strictEqual(normalizeStateAbbrev(s), USPS[s], `${s} should be ${USPS[s]}`);
});

// ── The 50-state + DC sweep (the winnability contract) ──
for (const [name, code] of Object.entries(USPS)) {
  t(`full name "${name}" → ${code}`, () => {
    assert.strictEqual(normalizeStateAbbrev(name), code);
    assert.strictEqual(normalizeStateAbbrev(name.toLowerCase()), code, 'case-insensitive');
    assert.strictEqual(normalizeStateAbbrev(name.toUpperCase()), code, 'uppercase');
    assert.strictEqual(normalizeStateAbbrev('  ' + name + '  '), code, 'trimmed');
  });
}

// ── Map completeness + no internal collisions ──
t('map covers all 50 states + DC', () => {
  for (const name of Object.keys(USPS))
    assert.ok(US_STATE_ABBREV[name.toLowerCase()] === USPS[name], `missing/wrong: ${name}`);
  assert.strictEqual(Object.keys(US_STATE_ABBREV).length, 51, 'exactly 50 states + DC');
});
t('every shipped abbreviation is unique (no collisions)', () => {
  const codes = Object.values(US_STATE_ABBREV);
  assert.strictEqual(new Set(codes).size, codes.length, 'duplicate abbreviation in map');
});

// ── No-regression: 2-letter passthrough + empty/unknown behavior unchanged ──
t('2-letter code passthrough (uppercased)', () => {
  assert.strictEqual(normalizeStateAbbrev('ny'), 'NY');
  assert.strictEqual(normalizeStateAbbrev('CT'), 'CT');
  assert.strictEqual(normalizeStateAbbrev('nj'), 'NJ');
});
t('empty / nullish → empty string', () => {
  assert.strictEqual(normalizeStateAbbrev(''), '');
  assert.strictEqual(normalizeStateAbbrev(null), '');
  assert.strictEqual(normalizeStateAbbrev(undefined), '');
  assert.strictEqual(normalizeStateAbbrev('   '), '');
});
t('truly-unknown input still falls back without throwing', () => {
  // garbage / typo input is not in the map → initials fallback, never throws
  assert.strictEqual(normalizeStateAbbrev('Westchester'), 'W');
  assert.strictEqual(normalizeStateAbbrev('Some Place'), 'SP');
});

// ── "State ZIP" tail (the bug): pinAddressParts' fallback parse splits a pin's
// address string on commas, so segs[2] is the standard US "State ZIP" tail
// ("..., Bedford, NY 10506"). The OLD code fed that whole chunk into the map /
// initials fallback → "NY 10506" → "N1", "Connecticut 06830" → "C0",
// "Washington 98101" → "W9". A garbage code that ALSO !== 'NY', so a NY home
// got wrongly flagged + shown as out-of-state. The fix strips the trailing ZIP.
t('RED PROOF: old normalize mangled a "State ZIP" tail into a garbage code', () => {
  assert.strictEqual(oldNormalize('NY 10506'), 'N1');        // should be NY
  assert.strictEqual(oldNormalize('CT 06830'), 'C0');        // should be CT
  assert.strictEqual(oldNormalize('Connecticut 06830'), 'C0'); // should be CT
  assert.strictEqual(oldNormalize('Washington 98101'), 'W9');  // should be WA
  // shipped (fixed) fn resolves the state correctly:
  assert.strictEqual(normalizeStateAbbrev('NY 10506'), 'NY');
  assert.strictEqual(normalizeStateAbbrev('CT 06830'), 'CT');
  assert.strictEqual(normalizeStateAbbrev('Connecticut 06830'), 'CT');
  assert.strictEqual(normalizeStateAbbrev('Washington 98101'), 'WA');
});
t('2-letter code + ZIP → the code (the common Westchester/CT shape)', () => {
  assert.strictEqual(normalizeStateAbbrev('NY 10506'), 'NY');
  assert.strictEqual(normalizeStateAbbrev('ny 10514'), 'NY');
  assert.strictEqual(normalizeStateAbbrev('CT 06830'), 'CT');
  assert.strictEqual(normalizeStateAbbrev('NJ 07601'), 'NJ');
});
t('full state name + ZIP → the code (incl. ZIP+4)', () => {
  assert.strictEqual(normalizeStateAbbrev('New York 10506'), 'NY');
  assert.strictEqual(normalizeStateAbbrev('Connecticut 06830'), 'CT');
  assert.strictEqual(normalizeStateAbbrev('NY 10506-1234'), 'NY');
  assert.strictEqual(normalizeStateAbbrev('North Carolina 27514'), 'NC');
  assert.strictEqual(normalizeStateAbbrev('Washington 98101'), 'WA');
});
t('every state + a ZIP tail resolves to its USPS code', () => {
  for (const [name, code] of Object.entries(USPS))
    assert.strictEqual(normalizeStateAbbrev(`${name} 12345`), code, `${name} 12345 should be ${code}`);
});
t('no-regression: a bare/partial ZIP is NOT stripped (no leading-space full ZIP)', () => {
  // bare "10506" has no leading whitespace before 5 digits → unchanged ("1", as before)
  assert.strictEqual(normalizeStateAbbrev('10506'), '1');
  // a 3-digit partial is not a ZIP → unchanged ("N1", as before)
  assert.strictEqual(normalizeStateAbbrev('NY 123'), 'N1');
});

console.log(`\nwestchester-state-abbrev: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
