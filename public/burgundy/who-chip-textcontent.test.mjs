// Locks updateWhoChip() — the always-visible identity chip added to the BURGUNDY
// reader top bar (public/burgundy/index.html, commit f10b6bd). Extracted from the
// shipped HTML at runtime so a drift in index.html breaks this test.
//
// Feature: a top-bar chip shows who's currently signing notes ("✎ <name>") and,
// tapped, re-opens the name box — so a second reader on a shared iPad isn't stuck
// wearing the first reader's name. The chip text is set by:
//   el.textContent = n || 'sign in';   // n = readerName(), reader-controlled
//
// THE LOAD-BEARING INVARIANT: the reader-supplied name reaches the chip through
// `.textContent`, NEVER `.innerHTML`. readerName() is untrusted (a reader types
// their own name into bg-name; a shared device means anyone can set it). textContent
// stores the string literally — a name of `<img src=x onerror=…>` is inert text.
// Switch the sink to innerHTML and that same name injects a LIVE element into the
// header. The sibling sheet-signature path (updateSheetSig) DOES use innerHTML and
// therefore runs the name through esc(); this chip is safe precisely because it
// uses textContent instead. This test proves the shipped sink is textContent AND
// that the innerHTML form leaks — so the sink can't silently regress.
//
// Also locks: the title tooltip is set via the `.title` DOM property (a string
// attribute, not an HTML sink), the empty-name fallback ('sign in'), and the
// null-guard (missing #who-name → no throw).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

const m = html.match(/function updateWhoChip\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not extract updateWhoChip() from index.html — did the function change?');
const src = m[0];

// --- Source lock: the reader-controlled name goes to textContent, not innerHTML ---
assert.ok(/\.textContent\s*=/.test(src), 'updateWhoChip must assign textContent');
assert.ok(!/\binnerHTML\b/.test(src), 'updateWhoChip must NOT touch innerHTML (reader-controlled name = XSS sink)');
assert.ok(/\.title\s*=/.test(src), 'updateWhoChip should set the button title tooltip');

// --- A DOM double that DISTINGUISHES textContent from innerHTML ---
function makeEl() {
  return {
    _text: undefined, _html: undefined, _title: undefined,
    set textContent(v) { this._text = v; }, get textContent() { return this._text; },
    set innerHTML(v)   { this._html = v; }, get innerHTML()   { return this._html; },
    set title(v)       { this._title = v; }, get title()      { return this._title; },
  };
}

// Build a runnable copy of the shipped fn with $ and readerName injected.
function makeUpdateWhoChip({ whoNameEl, btnEl, name }) {
  const $ = id => (id === 'who-name' ? whoNameEl : id === 'btn-who' ? btnEl : null);
  const readerName = () => name;
  return (0, eval)(`(function(){ const $ = arguments[0], readerName = arguments[1]; ${src} return updateWhoChip; })`)($, readerName);
}

// MUTATION ORACLE: the UNSAFE sink — innerHTML instead of textContent. This is the
// shape a careless "richer chip" refactor would introduce; it leaks a live tag.
function innerHTMLVariant({ whoNameEl, btnEl, name }) {
  const el = whoNameEl; if (!el) return;
  const n = name;
  el.innerHTML = n || 'sign in';          // <-- the leak
  const btn = btnEl;
  if (btn) btn.title = n ? `signing notes as ${n} — tap to change` : 'tap to sign your notes';
}

const XSS = '<img src=x onerror=alert(1)>';

// 1) Normal name → chip TEXT holds it, innerHTML NEVER written.
{
  const el = makeEl(), btn = makeEl();
  makeUpdateWhoChip({ whoNameEl: el, btnEl: btn, name: 'Marisa' })();
  assert.equal(el._text, 'Marisa', 'normal name lands in textContent');
  assert.equal(el._html, undefined, 'innerHTML must never be written');
  assert.ok(String(btn._title).includes('Marisa'), 'title names the signer');
}

// 2) XSS-shaped name → stored as literal text, innerHTML untouched (no live tag).
{
  const el = makeEl(), btn = makeEl();
  makeUpdateWhoChip({ whoNameEl: el, btnEl: btn, name: XSS })();
  assert.equal(el._text, XSS, 'malicious name is inert literal text via textContent');
  assert.equal(el._html, undefined, 'innerHTML never written → no live element injected');
}

// 3) Empty name → 'sign in' fallback.
{
  const el = makeEl(), btn = makeEl();
  makeUpdateWhoChip({ whoNameEl: el, btnEl: btn, name: '' })();
  assert.equal(el._text, 'sign in', 'empty name shows the sign-in prompt');
  assert.ok(String(btn._title).toLowerCase().includes('sign'), 'title prompts to sign when unset');
}

// 4) Null guard: missing #who-name element → no throw, no work.
{
  assert.doesNotThrow(
    () => makeUpdateWhoChip({ whoNameEl: null, btnEl: makeEl(), name: 'x' })(),
    'missing #who-name must be a silent no-op'
  );
}

// 5) Missing button but present chip → still updates text, no throw.
{
  const el = makeEl();
  assert.doesNotThrow(
    () => makeUpdateWhoChip({ whoNameEl: el, btnEl: null, name: 'Sam' })(),
    'missing #btn-who must not throw'
  );
  assert.equal(el._text, 'Sam', 'chip text still updates when the button is absent');
}

// 6) LOAD-BEARING mutation proof: the innerHTML variant LEAKS the live tag on the
//    exact same XSS name the shipped textContent form makes inert.
{
  const el = makeEl(), btn = makeEl();
  innerHTMLVariant({ whoNameEl: el, btnEl: btn, name: XSS });
  assert.ok(String(el._html).includes('<img'), 'innerHTML variant leaks a live <img> tag (proves the sink matters)');
  assert.equal(el._text, undefined, 'innerHTML variant bypasses textContent entirely');
}

console.log('who-chip-textcontent.test.mjs: all assertions passed');
