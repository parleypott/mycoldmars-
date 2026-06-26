// Lock: the upload-flow modals (translation/src/upload/dialogs.js) must escape
// user-supplied strings through the SHARED html-escape boundary, not a private
// copy. dialogs.js renders attacker-influenceable values straight into innerHTML
// — the uploaded FILENAME (title="…" + text), each detected SPEAKER NAME
// (data-speaker="…" + text), the signed audio URL (data-deferred-src="…"), and
// the mime label — so its escaper is a real XSS boundary.
//
// WHY THIS EXISTS: dialogs.js used to carry its OWN inline escapeHtml that
// escaped & < > " but NOT the single quote '. Today that's latent (every sink
// here is a double-quoted attribute or text, both covered by escaping "), but it
// was the lone weaker twin of the canonical translation/src/html-escape.js
// (which escapes all five chars incl. '), so any future single-quoted attribute
// added here would have been silently injectable. This test pins dialogs.js to
// the shared escaper and fails RED if a divergent local copy is reintroduced.
//
// Run: bun translation/src/upload/dialogs-escape-delegation.test.mjs
//      (auto-discovered by scripts/run-tests.mjs)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { escapeHtml } from '../html-escape.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'dialogs.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✗ ${msg}`); } };

// ── dialogs.js delegates to the shared boundary ──
ok(/import\s*\{[^}]*\bescapeHtml\b[^}]*\}\s*from\s*['"]\.\.\/html-escape\.js['"]/.test(SRC),
   'dialogs.js imports escapeHtml from ../html-escape.js');

// ── and carries NO private escapeHtml definition (the divergent-twin trap) ──
ok(!/function\s+escapeHtml\b/.test(SRC),
   'dialogs.js has no local `function escapeHtml` definition');
ok(!/\b(const|let|var)\s+escapeHtml\s*=/.test(SRC),
   'dialogs.js has no local `escapeHtml =` definition');

// ── the shared escaper dialogs.js now uses neutralizes BOTH quote styles ──
// (the exact gap the old local copy had: ' was left raw).
ok(escapeHtml("O'Brien's file.mov") === 'O&#39;Brien&#39;s file.mov',
   'single-quote (the old gap) is escaped → &#39;');
ok(!escapeHtml("x' onmouseover='alert(1)").includes("'"),
   'a single-quoted-attribute breakout is neutralized');
ok(!escapeHtml('x" onmouseover="alert(1)').includes('"'),
   'a double-quoted-attribute breakout is neutralized');
ok(!escapeHtml('<script>alert(1)</script>').includes('<script>'),
   'a raw <script> tag is neutralized');

// ── RED proof: the OLD weaker local escaper would have FAILED the quote check ──
{
  const oldWeak = (str) => String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  ok(oldWeak("O'Brien").includes("'"),
     'RED proof: the old &<>"-only escaper LEFT the single quote raw');
  ok(!escapeHtml("O'Brien").includes("'"),
     'the shared escaper dialogs.js adopted does NOT leave it raw');
}

console.log(`dialogs-escape-delegation: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
