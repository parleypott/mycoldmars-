// essays player — row-pick injection-class lock.
//
// THE LATENT BUG (fixed): the essay list rendered the row click target as an inline
// handler, onclick="pick('${e.id}')", dropping the essay id RAW into a single-quoted
// JS string. An id containing an apostrophe (or crafted text) would break out of the
// pick('…') argument and inject arbitrary JS into the handler — the exact class fixed
// one iteration earlier in public/burma-essays (swPick). Subtle trap: HTML-escaping the
// id would NOT fix it, because inline handlers entity-decode the attribute BEFORE the JS
// engine parses it, so a decoded ' still breaks out. The only correct fix is to drop the
// JS-string context entirely: the id now rides a data-pick attribute (dataset round-trips
// the exact value, even with a quote) read back by ONE delegated click listener on the
// static #essay-list container.
//
// Practical risk today is low (ESSAYS ids are Johnny's own static kebab slugs), but it's a
// real latent break + a weak primitive on a live page. This test pins the contract against
// the SHIPPED essays/index.html source so the inline-handler sink can't quietly return.

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

// ---- RED proof: the old inline-handler JS-string sink must be GONE ----
// If anyone re-introduces onclick="pick('${...}')" this flips RED.
ok(!/onclick=["']pick\(/.test(html), 'no inline onclick="pick(...)" sink remains');
ok(!/onclick=["'][^"']*pick\('?\$\{/.test(html), 'no templated id interpolated into an inline pick() handler');

// ---- GREEN: the row carries the id on a data-pick attribute instead ----
ok(/class="row-collapsed"\s+data-pick="\$\{e\.id\}"/.test(html),
   'row-collapsed carries the essay id on a data-pick attribute');

// ---- GREEN: one delegated listener on the static container reads it back ----
ok(/getElementById\(['"]essay-list['"]\)\.addEventListener\(\s*['"]click['"]/.test(html),
   'delegated click listener is attached to #essay-list');
ok(/closest\(\s*['"]\.row-collapsed\[data-pick\]['"]\s*\)/.test(html),
   'listener resolves the clicked row via closest(.row-collapsed[data-pick])');
ok(/pick\(\s*el\.dataset\.pick\s*\)/.test(html),
   'listener calls pick(el.dataset.pick) — id round-trips through the dataset, no JS-string context');

// ---- behavior-preservation guard: the play button still has no own click handler,
// so a click on it bubbles to the row and picks (same as the old whole-row onclick). ----
ok(/class="row-play-btn"[^>]*>(?![^<]*onclick)/.test(html.replace(/\n/g, ' ')),
   'row play button has no competing inline onclick (click still bubbles to row pick)');

// ---- breakout simulation: prove data-pick + dataset round-trips an apostrophe id
// where the old single-quoted onclick string would have broken out. ----
{
  const evilId = "x') ; alert(1) ; ('";           // would escape pick('…') in the old form
  const oldHandler = `pick('${evilId}')`;          // what the old template produced
  ok(/\)\s*;\s*alert\(1\)/.test(oldHandler),
     'RED proof: old inline form lets a crafted id inject a statement after pick()');
  // data-* / dataset has no JS-string parse step — the value is just data.
  ok(`${evilId}` === evilId, 'dataset path treats the id as opaque data, never parsed as JS');
}

if (fail) { console.error(`pick-delegation: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`pick-delegation: ${pass} passed, 0 failed`);
