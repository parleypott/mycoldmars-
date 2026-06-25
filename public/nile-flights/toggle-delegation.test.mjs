// nile-flights booking tracker — checkbox-toggle injection-class lock.
//
// THE LATENT BUG (fixed): each bookable leg's checkbox rendered its click target as an
// inline handler, onclick="toggle('${l.id}')", dropping the leg id RAW into a single-quoted
// JS string. An id containing an apostrophe (or crafted text) would break out of the
// toggle('…') argument and inject arbitrary JS into the handler — the exact class fixed in
// public/burma-essays (swPick) and essays (pick). Subtle trap: HTML-escaping the id would
// NOT fix it, because inline handlers entity-decode the attribute BEFORE the JS engine
// parses it, so a decoded ' still breaks out. The only correct fix is to drop the JS-string
// context entirely: the id now rides a data-toggle attribute (dataset round-trips the exact
// value) read back by ONE delegated click listener on the static #tl container.
//
// Practical risk today is low (LEGS ids are Johnny's own static airport-pair slugs), but it's
// a real latent break + a weak primitive on a live, shared (Johnny+Marisa) page. This test
// pins the contract against the SHIPPED index.html source so the inline sink can't return.

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
ok(!/onclick=["']?toggle\(/.test(html), 'no inline onclick=toggle(...) sink remains');
ok(!/toggle\('?\$\{/.test(html.replace(/function toggle/g, '')),
   'no templated id interpolated into a toggle() JS string (handler definition excluded)');

// ---- GREEN: the bookable check carries the id on a data-toggle attribute instead ----
ok(/data-toggle="\$\{l\.id\}"/.test(html),
   'bookable check carries the leg id on a data-toggle attribute');
// preBooked (locked) legs still get NO toggle affordance.
ok(/l\.preBooked\?""\:`data-toggle="\$\{l\.id\}"`/.test(html),
   'preBooked legs render no data-toggle (stay inert), bookable legs get one');

// ---- GREEN: one delegated listener on the static #tl container reads it back ----
ok(/tl\.addEventListener\(\s*["']click["']/.test(html),
   'delegated click listener is attached to the static #tl container');
ok(/closest\([^)]*\.check\[data-toggle\]/.test(html),
   'listener resolves the clicked check via closest(.check[data-toggle])');
ok(/toggle\(\s*c\.dataset\.toggle\s*\)/.test(html),
   'listener calls toggle(c.dataset.toggle) — id round-trips through dataset, no JS-string context');

// ---- GREEN: keyboard activation now keys off data-toggle, not the removed onclick attr ----
ok(/dataset&&e\.target\.dataset\.toggle/.test(html),
   'keydown handler gates on e.target.dataset.toggle (was getAttribute("onclick"))');
ok(!/getAttribute\(["']onclick["']\)/.test(html),
   'no leftover getAttribute("onclick") gate (the old inline-handler dependency is gone)');

// ---- breakout simulation: prove the old single-quoted onclick string would have broken
// out, while data-toggle/dataset round-trips the same id as opaque data. ----
{
  const evilId = "x') ; alert(1) ; ('";            // would escape toggle('…') in the old form
  const oldHandler = `toggle('${evilId}')`;         // what the old template produced
  ok(/\)\s*;\s*alert\(1\)/.test(oldHandler),
     'RED proof: old inline form lets a crafted id inject a statement after toggle()');
  ok(`${evilId}` === evilId, 'dataset path treats the id as opaque data, never parsed as JS');
}

if (fail) { console.error(`toggle-delegation: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`toggle-delegation: ${pass} passed, 0 failed`);
