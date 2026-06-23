// Verifier-layer LOCK for the QSS Explore page render boundary.
//
// The Explore page (queen-scarlet-school/explore/index.html) is Henry's
// world-exploration tool — it renders LLM-generated explorer cards (people,
// places, things, events extracted from the novel + drawn by Gemini) into a
// grid + lightbox. cardInner() builds each card's innerHTML and esc() is the
// PRIMARY XSS-escaping boundary: it escapes the card kind, title, caption,
// id, and image src — every one of which is LLM-generated (the least-trusted
// content on the page) and lands in an innerHTML template literal (a
// double-quoted src="" / alt="" / data-id="" attribute AND text-content
// slots). This is a SEPARATE bundle from the cast page's render boundary
// (cast-render.test.mjs) and the translation html-escape consolidation, so it
// was wholly untested.
//
// No live bug — esc covers all 5 entities (&<>"'), and cardInner escapes every
// interpolation (incl. the data-id="" attribute and the src="" attribute) —
// so this is a verifier-layer LOCK, not a fix. The test EXTRACTS the REAL
// shipped esc() + cardInner() from index.html at runtime (brace-matched +
// new Function, with esc bound into cardInner's scope), so it can never drift
// from a mirror; mutation-proven below with real on-disk edits to index.html.

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

// esc is standalone; cardInner references esc + encodeURIComponent (global),
// so build cardInner with esc's body in the same Function scope — it runs the
// EXACT shipped code, can't drift from a mirror.
const esc = new Function(`${extractFn(html, 'function esc(')}\nreturn esc;`)();
const cardInner = new Function(
  `${extractFn(html, 'function esc(')}\n${extractFn(html, 'function cardInner(')}\nreturn cardInner;`
)();

let passed = 0, failed = 0;
let mutOk = true;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ============================================================
// INLINE RED PROOFS — reconstruct broken variants, show they fail
// ============================================================

t('RED PROOF: a no-escape esc leaks a live <script> through a card title', () => {
  // it.title lands in `<div class="title">${esc(it.title)}</div>`.
  const badEsc = new Function(`function esc(s){ return String(s == null ? '' : s); } return esc;`)();
  const evil = '<script>alert(1)</script>';
  assert.ok(badEsc(evil).includes('<script>'), 'precondition: no-escape leaks');
  assert.ok(!esc(evil).includes('<script>'), 'shipped esc must neutralize the tag');
  // and through the real shipped cardInner:
  assert.ok(!cardInner({ status: 'ready', image_url: 'x', title: evil }).includes('<script>'),
    'cardInner must escape the title');
});

