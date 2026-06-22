// Verifier-layer LOCK for the QSS Cast page render boundary.
//
// The Cast page (queen-scarlet-school/cast/index.html) is Henry's character
// manager. esc() is its PRIMARY XSS-escaping boundary: it escapes the
// character name (c.name), current_state, portrait notes, and portrait
// id/src — all interpolated into innerHTML template literals (data-name
// attr, ccard-name, alt, the data-tts attr, gallery-thumb title) at ~15 call
// sites. Those fields are Henry-typed AND LLM-generated (Gemini character
// cards) — the least-trusted content on the page — so esc is genuinely
// load-bearing security, and this is a SEPARATE bundle from the translation
// html-escape consolidation, so it was wholly untested.
//
// initials() drives the avatar monogram on every cast card; portraitSrc()
// builds the <img src> (image_url, or a data: URL from dataBase64+mime, or '').
//
// No live bug — esc covers all 5 entities (text + double-quoted-attribute
// contexts), and portraitSrc's data: URLs sit in an <img src> (escaped quote,
// no JS execution) — so this is a verifier-layer LOCK, not a fix. The test
// EXTRACTS the REAL shipped functions from index.html at runtime (brace-matched
// + new Function), so it can never drift from a mirror; mutation-proven below.

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

function build(src, decl, name) {
  return new Function(`${extractFn(src, decl)}\nreturn ${name};`)();
}

const esc = build(html, 'function esc(', 'esc');
const initials = build(html, 'function initials(', 'initials');
const portraitSrc = build(html, 'function portraitSrc(', 'portraitSrc');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ============================================================
// INLINE RED PROOFS — reconstruct broken variants, show they fail
// ============================================================

t('RED PROOF: a no-escape esc leaks a live <script> through a card name', () => {
  const badEsc = new Function(`function esc(s){ return (s||''); } return esc;`)();
  const evil = '<script>alert(1)</script>';
  // Card name is interpolated raw into `<div class="ccard-name">${esc(c.name)}</div>`.
  assert.ok(badEsc(evil).includes('<script>'), 'precondition: no-escape leaks');
  assert.ok(!esc(evil).includes('<script>'), 'shipped esc must neutralize the tag');
});

t('RED PROOF: a <>-only esc leaves the attribute-breakout quote intact', () => {
  // c.name lands in `data-name="${esc(c.name)}"` — an unescaped " breaks out.
  const badEsc = new Function(`function esc(s){ return (s||'').replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;'); } return esc;`)();
  const attack = 'x" onmouseover="alert(1)';
  assert.ok(badEsc(attack).includes('"'), 'precondition: <>-only escaper leaves the quote');
  assert.ok(!esc(attack).includes('"'), 'shipped esc must entity-escape the quote');
});

// ============================================================
// esc() — the XSS boundary
// ============================================================

t('esc: all five entities', () => {
  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('>'), '&gt;');
  assert.equal(esc('"'), '&quot;');
  assert.equal(esc("'"), '&#39;');
});

