// Locks STRUCTURE's escHtml — the HTML-text escaper that guards every innerHTML
// sink fed by user-entered card fields (labelTag, source), the shared toast
// message sink, and the footage-type badge label.
//
// escHtml is an inline function in public/structure/index.html (a standalone,
// no-build public page), so we slice its source at runtime and eval it, then
// mutation-prove:
//   (1) it neutralizes an <img onerror> injection (the labelTag/source path is
//       genuinely user-entered; a future `title="${labelTag}"` hover feature
//       would make a <-only escape an attribute-breakout XSS),
//   (2) it covers ALL FIVE metacharacters (& < > " '), not just <,
//   (3) it is byte-identical to raw output for plain text — so escaping the
//       toast/badge sinks changed zero visible output for the current callers.
//
// If someone weakens escHtml back to a <-only replace (the old divergent form),
// assertions (1)/(2) go RED.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'index.html'), 'utf8');

// Slice the inline `function escHtml(...) { ... }` declaration out of the page.
const m = src.match(/function escHtml\(s\)\{[\s\S]*?\}\n/);
assert.ok(m, 'escHtml function not found in structure/index.html — did it get renamed/removed?');
const escHtml = eval('(' + m[0].replace(/^function escHtml/, 'function') + ')');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };

// (1) Injection is neutralized — no live angle brackets survive.
const payload = '<img src=x onerror=alert(1)>';
const escaped = escHtml(payload);
ok(!/<img/i.test(escaped), 'escaped payload must not contain a live <img tag');
ok(!escaped.includes('<') && !escaped.includes('>'), 'no raw angle brackets survive escaping');
eq(escHtml('<script>'), '&lt;script&gt;', '<script> fully escaped');

// (2) All five metacharacters covered (not just <).
eq(escHtml('&'), '&amp;', 'ampersand escaped');
eq(escHtml('<'), '&lt;', 'lt escaped');
eq(escHtml('>'), '&gt;', 'gt escaped');
eq(escHtml('"'), '&quot;', 'double-quote escaped (attribute-context safety)');
eq(escHtml("'"), '&#39;', 'single-quote escaped (attribute-context safety)');
// A value that would break out of a title="..." attribute is neutralized:
ok(!/"/.test(escHtml('a" onmouseover="alert(1)')), 'double-quote breakout neutralized');

// (3) Byte-identical for plain text — the real current callers (literal toast
// strings, plain label tags, const footage labels) render unchanged.
for (const s of ['B-Roll', 'Story Beat', 'INT 01', '00:12:34', 'Board exported as PNG.',
                 'A-CAM take 3', 'wide shot — dawn', '']) {
  eq(escHtml(s), s, `plain text unchanged: ${JSON.stringify(s)}`);
}
// Nullish coerces to empty string (matches the `card.labelTag && ...` guards).
eq(escHtml(null), '', 'null -> empty');
eq(escHtml(undefined), '', 'undefined -> empty');

// Apostrophe in a real toast string renders identically to the eye (&#39; -> ').
eq(escHtml("doesn't look like a STRUCTURE backup."), 'doesn&#39;t look like a STRUCTURE backup.',
   "apostrophe escaped but visually identical");

console.log(`ok - structure escHtml locked (${n} assertions)`);
