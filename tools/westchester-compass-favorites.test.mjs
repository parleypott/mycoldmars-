// Lock for parseCompassFavoritesCards (+ dupCapture) — public/westchester/index.html.
//
// This is the BULK import path on Johnny's ACTIVE house hunt: he stars a batch of homes
// on Compass, dumps the favorites page, and imports them all at once. parseCompassFavoritesCards
// turns each favorites *card* element into a pin {streetAddress, city, state, zip, price, beds,
// baths, sqft, lotSize, photos, ...}. It was ZERO-coverage.
//
// The card's textContent is DOUBLED with no separators (a Compass favorites quirk — visible +
// sr-only text concatenate): "44Bedrooms" means 4 beds, "Acresacres12 Maple Dr, ..." prefixes the
// address. The parser exploits that with \1 backreferences (dupCapture). A silent regression here
// mangles a whole batch of saved homes — beds doubled, lot size un-converted, the wrong photo, or a
// real listing dropped — with no signal. So the doubled-text contract + the dedup + the photo
// filter + the acres->sqft conversion are the load-bearing behaviors this pins.
//
// Reviewed: NO live bug — verifier-layer LOCK, not a fix. EXTRACTS the real shipped functions from
// index.html at runtime (slice + new Function) so the lock can't drift from a mirror; the two fns
// reference only each other + globals + the card object's textContent/querySelector, which the test
// supplies via tiny fake cards.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

// Pull the two contiguous functions (dupCapture + parseCompassFavoritesCards) verbatim.
function loadReal(src) {
  const start = src.indexOf('function dupCapture');
  const end = src.indexOf('function parseCompassListing');
  assert.ok(start >= 0 && end > start, 'could not locate the favorites parsers in index.html');
  const slice = src.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(slice + '\nreturn { dupCapture, parseCompassFavoritesCards };')();
}

// A fake favorites card: just enough surface for the parser (.textContent + .querySelector('img')).
function card(textContent, imgSrc) {
  return {
    textContent,
    querySelector(sel) {
      if (sel === 'img' && imgSrc !== undefined) {
        return { getAttribute: (a) => (a === 'src' ? imgSrc : null) };
      }
      return null;
    },
  };
}

// A fully-populated, correctly-doubled favorites card for "12 Maple Dr, Bedford, NY 10506".
const FULL =
  '$1,250,000 44Bedrooms 2.52.5Bathrooms 3,2003,200Square Feet ' +
  '0.50.5Acresacres12 Maple Dr, Bedford, NY 10506 ' +
  'Listing Courtesy of Compass Realty Active';

const { dupCapture, parseCompassFavoritesCards } = loadReal(html);

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; } };

// ─────────────────────────────────────────────────────────────────────────────
// Inline RED proof: a parser that ignored the \1 doubling (read the single token)
// would mis-read "44Bedrooms" as 44 beds. The shipped function reads 4.
// ─────────────────────────────────────────────────────────────────────────────
t('RED proof: ignoring the doubled-text \\1 backreference mis-reads beds (44 not 4)', () => {
  const naiveBeds = parseFloat((FULL.match(/(\d+(?:\.\d+)?)Bedrooms/) || [])[1] || '');
  assert.strictEqual(naiveBeds, 44, 'naive single-token read should grab the doubled "44"');
  const [pin] = parseCompassFavoritesCards([card(FULL, null)]);
  assert.strictEqual(pin.beds, 4, 'shipped parser must un-double to 4 beds');
});

// ─────────────────────────────────────────────────────────────────────────────
// Full happy path — every field extracted correctly.
// ─────────────────────────────────────────────────────────────────────────────
t('full card → all fields parsed', () => {
  const out = parseCompassFavoritesCards([card(FULL, 'https://cdn.compass.com/a.jpg')]);
  assert.strictEqual(out.length, 1);
  const p = out[0];
  assert.strictEqual(p.streetAddress, '12 Maple Dr');
  assert.strictEqual(p.city, 'Bedford');
  assert.strictEqual(p.state, 'NY');
  assert.strictEqual(p.zip, '10506');
  assert.strictEqual(p.price, 1250000);
  assert.strictEqual(p.beds, 4);
  assert.strictEqual(p.baths, 2.5);
  assert.strictEqual(p.sqft, 3200);
  assert.strictEqual(p.lotSize, Math.round(0.5 * 43560)); // 21780
  assert.deepStrictEqual(p.photos, ['https://cdn.compass.com/a.jpg']);
  assert.strictEqual(p.description, 'Listing courtesy of Compass Realty');
  assert.strictEqual(p.propertyType, null);
  assert.strictEqual(p.listingUrl, null);
});

