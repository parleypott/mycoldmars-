// Tests for parseListingPrice() + extractFromMeta()/extractCompassMetaFromHtml() price
// parsing in public/westchester/index.html — the single-listing import on Johnny's
// ACTIVE house hunt.
//
// BUG (this fix): the OG-meta price regexes (/\$([0-9,]+)/ and /\$\s*([\d,]+)/) captured
// only the leading integer run, so a SHORTHAND price — "$2.5M", "$2.5 million", "$950K" —
// captured just "$2" → price 2, pricing a multimillion-dollar house at $2 (poisoning the
// money panel + fit score) AND, in extractFromMeta, leaking the ".5M" tail into the
// geocode address chunk. Shorthand prices are common in non-Compass share cards
// (Zillow/Redfin/realtor/MLS og: tags) — the exact fallback sources extractFromMeta is for.
//
// Extracts the ACTUAL shipped functions from index.html at runtime (new Function + brace
// match — can't drift from a hand-copied mirror).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

function grab(re, label) {
  const m = HTML.match(re);
  if (!m) throw new Error('could not locate ' + label + ' in index.html');
  return m[0];
}
const priceSrc = grab(/function parseListingPrice\(text\) \{[\s\S]*?\n\}\n/, 'parseListingPrice');
const metaSrc = grab(/function extractFromMeta\(doc\) \{[\s\S]*?\n\}\n/, 'extractFromMeta');
const compassSrc = grab(/function extractCompassMetaFromHtml\(html\) \{[\s\S]*?\n\}\n/, 'extractCompassMetaFromHtml');

const { parseListingPrice, extractFromMeta, extractCompassMetaFromHtml } = new Function(
  priceSrc + metaSrc + compassSrc +
  '\nreturn { parseListingPrice, extractFromMeta, extractCompassMetaFromHtml };'
)();

// Minimal doc stub — extractFromMeta reads everything through doc.querySelector().
function makeDoc(meta) {
  return {
    querySelector(sel) {
      if (sel === 'meta[property="og:title"]') return meta.ogTitle != null ? { content: meta.ogTitle } : null;
      if (sel === 'meta[property="og:description"]') return meta.ogDesc != null ? { content: meta.ogDesc } : null;
      if (sel === 'meta[property="og:image"]') return meta.ogImg != null ? { content: meta.ogImg } : null;
      if (sel === 'meta[property="og:url"]') return meta.ogUrl != null ? { content: meta.ogUrl } : null;
      if (sel === 'link[rel="canonical"]') return meta.canonical != null ? { href: meta.canonical } : null;
      return null;
    },
  };
}
const run = (meta) => extractFromMeta(makeDoc(meta));

