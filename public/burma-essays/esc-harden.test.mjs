// Mutation-locked tests for the Burma Essays PWA escaper + switcher sink.
// Run: bun public/burma-essays/esc-harden.test.mjs  (auto-discovered by scripts/run-tests.mjs)
//
// Two load-bearing facts this locks:
//  1. esc() escapes the single quote (')  — it was the ONLY escaper in the repo
//     that omitted it (every sibling escapes [&<>"']). The omission mattered
//     because esc(e.id) used to be interpolated into an inline-handler JS string
//     ( onclick="swPick('…')" ), where an apostrophe breaks out of the argument.
//  2. The switcher no longer uses that inline JS-string sink at all: the essay id
//     rides a data-id attribute (esc's "-escaping protects the double-quoted
//     attribute, and dataset.id round-trips the exact value) + a delegated click.
//     Belt and suspenders — even if esc regressed, there's no JS-string context.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

// Pull the LIVE esc() out of the page source and run it, so the test tracks the
// real shipped function rather than a hand-copy that could drift.
function liveEsc() {
  const m = html.match(/function esc\(s\)\{[\s\S]*?\}\s*\n/);
  assert.ok(m, 'esc(s) function must be present in index.html');
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + '\nreturn esc;')();
}
const esc = liveEsc();

t('escapes the single quote (the load-bearing harmonization)', () => {
  // The buggy form (charclass [&<>"], no ') leaves this as a bare ' and goes RED.
  assert.equal(esc("a'b"), 'a&#39;b');
  assert.equal(esc("''"), '&#39;&#39;');
});

t('still escapes the other four HTML-significant chars', () => {
  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('>'), '&gt;');
  assert.equal(esc('"'), '&quot;');
});

t('combined / real-world payloads escape fully (no breakout chars survive)', () => {
  assert.equal(esc(`<b>&"'`), '&lt;b&gt;&amp;&quot;&#39;');
  const out = esc(`'); alert(1)//`);
  assert.ok(!/[<>"']/.test(out.replace(/&[a-z#0-9]+;/g, '')),
    'no raw breakout char may survive escaping');
  assert.ok(out.startsWith('&#39;'), 'leading apostrophe must be neutralized');
});

t('falsy / non-string input degrades to empty string, never throws', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(''), '');
});

t('switcher uses a data-id attribute, NOT an inline swPick() JS-string sink', () => {
  // The dangerous inline form must be gone...
  assert.ok(!/onclick="swPick\('/.test(html),
    'inline swPick() JS-string sink must not exist');
  // ...replaced by the esc-protected data-id attribute...
  assert.ok(/data-id="\$\{esc\(e\.id\)\}"/.test(html),
    'essay id must ride an esc-protected data-id attribute');
  // ...read back via delegated click on .sw-item[data-id].
  assert.ok(/closest\('\.sw-item\[data-id\]'\)/.test(html),
    'a delegated click must resolve the id from dataset, not an inline handler');
});

console.log(`\n${pass} passed, 0 failed`);
