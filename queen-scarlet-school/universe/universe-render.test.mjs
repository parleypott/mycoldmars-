// Verifier-layer LOCK for the QSS Universe page render + color cores.
//
// The Universe page (queen-scarlet-school/universe/index.html) is the
// world-PICKER — the FIRST page Henry sees: a Three.js orrery where each world
// in the WORLDS registry (window.QSSWorlds.list()) becomes a planet with an
// HTML label. It was entirely untested (flagged 3x in memory). Its load-bearing
// pure cores:
//   - escHtml(s)      → the render boundary: world shortName/name/tagline are
//                       interpolated into label.innerHTML via escHtml. This is
//                       real correctness, not just XSS-theater — a legitimate
//                       registry tagline with `&` or `'` (e.g. "Wordy's World",
//                       "Mom & Me") renders BROKEN without it.
//   - hexToRgba(hex,a)→ feeds the canvas radial-gradient sprites (sun/glow).
//   - pickAccent(w)/pickGlow(w) → choose the planet body + halo color from a
//                       world's colors, with a fallback chain.
//
// No live bug (escHtml covers all 5 entities; hexToRgba parses a 6-char hex;
// the pick fallback chains are correct) — so this is a verifier-layer LOCK
// (same standard as the cast-render / explore-render / westchester locks), NOT
// a fix. The test EXTRACTS the REAL shipped functions from index.html at
// runtime (brace-matched + new Function) — they reference only globals, so they
// materialize self-contained and can't drift from a mirror. Mutation-proven
// below with real on-disk edits to index.html: RED then GREEN.

import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, 'index.html');
const html = readFileSync(htmlPath, 'utf8');

// --- extract a `function NAME(...) { ... }` block by brace-matching ---
function extractFn(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`could not find ${decl}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// All four are standalone and reference only globals (String/parseInt/optional
// chaining) — extract each into its own Function scope; runs the EXACT shipped
// code, can't drift from a mirror.
const escHtml   = new Function(`${extractFn(html, 'function escHtml(')}\nreturn escHtml;`)();
const hexToRgba = new Function(`${extractFn(html, 'function hexToRgba(')}\nreturn hexToRgba;`)();
const pickAccent = new Function(`${extractFn(html, 'function pickAccent(')}\nreturn pickAccent;`)();
const pickGlow  = new Function(`${extractFn(html, 'function pickGlow(')}\nreturn pickGlow;`)();

let passed = 0, failed = 0;
let mutOk = true;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ============================================================
// INLINE RED PROOFS — reconstruct broken variants, show they fail
// ============================================================

t('RED PROOF: a no-escape escHtml leaves a registry `&` raw (broken HTML entity)', () => {
  // w.tagline lands in `<span class="label-tagline">${escHtml(w.tagline||'')}</span>`.
  const bad = new Function(`function escHtml(s){ return String(s || ''); } return escHtml;`)();
  assert.ok(bad('Mom & Me').includes(' & '), 'precondition: no-escape leaves the raw &');
  assert.equal(escHtml('Mom & Me'), 'Mom &amp; Me', 'shipped escHtml must entity-escape &');
});

t('RED PROOF: a <>-only escHtml leaves the attribute-breakout quote intact', () => {
  const bad = new Function(`function escHtml(s){ return String(s||'').replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;'); } return escHtml;`)();
  const attack = 'x" onmouseover="alert(1)';
  assert.ok(bad(attack).includes('"'), 'precondition: <>-only leaves the quote');
  assert.ok(!escHtml(attack).includes('"'), 'shipped escHtml must escape the quote');
});

// ============================================================
// escHtml — the label render boundary
// ============================================================

t('escHtml: all five entities', () => {
  assert.equal(escHtml('&'), '&amp;');
  assert.equal(escHtml('<'), '&lt;');
  assert.equal(escHtml('>'), '&gt;');
  assert.equal(escHtml('"'), '&quot;');
  assert.equal(escHtml("'"), '&#39;');
});

t('escHtml: ampersand escaped first (no double-escape)', () => {
  assert.equal(escHtml('<&>'), '&lt;&amp;&gt;');
  assert.equal(escHtml('a & b'), 'a &amp; b');
});

t("escHtml: a real registry tagline with an apostrophe renders correctly", () => {
  // "Wordy's World" — the legitimate-content case this boundary actually protects
  assert.equal(escHtml("Wordy's World"), 'Wordy&#39;s World');
});

