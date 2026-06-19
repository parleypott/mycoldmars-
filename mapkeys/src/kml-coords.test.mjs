// Coverage for the KML route-import coordinate extractor (mapkeys/src/kml-coords.js).
//
// Two real bugs are locked here:
//   1. gx:Track import was DEAD — getElementsByTagName('coord') never matched
//      the canonical <gx:coord> element, so every GPS-track KML imported as
//      zero coordinates and hit "No usable LineString".
//   2. The gx path pushed coords with no NaN guard, leaking [NaN, NaN] into the
//      route and poisoning every downstream distance.
//
// We parse real KML with @xmldom (browsers behave identically for XML docs —
// getElementsByTagName matches the qualified name) and drive the REAL shipped
// extractKmlCoords + token parsers.

import { DOMParser } from '@xmldom/xmldom';
import { extractKmlCoords, parseLineStringToken, parseGxCoordLine } from './kml-coords.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');

const GX_NS = 'xmlns:gx="http://www.google.com/kml/ext/2.2"';
const gxTrack = (coords) =>
  `<kml ${GX_NS}><Document><Placemark><gx:Track>${coords.map(c => `<gx:coord>${c}</gx:coord>`).join('')}</gx:Track></Placemark></Document></kml>`;
const lineString = (coordsText) =>
  `<kml><Document><Placemark><LineString><coordinates>${coordsText}</coordinates></LineString></Placemark></Document></kml>`;

// ── Inline RED proof: the OLD parseKML logic ───────────────────────────────
// Reconstructs the shipped-before behavior to prove it was genuinely broken.
function oldExtract(doc) {
  const out = [];
  const lineStrings = doc.getElementsByTagName('LineString');
  for (let i = 0; i < lineStrings.length; i++) {
    const coordEl = lineStrings[i].getElementsByTagName('coordinates')[0];
    if (!coordEl) continue;
    const tokens = coordEl.textContent.trim().split(/\s+/);
    for (const tok of tokens) {
      const parts = tok.split(',').map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) out.push([parts[0], parts[1]]);
    }
  }
  if (out.length === 0) {
    const coords = doc.getElementsByTagName('coord'); // the bug: never matches <gx:coord>
    for (let i = 0; i < coords.length; i++) {
      const parts = coords[i].textContent.trim().split(/\s+/).map(Number);
      if (parts.length >= 2) out.push([parts[0], parts[1]]); // the other bug: no NaN guard
    }
  }
  return out;
}

// RED 1: old logic drops the whole gx:Track.
{
  const doc = parse(gxTrack(['8.1 46.4 1200', '8.2 46.5 1210']));
  eq(oldExtract(parse(gxTrack(['8.1 46.4 1200', '8.2 46.5 1210']))), [], 'RED proof: old logic imports gx:Track as ZERO coords');
  eq(extractKmlCoords(doc), [[8.1, 46.4], [8.2, 46.5]], 'FIX: gx:Track now imports its coords');
}

// RED 2: old gx path (if it had matched) would push NaN; new path guards it.
{
  // A bare <coord> path with a malformed line — old code (no NaN guard) leaks NaN.
  const bare = '<kml><Document><Placemark><Track><coord>1 2 0</coord><coord>nope alsobad</coord><coord>3 4 0</coord></Track></Placemark></Document></kml>';
  const oldOut = oldExtract(parse(bare));
  ok(oldOut.some(c => Number.isNaN(c[0]) || Number.isNaN(c[1])), 'RED proof: old gx path leaks a NaN coord');
  eq(extractKmlCoords(parse(bare)), [[1, 2], [3, 4]], 'FIX: malformed gx coord line dropped, valid ones kept');
}