t('two-digit beds (1010Bedrooms → 10) un-doubles correctly', () => {
  const txt = '$2,000,000 1010Bedrooms 55Bathrooms 0.50.5Acresacres9 Oak Ln, Rye, NY 10580';
  const [p] = parseCompassFavoritesCards([card(txt, null)]);
  assert.strictEqual(p.beds, 10);
  assert.strictEqual(p.baths, 5);
});

t('comma sqft (2,5002,500Square Feet → 2500) un-doubles + strips commas', () => {
  const txt = '$900,000 33Bedrooms 22Bathrooms 2,5002,500Square Feet 0.20.2Acresacres4 Elm St, Bedford, NY 10506';
  const [p] = parseCompassFavoritesCards([card(txt, null)]);
  assert.strictEqual(p.sqft, 2500);
});

t('"Square Feet" with optional space variant ("Square ?Feet") matches', () => {
  const txt = '$900,000 1,2001,200SquareFeet 0.10.1Acresacres4 Elm St, Bedford, NY 10506';
  const [p] = parseCompassFavoritesCards([card(txt, null)]);
  assert.strictEqual(p.sqft, 1200);
});

// ─────────────────────────────────────────────────────────────────────────────
// Optional fields absent → null (never NaN), photos → [].
// ─────────────────────────────────────────────────────────────────────────────
t('minimal card (address + price only) → optional fields null, photos []', () => {
  const txt = '$3,400,000 0.10.1Acresacres1 Hill Rd, Armonk, NY 10504';
  const [p] = parseCompassFavoritesCards([card(txt, null)]);
  assert.strictEqual(p.streetAddress, '1 Hill Rd');
  assert.strictEqual(p.price, 3400000);
  assert.strictEqual(p.beds, null, 'no Bedrooms token → null not NaN');
  assert.strictEqual(p.baths, null);
  assert.strictEqual(p.sqft, null);
  assert.strictEqual(p.description, null, 'no brokerage → null');
  assert.deepStrictEqual(p.photos, []);
});

t('no acres token → lotSize null', () => {
  const txt = '$3,400,000 44Bedrooms 33Bathrooms ...acres-less... ' +
    'Acresacres1 Hill Rd, Armonk, NY 10504';
  const [p] = parseCompassFavoritesCards([card(txt, null)]);
  assert.strictEqual(p.lotSize, null);
});