t('escHtml: <script> neutralized', () => {
  const out = escHtml('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

t('escHtml: plain text passes through unchanged', () => {
  assert.equal(escHtml('Queen Scarlet'), 'Queen Scarlet');
  assert.equal(escHtml('the dragon school'), 'the dragon school');
});

t('escHtml: nullish/falsy → empty string (String(s || "") form)', () => {
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
  assert.equal(escHtml(''), '');
  assert.equal(escHtml(0), ''); // String(0||'') drops 0 — labels are never 0
});

// ============================================================
// hexToRgba — canvas gradient color builder
// ============================================================

t('hexToRgba: 6-char hex → correct per-channel rgba', () => {
  assert.equal(hexToRgba('#FFD93D', 0.5), 'rgba(255,217,61,0.5)');
  assert.equal(hexToRgba('#000000', 1), 'rgba(0,0,0,1)');
  assert.equal(hexToRgba('#FFFFFF', 0), 'rgba(255,255,255,0)');
});

t('hexToRgba: leading # is optional', () => {
  assert.equal(hexToRgba('FFD93D', 0.5), 'rgba(255,217,61,0.5)');
  assert.equal(hexToRgba('#FFD93D', 0.5), hexToRgba('FFD93D', 0.5));
});

t('hexToRgba: channels are independent (R/G/B read distinct byte pairs)', () => {
  // a regression reading the wrong slice would collapse channels
  assert.equal(hexToRgba('#102030', 1), 'rgba(16,32,48,1)');
});

t('hexToRgba: alpha is passed through verbatim', () => {
  assert.equal(hexToRgba('#123456', 0.42), 'rgba(18,52,86,0.42)');
});

// ============================================================
// pickAccent / pickGlow — color selection from a world record
// ============================================================

t('pickAccent: accent wins over primary', () => {
  assert.equal(pickAccent({ colors: { accent: '#AAA111', primary: '#BBB222' } }), '#AAA111');
});

t('pickAccent: falls to primary when no accent', () => {
  assert.equal(pickAccent({ colors: { primary: '#BBB222' } }), '#BBB222');
});

t('pickAccent: falls to planet ring color when no accent/primary', () => {
  assert.equal(pickAccent({ colors: {}, planet: { ring: { color: '#CCC333' } } }), '#CCC333');
});

t('pickAccent: final fallback default when nothing set', () => {
  assert.equal(pickAccent({}), '#FFD93D');
  assert.equal(pickAccent({ colors: {} }), '#FFD93D');
});

t('pickAccent: missing planet does not throw (optional chaining)', () => {
  assert.equal(pickAccent({ colors: {} }), '#FFD93D');
  assert.doesNotThrow(() => pickAccent({ colors: {}, planet: {} }));
});

t('pickGlow: binds to the same color as pickAccent (halo follows body)', () => {
  const w1 = { colors: { accent: '#AAA111', primary: '#BBB222' } };
  const w2 = { colors: { primary: '#BBB222' } };
  const w3 = { colors: {}, planet: { ring: { color: '#CCC333' } } };
  const w4 = {};
  for (const w of [w1, w2, w3, w4]) {
    assert.equal(pickGlow(w), pickAccent(w), 'glow and accent must agree');
  }
});

// ============================================================
// MUTATION PROOF — real source edits to index.html: RED then GREEN
// ============================================================

if (!process.env.__UNIVERSE_RENDER_CHILD) {
  const backup = htmlPath + '.bak';
  copyFileSync(htmlPath, backup);
  const restore = () => copyFileSync(backup, htmlPath);
  const expectRed = (label, from, to) => {
    const cur = readFileSync(htmlPath, 'utf8');
    if (!cur.includes(from)) { console.error(`✗ MUT ${label}: anchor missing`); mutOk = false; failed++; return; }
    writeFileSync(htmlPath, cur.replace(from, to));
    let red = false;
    try {
      execSync(`bun ${JSON.stringify(fileURLToPath(import.meta.url))}`,
        { stdio: 'pipe', env: { ...process.env, __UNIVERSE_RENDER_CHILD: '1' } });
    } catch { red = true; }
    restore();
    if (red) { passed++; } else { failed++; console.error(`✗ MUTATION ${label}: expected RED, got GREEN`); }
  };

  // (1) escHtml drops the " escape → attribute-breakout RED
  expectRed('escHtml drops the " escape',
    `'"':'&quot;'`, `'Z':'&quot;'`);
  // (2) escHtml drops the & escape → registry-& RED
  expectRed('escHtml drops the & escape',
    `'&':'&amp;'`, `'Z':'&amp;'`);
  // (3) hexToRgba reads the wrong byte pair for green → channel-collapse RED
  expectRed('hexToRgba green reads the red byte pair',
    `const g = parseInt(h.slice(2,4), 16);`, `const g = parseInt(h.slice(0,2), 16);`);
  // (4) pickAccent drops the accent preference → accent-vs-primary RED
  //     (first occurrence is pickAccent's line; pickGlow's identical line is untouched)
  expectRed('pickAccent no longer prefers accent',
    `return c.accent || c.primary || (w.planet?.ring?.color) || '#FFD93D';`,
    `return c.primary || (w.planet?.ring?.color) || '#FFD93D';`);

  restore();
  unlinkSync(backup);
  const after = readFileSync(htmlPath, 'utf8');
  t('index.html restored byte-identical after mutations', () => {
    assert.equal(after, html);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0 || !mutOk) process.exit(1);
