// Newpress INVESTOR DECK — renderSlide() render-contract coverage (first coverage).
//
// THE RISK (latent, zero prior coverage): renderSlide() in newpress-deck/src/main.js
// is a 19-case layout switch that dereferences ~20 REQUIRED fields with NO guard —
// e.g. `s.stats.map(...)`, `s.members.map(...)`, `s.col1.title`, `s.opportunities.map(...)`,
// `s.phases.map(p => ... p.items.map(...))`. If any slide in slides.js is missing the
// field its layout hard-derefs, renderSlide THROWS a TypeError and the whole deck render
// dies — a blank/error screen in the middle of an investor pitch. And any slide whose
// `layout` doesn't match a case falls through to `default: return ''` — a silently BLANK
// slide. Neither failure mode had a single test catching it.
//
// This locks TWO invariants over the REAL shipped slide data + the REAL shipped renderSlide:
//   1. Every slide renders to a NON-EMPTY string (no blank slide / no unhandled layout).
//   2. renderSlide never THROWS on the real data (every required field is present).
//
// It EXTRACTS the exact shipped renderSlide() + its helpers (e/nl/labelHTML/imgOrPlaceholder)
// straight out of main.js at runtime (new Function over the verbatim source block), so the
// test can never drift from a hand-copied mirror — same discipline as essays/fmt.test.mjs
// and flight/great-circle.test.mjs. The only free variable in that block is `document`,
// which `e()` uses to HTML-escape text; we stub a faithful minimal version.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(join(HERE, 'src/main.js'), 'utf8');

// ── Extract the verbatim source block: renderSlide() through the end of the
//    HELPERS section (e/nl/labelHTML/imgOrPlaceholder), stopping before NAVIGATION. ──
const startIdx = mainSrc.indexOf('function renderSlide(s)');
assert.ok(startIdx >= 0, 'could not locate renderSlide() in src/main.js');
const navIdx = mainSrc.indexOf('NAVIGATION', startIdx);
assert.ok(navIdx > startIdx, 'could not locate the NAVIGATION marker after renderSlide()');
let block = mainSrc.slice(startIdx, navIdx);
// Drop the dangling, still-open `/* ... NAVIGATION ... */` comment opener at the tail
// (its closing */ lives past our slice). The earlier HELPERS comment is fully closed and stays.
block = block.slice(0, block.lastIndexOf('/*'));

// Faithful minimal `document`: e() does `d.textContent = str; return d.innerHTML`, which in a
// real browser HTML-escapes &, <, > (and leaves quotes). Mirror exactly that.
const documentStub = {
  createElement() {
    let raw = '';
    return {
      set textContent(v) { raw = v == null ? '' : String(v); },
      get innerHTML() {
        return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
    };
  },
};

const renderSlide = new Function('document', block + '\n; return renderSlide;')(documentStub);

// ── Pull in the REAL shipped slide data. slides.js is `export default slides`. ──
const slides = (await import('./src/slides.js')).default;
assert.ok(Array.isArray(slides) && slides.length > 0, 'slides.js did not export a non-empty array');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// ── INVARIANT 1+2: every real slide renders to non-empty HTML and never throws. ──
slides.forEach((slide, i) => {
  let html;
  assert.doesNotThrow(
    () => { html = renderSlide(slide); },
    `slide #${i + 1} (layout '${slide.layout}') THREW in renderSlide — a required field is missing; this would blank the deck mid-pitch`,
  );
  ok(typeof html === 'string' && html.trim().length > 0,
    `slide #${i + 1} (layout '${slide.layout}') rendered BLANK — unhandled layout or empty body (hit default: '')`);
});

// Sanity: we actually exercised a real, multi-layout deck (not a stub).
ok(slides.length >= 15, `expected the full investor deck (>=15 slides), got ${slides.length}`);
ok(new Set(slides.map(s => s.layout)).size >= 10,
  `expected >=10 distinct layouts exercised, got ${new Set(slides.map(s => s.layout)).size}`);

// ── MUTATION PROOF (the guard has teeth): a slide missing its required map-field must
//    make renderSlide throw, and an unknown layout must render blank. If either of these
//    DIDN'T fail, INVARIANT 1/2 above would be vacuous. ──

// Find a real 'data'-layout slide (hard-derefs s.stats.map) and strip stats → must throw.
const dataSlide = slides.find(s => s.layout === 'data');
assert.ok(dataSlide, 'expected a data-layout slide to exist for the mutation proof');
const brokenData = { ...dataSlide };
delete brokenData.stats;
assert.throws(() => renderSlide(brokenData),
  'RED-proof FAILED: a data slide with no .stats should throw in s.stats.map(...) but did not');
checks++;

// Find a real 'team'-layout slide (hard-derefs s.members.map) and strip members → must throw.
const teamSlide = slides.find(s => s.layout === 'team');
if (teamSlide) {
  const brokenTeam = { ...teamSlide };
  delete brokenTeam.members;
  assert.throws(() => renderSlide(brokenTeam),
    'RED-proof FAILED: a team slide with no .members should throw in s.members.map(...) but did not');
  checks++;
}

// An unknown layout falls to `default: return ''` → blank. Confirm the blank-detector
// (INVARIANT 1) would actually fire on it.
assert.equal(renderSlide({ layout: '__nope__', headline: 'x' }), '',
  'RED-proof FAILED: an unknown layout should hit default and return "" (blank)');
checks++;

// A correct slice must still escape HTML the way the browser does (proves the document stub
// is faithful, so "renders non-empty" isn't passing on a broken escaper).
ok(renderSlide({ layout: 'data', headline: 'A < B & C', body: 'x', stats: [] }).includes('A &lt; B &amp; C'),
  'document stub should HTML-escape &,<,> in headline text the way innerHTML does');

console.log(`newpress-deck render-slide: ${checks} checks passed (${slides.length} real slides rendered, 0 blanks, 0 throws)`);