t('esc: ampersand escaped first (no double-escape of entities)', () => {
  // & must be replaced in the same single pass, not re-escape the ; of &lt;
  assert.equal(esc('<&>'), '&lt;&amp;&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
});

t('esc: attribute-breakout quote neutralized (the data-name="" / data-tts="" context)', () => {
  const out = esc('x" onmouseover="alert(1)');
  assert.ok(!out.includes('"'), 'no raw double-quote survives');
  assert.ok(out.includes('&quot;'));
});

t('esc: <script> neutralized in a text-content slot', () => {
  const out = esc('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'));
  assert.ok(!out.includes('</script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

t('esc: nullish and number coercion', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(''), '');
  // 0 is falsy → '' (the function uses (s || '')); a real card name is never 0.
  assert.equal(esc(0), '');
});

t('esc: safe text passes through unchanged', () => {
  assert.equal(esc('Queen Scarlet'), 'Queen Scarlet');
  assert.equal(esc('Principal Gerald'), 'Principal Gerald');
});

t('esc: a hostile character name has no live markup after escaping', () => {
  const name = 'Sparkle<img src=x onerror=alert(1)>';
  const out = esc(name);
  assert.ok(!out.includes('<img'), 'no live <img');
  assert.ok(!out.includes('onerror=alert(1)>'), 'closing > escaped so no live tag');
});

// ============================================================
// initials() — avatar monogram
// ============================================================

t('initials: first letters of the first two words, uppercased', () => {
  assert.equal(initials('Queen Scarlet'), 'QS');
  assert.equal(initials('principal gerald'), 'PG');
});

t('initials: caps at two letters for 3+ word names', () => {
  assert.equal(initials('Marcus Aurelius Alvarez'), 'MA');
});

t('initials: single word → one letter', () => {
  assert.equal(initials('Kevin'), 'K');
  assert.equal(initials('zoe'), 'Z');
});

t('initials: collapses extra whitespace', () => {
  assert.equal(initials('  Queen   Scarlet  '), 'QS');
});

t('initials: empty / null / whitespace → ?', () => {
  assert.equal(initials(''), '?');
  assert.equal(initials(null), '?');
  assert.equal(initials(undefined), '?');
  assert.equal(initials('   '), '?');
});

// ============================================================
// portraitSrc() — <img src> builder
// ============================================================

t('portraitSrc: null / falsy → empty string', () => {
  assert.equal(portraitSrc(null), '');
  assert.equal(portraitSrc(undefined), '');
});

t('portraitSrc: image_url wins when present', () => {
  assert.equal(portraitSrc({ image_url: 'https://cdn/x.png', dataBase64: 'AAAA' }), 'https://cdn/x.png');
});

t('portraitSrc: builds a data: URL from dataBase64 + mime', () => {
  assert.equal(portraitSrc({ dataBase64: 'AAAA', mime: 'image/jpeg' }), 'data:image/jpeg;base64,AAAA');
});

t('portraitSrc: default mime is image/png', () => {
  assert.equal(portraitSrc({ dataBase64: 'BBBB' }), 'data:image/png;base64,BBBB');
});

t('portraitSrc: no bytes → empty string', () => {
  assert.equal(portraitSrc({}), '');
  assert.equal(portraitSrc({ image_url: '' }), '');
  assert.equal(portraitSrc({ image_url: 123 }), ''); // non-string image_url ignored
});

t('portraitSrc: the built data: URL sits behind esc() in the src attribute (defense)', () => {
  // portraitSrc is always wrapped as esc(portraitSrc(p)) at the src="" sites;
  // a hostile mime can't break out of the attribute once escaped.
  const src = portraitSrc({ dataBase64: 'AAAA', mime: 'image/png" onload="x' });
  assert.ok(!esc(src).includes('"'), 'escaped src cannot break the attribute');
});

// ============================================================
// MUTATION PROOF — real source edits to index.html: RED then GREEN
// ============================================================

// Only the top-level invocation runs the mutation harness (guard against the
// child process recursing forever).
if (!process.env.__CAST_RENDER_CHILD) {
  const backup = htmlPath + '.bak';
  copyFileSync(htmlPath, backup);
  const restore = () => copyFileSync(backup, htmlPath);
  // Each mutation should drive the child RED; the expected non-zero exit is GREEN.
  const expectRed = (label, from, to) => {
    const cur = readFileSync(htmlPath, 'utf8');
    if (!cur.includes(from)) { console.error(`✗ MUT ${label}: anchor missing`); mutOk = false; return; }
    writeFileSync(htmlPath, cur.replace(from, to));
    let red = false;
    try {
      execSync(`bun ${JSON.stringify(fileURLToPath(import.meta.url))}`,
        { stdio: 'pipe', env: { ...process.env, __CAST_RENDER_CHILD: '1' } });
    } catch { red = true; }
    restore();
    if (red) { passed++; } else { failed++; console.error(`✗ MUTATION ${label}: expected RED, got GREEN`); }
  };

  // (1) drop the " escape from esc → attribute-breakout RED
  expectRed('esc drops the " escape',
    `'"':'&quot;'`, `'X_NO_QUOTE':'&quot;'`);
  // (2) initials slice(0,2) → slice(0,1) → two-word name RED
  expectRed('initials caps at 1 not 2',
    `.slice(0, 2).join('')`, `.slice(0, 1).join('')`);
  // (3) portraitSrc default mime png → gif → default-mime RED
  expectRed('portraitSrc default mime changed',
    `const mime = p.mime || 'image/png';`, `const mime = p.mime || 'image/gif';`);

  // restore + confirm byte-identical
  restore();
  unlinkSync(backup);
  const after = readFileSync(htmlPath, 'utf8');
  t('index.html restored byte-identical after mutations', () => {
    assert.equal(after, html);
  });
}

console.log(`\ncast-render: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
