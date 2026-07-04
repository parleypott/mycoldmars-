// Locks the attribute-safety contract of the Interpreter client's esc() helper.
//
// esc() replaced a former local main.js escaper that escaped only & < > (a DOM
// textContent->innerHTML round-trip never quote-escapes text nodes), which was
// interpolated into ~40 double-quoted attribute contexts. A value carrying a "
// (a filename like `Interview "final".mp4`, or a synced editor name/color) broke
// out of the attribute. The load-bearing assertions here are the QUOTE ones:
// neutering esc() back to a & < > -only form turns them RED.
import assert from 'node:assert/strict';
import { esc } from './esc.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

// ── Load-bearing: quotes MUST be escaped (the whole point of the fix) ──
t('escapes double quote so it cannot break out of title="…"', () => {
  assert.equal(esc('Interview "final".mp4'), 'Interview &quot;final&quot;.mp4');
});
t('escapes single quote', () => {
  assert.equal(esc("O'Brien"), 'O&#39;Brien');
});
t('a crafted attribute-breakout payload is fully neutralized', () => {
  const out = esc('x" onmouseover="alert(1)');
  assert.ok(!out.includes('"'), 'raw double quote must not survive');
  assert.equal(out, 'x&quot; onmouseover=&quot;alert(1)');
});

// ── The three chars the old form already handled — unchanged ──
t('escapes & < >', () => {
  assert.equal(esc('a<b>&c'), 'a&lt;b&gt;&amp;c');
});
t('ampersand escaped first — no double-escaping', () => {
  assert.equal(esc('Tom & Jerry'), 'Tom &amp; Jerry');
});

// ── Falsy behavior preserved byte-for-byte (old esc did `if(!str) return ''`) ──
t('empty string -> empty', () => { assert.equal(esc(''), ''); });
t('null -> empty (never "null")', () => { assert.equal(esc(null), ''); });
t('undefined -> empty (never "undefined")', () => { assert.equal(esc(undefined), ''); });
t('numeric 0 -> empty (matches old `if(!str)` short-circuit)', () => {
  assert.equal(esc(0), '');
});
t('false -> empty', () => { assert.equal(esc(false), ''); });

// ── Truthy non-strings coerce like the shared escaper ──
t('a truthy number coerces to its string form', () => {
  assert.equal(esc(42), '42');
});

// ── Quote-free strings are byte-identical to the old form ──
t('plain text is passed through unchanged', () => {
  assert.equal(esc('My Best Take.mp4'), 'My Best Take.mp4');
});

console.log(`esc.test.mjs: ${pass} assertions passed`);
