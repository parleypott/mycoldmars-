// Tests for normalizeListing() in public/westchester/index.html — the Compass /
// schema.org JSON-LD import normalizer (the import front door that turns a scraped
// listing object into the pin shape the app stores). Extracts the ACTUAL shipped
// function from index.html at runtime (strongest signal — can't drift from a
// hand-copied mirror), then proves the real bug is fixed:
//
//   BUG  schema.org JSON-LD `offers.price` is canonically a STRING with cents
//        ("1250000.00"). The old `replace(/[^\d]/g, '')` deleted the decimal
//        point, so $1,250,000.00 became 125,000,000 — a 100x price inflation that
//        poisons monthly cost, mansion tax, and the AI fit score for every Compass
//        listing whose price came in as a cents-bearing string.
//
// normalizeListing(raw, doc) is pure when called with a plain object and no doc
// (doc is only touched for the canonical-URL fallback, guarded by `doc ?`), so it
// runs headlessly with zero DOM.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// normalizeListing depends on pickAddrField — pull both out of the shipped source.
function extractFn(sig) {
  const m = HTML.match(new RegExp('function ' + sig + '[\\s\\S]*?\\n\\}\\n'));
  if (!m) throw new Error('could not locate ' + sig + ' in index.html');
  return m[0];
}
const normalizeListing = new Function(
  extractFn('pickAddrField\\(o, \\.\\.\\.keys\\) \\{') +
  extractFn('normalizeListing\\(raw, doc\\) \\{') +
  '\nreturn normalizeListing;'
)();

// The OLD (buggy) price coercion, for the RED proof — strips every non-digit,
// deleting the decimal point. Mirrors the pre-fix source one-liner.
const priceOLD = (v) => (typeof v === 'string' ? Number(String(v).replace(/[^\d]/g, '')) : v);

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('✗', name, '\n   ', e.message); } };
const addr = { streetAddress: '12 Memorial Plaza', city: 'Pleasantville', state: 'NY', zip: '10570' };
const norm = (price, extra = {}) => normalizeListing({ ...addr, price, ...extra });

// ---- RED proof: the old logic 100x-inflated cents-bearing string prices --------
t('RED: old logic turns "1250000.00" into 125000000', () => {
  assert.strictEqual(priceOLD('1250000.00'), 125000000);
});
t('RED: old logic turns "$2,400,000.00" into 240000000', () => {
  assert.strictEqual(priceOLD('$2,400,000.00'), 240000000);
});

// ---- GREEN: the shipped function parses cents-bearing strings correctly ---------
t('cents string "1250000.00" -> 1250000', () => {
  assert.strictEqual(norm('1250000.00').price, 1250000);
});
t('comma + cents "1,250,000.00" -> 1250000', () => {
  assert.strictEqual(norm('1,250,000.00').price, 1250000);
});
t('currency + comma + cents "$2,400,000.00" -> 2400000', () => {
  assert.strictEqual(norm('$2,400,000.00').price, 2400000);
});
t('cents string "999999.99" stays sub-million (not ~100M)', () => {
  const p = norm('999999.99').price;
  assert.ok(p > 999999 && p < 1000001, `expected ~999999.99, got ${p}`);
});

// ---- Regression locks: the formats that already worked must stay byte-identical -
t('plain integer string "1250000" -> 1250000', () => {
  assert.strictEqual(norm('1250000').price, 1250000);
});
t('comma integer string "1,250,000" -> 1250000', () => {
  assert.strictEqual(norm('1,250,000').price, 1250000);
});
t('currency comma integer "$2,400,000" -> 2400000', () => {
  assert.strictEqual(norm('$2,400,000').price, 2400000);
});
t('numeric price passes through untouched', () => {
  assert.strictEqual(norm(1875000).price, 1875000);
});
t('numeric price with cents passes through untouched', () => {
  assert.strictEqual(norm(1875000.5).price, 1875000.5);
});

// ---- The address / field plumbing the normalizer is otherwise responsible for ---
t('reads offers.price (the schema.org Offer shape) as a string with cents', () => {
  const n = normalizeListing({ streetAddress: '1 Main St', city: 'Irvington', state: 'NY',
    offers: { price: '3150000.00', priceCurrency: 'USD' } });
  assert.strictEqual(n.price, 3150000);
});
t('nested address.streetAddress + address.postalCode resolve', () => {
  const n = normalizeListing({ address: { streetAddress: '5 Wood Ln', city: 'Bedford',
    state: 'NY', postalCode: '10506' }, listPrice: 4200000 });
  assert.strictEqual(n.streetAddress, '5 Wood Ln');
  assert.strictEqual(n.zip, '10506');
  assert.strictEqual(n.price, 4200000);
});
t('photos coerce from mixed string/object array and cap at 12', () => {
  const photosRaw = Array.from({ length: 15 }, (_, i) =>
    i % 2 ? { url: `https://x/${i}.jpg` } : `https://y/${i}.jpg`);
  const n = norm(1000000, { photos: photosRaw });
  assert.strictEqual(n.photos.length, 12);
  assert.ok(n.photos.every(Boolean));
});
t('missing price stays undefined (not NaN, not 0)', () => {
  const n = normalizeListing({ ...addr });
  assert.ok(n.price === undefined || n.price === null);
});
t('beds/baths/sqft fall through their alias chains', () => {
  const n = norm(1000000, { bedrooms: 4, bathroomCount: 2.5, livingArea: 2800 });
  assert.strictEqual(n.beds, 4);
  assert.strictEqual(n.baths, 2.5);
  assert.strictEqual(n.sqft, 2800);
});

console.log(`\nnormalize-listing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
