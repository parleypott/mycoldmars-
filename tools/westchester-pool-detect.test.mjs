// Lock for detectPinAmenities (public/westchester/index.html) — the pool/ADU
// amenity scanner on Johnny's ACTIVE house hunt. It mines a listing's
// compass.description + notes + title for a pool and drives the pool badge on
// every pin (formatExtrasCell).
//
// THE BUG IT LOCKS: the negative-keyword veto (POOL_NEG_RE: "pool table",
// "carpool", "cesspool", "no pool"...) used to be a BLANKET override — so a
// luxury home with a genuine "in-ground gunite pool" that ALSO mentioned a game
// room "pool table" was wrongly flagged NO POOL. Strong, unambiguous pool
// signals must WIN over the veto; the veto only guards the weak \bpool\b
// catch-all. Pools + game rooms co-occur constantly in his Westchester range.
//
// EXTRACTS the real shipped STRONG_POOL_RE / POOL_RE / POOL_NEG_RE / ADU_RE +
// detectPinAmenities from index.html at runtime (new Function), so the lock
// can't drift from a mirror.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// Extract the contiguous span: the four pool/ADU regex consts through the end of
// detectPinAmenities (they sit back-to-back in source), eval it, return the fn.
function loadReal() {
  const start = html.indexOf('const STRONG_POOL_RE');
  assert.ok(start >= 0, 'STRONG_POOL_RE not found');
  const fnStart = html.indexOf('function detectPinAmenities(p) {', start);
  assert.ok(fnStart >= 0, 'detectPinAmenities not found');
  let i = html.indexOf('{', fnStart), depth = 0, end = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, 'could not brace-match detectPinAmenities');
  const src = html.slice(start, end);
  return new Function(`${src}\n return detectPinAmenities;`)();
}

const detectPinAmenities = loadReal();
const pool = (description) => detectPinAmenities({ compass: { description } }).hasPool;
const adu = (description) => detectPinAmenities({ compass: { description } }).hasAdu;

let pass = 0, fail = 0;
const eq = (got, exp, msg) => { if (got === exp) pass++; else { fail++; console.error(`FAIL: ${msg} — expected ${exp}, got ${got}`); } };

// ── INLINE RED PROOF: the OLD blanket-veto logic flags a real pool as no-pool ──
// Reconstruct the pre-fix condition (POOL_RE && !POOL_NEG_RE) and prove it WRONGLY
// vetoes a genuine in-ground pool that co-mentions a pool table — while the shipped
// fn (strong signal wins) correctly reports a pool.
{
  const POOL_RE = /\b(in[-\s]?ground pool|swimming pool|gunite pool|heated pool|saltwater pool|\bpool\b)/i;
  const POOL_NEG_RE = /\b(no pool|without (?:a )?pool|car ?pool|liverpool|pool table|cesspool)\b/i;
  const oldPool = (t) => POOL_RE.test(t) && !POOL_NEG_RE.test(t);
  const t = 'Beautiful in-ground gunite pool. Finished basement with pool table.';
  eq(oldPool(t), false, 'RED PROOF: old blanket-veto logic flags real pool as no-pool');
  eq(pool(t), true, 'RED PROOF: shipped fn correctly reports the pool (strong signal wins)');
}

// ── THE FIX: a strong pool signal WINS even with a negative keyword present ──
eq(pool('Beautiful in-ground gunite pool. Finished basement with pool table.'), true, 'in-ground pool + pool table → pool');
eq(pool('Sparkling swimming pool and game room with a pool table.'), true, 'swimming pool + pool table → pool');
eq(pool('Heated saltwater pool overlooking the valley. Billiards/pool table in den.'), true, 'saltwater pool + pool table → pool');
eq(pool('Stunning gunite pool; basement has a pool table and bar.'), true, 'gunite pool + pool table → pool');
eq(pool('In-ground pool. No pool heater included.'), true, 'in-ground pool wins over "no pool" phrase');

// ── NEGATIVE VETO STILL GUARDS THE WEAK \bpool\b CATCH-ALL (no regression) ──
eq(pool('Den has a pool table.'), false, 'pool table only → no pool');
eq(pool('Spacious home, no pool but room for one.'), false, '"no pool" → no pool');
eq(pool('Quiet carpool-friendly cul-de-sac.'), false, 'carpool → no pool');
eq(pool('Convenient car pool lane access.'), false, 'car pool → no pool');
eq(pool('Just off Liverpool Road.'), false, 'liverpool → no pool');
eq(pool('Cesspool requires replacement.'), false, 'cesspool → no pool');
eq(pool('Lovely lot, but without a pool.'), false, '"without a pool" → no pool');

// ── WEAK \bpool\b STILL DETECTED WHEN NO VETO PRESENT (no regression) ──
eq(pool('Lovely backyard with a pool.'), true, 'bare "pool" → pool');
eq(pool('Gorgeous home. Pool. Patio.'), true, 'standalone "Pool." → pool');
eq(pool('Resort-style pool and spa.'), true, 'pool + spa → pool');

// ── NO POOL MENTION AT ALL ──
eq(pool('Charming colonial, 4 beds, hardwood floors.'), false, 'no pool mention → no pool');
eq(pool(''), false, 'empty → no pool');

// ── STRONG SIGNAL VARIANTS (each unambiguous form) ──
eq(pool('inground pool with deck'), true, 'inground (no hyphen) pool');
eq(pool('in-ground pool'), true, 'in-ground pool');
eq(pool('in ground pool'), true, 'in ground pool (space)');
eq(pool('private heated pool'), true, 'heated pool');

// ── ADU detection unaffected by the pool fix ──
eq(adu('In-ground pool with a charming guest cottage.'), true, 'guest cottage → ADU (independent)');
eq(adu('Pool table in the den.'), false, 'pool table → no ADU');
eq(adu('Includes an accessory dwelling unit over the garage.'), true, 'accessory dwelling → ADU');
eq(adu('Pool house by the saltwater pool.'), true, 'pool house → ADU');

// ── manual override still wins over the text scan ──
eq(detectPinAmenities({ compass: { description: 'in-ground pool' }, hasPool: false }).hasPool, false, 'manual hasPool:false override wins');
eq(detectPinAmenities({ compass: { description: 'no pool here' }, hasPool: true }).hasPool, true, 'manual hasPool:true override wins');
eq(detectPinAmenities({ notes: 'gunite pool', hasAdu: true }).hasAdu, true, 'manual hasAdu:true override wins');

// ── reads all three text sources ──
eq(detectPinAmenities({ notes: 'in-ground pool out back' }).hasPool, true, 'pool from notes');
eq(detectPinAmenities({ compass: { title: 'Estate w/ swimming pool' } }).hasPool, true, 'pool from title');
eq(detectPinAmenities({}).hasPool, false, 'empty pin → no pool, no throw');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
