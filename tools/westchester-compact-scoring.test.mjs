// Lock for compactPinForScoring (public/westchester/index.html) — the payload
// builder that decides EXACTLY what data the AI scorer sees for each house on
// Johnny's ACTIVE Westchester hunt. scorePin() POSTs { pin: compactPinForScoring(pin),
// ... } to /api/whh-score; whh-score's buildPrompt (separately locked) consumes this
// shape. A dropped or mis-mapped field here silently scores every house on incomplete
// or wrong data, with no signal — so the field set + mappings are the load-bearing
// contract.
//
// No live bug found (all 17 fields map correctly: lotSqft←compass.lotSize,
// train.gctMin←train.gct, description capped at 600, monthlyAllIn←computePinMonthly,
// ?? preserves a 0 on beds/baths/sqft) — this is a verifier-layer LOCK, same standard
// as the westchester-geo / monthly / sort / address / munikey / matrix-bands locks.
// EXTRACTS the real shipped function from index.html at runtime (brace-match + new
// Function, the two helper globals computePinMonthly/formatPinAddress injected as
// stubs) so the lock can't drift from a mirror.
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

// Materialize the real shipped compactPinForScoring from a source string (default:
// the live index.html). computePinMonthly + formatPinAddress are free variables in
// the function body, so they're injected as factory params — the function references
// formatPinAddress WITHOUT a typeof guard, so it MUST be in scope or it throws.
function make(monthlyStub, addrStub, src = html) {
  const fnStart = src.indexOf('function compactPinForScoring(p) {');
  assert.ok(fnStart >= 0, 'compactPinForScoring not found');
  const fnEnd = braceMatch(src, fnStart);
  assert.ok(fnEnd > 0, 'could not brace-match compactPinForScoring');
  const fnSrc = src.slice(fnStart, fnEnd);
  return new Function(
    'computePinMonthly', 'formatPinAddress',
    `${fnSrc}\n return compactPinForScoring;`
  )(monthlyStub, addrStub);
}

// Default stubs: address tagged so we can prove it came from formatPinAddress(p);
// monthly returns a known total.
const ADDR = (p) => 'FMT:' + (p.id || '?');
const MONTHLY = () => ({ total: 4242 });
const compact = make(MONTHLY, ADDR);

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('✗', name, '—', e.message); } };

// A representative full pin (the common scored shape).
function fullPin() {
  return {
    id: 'p1',
    schoolDistrict: 'Chappaqua',
    askingPrice: 1250000,
    rank: 3,
    notes: 'corner lot, needs a roof',
    compass: {
      price: 1199000,
      beds: 4, baths: 3, sqft: 2800,
      yearBuilt: 1962, lotSize: 12000,
      description: 'x'.repeat(900),
    },
    train: { name: 'Chappaqua', line: 'Harlem', gct: 52, walkMin: 8, miles: 0.4 },
    trail: { name: 'North County', miles: 0.6, driveDistMi: 1.2 },
  };
}

// ── RED proof: a field-blind reconstruction (drops lotSize→lotSqft mapping +
//    ignores computePinMonthly) would silently send the AI wrong data. The shipped
//    builder must carry lotSqft from compass.lotSize and monthlyAllIn from the
//    monthly helper. ──
t('RED-proof: lotSqft comes from compass.lotSize, not a missing compass.lotSqft', () => {
  const out = compact(fullPin());
  assert.strictEqual(out.lotSqft, 12000); // a builder reading c.lotSqft would yield null
  assert.notStrictEqual(out.lotSqft, null);
});
t('RED-proof: monthlyAllIn comes from computePinMonthly(p).total', () => {
  const out = compact(fullPin());
  assert.strictEqual(out.monthlyAllIn, 4242); // ignoring the helper would yield null
});

// ── Happy-path full field contract ──
t('address comes from formatPinAddress(p)', () => {
  assert.strictEqual(compact(fullPin()).address, 'FMT:p1');
});
t('price (compass.price) and askingPrice (pin.askingPrice) are DISTINCT fields', () => {
  const o = compact(fullPin());
  assert.strictEqual(o.price, 1199000);
  assert.strictEqual(o.askingPrice, 1250000);
});
t('beds/baths/sqft/yearBuilt pulled from compass', () => {
  const o = compact(fullPin());
  assert.strictEqual(o.beds, 4);
  assert.strictEqual(o.baths, 3);
  assert.strictEqual(o.sqft, 2800);
  assert.strictEqual(o.yearBuilt, 1962);
});
t('schoolDistrict / rank / notes carried from the pin', () => {
  const o = compact(fullPin());
  assert.strictEqual(o.schoolDistrict, 'Chappaqua');
  assert.strictEqual(o.rank, 3);
  assert.strictEqual(o.notes, 'corner lot, needs a roof');
});
t('description is capped at 600 chars', () => {
  const o = compact(fullPin());
  assert.strictEqual(o.description.length, 600);
});
t('train nested object: gctMin maps from train.gct (the load-bearing rename)', () => {
  const o = compact(fullPin());
  assert.deepStrictEqual(o.train, {
    name: 'Chappaqua', line: 'Harlem', gctMin: 52, walkMin: 8, miles: 0.4,
  });
});
t('trail nested object: name/miles/driveDistMi', () => {
  const o = compact(fullPin());
  assert.deepStrictEqual(o.trail, { name: 'North County', miles: 0.6, driveDistMi: 1.2 });
});
t('exact key set — no field added or dropped', () => {
  const o = compact(fullPin());
  assert.deepStrictEqual(Object.keys(o).sort(), [
    'address', 'askingPrice', 'beds', 'baths', 'description', 'lotSqft',
    'monthlyAllIn', 'notes', 'price', 'rank', 'schoolDistrict', 'sqft',
    'train', 'trail', 'yearBuilt',
  ].sort());
});

