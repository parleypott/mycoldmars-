// Mutation-lock for escHtml — the mapkeys panel row escaper. Proves it is
// ATTRIBUTE-safe (quotes escaped), so a map/layer/shape name can't break out
// of a title="..." attribute or inject markup, while leaving clean names
// byte-identical.
import assert from 'node:assert';
import { escHtml } from './esc.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); }
};

// Clean names must pass through byte-identical (zero regression on the common case).
for (const clean of [
  'Old map', 'Rand McNally 1893', 'Panama Canal Zone', 'wmts.example.org · 3',
  'City Plan (North Sheet)', 'A-B_C 12', '',
]) {
  t(`clean unchanged: ${clean}`, () => assert.strictEqual(escHtml(clean), clean));
}

// The load-bearing cases: the five HTML-significant chars must all be escaped.
t('ampersand → &amp;', () => assert.strictEqual(escHtml('Baist & Sanborn'), 'Baist &amp; Sanborn'));
t('double-quote → &quot; (attribute breakout)', () =>
  assert.strictEqual(escHtml('The "New" World'), 'The &quot;New&quot; World'));
t('single-quote → &#39;', () => assert.strictEqual(escHtml("O'Neill's map"), 'O&#39;Neill&#39;s map'));
t('less-than → &lt;', () => assert.strictEqual(escHtml('a<b'), 'a&lt;b'));
t('greater-than → &gt;', () => assert.strictEqual(escHtml('a>b'), 'a&gt;b'));

// A real injection attempt is fully neutralized — no live < or " survives.
t('script-in-title cannot break the attribute or inject a tag', () => {
  const out = escHtml('x"><img src=q onerror=alert(1)>');
  assert.ok(!/[<>"]/.test(out), `raw < > or " survived: ${out}`);
  assert.strictEqual(out, 'x&quot;&gt;&lt;img src=q onerror=alert(1)&gt;');
});

// Ampersand escaped FIRST so an already-safe pass isn't double-processed wrong.
t('ampersand-first ordering: &lt; stays &amp;lt;', () =>
  assert.strictEqual(escHtml('&<'), '&amp;&lt;'));

// Null/undefined coerce to empty string, never throw.
t('null → empty', () => assert.strictEqual(escHtml(null), ''));
t('undefined → empty', () => assert.strictEqual(escHtml(undefined), ''));

console.log(`escHtml: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
