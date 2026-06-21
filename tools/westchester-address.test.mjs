// Lock for the Westchester House Hunter ADDRESS-DISPLAY contract
// (public/westchester/index.html) — runs on EVERY pin render on Johnny's
// ACTIVE house hunt. pinAddressParts splits a pin into {street, place, state}
// (street-number + road abbreviation, addrParts vs comma-split fallback, place
// cleaning); formatPinAddress is the one-line popup/select form with the
// out-of-state flag (CT shows, NY hidden); formatPinAddressHtml is the two-line
// table cell (escaped). Only the sub-helper normalizeStateAbbrev was previously
// locked — the road-abbrev + NY-suppression + HTML-escape logic was untested.
//
// EXTRACTS the real shipped functions + US_STATE_ABBREV from index.html at
// runtime (new Function) so the lock can't drift from a hand-copied mirror.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, '..', 'public', 'westchester', 'index.html');

function loadReal(src) {
  // Brace-match a `function NAME(` body.
  function fn(name) {
    const s = src.indexOf('function ' + name + '(');
    assert.ok(s >= 0, 'function not found: ' + name);
    let i = src.indexOf('{', s), d = 0, e = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') { d--; if (d === 0) { e = i + 1; break; } }
    }
    assert.ok(e > 0, 'could not brace-match: ' + name);
    return src.slice(s, e);
  }
  // Brace-match a `const NAME = { ... };` block.
  function blk(marker) {
    const s = src.indexOf(marker);
    assert.ok(s >= 0, 'block not found: ' + marker);
    let i = src.indexOf('{', s), d = 0, e = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') { d--; if (d === 0) { e = i + 1; break; } }
    }
    assert.ok(e > 0, 'could not brace-match block: ' + marker);
    return src.slice(s, e + 1); // include the trailing brace (";" optional)
  }
  const map = blk('const US_STATE_ABBREV = {');
  const fns = ['cleanPlace', 'normalizeStateAbbrev', 'escapeHtml',
    'pinAddressParts', 'formatPinAddress', 'formatPinAddressHtml'].map(fn).join('\n');
  const factory = new Function(
    `${map}\n${fns}\n return { pinAddressParts, formatPinAddress, formatPinAddressHtml, cleanPlace, normalizeStateAbbrev, escapeHtml };`
  );
  return factory();
}

const html = readFileSync(HTML_PATH, 'utf8');
const R = loadReal(html);

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗', name); } }
function eq(name, a, b) { ok(name + ` (got ${JSON.stringify(a)})`, a === b); }

// ───────── inline RED proof: a no-NY-suppression formatPinAddress would SHOW
// "NY", defeating the out-of-state flag the comment promises. ─────────
{
  const oldFormat = (pin) => {
    const { street, place, state } = R.pinAddressParts(pin);
    const parts = [street, place].filter(Boolean);
    if (state) parts.push(state); // BUG: no `!== 'NY'` guard
    return parts.join(', ');
  };
  const ny = { addrParts: { road: 'Main St', city: 'Bedford', state: 'New York' } };
  ok('RED proof: unsuppressed format LEAKS "NY"', /,\s*NY$/.test(oldFormat(ny)));
  ok('RED proof: shipped format HIDES "NY"', !/NY/.test(R.formatPinAddress(ny)));
}

