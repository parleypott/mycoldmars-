// nile-flights booking tracker — booker-name innerHTML escape lock.
//
// THE LATENT BUG (fixed): the booked-status card interpolated the booker name RAW
// into innerHTML — `<span class="by">${who} ...` where `who` was `· ${info.by}`.
// info.by is the ONE user-entered, server-round-tripped value on this page (typed
// into #who by Johnny/Marisa/the EA, persisted to Supabase, read back on every
// poll). A name containing "<" (e.g. "A<B", "me<3") would have the browser treat it
// as a bogus tag open and swallow following markup until the next ">", corrupting the
// card; an "&" could mis-decode. This is the same render-integrity class the repo has
// closed at every other innerHTML sink. Sibling of toggle-delegation.test.mjs, which
// locked the OTHER sink on this page (the checkbox JS-string). Practical risk is low
// (names rarely contain "<"), but it's a real latent break on a live, shared page and
// the page's own standard is to pin these sinks so they can't return.
//
// The fix routes info.by through an inline esc() before interpolation. This test pins
// the contract against the SHIPPED index.html so the raw sink can't come back.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  try { assert.ok(cond, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};

// ---- RED proof: the booker name must never be interpolated raw into innerHTML ----
ok(!/`·\s*\$\{info\.by\}`/.test(html),
   'no raw `· ${info.by}` interpolation remains (would corrupt the card on a "<" name)');

// ---- GREEN: an esc() helper is defined and used on the booker name ----
ok(/const esc\s*=/.test(html), 'an esc() escaping helper is defined');
ok(/\$\{esc\(info\.by\)\}/.test(html), 'the booker name rides through esc(info.by) before innerHTML');

// ---- behaviour: replicate the SHIPPED esc() and prove it neutralizes the break ----
// Pull the exact esc() body out of the source so this test locks the real function,
// not a hand-copy, and executes it against the dangerous cases.
{
  const m = html.match(/const esc\s*=\s*(s=>String\(s\)\.replace\([\s\S]*?\}\[c\]\)\));/);
  ok(!!m, 'esc() body is extractable from the source for behavioural check');
  if (m) {
    // eslint-disable-next-line no-eval
    const esc = eval('(' + m[1] + ')');
    ok(esc('A<B') === 'A&lt;B', 'esc turns "<" into &lt; (stops the tag-open swallow)');
    ok(esc('Jo & Marisa') === 'Jo &amp; Marisa', 'esc turns "&" into &amp;');
    ok(esc('"Q"') === '&quot;Q&quot;', 'esc turns double-quote into &quot;');
    ok(esc("O'Neil") === 'O&#39;Neil', 'esc turns apostrophe into &#39;');
    ok(esc('Marisa') === 'Marisa', 'esc leaves a clean name byte-identical (zero regression)');
    ok(esc('EA') === 'EA', 'esc leaves the "EA" fallback byte-identical');
    // mutation proof: the RED assertion above fails if esc is bypassed — confirm the
    // dangerous input actually differs from its escaped form, so the guard is load-bearing.
    ok(esc('A<B') !== 'A<B', 'escaped output genuinely differs from the raw dangerous input');
  }
}

if (fail) { console.error(`booker-escape: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`booker-escape: ${pass} passed, 0 failed`);
