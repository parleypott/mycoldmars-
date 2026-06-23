// Locks laserspace's persisted high-score reader (readHiScore) — the NaN-safe
// parse that drives the on-screen "HI-SCORE" HUD and the score>hi update gate.
//
// Bug it guards: the old form `parseInt(localStorage.getItem("laserspaceHi") || "0", 10)`
// returns NaN on a corrupt/non-numeric stored value ("abc", " "), which then
// (a) renders as "00NaN" via String(NaN).padStart(5,"0") on the HUD, and
// (b) freezes the high score forever — `score > NaN` is always false, so it
//     never updates even when you beat it.
//
// The test EXTRACTS the real shipped readHiScore from laserspace/index.html at
// runtime (can't drift from a mirror) and mutation-proves the Number.isFinite guard.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Extract the real shipped `function readHiScore(raw) { ... }` body via brace match.
function extractFn(name) {
  const sig = `function ${name}(`;
  const start = html.indexOf(sig);
  assert.ok(start !== -1, `${name} not found in index.html`);
  // find the opening brace of the body
  let i = html.indexOf('{', start);
  assert.ok(i !== -1, `opening brace for ${name} not found`);
  let depth = 0, end = -1;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  assert.ok(end !== -1, `closing brace for ${name} not found`);
  const params = html.slice(start + sig.length, html.indexOf(')', start));
  const body = html.slice(i + 1, end);
  // eslint-disable-next-line no-new-func
  return new Function(params, body);
}

const readHiScore = extractFn('readHiScore');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); } }

// ── inline RED proof: the OLD form leaked NaN on corrupt input ──
t('RED proof: old parseInt form returns NaN on a non-numeric store (now guarded)', () => {
  const oldForm = (raw) => parseInt(raw || '0', 10);
  assert.ok(Number.isNaN(oldForm('abc')), 'old form must yield NaN on "abc"');
  assert.ok(Number.isNaN(oldForm(' ')), 'old form must yield NaN on a space');
  // String(NaN).padStart(5,"0") is the literal "00NaN" the HUD would render
  assert.equal(String(oldForm('abc')).padStart(5, '0'), '00NaN');
  // the shipped fn defuses both
  assert.equal(readHiScore('abc'), 0);
  assert.equal(readHiScore(' '), 0);
});

// ── the fix ──
t('corrupt non-numeric store -> 0 (not NaN)', () => {
  assert.equal(readHiScore('abc'), 0);
  assert.equal(readHiScore('garbage'), 0);
  assert.equal(readHiScore('NaN'), 0);
  assert.equal(readHiScore(' '), 0);
  assert.equal(readHiScore('!!!'), 0);
});

t('result is always a finite number renderable without "NaN"', () => {
  for (const v of ['abc', '12345', null, '', ' ', 'x', '0', '99999garbage', undefined]) {
    const hi = readHiScore(v);
    assert.ok(Number.isFinite(hi), `readHiScore(${JSON.stringify(v)}) must be finite, got ${hi}`);
    assert.ok(!String(hi).includes('NaN'), `rendered HUD value must not contain NaN for ${JSON.stringify(v)}`);
  }
});

t('the freeze condition cannot occur: a positive score can always beat the floor', () => {
  // The bug was score>hi always false when hi===NaN. With the guard, a corrupt
  // store yields hi=0, so any positive score updates the high score.
  assert.ok(100 > readHiScore('abc'));
  assert.ok(1 > readHiScore(' '));
});

// ── no-regression: every valid input is byte-identical to the old form ──
t('no-regression: valid numeric strings parse identically to the old form', () => {
  const oldForm = (raw) => parseInt(raw || '0', 10);
  for (const v of ['12345', '0', '1', '99999', '500', '7', '9999garbage', '42abc']) {
    assert.equal(readHiScore(v), oldForm(v), `value ${JSON.stringify(v)} must be unchanged`);
  }
});

t('no-regression: null/empty fall back to 0 (the existing || "0" guard)', () => {
  assert.equal(readHiScore(null), 0);
  assert.equal(readHiScore(''), 0);
  assert.equal(readHiScore(undefined), 0);
});

t('leading-numeric lenient parse preserved (parseInt stops at first non-digit)', () => {
  assert.equal(readHiScore('9999garbage'), 9999);
  assert.equal(readHiScore('42abc'), 42);
  assert.equal(readHiScore('  17'), 17); // leading whitespace tolerated by parseInt
});

// ── source-binding: the guard is actually wired, old form gone ──
t('source-binding: index.html uses readHiScore + Number.isFinite, not the raw parseInt at the hi: site', () => {
  assert.ok(/function readHiScore\s*\(/.test(html), 'readHiScore must be defined');
  assert.ok(/Number\.isFinite\(v\)\s*\?\s*v\s*:\s*0/.test(html), 'NaN guard must be present');
  assert.ok(/hi:\s*readHiScore\(localStorage\.getItem\("laserspaceHi"\)\)/.test(html),
    'the hi: field must call readHiScore');
  assert.ok(!/hi:\s*parseInt\(localStorage\.getItem\("laserspaceHi"\)/.test(html),
    'the old inline parseInt form must be gone from the hi: field');
});

console.log(`hi-score: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