t('RED PROOF: a <>-only esc leaves the attribute-breakout quote intact', () => {
  // it.id lands in `data-id="${esc(it.id)}"` and src in `src="${esc(src)}"` —
  // an unescaped " breaks out of the attribute and injects a handler.
  const badEsc = new Function(`function esc(s){ return String(s == null ? '' : s).replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;'); } return esc;`)();
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

t('esc: ampersand escaped first (no double-escape)', () => {
  assert.equal(esc('<&>'), '&lt;&amp;&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
});

t('esc: attribute-breakout quote neutralized', () => {
  const out = esc('x" onmouseover="alert(1)');
  assert.ok(!out.includes('"'), 'no raw double-quote survives');
  assert.ok(out.includes('&quot;'));
});

t('esc: <script> neutralized', () => {
  const out = esc('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'));
  assert.ok(!out.includes('</script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

t('esc: nullish coercion → empty string (the String(s==null?...) form)', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(''), '');
});

t('esc: 0 is coerced to the string "0" (NOT dropped — uses s==null, not ||)', () => {
  // distinct from the cast esc which uses (s||'') and drops 0; here 0 survives
  assert.equal(esc(0), '0');
});

t('esc: safe text passes through unchanged', () => {
  assert.equal(esc('The Iron Bunker'), 'The Iron Bunker');
});

// ============================================================
// cardInner() — the per-card render boundary
// ============================================================

t('cardInner: kind tag is uppercased AND escaped', () => {
  const out = cardInner({ status: 'queued', kind: 'place', title: 't' });
  assert.ok(out.includes('>PLACE<'), 'kind uppercased in the kind-tag span');
});

t('cardInner: a hostile kind cannot inject markup', () => {
  const out = cardInner({ status: 'queued', kind: '<img src=x onerror=alert(1)>', title: 't' });
  assert.ok(!out.includes('<img'), 'no live <img from the kind tag');
});

t('cardInner: title escaped (XSS in title neutralized)', () => {
  const out = cardInner({ status: 'queued', title: '<script>alert(1)</script>' });
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

t('cardInner: caption escaped, absent caption → empty', () => {
  const out = cardInner({ status: 'queued', title: 't', caption: '"><b>x</b>' });
  assert.ok(!out.includes('<b>x</b>'), 'caption markup neutralized');
  const noCap = cardInner({ status: 'queued', title: 't' });
  assert.ok(noCap.includes('class="caption"'), 'caption slot still rendered empty');
});

t('cardInner: data-id attribute escaped (breakout quote neutralized)', () => {
  const out = cardInner({ status: 'queued', title: 't', id: 'x" onmouseover="alert(1)' });
  assert.ok(!out.includes('onmouseover="alert(1)"'), 'no live handler on the rate buttons');
  assert.ok(out.includes('&quot;'), 'the id quote is entity-escaped');
});

t('cardInner: ready status renders an <img> with escaped src', () => {
  const out = cardInner({ status: 'ready', image_url: 'https://cdn/a.png', title: 't' });
  assert.ok(out.includes('<img src="https://cdn/a.png"'), 'image_url used as src');
  assert.ok(out.includes('loading="lazy"'));
});

t('cardInner: ready status with hostile image_url → src escaped, no breakout', () => {
  const out = cardInner({ status: 'ready', image_url: 'x" onload="alert(1)', title: 't' });
  assert.ok(!out.includes('onload="alert(1)"'), 'no live onload from the src');
  assert.ok(out.includes('&quot;'));
});

t('cardInner: no image_url → falls back to the /api/qss-explorer image route (id encoded)', () => {
  const out = cardInner({ status: 'ready', id: 'abc 123', title: 't' });
  assert.ok(out.includes('/api/qss-explorer?action=image&amp;id=abc%20123'),
    'fallback route used with encodeURIComponent on the id (& entity-escaped in src attr)');
});

t('cardInner: generating / error / queued each render a placeholder, no <img>', () => {
  const gen = cardInner({ status: 'generating', title: 't' });
  const err = cardInner({ status: 'error', title: 't' });
  const q   = cardInner({ status: 'queued', title: 't' });
  assert.ok(gen.includes('placeholder generating') && !gen.includes('<img'));
  assert.ok(err.includes('placeholder error') && !err.includes('<img'));
  assert.ok(q.includes('>queued<') && !q.includes('<img'));
});

t('cardInner: rating up/down toggles the active class on the right button', () => {
  const up = cardInner({ status: 'queued', title: 't', rating: 'up' });
  assert.ok(/rate-btn up active/.test(up), 'up button active when rating=up');
  assert.ok(!/rate-btn down active/.test(up), 'down NOT active');
  const down = cardInner({ status: 'queued', title: 't', rating: 'down' });
  assert.ok(/rate-btn down active/.test(down));
  assert.ok(!/rate-btn up active/.test(down));
  const none = cardInner({ status: 'queued', title: 't' });
  assert.ok(!/rate-btn up active/.test(none) && !/rate-btn down active/.test(none),
    'neither active when no rating');
});

t('cardInner: missing title/kind do not throw and produce no live markup', () => {
  const out = cardInner({ status: 'queued' });
  assert.ok(typeof out === 'string' && out.includes('class="title"'));
});

// ============================================================
// MUTATION PROOF — real source edits to index.html: RED then GREEN
// ============================================================

if (!process.env.__EXPLORE_RENDER_CHILD) {
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
        { stdio: 'pipe', env: { ...process.env, __EXPLORE_RENDER_CHILD: '1' } });
    } catch { red = true; }
    restore();
    if (red) { passed++; } else { failed++; console.error(`✗ MUTATION ${label}: expected RED, got GREEN`); }
  };

  // (1) drop the " escape from esc → attribute-breakout RED
  expectRed('esc drops the " escape',
    `'"':'&quot;'`, `'X_NO_QUOTE':'&quot;'`);
  // (2) cardInner renders the title RAW → XSS-in-title RED
  expectRed('cardInner title rendered raw',
    `<div class="title">\${esc(it.title)}</div>`, `<div class="title">\${it.title}</div>`);
  // (3) cardInner drops the kind toUpperCase → tag-uppercase RED
  expectRed('cardInner kind not uppercased',
    `const tag = (it.kind || '').toUpperCase();`, `const tag = (it.kind || '');`);

  restore();
  unlinkSync(backup);
  const after = readFileSync(htmlPath, 'utf8');
  t('index.html restored byte-identical after mutations', () => {
    assert.equal(after, html);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0 || !mutOk) process.exit(1);