// ───────── pinAddressParts: addrParts path ─────────
{
  const p = R.pinAddressParts({ addrParts: {
    house_number: '123', road: 'West Main Street', village: 'Village of Scarsdale', state_code: 'NY' } });
  eq('addrParts street: number + abbreviated road', p.street, '123 W Main ST');
  eq('addrParts place: Village-of stripped', p.place, 'Scarsdale');
  eq('addrParts state: NY', p.state, 'NY');
}
{
  // road parsed out of a.street when no a.road
  const p = R.pinAddressParts({ addrParts: { street: '45 Old Post Road', town: 'Bedford', state: 'New York' } });
  eq('street-parse: house number split out', p.street, '45 Old Post RD');
  eq('street-parse: place', p.place, 'Bedford');
  eq('street-parse: state NY', p.state, 'NY');
}
{
  // directional + street-type abbreviation
  const p = R.pinAddressParts({ addrParts: { road: 'North Bedford Avenue', city: 'Mount Kisco', state_code: 'NY' } });
  eq('abbrev: North→N, Avenue→AVE', p.street, 'N Bedford AVE');
}
{
  // place fallback chain village→town→city→hamlet
  eq('place: town fallback', R.pinAddressParts({ addrParts: { road: 'A Rd', town: 'Rye', state: 'New York' } }).place, 'Rye');
  eq('place: city fallback', R.pinAddressParts({ addrParts: { road: 'A Rd', city: 'Rye', state: 'New York' } }).place, 'Rye');
  eq('place: hamlet fallback', R.pinAddressParts({ addrParts: { road: 'A Rd', hamlet: 'Katonah', state: 'New York' } }).place, 'Katonah');
}

// ───────── pinAddressParts: comma-split FALLBACK (legacy pins, no addrParts) ─────────
{
  const p = R.pinAddressParts({ address: '5 Maple Drive, Village of Chappaqua, NY 10514' });
  eq('fallback street: seg0 raw', p.street, '5 Maple Drive');
  eq('fallback place: cleaned', p.place, 'Chappaqua');
  eq('fallback state: ZIP stripped → NY', p.state, 'NY');
}
{
  const p = R.pinAddressParts({ address: '8 High St, Greenwich, Connecticut 06830' });
  eq('fallback CT: state from full name', p.state, 'CT');
}
{
  // uses pin.display when address absent
  const p = R.pinAddressParts({ display: '9 Elm Ct, Bedford, NY' });
  eq('fallback uses pin.display', p.street, '9 Elm Ct');
}
{
  const p = R.pinAddressParts({});
  eq('empty pin: street ""', p.street, '');
  eq('empty pin: place ""', p.place, '');
  eq('empty pin: state ""', p.state, '');
}

// ───────── formatPinAddress: out-of-state flag (the load-bearing contract) ─────────
eq('format: CT shows (out-of-state)',
  R.formatPinAddress({ addrParts: { road: 'Old Post Road', town: 'Greenwich', state: 'Connecticut' } }),
  'Old Post RD, Greenwich, CT');
eq('format: NY hidden',
  R.formatPinAddress({ addrParts: { road: 'Main St', city: 'Bedford', state: 'New York' } }),
  'Main St, Bedford');
eq('format: NJ shows',
  R.formatPinAddress({ addrParts: { road: 'Park Avenue', city: 'Tenafly', state: 'New Jersey' } }),
  'Park AVE, Tenafly, NJ');
eq('format: street only (no place/state)',
  R.formatPinAddress({ addrParts: { road: 'Lone Road' } }), 'Lone RD');
eq('format: empty pin → ""', R.formatPinAddress({}), '');

// ───────── formatPinAddressHtml: two-line + escape + NY suppression ─────────
{
  const h = R.formatPinAddressHtml({ addrParts: { house_number: '12', road: 'Main Street', city: 'Bedford', state_code: 'NY' } });
  ok('html: addr-street div', h.includes('<div class="addr-street">12 Main ST</div>'));
  ok('html: addr-sub has place', h.includes('Bedford'));
  ok('html: NY not in sub', !/>.*NY.*</.test(h) && !h.includes(', NY'));
}
{
  const h = R.formatPinAddressHtml({ addrParts: { road: 'Sea Rd', town: 'Greenwich', state: 'Connecticut' } });
  ok('html: CT shows in sub', h.includes('CT'));
}
{
  // escaping — a malicious/odd street must be entity-escaped
  const h = R.formatPinAddressHtml({ address: '5 A&B <b>Ln, Bedford, NY' });
  ok('html: & escaped', h.includes('A&amp;B'));
  ok('html: < escaped', h.includes('&lt;b&gt;'));
  ok('html: no raw <b>', !h.includes('<b>'));
}
{
  // no place/state → no sub div
  const h = R.formatPinAddressHtml({ addrParts: { road: 'Lone Rd' } });
  ok('html: no sub div when place+state empty', !h.includes('addr-sub'));
}

