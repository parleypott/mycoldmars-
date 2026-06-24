// Locks the two PURE guards on the interpreter's transcript-export path:
//   esc()          — pdf-export.js — the XSS boundary. Every user-typed tag
//                    name / color / note flows through esc() into the HTML that
//                    exportHighlightsPDF writes with win.document.write(html).
//                    The doc string warns about a real attribute-breakout hole
//                    that a prior fix closed; this LOCKS it so a future edit
//                    can't silently reopen it.
//   safeFilename() — summary-export.js — the download-filename sanitizer.
//
// Both are pure + freeze-independent (no deploy needed to verify). Imports the
// REAL shipped functions. Mutation-proven a real verifier — see the journal for
// the mutations that each go RED.

import assert from 'node:assert';
import { esc } from './pdf-export.js';
import { safeFilename } from './summary-export.js';

let pass = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); pass++; };
const ok = (c, m) => { assert.ok(c, m); pass++; };

// ── esc(): all five entities ───────────────────────────────────────────────
eq(esc('&'), '&amp;', 'ampersand escaped');
eq(esc('<'), '&lt;', 'less-than escaped');
eq(esc('>'), '&gt;', 'greater-than escaped');
eq(esc('"'), '&quot;', 'double-quote escaped (style-attribute context)');
eq(esc("'"), '&#39;', 'single-quote escaped');

// Ampersand MUST be replaced first, else < > " ' entities get double-escaped.
eq(esc('<&>'), '&lt;&amp;&gt;', 'ampersand-first ordering: no double escaping');
eq(esc('a & b < c'), 'a &amp; b &lt; c', 'mixed text escaped correctly');

// ── esc(): the documented attribute-breakout attack ────────────────────────
// A tag color stored as `red;"><script>alert(1)</script>` is embedded inside a
// double-quoted style="background:..." attribute. esc() MUST neutralize the
// quote AND the angle brackets so it cannot break out of the attribute.
const attack = 'red;"><script>alert(1)</script>';
const escaped = esc(attack);
ok(!escaped.includes('"'), 'attack: raw double-quote neutralized');
ok(!escaped.includes('<'), 'attack: raw < neutralized');
ok(!escaped.includes('>'), 'attack: raw > neutralized');
ok(!/<script/i.test(escaped), 'attack: no live <script in output');
eq(esc('red;"'), 'red;&quot;', 'attack fragment: quote-breakout closed');

// Single-quote attribute breakout (defensive — some attrs are single-quoted).
ok(!esc("x' onmouseover='alert(1)").includes("'"), 'single-quote breakout closed');

// ── esc(): INLINE RED PROOF — the OLD &<>-only escaper let the attack through ─
// Reconstructs the pre-fix escaper the doc string warns about and proves the
// breakout quote SURVIVED it, while the shipped esc() neutralizes it.
const oldEsc = (str) =>
  String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
ok(oldEsc(attack).includes('"'), 'RED proof: old escaper LEFT the breakout quote raw');
ok(!esc(attack).includes('"'), 'GREEN: shipped esc() closes the breakout quote');

// ── esc(): nullish + coercion + safe passthrough ───────────────────────────
eq(esc(null), '', 'null → empty string');
eq(esc(undefined), '', 'undefined → empty string');
eq(esc(0), '0', 'number 0 coerced (not dropped as falsy)');
eq(esc(42), '42', 'number coerced to string');
eq(esc(''), '', 'empty string stays empty');
eq(esc('Day 2 — Market'), 'Day 2 — Market', 'safe text passes through unchanged');
eq(esc('#DD2C1E'), '#DD2C1E', 'a normal hex color is untouched');

// ── safeFilename(): documented behavior ────────────────────────────────────
eq(safeFilename('My File'), 'my-file', 'space → dash, lowercased');
eq(safeFilename('My___File'), 'my___file', 'underscores preserved (no dash-bloat conversion)');
eq(safeFilename('report.final.txt'), 'report.final.txt', 'dots preserved');
eq(safeFilename('a-b_c.d'), 'a-b_c.d', 'allowed punctuation kept');
eq(safeFilename('  spaced  '), 'spaced', 'leading/trailing dashes stripped');
eq(safeFilename('---abc---'), 'abc', 'leading/trailing dash runs stripped');
eq(safeFilename('...hidden'), 'hidden', 'leading dots stripped');
eq(safeFilename('Café Über'), 'caf-ber', 'non-ascii letters become a single dash');

// degenerate inputs → the 'untitled' floor, never an empty download name
eq(safeFilename('***'), 'untitled', 'all-special → untitled');
eq(safeFilename(''), 'untitled', 'empty → untitled');
eq(safeFilename(null), 'untitled', 'null → untitled');
eq(safeFilename(undefined), 'untitled', 'undefined → untitled');
eq(safeFilename('   '), 'untitled', 'whitespace-only → untitled');

// length cap
ok(safeFilename('a'.repeat(500)).length <= 120, 'capped at 120 chars');

// ── safeFilename(): truncation must NOT leave a dangling separator ─────────────
// The cap can land the 120-char cut on a separator. Stripping leading/trailing
// dashes BEFORE the slice (the prior order) re-introduced that dash into the
// download name ("…title--summary.txt"). These lock the strip-after-slice fix.
// RED proof: the buggy order (strip then slice) leaves a trailing dash on both.
{
  const cutOnDash = 'a'.repeat(119) + ' bcd';          // 120th char becomes '-'
  const r1 = safeFilename(cutOnDash);
  ok(r1.length <= 120, 'truncated name still within cap');
  ok(!/[-.]$/.test(r1), 'truncation does not leave a trailing separator (cut-on-dash)');

  const longSpaced = 'My Long Burma Interview Title '.repeat(6);  // realistic long name
  const r2 = safeFilename(longSpaced);
  ok(!/[-.]$/.test(r2), 'truncation does not leave a trailing separator (long spaced name)');
  ok(!/^[-.]/.test(r2), 'no leading separator after the cap either');

  // Prove the OLD order was actually buggy (strip BEFORE slice keeps the dash).
  const oldOrder = (s) => String(s || 'untitled')
    .replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '').toLowerCase().slice(0, 120) || 'untitled';
  ok(/[-.]$/.test(oldOrder(cutOnDash)), 'RED proof: old strip-then-slice order LEFT a trailing dash');
  ok(!/[-.]$/.test(safeFilename(cutOnDash)), 'GREEN: shipped strip-after-slice order removes it');
}

// degenerate cap case: a name that is ALL separators past the cap still floors to 'untitled'
eq(safeFilename('-'.repeat(200)), 'untitled', 'all-separator long name → untitled (not a bare dash)');

console.log(`export-guards: ${pass}/${pass} GREEN`);
