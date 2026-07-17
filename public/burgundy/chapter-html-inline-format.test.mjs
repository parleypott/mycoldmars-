// Locks the INLINE-FORMATTING render added to chapterHTML() in the BURGUNDY reader
// (public/burgundy/index.html, commit 4643876). Extracted from the shipped HTML at
// runtime so a drift in index.html breaks this test.
//
// Feature: manuscript text carries markdown emphasis that the reader now restores —
// ~~strike~~ (locked separately in chapter-html-strike.test.mjs), plus ***bold-italic***,
// **bold**, and *italic*. The render is:
//   esc(s)
//     .replace(/~~([^~]+?)~~/g,     '<s>$1</s>')
//     .replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
//     .replace(/\*\*([^*]+?)\*\*/g,     '<strong>$1</strong>')
//     .replace(/\*([^*]+?)\*/g,         '<em>$1</em>')
//
// TWO LOAD-BEARING INVARIANTS this test pins:
//  (A) XSS-SAFETY VIA ESCAPE-FIRST ORDER. esc() runs BEFORE the emphasis replaces.
//      Because the paragraph text is untrusted-shaped (a novel-in-progress book.json),
//      the only safe order is escape-the-whole-string, THEN wrap already-safe content
//      in the sole raw markup this path emits (<s>/<strong>/<em>). Drop esc, or run the
//      replace on the raw string, and a *<script>* payload leaks a LIVE tag into the
//      reader's innerHTML. Proven safe here AND proven unsafe when reversed.
//  (B) PRECEDENCE ORDER triple → double → single. If the single-* rule ran first it
//      would chew **bold** into *<em>bold</em>* garbage. The shipped order is the only
//      one that renders ***/**/* correctly; this test pins bold-italic/bold/italic all
//      render cleanly, which only holds under the shipped precedence.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');
const m = html.match(/function chapterHTML\(ch, ci, esc\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not extract chapterHTML() from index.html — did the function signature change?');
const chapterHTML = (0, eval)('(' + m[0] + ')');

// A minimal esc mirroring the reader's (escapes & < > ").
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Pull just the inner HTML of the first rendered paragraph.
const body = (t) => chapterHTML({ title: 'T', paragraphs: [t] }, 0, esc).match(/data-key="0:0">([\s\S]*?)<\/p>/)[1];

// MUTATION ORACLE: the emphasis pass with NO escaping — the clearest XSS leak, and the
// shape a refactor that flips esc-first order (or drops esc) would produce.
function noEscBody(t) {
  return String(t)
    .replace(/~~([^~]+?)~~/g, '<s>$1</s>')
    .replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+?)\*/g, '<em>$1</em>');
}
// MUTATION ORACLE 2: single-* rule FIRST (precedence broken). Proves the shipped order matters.
function singleFirstBody(t) {
  return esc(t)
    .replace(/\*([^*]+?)\*/g, '<em>$1</em>')
    .replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
}

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// 1. *italic* renders as <em>, surrounding prose intact, markers gone.
{
  const out = body('say *hi* now');
  ok(out === 'say <em>hi</em> now', '*hi* becomes <em>hi</em>, prose intact');
}

// 2. **bold** renders as <strong> — NOT chewed by the single-* rule.
{
  const out = body('say **hi** now');
  ok(out === 'say <strong>hi</strong> now', '**hi** becomes <strong>hi</strong> (precedence: double before single)');
  ok(!out.includes('<em>'), 'no stray <em> leaks from **bold** (single-* rule did not misfire)');
}

// 3. ***bold-italic*** renders as nested <strong><em> — triple wins over double/single.
{
  const out = body('say ***hi*** now');
  ok(out === 'say <strong><em>hi</em></strong> now', '***hi*** becomes <strong><em>hi</em></strong>');
}

// 4. Mixed emphasis on one line each resolve independently.
{
  const out = body('**bold** and *it*');
  ok(out === '<strong>bold</strong> and <em>it</em>', 'bold and italic on one line both wrap correctly');
}

// 5. Strike and emphasis COEXIST (the strike replace runs first, emphasis after).
{
  const out = body('~~cut~~ and *it*');
  ok(out === '<s>cut</s> and <em>it</em>', 'strike + italic render together');
}

// 6. THE XSS PROOF: an emphasized HTML payload is ESCAPED — only <em>/<strong> are raw.
{
  const out = body('*<script>alert(1)</script>*');
  ok(out === '<em>&lt;script&gt;alert(1)&lt;/script&gt;</em>', 'emphasized script tag escaped inside <em>');
  ok(!out.includes('<script>alert(1)'), 'no raw <script> leaks from an italicized payload');
}
{
  const out = body('**<img src=x onerror=alert(1)>**');
  ok(!out.includes('<img src=x onerror'), 'no raw <img onerror> leaks from a bolded payload');
  ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the bolded img payload is fully escaped');
}

// 7. MUTATION PROOF (invariant A) — esc-first order is load-bearing. The no-esc form
//    LEAKS a live <script> on the exact input the shipped form escapes.
{
  const evil = '*<script>alert(1)</script>*';
  ok(!body(evil).includes('<script>alert(1)'), 'shipped (esc-first) does NOT leak a live script');
  ok(noEscBody(evil).includes('<script>alert(1)</script>'), 'MUTATION PROOF: no-esc emphasis DOES leak the live script');
}

// 8. MUTATION PROOF (invariant B) — precedence is load-bearing. Single-* FIRST mangles
//    **bold** into broken *<em>…</em>* output; the shipped order does not.
{
  ok(body('say **hi** now') === 'say <strong>hi</strong> now', 'shipped order renders **bold** cleanly');
  const broken = singleFirstBody('say **hi** now');
  ok(broken.includes('*<em>hi</em>*'), 'MUTATION PROOF: single-* first chews **bold** into *<em>hi</em>*');
}

// 9. textContent stays CLEAN — the note-anchoring invariant. Stripping the emitted tags
//    must leave prose with NO leftover * or ~ markers (offsets the reader counts).
{
  const stripped = body('a ***bi*** b **bo** c *it* d ~~cut~~ e').replace(/<\/?(?:s|strong|em)>/g, '');
  ok(stripped === 'a bi b bo c it d cut e', 'rendered inner text carries no emphasis markers (textContent clean)');
  ok(!/[*~]/.test(stripped), 'no stray * or ~ survive into textContent');
}

// 10. Lone / unbalanced markers are inert — a bare * (math, a single unpaired *) never wraps.
{
  ok(body('2 * 3 = 6') === '2 * 3 = 6', 'a single unpaired * passes through unchanged');
  ok(body('a * b') === 'a * b', 'lone * is inert');
  ok(!body('a **** b').includes('<strong>'), '**** (no inner text) yields no <strong> — regex needs >=1 inner char');
}

// 11. A pure-asterisk line is a SCENE BREAK (caught by the asterism rule upstream), not
//     an empty emphasis span — proves the md pass never sees a bare *** line.
{
  const out = chapterHTML({ title: 'T', paragraphs: ['***'] }, 0, esc);
  ok(out.includes('＊ ＊ ＊'), '*** alone renders as the asterism scene break, not <strong><em></em></strong>');
  ok(!out.includes('<strong><em></em></strong>'), 'no empty bold-italic span from a bare *** line');
}

console.log(`chapter-html-inline-format.test.mjs: ${pass} assertions passed`);