t('price without comma groups → null (favorites prices always carry commas)', () => {
  const txt = '$950000 0.10.1Acresacres1 Hill Rd, Armonk, NY 10504';
  const [p] = parseCompassFavoritesCards([card(txt, null)]);
  assert.strictEqual(p.price, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Photo filter: only absolute http(s) URLs that aren't "./..." survive.
// ─────────────────────────────────────────────────────────────────────────────
t('relative "./placeholder" image → photos []', () => {
  const [p] = parseCompassFavoritesCards([card(FULL, './placeholder.png')]);
  assert.deepStrictEqual(p.photos, []);
});
t('root-relative "/img.jpg" (no scheme) → photos []', () => {
  const [p] = parseCompassFavoritesCards([card(FULL, '/img.jpg')]);
  assert.deepStrictEqual(p.photos, []);
});
t('data: URL image → photos [] (not http(s))', () => {
  const [p] = parseCompassFavoritesCards([card(FULL, 'data:image/png;base64,AAAA')]);
  assert.deepStrictEqual(p.photos, []);
});
t('missing <img> → photos []', () => {
  const [p] = parseCompassFavoritesCards([card(FULL, undefined)]);
  assert.deepStrictEqual(p.photos, []);
});
t('http (not https) image → kept', () => {
  const [p] = parseCompassFavoritesCards([card(FULL, 'http://x.com/y.jpg')]);
  assert.deepStrictEqual(p.photos, ['http://x.com/y.jpg']);
});

// ─────────────────────────────────────────────────────────────────────────────
// Dedup by street|city (case-insensitive), and skip cards with no NY address.
// ─────────────────────────────────────────────────────────────────────────────
t('two cards, same street+city (case variant) → deduped to one', () => {
  const a = '$1,250,000 44Bedrooms 0.50.5Acresacres12 Maple Dr, Bedford, NY 10506';
  const b = '$1,275,000 44Bedrooms 0.50.5Acresacres12 MAPLE DR, BEDFORD, NY 10506';
  const out = parseCompassFavoritesCards([card(a, null), card(b, null)]);
  assert.strictEqual(out.length, 1, 'same street|city must dedup');
  assert.strictEqual(out[0].price, 1250000, 'first card wins');
});

t('different streets → both kept', () => {
  const a = '$1,250,000 0.50.5Acresacres12 Maple Dr, Bedford, NY 10506';
  const b = '$2,000,000 0.50.5Acresacres9 Oak Ln, Rye, NY 10580';
  const out = parseCompassFavoritesCards([card(a, null), card(b, null)]);
  assert.strictEqual(out.length, 2);
});

t('card with no NY address → skipped (not in output)', () => {
  const out = parseCompassFavoritesCards([card('$1,000,000 some unrelated card text 44Bedrooms', null)]);
  assert.deepStrictEqual(out, []);
});

t('empty card list → []', () => {
  assert.deepStrictEqual(parseCompassFavoritesCards([]), []);
});

t('whitespace-only / blank card → skipped, no throw', () => {
  assert.deepStrictEqual(parseCompassFavoritesCards([card('   \n  ', null)]), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// dupCapture unit: returns the first capture group, or null on no match.
// ─────────────────────────────────────────────────────────────────────────────
t('dupCapture returns m[1] on match, null on miss', () => {
  assert.strictEqual(dupCapture('44Bedrooms', /(\d+(?:\.\d+)?)\1Bedrooms/), '4');
  assert.strictEqual(dupCapture('nope', /(\d+)\1Beds/), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Documents the NY-only limitation of the BULK favorites path (NOTE for Johnny).
// The single-listing path (parseCompassListing → normalizeListing) DOES handle CT;
// this bulk parser hardcodes (NY), so a CT favorite is silently dropped.
// ─────────────────────────────────────────────────────────────────────────────
t('NOTE: a CT favorite is silently dropped (bulk parser is NY-only)', () => {
  const ct = '$2,500,000 44Bedrooms 0.50.5Acresacres5 Field Point Rd, Greenwich, CT 06830';
  assert.deepStrictEqual(parseCompassFavoritesCards([card(ct, null)]), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutation proofs — each breaks the REAL shipped source in-memory and asserts the
// lock goes RED, proving the test has teeth (not a rubber stamp).
// ─────────────────────────────────────────────────────────────────────────────
function mutate(orig, rep) {
  assert.ok(html.includes(orig), `mutation anchor not found: ${orig}`);
  const mutated = html.replace(orig, rep);
  assert.notStrictEqual(mutated, html, 'mutation was a no-op');
  return loadReal(mutated).parseCompassFavoritesCards;
}

t('MUTATION: dropping the \\1 in the Bedrooms regex → beds reads doubled (44)', () => {
  const fn = mutate('(\\d+(?:\\.\\d+)?)\\1Bedrooms', '(\\d+(?:\\.\\d+)?)Bedrooms');
  const [p] = fn([card(FULL, null)]);
  assert.strictEqual(p.beds, 44, 'mutant should read the doubled token');
});

t('MUTATION: changing address state token (NY → QQ) → the card no longer parses', () => {
  const fn = mutate(',\\s*(NY)\\s+(\\d{5})', ',\\s*(QQ)\\s+(\\d{5})');
  assert.deepStrictEqual(fn([card(FULL, null)]), []);
});

t('MUTATION: dropping the acres→sqft conversion → lotSize is the raw acres', () => {
  const fn = mutate('Math.round(acres * 43560)', 'acres');
  const [p] = fn([card(FULL, null)]);
  assert.strictEqual(p.lotSize, 0.5, 'mutant leaves lotSize as raw acres');
});

t('MUTATION: weakening the photo scheme guard → a relative image leaks in', () => {
  const fn = mutate('&& /^https?:/.test(coverImg)', '&& true');
  const [p] = fn([card(FULL, '/relative.png')]);
  assert.deepStrictEqual(p.photos, ['/relative.png'], 'mutant leaks the relative img');
});

t('MUTATION: disabling dedup → duplicate cards both appear', () => {
  const fn = mutate('if (seen.has(key)) return;', 'if (false) return;');
  const a = '$1,250,000 0.50.5Acresacres12 Maple Dr, Bedford, NY 10506';
  const b = '$1,275,000 0.50.5Acresacres12 Maple Dr, Bedford, NY 10506';
  assert.strictEqual(fn([card(a, null), card(b, null)]).length, 2, 'mutant keeps the dup');
});

console.log(`westchester-compass-favorites: ${passed} passed`);
if (process.exitCode) throw new Error('westchester-compass-favorites: failures above');
