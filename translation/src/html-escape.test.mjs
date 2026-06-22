// Lock for the shared HTML-escape boundary (translation/src/html-escape.js) —
// the single source of truth that manual-steps.js esc(), devchat-render.js
// escDc(), and export/pdf-export.js esc() all now delegate to. A regression
// here is an XSS hole in three places at once (the devchat public-message
// render is the worst — anonymous attacker-controllable input), so this suite
// is mutation-proven: it must go RED if any of the five entities, the
// ampersand-first ordering, or the nullish-degradation is broken.
//
// Run: bun translation/src/html-escape.test.mjs   (auto-discovered by run-tests.mjs)

import { escapeHtml } from './html-escape.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`  ✗ ${msg}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✗ ${msg}`); } };

// ── inline RED proof: a naive <>-only escaper leaves the attribute-breakout
// quote intact; escapeHtml must neutralize it. (If escapeHtml ever stops
// escaping ", a value used inside href="..." can break out and inject an
// event handler — the exact pdf-export attribute-breakout incident.)
{
  const naive = (s) => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attack = 'red;"><script>alert(1)</script>';
  ok(naive(attack).includes('"'), 'RED proof: naive <>-only escaper LEAVES the breakout quote');
  ok(!escapeHtml(attack).includes('"'), 'escapeHtml neutralizes the attribute-breakout quote');
  ok(!escapeHtml(attack).includes('<script>'), 'escapeHtml neutralizes a raw <script>');
}

// ── the five entities, each in isolation ──
eq(escapeHtml('&'), '&amp;', 'ampersand');
eq(escapeHtml('<'), '&lt;', 'less-than');
eq(escapeHtml('>'), '&gt;', 'greater-than');
eq(escapeHtml('"'), '&quot;', 'double-quote');
eq(escapeHtml("'"), '&#39;', 'single-quote');

// ── ampersand FIRST (no double-escape of the entities it emits) ──
eq(escapeHtml('a & b'), 'a &amp; b', 'ampersand in prose');
eq(escapeHtml('<a & b>'), '&lt;a &amp; b&gt;', 'mixed: tag + ampersand, no double-escape');
ok(!escapeHtml('&').includes('&amp;amp;'), 'ampersand not double-escaped');
eq(escapeHtml('&amp;'), '&amp;amp;', 'an already-entity is escaped once more (raw &), not doubled twice');

// ── real attack strings ──
eq(escapeHtml('<script>alert(1)</script>'),
   '&lt;script&gt;alert(1)&lt;/script&gt;', 'script tag fully neutralized');
ok(!escapeHtml('x" onmouseover="alert(1)').includes('"'),
   'event-handler breakout quote escaped');
ok(!escapeHtml("x' onmouseover='alert(1)").includes("'"),
   'single-quote handler breakout escaped');

// ── nullish / coercion ──
eq(escapeHtml(null), '', 'null → empty string (not "null")');
eq(escapeHtml(undefined), '', 'undefined → empty string');
eq(escapeHtml(''), '', 'empty stays empty');
eq(escapeHtml(0), '0', 'number 0 coerced (not dropped)');
eq(escapeHtml(42), '42', 'number coerced');
eq(escapeHtml(true), 'true', 'boolean coerced');

// ── safe text passes through unchanged ──
eq(escapeHtml('Open Supabase SQL Editor'), 'Open Supabase SQL Editor', 'plain label untouched');
eq(escapeHtml('https://vercel.com/dashboard'), 'https://vercel.com/dashboard', 'plain URL untouched');

// ── parity with the THREE legacy escapers the shared one replaced ──
// devchat escDc / manual-steps esc were `String(s ?? '').replace(/[&<>"']/g, ...)`;
// pdf-export esc was a chained .replace (null → ''). All three produced the
// SAME output for every input. This sweep is the proof the consolidation is
// behavior-identical (and the live regression guards are the devchat-render +
// export-guards suites, which exercise escDc/esc directly through the delegate).
{
  const legacyRegex = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
  const legacyChained = (s) => {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  const samples = [
    'plain', '<b>bold</b>', 'a & b', 'q"uote', "ap'os", '<a href="x">&\'</a>',
    'O\'Brien', 'red;"><script>', '', null, undefined, 0, 42, true,
    'mixed & < > " \' all', 'café — résumé', '日本語', '🎬 emoji',
  ];
  for (const s of samples) {
    eq(escapeHtml(s), legacyRegex(s), `parity vs legacy regex escaper: ${JSON.stringify(s)}`);
    eq(escapeHtml(s), legacyChained(s), `parity vs legacy chained escaper: ${JSON.stringify(s)}`);
  }
}

console.log(`html-escape: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
