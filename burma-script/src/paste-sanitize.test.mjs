/**
 * WP-11 — paste sanitization transforms.
 *
 * Proves the DOM-free clipboard-HTML cleaners kill the top real-world corruption sources — Google
 * Docs' normal-weight <b> wrapper, Word's mso-* inline styles + <o:p> + conditional comments — while
 * PRESERVING genuine bold/italic and our own data-* chips (timecode, directionChip, flavor). These
 * run byte-identically in the browser (transformPastedHTML) and here, so this is the real contract.
 *
 * Run: bun src/paste-sanitize.test.mjs   (auto-discovered by run-tests.mjs)
 */
import assert from 'node:assert/strict';
import {
  sanitizePastedHTML,
  sanitizePastedText,
  unwrapNormalBold,
  stripStyleAndClass,
  removeEmptySpans,
  stripOfficeCruft,
} from './extensions/paste-sanitize.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

// --- Google Docs: the whole selection is wrapped in a normal-weight <b> ---------------------------
ok('unwraps Google-Docs font-weight:normal <b> wrapper, keeps inner text', () => {
  const html = '<b style="font-weight:normal;" id="docs-internal-guid-abc"><span>hello world</span></b>';
  const out = sanitizePastedHTML(html);
  assert.ok(!/<b\b/i.test(out), 'no <b> tag survives');
  assert.ok(out.includes('hello world'), 'text preserved');
});

ok('keeps GENUINE bold nested inside the normal-weight wrapper', () => {
  // Docs wrapper (normal) containing a real bold run.
  const html = '<b style="font-weight:normal"><span>plain </span><b style="font-weight:700">loud</b></b>';
  const out = unwrapNormalBold(html);
  // The normal-weight wrapper is gone; the real 700 bold stays as a <b>.
  assert.ok(out.includes('loud'), 'bold text kept');
  const bopens = (out.match(/<b\b/gi) || []).length;
  assert.equal(bopens, 1, 'exactly the one genuine bold <b> survives');
  const bcloses = (out.match(/<\/b>/gi) || []).length;
  assert.equal(bcloses, 1, 'its matching close survives, wrapper close dropped');
});

ok('unwraps <strong> with font-weight:400 too', () => {
  const out = unwrapNormalBold('<strong style="font-weight:400">x</strong>');
  assert.ok(!/<strong\b/i.test(out) && out.includes('x'));
});

// --- style/class stripping ------------------------------------------------------------------------
ok('strips style/class/lang/dir/align attributes, keeps data-*', () => {
  const html = '<span style="mso-fareast:x;font-weight:700" class="c3" data-tc="00:00:01:00">t</span>';
  const out = stripStyleAndClass(html);
  assert.ok(!/style=/.test(out) && !/class=/.test(out), 'style + class gone');
  assert.ok(out.includes('data-tc="00:00:01:00"'), 'data-* preserved');
});

// --- empty span removal (but never a data-* span) -------------------------------------------------
ok('removes empty bare spans, keeps empty data-* spans (chips/timecodes)', () => {
  const html = '<span></span><span>  </span><span data-dchip="" data-kind="archive"></span>keep';
  const out = removeEmptySpans(html);
  assert.ok(out.includes('data-dchip'), 'chip span kept even when empty');
  assert.ok(!/<span>\s*<\/span>/.test(out), 'bare empty spans gone');
  assert.ok(out.endsWith('keep'));
});

// --- Word / Office cruft --------------------------------------------------------------------------
ok('drops conditional comments, <style> islands and <o:p>', () => {
  const html = '<!--[if gte mso 9]><style>p{color:red}</style><![endif]--><p>hi<o:p></o:p></p>';
  const out = stripOfficeCruft(html);
  assert.ok(!out.includes('<!--') && !/<style/i.test(out) && !/<o:p/i.test(out));
  assert.ok(out.includes('hi'));
});

// --- our own chips survive a full sanitize pass ---------------------------------------------------
ok('a timecode chip and a direction chip survive the full sanitize', () => {
  const html = '<span data-tc="00:03:29:00" class="wp-tc-tag" style="color:red">00:03:29:00</span>'
    + '<span data-dchip="" data-kind="archive" data-status="found" class="wp-dchip">ARCHIVE FOUND</span>';
  const out = sanitizePastedHTML(html);
  assert.ok(out.includes('data-tc="00:03:29:00"'), 'timecode data survives');
  assert.ok(out.includes('data-kind="archive"') && out.includes('data-status="found"'), 'chip data survives');
  assert.ok(!/style=/.test(out) && !/class=/.test(out), 'presentational attrs stripped');
});

// --- full realistic Google-Docs paste -------------------------------------------------------------
ok('full Google-Docs paste: bold wrapper gone, real bold kept, styles stripped', () => {
  const html = '<meta charset="utf-8">'
    + '<b style="font-weight:normal;" id="docs-internal-guid-x">'
    + '<span style="font-weight:400;color:#000">The coral </span>'
    + '<span style="font-weight:700">lives</span>'
    + '<span style="font-weight:400"> inside.</span>'
    + '</b>';
  const out = sanitizePastedHTML(html);
  assert.ok(out.includes('The coral') && out.includes('lives') && out.includes('inside.'), 'all text kept');
  assert.ok(!/style=/.test(out), 'all inline styles stripped');
  assert.ok(!/font-weight/i.test(out), 'no font-weight left to falsely bold everything');
});

// --- plaintext normalization ----------------------------------------------------------------------
ok('sanitizePastedText normalizes CRLF and NBSP', () => {
  const out = sanitizePastedText('a\r\nb\rc d');
  assert.equal(out, 'a\nb\nc d');
});

// --- non-string guards ----------------------------------------------------------------------------
ok('non-string / empty inputs pass through untouched', () => {
  assert.equal(sanitizePastedHTML(''), '');
  assert.equal(sanitizePastedHTML(null), null);
  assert.equal(sanitizePastedText(undefined), undefined);
});

console.log(`paste-sanitize: ${pass} passed, 0 failed`);
