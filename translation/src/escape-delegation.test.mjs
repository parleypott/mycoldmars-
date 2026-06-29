// Lock: four more Interpreter-client renderers must escape user/model strings
// through the SHARED html-escape boundary, not a private copy.
//
//   - workshop/index.js                  — Soundbite Workshop render
//   - command-palette.js                 — ⌘K palette render
//   - sot-hunter.js                      — soundbite-hunter result render
//   - editor/extensions/SpeakerBlock.js  — rename-speaker prompt
//
// WHY THIS EXISTS: workshop/index.js carried its OWN local escapeHtml that
// escaped only & < > — missing BOTH " and ' — the WEAKEST twin found in the
// translation tree (the dialogs.js twin at least escaped "). Every current
// workshop sink is text content, so it was latent, but it lived right next to a
// separate escapeAttr and any future attribute interpolation through escapeHtml
// (the natural mistake, since the other three copies WERE attribute-safe) would
// have been silently injectable. The other three carried byte-equivalent-but-
// duplicated copies — same divergent-twin trap that has paid the bug tax ~200x
// in this repo. All four now delegate to translation/src/html-escape.js.
//
// Run: bun translation/src/escape-delegation.test.mjs
//      (auto-discovered by scripts/run-tests.mjs)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { escapeHtml } from './html-escape.js';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✗ ${msg}`); } };

// (relative-to-HERE source path, import path it must use)
const FILES = [
  ['workshop/index.js', '../html-escape.js'],
  ['command-palette.js', './html-escape.js'],
  ['sot-hunter.js', './html-escape.js'],
  ['editor/extensions/SpeakerBlock.js', '../../html-escape.js'],
];

for (const [rel, importPath] of FILES) {
  const src = readFileSync(join(HERE, rel), 'utf8');
  const importRe = new RegExp(
    `import\\s*\\{[^}]*\\bescapeHtml\\b[^}]*\\}\\s*from\\s*['"]${importPath.replace(/[.\/]/g, m => '\\' + m)}['"]`
  );
  ok(importRe.test(src), `${rel} imports escapeHtml from ${importPath}`);
  // and carries NO private escapeHtml definition (the divergent-twin trap)
  ok(!/function\s+escapeHtml\b/.test(src), `${rel} has no local \`function escapeHtml\``);
  ok(!/\b(const|let|var)\s+escapeHtml\s*=/.test(src), `${rel} has no local \`escapeHtml =\``);
}

// ── the shared escaper they now use neutralizes ALL FIVE significant chars ──
ok(escapeHtml('&').includes('&amp;'), 'escapes &');
ok(escapeHtml('<script>').includes('&lt;'), 'escapes <');
ok(escapeHtml('a>b').includes('&gt;'), 'escapes >');
ok(escapeHtml('x" onmouseover="alert(1)') && !escapeHtml('x" y').includes('"'),
   'escapes " (a double-quoted-attr breakout is neutralized)');
ok(!escapeHtml("x' onmouseover='alert(1)").includes("'"),
   "escapes ' (a single-quoted-attr breakout is neutralized)");

// ── RED proof: the OLD workshop escaper (& < > only) LEFT both quotes raw ──
{
  const oldWorkshopWeak = (str) => String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  ok(oldWorkshopWeak('x"y').includes('"'),
     'RED proof: old workshop escaper left the double quote raw');
  ok(oldWorkshopWeak("x'y").includes("'"),
     'RED proof: old workshop escaper left the single quote raw');
  ok(!escapeHtml('x"y').includes('"') && !escapeHtml("x'y").includes("'"),
     'the shared escaper workshop adopted leaves NEITHER quote raw');
}

console.log(`escape-delegation: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
