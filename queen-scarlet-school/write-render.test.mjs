// Lock the QSS WRITE page's render-escaping boundary (esc + escHtml).
//
// queen-scarlet-school/index.html is Henry's PRIMARY tool — the write app where
// the most untrusted content in the whole QSS system gets rendered into the UI:
// Henry's typed story text AND Gemini-generated content (block options, Wordy
// freestyle chat, character names, scene titles). Both render via .innerHTML.
//
// esc() and escHtml() are byte-identical 5-entity HTML-entity escapers and they
// are the ONLY thing standing between that content and stored XSS / broken
// markup. They're used in 90+ sites, MANY in DOUBLE-QUOTED ATTRIBUTES —
// data-tts="${esc(blockText)}", data-name="${esc(name)}", aria-label="${esc(..)}",
// <option value="${esc(v.id)}">, <img src="${esc(url)}" alt="${esc(title)}">,
// data-voice-for="${esc(c.name)}", data-id="${escHtml(m.id)}", etc. So the
// quote escape ("→&quot;) is LOAD-BEARING for both correctness (a character
// name with a " would break the attribute) AND XSS (a name/title can inject an
// event handler by breaking out of the attribute).
//
// No live bug — esc/escHtml cover all 5 entities — so this is a verifier-layer
// LOCK (same standard as cast-render / explore-render / universe-render /
// burma-essays markup), NOT a fix. ZERO source change: the test EXTRACTS the
// real shipped functions from index.html at runtime, so it can't drift.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dirname, 'index.html');
const ORIGINAL = readFileSync(INDEX, 'utf8');
const origHash = createHash('md5').update(ORIGINAL).digest('hex');

// Each escaper is a single self-contained line ending in `})[c]); }`.
const ESC_RE = /function esc\(s\)\s*\{[\s\S]*?\}\)\[c\]\);\s*\}/;
const ESCHTML_RE = /function escHtml\(s\)\s*\{[\s\S]*?\}\)\[c\]\);\s*\}/;

function materialize(src, name) {
  return new Function(src + '; return ' + name + ';')();
}
function extract(html, re, name) {
  const m = html.match(re);
  if (!m) throw new Error('could not extract ' + name + ' from index.html');
  return { src: m[0], fn: materialize(m[0], name) };
}

let pass = 0,
  fail = 0;
function t(desc, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.error('  ✗ ' + desc + '\n     ' + e.message);
  }
}

const escReal = extract(ORIGINAL, ESC_RE, 'esc');
const escHtmlReal = extract(ORIGINAL, ESCHTML_RE, 'escHtml');
const esc = escReal.fn;
const escHtml = escHtmlReal.fn;

// ── RED PROOFS (reconstruct mutants from the REAL extracted source) ──────────
// A <>-only escaper (the pre-quote-escape era) leaves the attribute-breakout
// quote raw — proving the " escape in the shipped fn is load-bearing.
t('RED proof: a <>-only esc leaves the attribute-breakout quote raw', () => {
  const mutSrc = escReal.src.replace(`[&<>"']`, `[&<>]`);
  const mutEsc = materialize(mutSrc, 'esc');
  const attack = 'x" onmouseover="alert(1)';
  assert.ok(mutEsc(attack).includes('"'), 'mutant should leave a raw "');
  assert.ok(!esc(attack).includes('"'), 'real esc must escape every "');
  assert.ok(esc(attack).includes('&quot;'), 'real esc emits &quot;');
});

t('RED proof: a no-op escaper leaves a live <script> (real esc neutralizes it)', () => {
  const noop = (s) => s;
  const payload = '<script>alert(1)</script>';
  assert.ok(noop(payload).includes('<script'), 'no-op leaves raw <script');
  assert.ok(!esc(payload).includes('<script'), 'real esc neutralizes <script');
  assert.ok(esc(payload).includes('&lt;script'), 'real esc emits &lt;script');
});

