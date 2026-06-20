/*
 * label-contrast.test.mjs — L2 guard (WCAG AA on chrome labels).
 *
 * Several small-text label tokens (label-3/4/5, lane-lab) painted real <18px chrome text — the
 * "pick a type" hint, the copy toast label, the grip glyph, the REC label — at 2.6–3.5:1, failing
 * WCAG AA (4.5:1 for normal text; the 3:1 large-text exemption does NOT apply below 18px). This test
 * parses styles.css, reconstructs each scheme's token set (inheriting from :root for any token a
 * scheme doesn't override), and asserts every label token used as real text clears 4.5:1 against the
 * lighter of the two surfaces it sits on (frame and face). Pure string parsing — no browser needed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.error('  ✗', name, extra != null ? '— ' + extra : ''); } }

function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function L(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a, b) { const l1 = L(a), l2 = L(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); }

// Pull every `--token: #hex;` out of a CSS block of text.
function tokens(block) {
  const out = {};
  const re = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2];
  return out;
}

// :root is the base; each [data-scheme="X"] overrides a subset and inherits the rest.
const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
ok('found :root block', !!rootMatch);
const root = tokens(rootMatch[1]);

const schemeNames = ['cream', 'cool', 'sepia', 'slate', 'graphite', 'manila'];
const LABEL_TOKENS = ['label-3', 'label-4', 'label-5', 'lane-lab'];

for (const name of schemeNames) {
  let merged;
  if (name === 'cream') {
    merged = root; // cream is the :root default
  } else {
    const m = css.match(new RegExp('\\[data-scheme="' + name + '"\\]\\s*\\{([\\s\\S]*?)\\}'));
    ok('found scheme ' + name, !!m);
    if (!m) continue;
    merged = { ...root, ...tokens(m[1]) };
  }
  const frame = merged['frame'], face = merged['face'];
  ok(name + ' has frame+face', !!frame && !!face);
  for (const t of LABEL_TOKENS) {
    const c = merged[t];
    ok(name + ' has ' + t, !!c);
    if (!c) continue;
    const r = Math.min(ratio(c, frame), ratio(c, face));
    ok(`${name} --${t} (${c}) clears AA 4.5:1`, r >= 4.5, `got ${r.toFixed(2)}:1`);
  }
}

console.log(`label-contrast: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