// ── ?? vs || : a 0 must be PRESERVED on numeric compass fields (a 0-bed / 0-sqft
//    reads differently from "unknown"). ──
t('beds/baths/sqft/yearBuilt/lotSqft use ?? — a real 0 is preserved, not nulled', () => {
  const p = fullPin();
  p.compass.beds = 0; p.compass.baths = 0; p.compass.sqft = 0;
  p.compass.yearBuilt = 0; p.compass.lotSize = 0;
  const o = compact(p);
  assert.strictEqual(o.beds, 0);
  assert.strictEqual(o.baths, 0);
  assert.strictEqual(o.sqft, 0);
  assert.strictEqual(o.yearBuilt, 0);
  assert.strictEqual(o.lotSqft, 0);
});

// ── null / absent defaults ──
t('missing compass → all compass fields null (no throw)', () => {
  const o = compact({ id: 'x' });
  assert.strictEqual(o.price, null);
  assert.strictEqual(o.beds, null);
  assert.strictEqual(o.lotSqft, null);
  assert.strictEqual(o.description, null);
});
t('absent train/trail → null', () => {
  const o = compact({ id: 'x', compass: {} });
  assert.strictEqual(o.train, null);
  assert.strictEqual(o.trail, null);
});
t('absent rank → 0; absent notes/schoolDistrict/askingPrice → null', () => {
  const o = compact({ id: 'x', compass: {} });
  assert.strictEqual(o.rank, 0);
  assert.strictEqual(o.notes, null);
  assert.strictEqual(o.schoolDistrict, null);
  assert.strictEqual(o.askingPrice, null);
});
t('train sub-fields fall back to null when missing (line/gct/walkMin)', () => {
  const o = compact({ id: 'x', compass: {}, train: { name: 'Foo', miles: 1.1 } });
  assert.deepStrictEqual(o.train, {
    name: 'Foo', line: null, gctMin: null, walkMin: null, miles: 1.1,
  });
});
t('monthlyAllIn null when computePinMonthly returns null', () => {
  const c2 = make(() => null, ADDR);
  assert.strictEqual(c2(fullPin()).monthlyAllIn, null);
});
t('short description passes through unsliced', () => {
  const p = fullPin(); p.compass.description = 'a cozy ranch';
  assert.strictEqual(compact(p).description, 'a cozy ranch');
});

// ── Mutation proofs: materialize a MUTATED source string and assert the lock
//    assertions above would catch each regression (self-contained, no disk write). ──
function mutant(find, replace, stub = MONTHLY) {
  assert.ok(html.includes(find), `mutation anchor not found: ${find}`);
  return make(stub, ADDR, html.replace(find, replace));
}
t('MUTATION: lotSqft←c.lotSqft (wrong source) → lotSqft drops to null', () => {
  const m = mutant('lotSqft: c.lotSize ?? null', 'lotSqft: c.lotSqft ?? null');
  assert.strictEqual(m(fullPin()).lotSqft, null); // the lock case above asserts 12000 → would go RED
});
t('MUTATION: description cap 600→50 → length assert would fail', () => {
  const m = mutant('.slice(0, 600)', '.slice(0, 50)');
  assert.strictEqual(m(fullPin()).description.length, 50); // lock asserts 600 → RED
});
t('MUTATION: monthlyAllIn forced null → integration assert would fail', () => {
  const m = mutant('monthlyAllIn: m ? m.total : null', 'monthlyAllIn: null');
  assert.strictEqual(m(fullPin()).monthlyAllIn, null); // lock asserts 4242 → RED
});
t('MUTATION: train gctMin source train.gct→0 → rename assert would fail', () => {
  const m = mutant('gctMin: p.train.gct||null', 'gctMin: 0');
  assert.strictEqual(m(fullPin()).train.gctMin, 0); // lock asserts 52 → RED
});
t('MUTATION: beds ?? → || → a real 0 is wrongly nulled', () => {
  const m = mutant('beds: c.beds ?? null', 'beds: c.beds || null');
  const p = fullPin(); p.compass.beds = 0;
  assert.strictEqual(m(p).beds, null); // lock asserts 0-preserved → RED
});

console.log(`\ncompact-scoring: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