// ───────── cleanPlace + escapeHtml units ─────────
eq('cleanPlace strips "Town of"', R.cleanPlace('Town of Rye'), 'Rye');
eq('cleanPlace strips "Hamlet of"', R.cleanPlace('Hamlet of Katonah'), 'Katonah');
eq('cleanPlace leaves plain', R.cleanPlace('Scarsdale'), 'Scarsdale');
eq('cleanPlace empty', R.cleanPlace(''), '');
eq('escapeHtml all 5', R.escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
eq('escapeHtml null → ""', R.escapeHtml(null), '');

// ───────── MUTATION PROOF: prove the test catches each regression ─────────
// (re-load mutated source and assert the suite would have failed)
function mutatedFails(mutate, label) {
  const m = loadReal(mutate(html));
  return m;
}
let mutCaught = 0;
// M1: drop the NY-suppression guard in formatPinAddress
try {
  const M = mutatedFails(s => s.replace(
    "if (state && state !== 'NY') parts.push(state);",
    "if (state) parts.push(state);"));
  const leaks = /NY/.test(M.formatPinAddress({ addrParts: { road: 'Main St', city: 'Bedford', state: 'New York' } }));
  ok('MUT M1: dropping NY-suppression is detectable', leaks); if (leaks) mutCaught++;
} catch (e) { console.error('M1 mutate failed', e.message); fail++; }
// M2: drop street-type abbreviation
try {
  const M = mutatedFails(s => s.replace(
    /road = road\.replace\(\/\\b\(Lane\|Street\|Road[^;]*;/,
    'road = road;'));
  const unabbrev = R.pinAddressParts({ addrParts: { road: 'Main Street', city: 'Bedford', state_code: 'NY' } }).street;
  const mutStreet = M.pinAddressParts({ addrParts: { road: 'Main Street', city: 'Bedford', state_code: 'NY' } }).street;
  const detect = unabbrev !== mutStreet; // shipped abbreviates, mutant doesn't
  ok('MUT M2: dropping street-type abbrev is detectable', detect); if (detect) mutCaught++;
} catch (e) { console.error('M2 mutate failed', e.message); fail++; }
// M3: drop escapeHtml on the street in formatPinAddressHtml
try {
  const M = mutatedFails(s => s.replace(
    '<div class="addr-street">${escapeHtml(street)}</div>',
    '<div class="addr-street">${street}</div>'));
  const raw = M.formatPinAddressHtml({ address: '<b>x, Bedford, NY' });
  const detect = raw.includes('<b>x'); // mutant leaks raw markup
  ok('MUT M3: dropping street escape is detectable', detect); if (detect) mutCaught++;
} catch (e) { console.error('M3 mutate failed', e.message); fail++; }
// M4: break cleanPlace ("Village of" no longer stripped)
try {
  const M = mutatedFails(s => s.replace(
    "/^(Village|Town|City|Hamlet|Township|Borough)\\s+of\\s+/i, ''",
    "/__never__/i, ''"));
  const detect = M.cleanPlace('Village of Scarsdale') === 'Village of Scarsdale';
  ok('MUT M4: breaking cleanPlace is detectable', detect); if (detect) mutCaught++;
} catch (e) { console.error('M4 mutate failed', e.message); fail++; }

ok('MUTATION: all 4 source mutations detected', mutCaught === 4);

console.log(`\nwestchester-address: ${pass} passed, ${fail} failed (mutations caught: ${mutCaught}/4)`);
if (fail > 0) process.exit(1);
