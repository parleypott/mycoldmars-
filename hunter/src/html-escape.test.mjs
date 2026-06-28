// Locks The Hunter's escHtml escaper. The whole reason this module exists is
// that the OLD DOM-based escaper (`div.textContent = str; div.innerHTML`)
// escaped & < > but NOT quotes, while escHtml is used in HTML ATTRIBUTE
// contexts (href=, src=, class=). A value with a double-quote could break out
// of the attribute and graft an event handler onto the tag — an XSS.
//
// MUTATION TEST: drop the `"` or `'` replace() from html-escape.js and the
// quote/attribute-breakout assertions below go RED. Drop the `&` replace and
// the ampersand/ordering assertions go RED.
import { escHtml } from './html-escape.js';
import assert from 'node:assert/strict';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// ── The load-bearing fix: quotes MUST be escaped (the old DOM version didn't) ──
t('escapes double quote', () => {
  assert.equal(escHtml('a"b'), 'a&quot;b');
});
t('escapes single quote', () => {
  assert.equal(escHtml("a'b"), 'a&#39;b');
});
t('neutralizes attribute-breakout payload (href context)', () => {
  // url = `x" onmouseover="alert(1)` — the exact attribute-injection the old
  // escaper let through. After escaping there is no bare " to close href=.
  const out = escHtml('x" onmouseover="alert(1)');
  assert.ok(!out.includes('"'), 'no raw double-quote may survive');
  assert.equal(out, 'x&quot; onmouseover=&quot;alert(1)');
});

// ── Behavior parity with the old DOM escaper for the &<> text case ──
t('escapes ampersand', () => {
  assert.equal(escHtml('Tom & Jerry'), 'Tom &amp; Jerry');
});
t('escapes angle brackets (cannot open a new tag)', () => {
  assert.equal(escHtml('<img src=x>'), '&lt;img src=x&gt;');
});
t('ampersand escaped FIRST — no double-escaping', () => {
  // If & were not escaped first, `<` -> `&lt;` would then become `&amp;lt;`.
  assert.equal(escHtml('<'), '&lt;');
  assert.equal(escHtml('&lt;'), '&amp;lt;');
});
t('all five chars together', () => {
  assert.equal(escHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

// ── Falsy handling byte-identical to old `str || ''` ──
t('null/undefined/empty/0/false -> empty string', () => {
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
  assert.equal(escHtml(''), '');
  assert.equal(escHtml(0), '');
  assert.equal(escHtml(false), '');
});
t('non-empty plain string passes through unchanged', () => {
  assert.equal(escHtml('Westchester House Hunter'), 'Westchester House Hunter');
});
t('coerces non-string truthy values', () => {
  assert.equal(escHtml(42), '42');
});

console.log(`html-escape.test.mjs: ${pass}/${pass} assertions passed`);
