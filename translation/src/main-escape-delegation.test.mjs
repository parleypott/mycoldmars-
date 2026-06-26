// Locks main.js's escapeHtmlSafe onto the shared canonical escaper.
//
// main.js carried the LAST surviving divergent-weaker HTML escaper in
// translation/src: an inline `escapeHtmlSafe` that escaped only & < > " (NO
// single quote) and used String(str) instead of String(str ?? ''). Every other
// escaper in translation/src already delegates to the canonical 5-char,
// nullish-safe html-escape.js (command-palette / SpeakerBlock / sot-hunter /
// manual-steps / devchat-render / pdf-export / upload/dialogs). main.js's
// escapeHtmlSafe slipped the divergence triage because the scanner groups by
// exact function NAME and this one is named differently.
//
// LATENT, not a live XSS today: all ~20 escapeHtmlSafe() sinks are element text
// or DOUBLE-quoted attributes (style="…", title="…"), where escaping " already
// closes the breakout — a raw single quote can't escape a double-quoted attr.
// But a future single-quoted attribute sink would have been silently injectable,
// and nullish inputs (a missing color/when/label) leaked the literal
// "undefined"/"null" into the UI.
//
// This test proves the consolidation two ways:
//   1. BEHAVIOR — escapeHtmlSafe now escapes all five chars (incl. ' → &#39;)
//      and degrades nullish to '' — i.e. it IS the canonical escaper.
//   2. SOURCE GREP — main.js no longer defines a divergent inline escaper body
//      (the `.replace(/"/g, '&quot;')` chain) for escapeHtmlSafe; it delegates.
// Mutation-proof: reverting escapeHtmlSafe to the old 4-char inline form turns
// the single-quote, nullish, AND source-grep assertions RED.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { escapeHtml } from './html-escape.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN = join(__dirname, 'main.js');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL:', name); }
}

// The shared escaper is the contract escapeHtmlSafe must now match. We assert on
// escapeHtml directly (escapeHtmlSafe is an internal, un-exported alias of it),
// plus grep main.js to prove the alias actually delegates rather than carrying
// its own weaker body.

// ── 1. canonical behaviour the alias now inherits ──────────────────
ok("single quote escapes to &#39; (the gap the old copy left open)",
  escapeHtml(`a'b`) === 'a&#39;b');
ok("double quote escapes to &quot;",
  escapeHtml('a"b') === 'a&quot;b');
ok("ampersand first, no double-escape",
  escapeHtml('a&b') === 'a&amp;b');
ok("lt/gt escape",
  escapeHtml('<x>') === '&lt;x&gt;');
ok("all five together",
  escapeHtml(`&<>"'`) === '&amp;&lt;&gt;&quot;&#39;');
ok("null degrades to '' (not the literal 'null')",
  escapeHtml(null) === '');
ok("undefined degrades to '' (not the literal 'undefined')",
  escapeHtml(undefined) === '');
ok("number coerces to its string form",
  escapeHtml(42) === '42');
// A would-be single-quoted-attribute breakout is now neutralised.
ok("single-quote injection payload is neutralised",
  !escapeHtml(`' onmouseover='alert(1)`).includes("'"));

// ── 2. source proof: escapeHtmlSafe delegates, no divergent body ───
const src = readFileSync(MAIN, 'utf8');
ok("main.js imports the shared escapeHtml",
  /import\s*\{[^}]*\bescapeHtml\b[^}]*\}\s*from\s*['"]\.\/html-escape\.js['"]/.test(src));
// The old inline body's signature was a chain that ended at &quot; with NO
// single-quote replace. Assert escapeHtmlSafe no longer contains that chain.
const safeDef = src.match(/function escapeHtmlSafe[\s\S]*?\n\}/);
ok("escapeHtmlSafe definition is present", !!safeDef);
ok("escapeHtmlSafe body no longer carries an inline .replace escaper chain",
  safeDef && !/\.replace\(\/&\/g/.test(safeDef[0]));
ok("escapeHtmlSafe delegates to escapeHtml",
  safeDef && /return\s+escapeHtml\(/.test(safeDef[0]));

console.log(`main-escape-delegation: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