// ── gx:Track (the fix) ─────────────────────────────────────────────────────
eq(extractKmlCoords(parse(gxTrack(['8.1 46.4 1200']))), [[8.1, 46.4]], 'single gx:coord');
eq(extractKmlCoords(parse(gxTrack(['8.1 46.4 1200', '8.2 46.5 1210', '8.3 46.6 1220']))),
  [[8.1, 46.4], [8.2, 46.5], [8.3, 46.6]], 'multi gx:coord in order');
eq(extractKmlCoords(parse(gxTrack(['8.1 46.4']))), [[8.1, 46.4]], 'gx:coord without altitude');
ok(extractKmlCoords(parse(gxTrack(['8.1 46.4 1200', '8.2 46.5 1210']))).length === 2, 'gx:Track yields 2 (was 0 before fix)');

// gx:coord NaN / malformed guard
eq(extractKmlCoords(parse(gxTrack(['8.1 46.4 1200', 'garbage line', '8.3 46.6']))),
  [[8.1, 46.4], [8.3, 46.6]], 'gx: malformed line dropped');
eq(extractKmlCoords(parse(gxTrack(['', '8.1 46.4']))), [[8.1, 46.4]], 'gx: empty coord line dropped');
eq(extractKmlCoords(parse(gxTrack(['only-one'])).valueOf ? parse(gxTrack(['only-one'])) : parse(gxTrack(['only-one']))),
  [], 'gx: single-token line (no lat) dropped');

// ── LineString (must stay byte-identical to old behavior) ──────────────────
{
  const docs = [
    lineString('1,2,0 3,4,0'),
    lineString('1,2,0 3,4,0 5,6'),
    lineString('1,2,0 bad,token 5,6'),
    lineString('   2.5,3.5,10   4.5,5.5,10   '),
    lineString(''),
  ];
  for (const xml of docs) {
    eq(extractKmlCoords(parse(xml)), oldExtract(parse(xml)), `LineString parity: ${xml.slice(40, 70)}`);
  }
}
eq(extractKmlCoords(parse(lineString('1,2,0 3,4,0'))), [[1, 2], [3, 4]], 'LineString basic');
eq(extractKmlCoords(parse(lineString('1,2,0 bad,token 5,6,0'))), [[1, 2], [5, 6]], 'LineString drops NaN token');

// LineString wins over gx — a doc with BOTH only reads the LineString.
{
  const both = `<kml ${GX_NS}><Document><Placemark><LineString><coordinates>9,9,0 8,8,0</coordinates></LineString></Placemark><Placemark><gx:Track><gx:coord>1 1 0</gx:coord></gx:Track></Placemark></Document></kml>`;
  eq(extractKmlCoords(parse(both)), [[9, 9], [8, 8]], 'LineString present → gx fallback NOT used');
}

// ── token parsers (unit) ───────────────────────────────────────────────────
eq(parseLineStringToken('1,2,0'), [1, 2], 'parseLineStringToken: lng,lat,alt');
eq(parseLineStringToken('1.5,2.5'), [1.5, 2.5], 'parseLineStringToken: lng,lat');
eq(parseLineStringToken('1'), null, 'parseLineStringToken: single value → null');
eq(parseLineStringToken('a,b'), null, 'parseLineStringToken: non-numeric → null');
eq(parseLineStringToken(''), null, 'parseLineStringToken: empty → null');
eq(parseGxCoordLine('8.1 46.4 1200'), [8.1, 46.4], 'parseGxCoordLine: space-separated lon lat alt');
eq(parseGxCoordLine('  8.1   46.4  '), [8.1, 46.4], 'parseGxCoordLine: extra whitespace');
eq(parseGxCoordLine('8.1'), null, 'parseGxCoordLine: single value → null');
eq(parseGxCoordLine('garbage here'), null, 'parseGxCoordLine: non-numeric → null');
eq(parseGxCoordLine(''), null, 'parseGxCoordLine: empty → null');
eq(parseGxCoordLine('1,2'), null, 'parseGxCoordLine: comma-separated (wrong delimiter) → null');

console.log(`kml-coords: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  FAIL:', f); process.exit(1); }