// The OLD (buggy) price parse, for the RED proof — integer run only.
const oldPrice = (text) => { const m = (text || '').match(/\$\s*([\d,]+)/); return m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : null; };

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`  ✗ ${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); }
}
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); }
}

// ── RED proof: the old regex is genuinely broken on shorthand ───────────────────
eq('RED: old regex prices "$2.5M" at 2', oldPrice('$2.5M Bedford, NY'), 2);
eq('RED: old regex prices "$950K" at 950', oldPrice('$950K cottage'), 950);
ok('RED proof would have failed pre-fix (old !== new for shorthand)', oldPrice('$2.5M') !== parseListingPrice('$2.5M'));

// ── parseListingPrice: shorthand (the fix) ──────────────────────────────────────
eq('$2.5M → 2,500,000', parseListingPrice('$2.5M'), 2500000);
eq('$2.5m (lowercase) → 2,500,000', parseListingPrice('$2.5m'), 2500000);
eq('$3M → 3,000,000', parseListingPrice('$3M'), 3000000);
eq('$2.5 million → 2,500,000', parseListingPrice('$2.5 million'), 2500000);
eq('$1.2 mil → 1,200,000', parseListingPrice('$1.2 mil'), 1200000);
eq('$950K → 950,000', parseListingPrice('$950K'), 950000);
eq('$950k → 950,000', parseListingPrice('$950k'), 950000);
eq('$950 thousand → 950,000', parseListingPrice('$950 thousand'), 950000);
eq('$1.275M → 1,275,000', parseListingPrice('$1.275M'), 1275000);
eq('shorthand mid-sentence', parseListingPrice('Stunning home priced at $2.5M with views'), 2500000);
eq('"$ 2.5 M" with spaces', parseListingPrice('$ 2.5 M'), 2500000);

// ── parseListingPrice: full prices unchanged (no regression) ────────────────────
eq('$2,500,000 → 2,500,000', parseListingPrice('$2,500,000'), 2500000);
eq('$1,275,000 → 1,275,000', parseListingPrice('$1,275,000'), 1275000);
eq('$899,000 → 899,000', parseListingPrice('$899,000'), 899000);
eq('$2500000 (no commas) → 2,500,000', parseListingPrice('$2500000'), 2500000);
eq('full price mid-sentence', parseListingPrice('Asking $1,995,000 — must see'), 1995000);

// ── no false unit attach ────────────────────────────────────────────────────────
eq('"$1,200,000 modern home" not multiplied', parseListingPrice('$1,200,000 modern home'), 1200000);
eq('"$899,000 mansion" not multiplied', parseListingPrice('$899,000 mansion'), 899000);

// ── edges → null, no throw ──────────────────────────────────────────────────────
eq('no price → null', parseListingPrice('4 Maple Dr, Rye, NY'), null);
eq('empty → null', parseListingPrice(''), null);
eq('null → null', parseListingPrice(null), null);
eq('undefined → null', parseListingPrice(undefined), null);
ok('number arg → no throw', (() => { try { parseListingPrice(12345); return true; } catch { return false; } })());

// ── extractFromMeta end-to-end: price correct AND address not polluted ──────────
{
  const r = run({ ogTitle: '$2.5M · 4 Maple Dr · Rye · NY 10580', ogDesc: '' });
  eq('e2e shorthand: price', r.price, 2500000);
  eq('e2e shorthand: street clean (no ".5M")', r.streetAddress, '4 Maple Dr');
  eq('e2e shorthand: city', r.city, 'Rye');
  eq('e2e shorthand: state', r.state, 'NY');
  eq('e2e shorthand: zip', r.zip, '10580');
  ok('e2e shorthand: no "M" leaked anywhere in address', !/\.5M|2\.5/.test([r.streetAddress, r.city, r.state].join('|')));
}
{
  // price only in the description (title has no $) → still parsed, address intact
  const r = run({ ogTitle: '4 Maple Dr, Rye, NY 10580', ogDesc: 'Beautiful colonial, $1.85M, 4 bed 3 bath 3,200 sqft' });
  eq('e2e desc-price: price', r.price, 1850000);
  eq('e2e desc-price: street intact', r.streetAddress, '4 Maple Dr');
  eq('e2e desc-price: beds', r.beds, 4);
  eq('e2e desc-price: sqft', r.sqft, 3200);
}
{
  // full comma price in title → unchanged behavior
  const r = run({ ogTitle: '123 Main St | $1,275,000 | Bedford, NY 10506', ogDesc: '' });
  eq('e2e full price: price', r.price, 1275000);
  eq('e2e full price: street', r.streetAddress, '123 Main St');
  eq('e2e full price: city', r.city, 'Bedford');
  eq('e2e full price: state', r.state, 'NY');
}
{
  // no price at all → price null, address intact
  const r = run({ ogTitle: '7 Oak Ln, Scarsdale, NY 10583', ogDesc: '' });
  eq('e2e no price: price null', r.price, null);
  eq('e2e no price: street', r.streetAddress, '7 Oak Ln');
}

// ── extractCompassMetaFromHtml: shorthand in og:description ──────────────────────
{
  const html = '<meta property="og:description" content="Gorgeous estate offered at $4.2M, 5-bed 6-bath 6,500 sqft">';
  const r = extractCompassMetaFromHtml(html);
  eq('compass shorthand: price', r.price, 4200000);
  eq('compass shorthand: beds', r.beds, 5);
  eq('compass shorthand: sqft', r.sqft, 6500);
}
{
  const html = '<meta property="og:description" content="Listed at $2,950,000 · 4 bed 4 bath 4,100 sqft">';
  const r = extractCompassMetaFromHtml(html);
  eq('compass full price unchanged', r.price, 2950000);
}

if (fail) { console.error(`\nwestchester-price: ${pass} passed, ${fail} FAILED`); process.exit(1); }
console.log(`westchester-price: ${pass} passed`);