// ── esc: 5-entity contract ───────────────────────────────────────────────────
t('esc escapes &', () => assert.strictEqual(esc('a & b'), 'a &amp; b'));
t('esc escapes <', () => assert.strictEqual(esc('a < b'), 'a &lt; b'));
t('esc escapes >', () => assert.strictEqual(esc('a > b'), 'a &gt; b'));
t('esc escapes "', () => assert.strictEqual(esc('say "hi"'), 'say &quot;hi&quot;'));
t("esc escapes '", () => assert.strictEqual(esc("it's"), 'it&#39;s'));
t('esc all five at once', () =>
  assert.strictEqual(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;'));
t('esc ampersand-first, no double-escape', () => {
  // & must be replaced first so &lt; does not become &amp;lt;
  assert.strictEqual(esc('<'), '&lt;');
  assert.strictEqual(esc('&lt;'), '&amp;lt;'); // a literal "&lt;" → escape only the &
});
t('esc plain text passes through unchanged', () =>
  assert.strictEqual(esc('Queen Scarlet flew over the school'), 'Queen Scarlet flew over the school'));
t('esc nullish → empty string', () => {
  assert.strictEqual(esc(null), '');
  assert.strictEqual(esc(undefined), '');
  assert.strictEqual(esc(''), '');
});
t('esc(0) → "" (0 coerced by `0 || ""`)', () => assert.strictEqual(esc(0), ''));
t('esc attribute-breakout payload fully defanged', () => {
  const out = esc('x" onmouseover="alert(1)');
  assert.ok(!out.includes('"'), 'no raw "');
  assert.ok(out.includes('&quot;'));
});
t('esc <script> neutralized', () => {
  const out = esc('<script>alert(1)</script>');
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('</script'));
});
t('esc a realistic Henry character name with quote + ampersand', () => {
  // e.g. a name typed into the write UI, rendered into data-name="..."
  assert.strictEqual(esc(`Bob "the Brave" & Sons`), 'Bob &quot;the Brave&quot; &amp; Sons');
});

// ── escHtml: same 5-entity contract (the freestyle/theme render copy) ─────────
t('escHtml escapes all five', () =>
  assert.strictEqual(escHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;'));
t('escHtml escapes the breakout quote', () => {
  const out = escHtml('a" onfocus="x');
  assert.ok(!out.includes('"'));
  assert.ok(out.includes('&quot;'));
});
t('escHtml neutralizes a live tag (Wordy/LLM chat content)', () => {
  const out = escHtml('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('&lt;img'));
});
t('escHtml ampersand-first, no double-escape', () =>
  assert.strictEqual(escHtml('&lt;'), '&amp;lt;'));
t('escHtml nullish/0 → empty', () => {
  assert.strictEqual(escHtml(null), '');
  assert.strictEqual(escHtml(undefined), '');
  assert.strictEqual(escHtml(0), '');
});

// ── divergent-copy lock: esc and escHtml must stay identical ──────────────────
t('esc and escHtml produce identical output (no drift between copies)', () => {
  const inputs = [
    `&<>"'`,
    'plain',
    'a" onmouseover="x',
    '<script>x</script>',
    'Bob & "Q"',
    '',
    "it's a < test >",
  ];
  for (const s of inputs) {
    assert.strictEqual(esc(s), escHtml(s), 'divergence on: ' + JSON.stringify(s));
  }
});

// ── REAL on-disk mutations: prove the lock is over the live file ─────────────
// Mutate index.html, re-extract from the mutated file, assert the mutant
// misbehaves (the lock would catch it), then restore. try/finally guarantees
// restoration; a final md5 check proves byte-identical restore.
function onDiskMutation(desc, mutate, assertMutant) {
  let restored = false;
  try {
    const mutatedHtml = mutate(ORIGINAL);
    assert.notStrictEqual(mutatedHtml, ORIGINAL, 'mutation must change the file');
    writeFileSync(INDEX, mutatedHtml);
    const reread = readFileSync(INDEX, 'utf8');
    assertMutant(reread);
    pass++;
  } catch (e) {
    fail++;
    console.error('  ✗ ' + desc + '\n     ' + e.message);
  } finally {
    writeFileSync(INDEX, ORIGINAL);
    restored = true;
  }
  if (!restored) writeFileSync(INDEX, ORIGINAL);
}

onDiskMutation(
  'on-disk: drop esc " escape (char class → [&<>]) → quote left raw',
  (html) => html.replace(escReal.src, escReal.src.replace(`[&<>"']`, `[&<>]`)),
  (html) => {
    const mut = extract(html, ESC_RE, 'esc').fn;
    assert.ok(mut('a"b').includes('"'), 'mutated esc must leave a raw " (RED)');
  }
);

onDiskMutation(
  'on-disk: drop escHtml " escape → quote left raw',
  (html) => html.replace(escHtmlReal.src, escHtmlReal.src.replace(`[&<>"']`, `[&<>]`)),
  (html) => {
    const mut = extract(html, ESCHTML_RE, 'escHtml').fn;
    assert.ok(mut('a"b').includes('"'), 'mutated escHtml must leave a raw " (RED)');
  }
);

onDiskMutation(
  'on-disk: drop esc & escape (char class → [<>"\']) → ampersand left raw',
  (html) => html.replace(escReal.src, escReal.src.replace(`[&<>"']`, `[<>"']`)),
  (html) => {
    const mut = extract(html, ESC_RE, 'esc').fn;
    assert.strictEqual(mut('a & b'), 'a & b', 'mutated esc must leave a raw & (RED)');
  }
);

// ── file restored byte-identical ─────────────────────────────────────────────
t('index.html restored byte-identical after on-disk mutations', () => {
  const now = createHash('md5').update(readFileSync(INDEX, 'utf8')).digest('hex');
  assert.strictEqual(now, origHash, 'index.html must be byte-identical after mutations');
});

console.log(`write-render: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
